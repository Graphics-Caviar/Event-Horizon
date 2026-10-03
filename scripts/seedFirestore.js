/**
 * seedFirestore.js
 * Seeds the static /achievements reference data and some demo leaderboard
 * rows into Cloud Firestore.
 *
 * Usage:
 *   npm run seed
 *
 * READ THIS BEFORE EXPECTING ACHIEVEMENTS TO SEED
 * -----------------------------------------------
 * firestore.rules deliberately blocks part of what this script does:
 *
 *   /achievements                    allow write: if false -> always denied
 *   /leaderboards/{level}/scores     requires auth.uid == data.userId
 *
 * Leaderboard rows seed fine: the script signs in anonymously and stamps
 * that uid on every row, which is what the rules require.
 *
 * Achievements CANNOT be seeded by this script at all. `allow write: if
 * false` applies to any client-SDK caller, authenticated or not — and the
 * emulator loads the same rules file, so running against the emulator does
 * NOT get round it (verified: 0/7 written, denied at firestore.rules L48).
 * To populate /achievements, pick one:
 *
 *   1. Seed BEFORE deploying rules. A brand-new database created in test
 *      mode allows writes for 30 days, so:
 *        npm run seed
 *        firebase deploy --only firestore:rules,firestore:indexes
 *      This is the easiest path on a fresh project.
 *   2. Use the Admin SDK, which bypasses rules entirely. Against the
 *      emulator it needs no service account (just FIRESTORE_EMULATOR_HOST
 *      and a project id); against live it needs a service-account key.
 *      Requires adding `firebase-admin` as a devDependency.
 *   3. Relax the /achievements write rule temporarily, seed, then restore
 *      it. Quickest one-off, easiest to forget to undo.
 *   4. Add the 7 documents by hand in the Firebase console or Emulator UI.
 */

import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth'
import {
	getFirestore,
	doc,
	setDoc,
	collection,
	serverTimestamp,
	connectFirestoreEmulator,
} from 'firebase/firestore'

/** Minimal .env reader so this script needs no dotenv dependency. */
function loadEnv(path = '.env') {
	try {
		for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
			const match = line.match(
				/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/
			)
			if (match && !process.env[match[1]]) {
				process.env[match[1]] = match[2].replace(
					/^["']|["']$/g,
					''
				)
			}
		}
	} catch {
		// No .env file — fall through to whatever is already in the
		// environment and let the missing-config check below report it.
	}
}

loadEnv()

// No hardcoded fallbacks: the credentials belong in .env (which is
// gitignored) so this script and the game can never drift onto different
// projects, and so a checkout does not carry someone else's project id.
const firebaseConfig = {
	apiKey: process.env.VITE_FIREBASE_API_KEY,
	authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: process.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: process.env.VITE_FIREBASE_APP_ID,
}

const USE_EMULATOR =
	String(process.env.VITE_FIREBASE_USE_EMULATOR || '').toLowerCase() ===
	'true'

const DEFAULT_ACHIEVEMENTS = [
	{
		achievementId: 'ESCAPE_SINGULARITY',
		title: 'Escape the Singularity',
		description:
			'Successfully escape the black hole event horizon in Level 1.',
		iconPath: 'public/assets/images/achievements/escape_singularity.png',
		level: 1,
	},
	{
		achievementId: 'GRAVITY_SURVIVOR',
		title: 'Gravitational Resiliency',
		description:
			'Survive the alien planet gravity remapping storm in Level 2.',
		iconPath: 'public/assets/images/achievements/gravity_survivor.png',
		level: 2,
	},
	{
		achievementId: 'ROVER_PILOT',
		title: 'Exodus Pilot',
		description:
			'Successfully drive the rover across the hostile terrain to the alien portal.',
		iconPath: 'public/assets/images/achievements/rover_pilot.png',
		level: 2,
	},
	{
		achievementId: 'DIMENSION_HOPPER',
		title: 'Reality Shifter',
		description:
			'Shift between Matter, Energy, and Void dimensions 20 times in Level 3.',
		iconPath: 'public/assets/images/achievements/dimension_hopper.png',
		level: 3,
	},
	{
		achievementId: 'OVERDRIVE_MASTER',
		title: 'Quantum Overdrive Master',
		description:
			'Activate Quantum Overdrive 5 times across your playthroughs.',
		iconPath: 'public/assets/images/achievements/overdrive_master.png',
		level: 3,
	},
	{
		achievementId: 'DEVOURER_SLAYER',
		title: 'Cosmic Deliverance',
		description:
			'Defeat The Devourer and destroy its core in Level 3.',
		iconPath: 'public/assets/images/achievements/devourer_slayer.png',
		level: 3,
	},
	{
		achievementId: 'NITROGEN_HOARDER',
		title: 'Nitrogen Harvest King',
		description:
			'Collect 100 or more total Nitrogen canisters across playthroughs.',
		iconPath: 'public/assets/images/achievements/nitrogen_hoarder.png',
		level: 'global',
	},
]

/** Turn the usual seeding failures into the fix, not a stack trace. */
function explainWriteFailure(error, collectionLabel) {
	if (error?.code === 'permission-denied') {
		return (
			`denied by firestore.rules (${collectionLabel}). ` +
			'See the header of this file for the three ways round it.'
		)
	}
	if (error?.code === 'not-found') {
		return (
			'no Firestore database exists for this project yet. ' +
			'Firebase Console -> Build -> Firestore Database -> Create database.'
		)
	}
	if (error?.code === 'unavailable') {
		return USE_EMULATOR
			? 'cannot reach the emulator. Start it with: firebase emulators:start'
			: 'cannot reach Firestore (offline?).'
	}
	return error?.message || String(error)
}

async function seed() {
	console.log('--- Event Horizon Firestore Seeder ---')

	const missing = ['apiKey', 'projectId', 'appId'].filter(
		(key) => !firebaseConfig[key]
	)
	if (missing.length > 0) {
		throw new Error(
			`Missing Firebase config: ${missing.join(', ')}. ` +
				'Copy .env.example to .env and fill in the VITE_FIREBASE_* values.'
		)
	}

	console.log(`Project: ${firebaseConfig.projectId}`)
	console.log(`Target:  ${USE_EMULATOR ? 'LOCAL EMULATOR' : 'LIVE'}`)

	const app = initializeApp(firebaseConfig)
	const db = getFirestore(app)
	const auth = getAuth(app)

	if (USE_EMULATOR) {
		connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
			disableWarnings: true,
		})
		connectFirestoreEmulator(db, '127.0.0.1', 8080)
	}

	// The leaderboard rules require request.auth.uid to match the userId on
	// each row, so seed rows have to belong to a real (anonymous) account.
	let uid = null
	try {
		const credential = await signInAnonymously(auth)
		uid = credential.user.uid
		console.log(`Signed in anonymously as ${uid}`)
	} catch (error) {
		console.warn(
			`! Could not sign in: ${error?.code || error?.message}. ` +
				'Leaderboard seeding will be skipped.'
		)
	}

	// 1. Seed Achievements
	console.log(
		'\n[1/2] Seeding static achievements (/achievements/{achievementId})...'
	)
	let achievementsSeeded = 0
	for (const ach of DEFAULT_ACHIEVEMENTS) {
		const achDocRef = doc(db, 'achievements', ach.achievementId)
		try {
			await setDoc(
				achDocRef,
				{
					achievementId: ach.achievementId,
					title: ach.title,
					description: ach.description,
					iconPath: ach.iconPath,
					level: ach.level,
				},
				{ merge: true }
			)
			achievementsSeeded++
			console.log(
				`  ✓ Seeded achievement: ${ach.achievementId}`
			)
		} catch (error) {
			console.warn(
				`  ✗ ${ach.achievementId}: ${explainWriteFailure(error, '/achievements is write-denied')}`
			)
			// Every achievement will fail the same way — stop after the first.
			break
		}
	}

	// 2. Seed Default Leaderboard High Scores
	console.log(
		'\n[2/2] Seeding initial leaderboard scores (/leaderboards/{levelId}/scores)...'
	)
	const initialScores = {
		level_1: [
			{
				userId: 'seed_pilot_1',
				displayName: 'Commander_Nova',
				score: 12500,
				timeElapsed: 74.2,
				nitrogenCollected: 48,
			},
			{
				userId: 'seed_pilot_2',
				displayName: 'Vanguard_99',
				score: 10400,
				timeElapsed: 88.5,
				nitrogenCollected: 36,
			},
			{
				userId: 'seed_pilot_3',
				displayName: 'Pilot_Zeta',
				score: 8200,
				timeElapsed: 95.0,
				nitrogenCollected: 25,
			},
		],
		level_2: [
			{
				userId: 'seed_pilot_1',
				displayName: 'Commander_Nova',
				score: 21800,
				timeElapsed: 142.1,
				nitrogenCollected: 72,
			},
			{
				userId: 'seed_pilot_2',
				displayName: 'Vanguard_99',
				score: 18500,
				timeElapsed: 160.0,
				nitrogenCollected: 58,
			},
		],
		level_3: [
			{
				userId: 'seed_pilot_1',
				displayName: 'Commander_Nova',
				score: 35000,
				timeElapsed: 220.4,
				nitrogenCollected: 110,
			},
		],
		global: [
			{
				userId: 'seed_pilot_1',
				displayName: 'Commander_Nova',
				score: 69300,
				timeElapsed: 436.7,
				nitrogenCollected: 230,
			},
			{
				userId: 'seed_pilot_2',
				displayName: 'Vanguard_99',
				score: 54100,
				timeElapsed: 510.2,
				nitrogenCollected: 180,
			},
		],
	}

	let scoresSeeded = 0
	if (!uid) {
		console.warn('  ! Skipped: not signed in.')
	} else {
		outer: for (const [levelId, scores] of Object.entries(
			initialScores
		)) {
			const scoresCol = collection(
				db,
				'leaderboards',
				levelId,
				'scores'
			)
			for (const score of scores) {
				// The seeded pilot names are kept for flavour, but the
				// userId must be the signed-in uid or the rules reject
				// the write. These are demo rows owned by one seed
				// account, not real per-player entries.
				const ref = doc(scoresCol)
				try {
					await setDoc(ref, {
						...score,
						scoreId: ref.id,
						userId: uid,
						achievedAt: serverTimestamp(),
					})
					scoresSeeded++
					console.log(
						`  ✓ Added score for ${levelId}: ${score.displayName} (${score.score} pts)`
					)
				} catch (error) {
					console.warn(
						`  ✗ ${levelId}: ${explainWriteFailure(error, '/leaderboards create')}`
					)
					break outer
				}
			}
		}
	}

	console.log(
		`\nDone: ${achievementsSeeded}/${DEFAULT_ACHIEVEMENTS.length} achievements, ${scoresSeeded} leaderboard rows.`
	)
	if (achievementsSeeded === 0) {
		console.log(
			'Achievements are write-denied by firestore.rules — see this file’s header for how to seed them.'
		)
	}
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('Seeding failed:', err?.message || err)
		process.exit(1)
	})
