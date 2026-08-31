/**
 * seedFirestore.js
 * Node.js script to seed default achievements and initial leaderboard test records
 * into Cloud Firestore.
 *
 * Usage:
 *   node scripts/seedFirestore.js
 */

import { initializeApp } from 'firebase/app'
import {
	getFirestore,
	doc,
	setDoc,
	collection,
	addDoc,
	serverTimestamp,
} from 'firebase/firestore'

const firebaseConfig = {
	apiKey:
		process.env.VITE_FIREBASE_API_KEY ||
		'AIzaSyB-Z6y1RZLuSVfGvDi27WsfaBARe8zrRkQ',
	authDomain:
		process.env.VITE_FIREBASE_AUTH_DOMAIN ||
		'event-horizon-335a2.firebaseapp.com',
	projectId:
		process.env.VITE_FIREBASE_PROJECT_ID || 'event-horizon-335a2',
	storageBucket:
		process.env.VITE_FIREBASE_STORAGE_BUCKET ||
		'event-horizon-335a2.firebasestorage.app',
	messagingSenderId:
		process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '148619920881',
	appId:
		process.env.VITE_FIREBASE_APP_ID ||
		'1:148619920881:web:82332ad8cc90d78ff03050',
}

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

async function seed() {
	console.log('--- Event Horizon Firestore Seeder ---')
	console.log(`Connecting to project: ${firebaseConfig.projectId}...`)

	const app = initializeApp(firebaseConfig)
	const db = getFirestore(app)

	// 1. Seed Achievements
	console.log(
		'\n[1/2] Seeding static achievements (/achievements/{achievementId})...'
	)
	for (const ach of DEFAULT_ACHIEVEMENTS) {
		const achDocRef = doc(db, 'achievements', ach.achievementId)
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
		console.log(`  ✓ Seeded achievement: ${ach.achievementId}`)
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

	for (const [levelId, scores] of Object.entries(initialScores)) {
		const scoresCol = collection(
			db,
			'leaderboards',
			levelId,
			'scores'
		)
		for (const score of scores) {
			await addDoc(scoresCol, {
				...score,
				achievedAt: serverTimestamp(),
			})
			console.log(
				`  ✓ Added score for ${levelId}: ${score.displayName} (${score.score} pts)`
			)
		}
	}

	console.log('\n✓ Seeding completed successfully!')
}

seed().catch((err) => {
	console.error('Seeding failed:', err)
	process.exit(1)
})
