/**
 * @file firebaseConfig.js
 * @description Production Firebase App initialization and database connection.
 */

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'

/**
 * Firebase project configuration loaded strictly from environment variables.
 */
export const firebaseConfig = Object.freeze({
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
})

/**
 * Validate that essential Firebase configuration keys are present.
 */
function validateConfig(config) {
	const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId']
	const missingKeys = requiredKeys.filter((key) => !config[key])

	if (missingKeys.length > 0) {
		console.warn(
			`[Firebase] Missing required configuration keys: ${missingKeys.join(', ')}. ` +
				'Check your .env file to ensure all VITE_FIREBASE_* variables are set.'
		)
	}
}

validateConfig(firebaseConfig)

// Initialize Firebase App (Singleton Pattern)
export const app =
	getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

// Initialize Firebase Services
export const auth = getAuth(app)
export const db = getFirestore(app)

// Initialize Google Analytics (Browser only, safe for SSR/non-browser contexts)
export let analytics = null
if (typeof window !== 'undefined') {
	isSupported()
		.then((supported) => {
			if (supported && firebaseConfig.measurementId) {
				analytics = getAnalytics(app)
			}
		})
		.catch((error) => {
			console.warn(
				'[Firebase Analytics] Initialization skipped:',
				error?.message
			)
		})
}

export default { app, auth, db, analytics, firebaseConfig }
