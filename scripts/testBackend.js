/**
 * testBackend.js
 * End-to-end check of the Firebase backend against the Emulator Suite.
 *
 * It exercises the real services AND the real firestore.rules, including
 * every deny case, so it catches both service bugs and rules regressions.
 * No dependencies beyond what the game already uses, and it never touches
 * the live project — it forces a `demo-` project id, which the Firebase
 * tooling treats as emulator-only.
 *
 * The callsigns and passwords below are throwaway test fixtures created in
 * the local emulator. They are not real credentials and must never be
 * pointed at a live project.
 *
 * Usage:
 *   firebase emulators:start --only auth,firestore --project demo-event-horizon
 *   npm run test:backend
 */

// Must be set BEFORE importing firebaseConfig, which initializes on import.
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-event-horizon'
process.env.VITE_FIREBASE_API_KEY = 'demo-api-key'
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'demo-event-horizon.firebaseapp.com'
process.env.VITE_FIREBASE_APP_ID = '1:1:web:demo'
process.env.VITE_FIREBASE_USE_EMULATOR = 'true'

// StorageService expects a browser localStorage; a minimal stand-in lets the
// local <-> cloud mirror path run instead of silently failing.
const memory = new Map()
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => memory.set(key, String(value)),
	removeItem: (key) => memory.delete(key),
	clear: () => memory.clear(),
}

const { default: backend } = await import('../src/services/FirebaseService.js')
const { default: storage } = await import('../src/services/StorageService.js')
const { validateUsername, validatePassword, usernameToEmail } =
	await import('../src/services/AuthService.js')
const { db } = await import('../src/services/firebaseConfig.js')
const { doc, getDoc, setDoc, updateDoc, collection, getDocs } =
	await import('firebase/firestore')

// Unique per run so repeated runs against a warm emulator do not collide.
const CALLSIGN = `Nova_${Date.now().toString().slice(-6)}`
const PASSWORD = 'emulator-test-pw'

let passed = 0
let failed = 0
function check(label, condition, detail = '') {
	if (condition) {
		passed++
		console.log(`  PASS  ${label}`)
	} else {
		failed++
		console.log(`  FAIL  ${label} ${detail}`)
	}
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('\n=== 1. validation rules (no network) ===')
check('rejects a short callsign', !validateUsername('ab').ok)
check('rejects a callsign starting with a digit', !validateUsername('7Nova').ok)
check('rejects illegal characters', !validateUsername('no spaces').ok)
check('rejects an over-long callsign', !validateUsername('a'.repeat(17)).ok)
check('accepts a good callsign', validateUsername('Nova_7').ok)
check('rejects a short password', !validatePassword('abc').ok)
check('accepts an 8+ char password', validatePassword('abcd1234').ok)
check(
	'callsign maps to a lowercased synthetic address',
	usernameToEmail('NoVa_7') === 'nova_7@pilots.eventhorizon.game',
	usernameToEmail('NoVa_7')
)

console.log('\n=== 2. init does NOT sign anyone in ===')
const initial = await backend.init()
check('backend reachable', initial.ready === true)
check('nobody signed in after init', initial.signedIn === false)
check('no uid yet', initial.uid === null)

console.log('\n=== 3. create an account ===')
const created = await backend.signUp(CALLSIGN, PASSWORD)
check('sign-up succeeded', created.ok === true, created.error || '')
if (!created.ok) {
	console.error(
		'\nCannot continue without an account. Are the emulators up?'
	)
	process.exit(1)
}
const uid = backend.status().uid
check('uid assigned', typeof uid === 'string' && uid.length > 0)
check('callsign reported', backend.status().username === CALLSIGN)
check('not flagged as a guest', backend.status().isGuest === false)

console.log('\n=== 4. duplicate + wrong-password handling ===')
const duplicate = await backend.signUp(CALLSIGN, PASSWORD)
check('duplicate callsign rejected', duplicate.ok === false)
check(
	'duplicate error names the cause',
	/already taken/i.test(duplicate.error || ''),
	duplicate.error
)
const weak = await backend.signUp('Another_One', 'short')
check('weak password rejected before the network', weak.ok === false)

console.log('\n=== 5. profile document for the account ===')
const snapshot = await getDoc(doc(db, 'users', uid))
const profile = snapshot.data() || {}
check('profile doc exists', snapshot.exists())
check('userId matches uid', profile.userId === uid)
check('displayName is the callsign', profile.displayName === CALLSIGN)
check('createdAt is a server timestamp', Boolean(profile.createdAt?.seconds))
check('highestUnlockedLevel starts at 1', profile.highestUnlockedLevel === 1)
check(
	'unlockedAchievements is an array',
	Array.isArray(profile.unlockedAchievements)
)

console.log('\n=== 6. local writes mirror to the cloud ===')
storage.setSelectedShip('aegis')
await wait(1200)
const mirrored = (await getDoc(doc(db, 'users', uid))).data()
check(
	'selectedShip mirrored',
	mirrored.settings?.selectedShip === 'aegis',
	`got ${mirrored.settings?.selectedShip}`
)

console.log('\n=== 7. save slots ===')
const gameState = {
	playerName: CALLSIGN,
	currentLevel: 1,
	integrity: 72,
	nitrogenCollected: 9,
	score: 4210,
	elapsedTime: 63.456,
}
check(
	'saveCheckpoint wrote',
	(await backend.saveCheckpoint(gameState, {
		checkpointId: 'asteroid_belt',
	})) === true
)
const slot = await backend.saves.load()
check('slot reads back', slot !== null)
check('health mapped from integrity', slot?.health === 72)
check('nitrogenStock mapped', slot?.nitrogenStock === 9)
check('timeElapsed rounded to 2dp', slot?.timeElapsed === 63.46)
check('checkpointId stored', slot?.checkpointId === 'asteroid_belt')

console.log('\n=== 8. leaderboard submit + ordered read ===')
const scoreId = await backend.submitRun(gameState, { completed: true })
check('submitRun returned a score id', typeof scoreId === 'string')
const top = await backend.leaderboard.getTopScores('level_1', 25)
check(
	'level_1 contains the run',
	top.some((row) => row.userId === uid && row.score === 4210)
)
check(
	'row carries the account callsign',
	top.find((row) => row.userId === uid)?.displayName === CALLSIGN
)
check('rank annotated on read', top[0]?.rank === 1)
check(
	'ordered by score descending',
	top.every(
		(row, index) => index === 0 || top[index - 1].score >= row.score
	)
)
const globalBoard = await backend.leaderboard.getTopScores('global', 25)
check(
	'global board also written',
	globalBoard.some((row) => row.userId === uid)
)

console.log('\n=== 9. lifetime counters ===')
const counted = (await getDoc(doc(db, 'users', uid))).data()
check(
	'totalNitrogenCollected incremented',
	counted.totalNitrogenCollected === 9
)
check('highestUnlockedLevel advanced', counted.highestUnlockedLevel === 2)

console.log('\n=== 10. achievements ===')
check(
	'unlock() records against the profile',
	await backend.achievements.unlock('ESCAPE_SINGULARITY')
)
await wait(600)
const unlocked = (await getDoc(doc(db, 'users', uid))).data()
	.unlockedAchievements
check('achievement persisted', unlocked?.includes('ESCAPE_SINGULARITY'))
check(
	'repeat unlock is a no-op',
	(await backend.achievements.unlock('ESCAPE_SINGULARITY')) === false
)

console.log('\n=== 11. firestore.rules enforcement ===')
async function expectDenied(label, operation) {
	try {
		await operation()
		check(label, false, '-> ALLOWED but should be denied')
	} catch (error) {
		check(
			label,
			error?.code === 'permission-denied',
			`-> got ${error?.code}`
		)
	}
}
await expectDenied("cannot write another user's profile", () =>
	setDoc(doc(db, 'users', 'someone-else'), { userId: 'someone-else' })
)
await expectDenied("cannot read another user's profile", () =>
	getDoc(doc(db, 'users', 'someone-else'))
)
await expectDenied('cannot write /achievements', () =>
	setDoc(doc(db, 'achievements', 'HACKED'), { title: 'nope' })
)
await expectDenied('cannot mutate an existing score', () =>
	updateDoc(doc(db, 'leaderboards', 'level_1', 'scores', scoreId), {
		score: 999999,
	})
)
await expectDenied('cannot submit a score under a foreign uid', () =>
	setDoc(doc(collection(db, 'leaderboards', 'level_1', 'scores')), {
		userId: 'not-me',
		displayName: 'Spoof',
		score: 1,
		timeElapsed: 1,
		nitrogenCollected: 1,
	})
)
await expectDenied('cannot submit to an invalid level id', () =>
	setDoc(doc(collection(db, 'leaderboards', 'level_99', 'scores')), {
		userId: uid,
		displayName: 'X',
		score: 1,
		timeElapsed: 1,
		nitrogenCollected: 1,
	})
)
await expectDenied('cannot submit a negative score', () =>
	setDoc(doc(collection(db, 'leaderboards', 'level_1', 'scores')), {
		userId: uid,
		displayName: 'X',
		score: -5,
		timeElapsed: 1,
		nitrogenCollected: 1,
	})
)

console.log('\n=== 12. leaderboards are publicly readable ===')
const publicRead = await getDocs(
	collection(db, 'leaderboards', 'level_1', 'scores')
)
check('public read allowed', publicRead.size >= 1)

console.log('\n=== 13. sign out clears local state ===')
await backend.signOut()
await wait(800)
check('signed out', backend.status().signedIn === false)
check('username cleared', backend.status().username === null)
check(
	'cached ship reset to default',
	storage.load().selectedShip === 'starfighter',
	storage.load().selectedShip
)
check(
	'writes are ignored while signed out',
	(await backend.saveCheckpoint(gameState)) === false
)
check(
	'submitRun is ignored while signed out',
	(await backend.submitRun(gameState)) === null
)

console.log('\n=== 14. sign back in ===')
const wrong = await backend.signIn(CALLSIGN, 'not-the-password')
check('wrong password rejected', wrong.ok === false)
check(
	'wrong-password message is vague',
	/incorrect callsign or password/i.test(wrong.error || ''),
	wrong.error
)
const unknown = await backend.signIn('Nobody_Here', PASSWORD)
check('unknown callsign rejected', unknown.ok === false)

// Lowercased on purpose: sign-in must be case-insensitive.
const back = await backend.signIn(CALLSIGN.toLowerCase(), PASSWORD)
check(
	'sign-in succeeded (case-insensitive)',
	back.ok === true,
	back.error || ''
)
check('same uid as before', backend.status().uid === uid)
check('callsign casing preserved', backend.status().username === CALLSIGN)
await wait(800)
check(
	'previous progress restored from the cloud',
	storage.load().selectedShip === 'aegis',
	storage.load().selectedShip
)

console.log('\n=== 15. guest sessions ===')
await backend.signOut()
await wait(500)
const guest = await backend.signInAsGuest()
check('guest sign-in succeeded', guest.ok === true, guest.error || '')
check('guest is flagged as a guest', backend.status().isGuest === true)
check('guest has no callsign', backend.status().username === null)
check('guest got its own uid', backend.status().uid !== uid)
await backend.signOut()

console.log(`\n========== ${passed} passed, ${failed} failed ==========\n`)
process.exit(failed === 0 ? 0 : 1)
