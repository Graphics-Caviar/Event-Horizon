/**
 * @file firebaseConfig.js
 * @description Creates the one Firebase app/auth/db handle pair the rest of
 * the game shares.
 *
 * HARD RULE: importing this file must never be able to break the game.
 *
 * The previous version called initializeApp()/getAuth()/getFirestore() at
 * module scope with no guard, so a missing .env or an unprovisioned project
 * would throw during import and take the whole boot down with it. Everything
 * here is wrapped instead: if config is missing or init fails, `auth`/`db`
 * are left null, `isFirebaseReady()` returns false, and every service on top
 * of this file is expected to fall back to local-only behaviour.
 */

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'

// Vite exposes import.meta.env in the browser; Node scripts (scripts/*.js)
// import this same file and only have process.env. Support both so there is
// exactly one place that knows the variable names.
const env =
	(typeof import.meta !== 'undefined' && import.meta.env) ||
	(typeof process !== 'undefined' && process.env) ||
	{}

export const firebaseConfig = Object.freeze({
	apiKey: env.VITE_FIREBASE_API_KEY,
	authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: env.VITE_FIREBASE_APP_ID,
	measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
})

/** Emulator ports must match the ones in firebase.json. */
const EMULATOR = Object.freeze({
	host: '127.0.0.1',
	authPort: 9099,
	firestorePort: 8080,
})

export const useEmulator =
	String(env.VITE_FIREBASE_USE_EMULATOR || '').toLowerCase() === 'true'

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId']

/** A value straight out of .env.example is "set" but useless — treat the
 * placeholders as missing so we fail over to local-only instead of firing
 * doomed requests at a project that does not exist. */
function isPlaceholder(value) {
	return (
		typeof value === 'string' &&
		(value.startsWith('your-') || value.endsWith('-here'))
	)
}

/** True when every key needed to reach a real project is present. */
export function isFirebaseConfigured() {
	return REQUIRED_KEYS.every(
		(key) =>
			firebaseConfig[key] &&
			!isPlaceholder(firebaseConfig[key])
	)
}

let app = null
let auth = null
let db = null
let analytics = null
let initError = null

function initialize() {
	if (!isFirebaseConfigured()) {
		const missing = REQUIRED_KEYS.filter(
			(key) =>
				!firebaseConfig[key] ||
				isPlaceholder(firebaseConfig[key])
		)
		initError = new Error(
			`Missing Firebase config: ${missing.join(', ')}`
		)
		console.warn(
			`[Firebase] ${initError.message}. Copy .env.example to .env and fill in the VITE_FIREBASE_* values. ` +
				'Running local-only: progress will be saved to this browser instead of the cloud.'
		)
		return
	}

	try {
		app =
			getApps().length === 0
				? initializeApp(firebaseConfig)
				: getApp()
		auth = getAuth(app)
		db = getFirestore(app)

		if (useEmulator) {
			connectAuthEmulator(
				auth,
				`http://${EMULATOR.host}:${EMULATOR.authPort}`,
				{ disableWarnings: true }
			)
			connectFirestoreEmulator(
				db,
				EMULATOR.host,
				EMULATOR.firestorePort
			)
			console.info(
				`[Firebase] Using local emulators (auth :${EMULATOR.authPort}, firestore :${EMULATOR.firestorePort}). Start them with: firebase emulators:start`
			)
		} else {
			console.info(
				`[Firebase] Connected to project "${firebaseConfig.projectId}".`
			)
		}
	} catch (error) {
		initError = error
		app = null
		auth = null
		db = null
		console.warn(
			'[Firebase] Initialization failed; running local-only:',
			error?.message
		)
	}
}

initialize()

// Analytics is optional and browser-only. It must never block or throw into
// the game loop, and it is skipped entirely against the emulator.
if (
	app &&
	!useEmulator &&
	typeof window !== 'undefined' &&
	firebaseConfig.measurementId
) {
	isSupported()
		.then((supported) => {
			if (supported) analytics = getAnalytics(app)
		})
		.catch((error) => {
			console.warn(
				'[Firebase Analytics] Initialization skipped:',
				error?.message
			)
		})
}

/** True when Firebase initialized and the SDK handles are usable. Services
 * call this before every network op so a missing backend degrades to
 * local-only rather than throwing. */
export function isFirebaseReady() {
	return Boolean(app && auth && db)
}

/** Why Firebase is unavailable, or null when it initialized fine. */
export function getInitError() {
	return initError
}

export { app, auth, db, analytics }
export default { app, auth, db, analytics, firebaseConfig, isFirebaseReady }
