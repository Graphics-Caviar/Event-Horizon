/**
 * AuthService.js
 * Username + password accounts, backed by Firebase Authentication.
 *
 * WHY USERNAMES MAP TO EMAILS
 * ---------------------------
 * Firebase Auth has no username/password provider — the closest thing is
 * email/password. The game wants pilot callsigns, not email addresses, so a
 * callsign is mapped to a synthetic address that never receives mail:
 *
 *   "Nova_7"  ->  "nova_7@pilots.eventhorizon.game"
 *
 * That buys us Firebase's own uniqueness check for free (a taken callsign
 * comes back as auth/email-already-in-use) and keeps every rule in
 * firestore.rules working unchanged, since they only ever look at uid.
 *
 * THE TRADEOFF: there is no real inbox, so there is no password reset and
 * no email verification. A forgotten password cannot be recovered without
 * an admin deleting the account. That is an acceptable deal for a course
 * project; a production game would collect a real email for recovery.
 *
 * PASSWORDS ARE NEVER STORED BY THIS APP. Firebase Auth hashes and holds
 * them; nothing here or in ProfileService ever writes a password into
 * Firestore, and the plaintext never leaves the sign-in call.
 */

import {
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	signInAnonymously,
	onAuthStateChanged,
	updateProfile,
	signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth, isFirebaseReady } from './firebaseConfig.js'
import {
	PASSWORD_MIN,
	usernameToEmail,
	emailToUsername,
	validateUsername,
	validatePassword,
} from './authRules.js'

// The pure rules live in their own Firebase-free module so AuthScreen can
// validate a form without dragging the Firebase SDK into the main bundle.
// Re-exported here so existing importers of AuthService keep working.
export {
	CALLSIGN_DOMAIN,
	USERNAME_MIN,
	USERNAME_MAX,
	PASSWORD_MIN,
	normalizeUsername,
	usernameToEmail,
	emailToUsername,
	validateUsername,
	validatePassword,
} from './authRules.js'

/** Firebase error codes -> messages a player can act on. Several of these
 * are configuration problems rather than user mistakes, so they name the
 * console step that fixes them. */
function explain(error) {
	switch (error?.code) {
		case 'auth/email-already-in-use':
			return 'That callsign is already taken.'
		case 'auth/invalid-credential':
		case 'auth/wrong-password':
		case 'auth/user-not-found':
			// Firebase collapses these into invalid-credential on newer
			// versions; keep the message vague either way so the form does
			// not reveal which callsigns exist.
			return 'Incorrect callsign or password.'
		case 'auth/weak-password':
			return `Password must be at least ${PASSWORD_MIN} characters.`
		case 'auth/too-many-requests':
			return 'Too many attempts. Wait a moment and try again.'
		case 'auth/network-request-failed':
			return 'Could not reach the server. Check your connection.'
		case 'auth/user-disabled':
			return 'This account has been disabled.'
		case 'auth/configuration-not-found':
			return 'Authentication is not enabled for this Firebase project (Console -> Build -> Authentication -> Get started).'
		case 'auth/operation-not-allowed':
			return 'Email/password sign-in is disabled (Console -> Authentication -> Sign-in method).'
		case 'auth/admin-restricted-operation':
			return 'Guest sign-in is disabled (Console -> Authentication -> Sign-in method -> Anonymous).'
		case 'auth/api-key-not-valid':
		case 'auth/invalid-api-key':
			return 'VITE_FIREBASE_API_KEY in .env is not valid for this project.'
		default:
			return error?.message || String(error)
	}
}

export class AuthService {
	constructor() {
		this._user = null
		this._listeners = new Set()
		this._resolved = false
		// Set during signUp(). Firebase fires onAuthStateChanged the instant
		// the account exists — before updateProfile() has had a chance to
		// attach the display name — so anything that syncs off that event
		// would otherwise read a null displayName and fall back to the
		// lowercased address. This carries the intended casing across that
		// window.
		this._pendingDisplayName = null

		// Resolves the first time Firebase tells us whether a persisted
		// session exists. Everything that needs a uid waits on this rather
		// than assuming signed-out.
		this._readyPromise = new Promise((resolve) => {
			if (!isFirebaseReady()) {
				this._resolved = true
				resolve(null)
				return
			}
			onAuthStateChanged(
				auth,
				(user) => {
					this._user = user
					if (!this._resolved) {
						this._resolved = true
						resolve(user?.uid || null)
					}
					this._emit(user)
				},
				(error) => {
					console.warn(
						`[Auth] State listener failed: ${explain(error)}`
					)
					if (!this._resolved) {
						this._resolved = true
						resolve(null)
					}
				}
			)
		})
	}

	get uid() {
		return this._user?.uid || null
	}

	get isSignedIn() {
		return Boolean(this._user)
	}

	get isGuest() {
		return Boolean(this._user?.isAnonymous)
	}

	/** The pilot callsign: the display name when set, else derived from the
	 * synthetic address. Null for guests and signed-out. */
	get username() {
		if (!this._user || this._user.isAnonymous) return null
		return (
			this._user.displayName ||
			this._pendingDisplayName ||
			emailToUsername(this._user.email) ||
			null
		)
	}

	/**
	 * Wait until Firebase has restored (or ruled out) a persisted session.
	 *
	 * NOTE: this no longer signs anyone in. An earlier version called
	 * signInAnonymously() here, which meant any Firestore read could
	 * silently mint a throwaway account and bypass the login screen
	 * entirely. Sign-in is now always an explicit user action.
	 *
	 * @returns {Promise<string|null>} the uid, or null if signed out.
	 */
	ready() {
		return this._readyPromise
	}

	/**
	 * Create a new account.
	 * @returns {Promise<{ok: boolean, uid?: string, username?: string, error?: string}>}
	 */
	async signUp(username, password) {
		if (!isFirebaseReady()) {
			return {
				ok: false,
				error: 'Accounts are unavailable — Firebase is not configured.',
			}
		}

		const nameCheck = validateUsername(username)
		if (!nameCheck.ok) return { ok: false, error: nameCheck.error }
		const passCheck = validatePassword(password)
		if (!passCheck.ok) return { ok: false, error: passCheck.error }

		const display = String(username).trim()
		// Must be set before the account is created — see the field's comment.
		this._pendingDisplayName = display

		try {
			const credential = await createUserWithEmailAndPassword(
				auth,
				usernameToEmail(display),
				password
			)
			// Keep the original casing for display; the login address stays
			// lowercase so sign-in is case-insensitive.
			await updateProfile(credential.user, {
				displayName: display,
			})
			this._user = credential.user
			console.info(`[Auth] Created account for "${display}"`)
			this._emit(credential.user)
			return {
				ok: true,
				uid: credential.user.uid,
				username: display,
			}
		} catch (error) {
			this._pendingDisplayName = null
			console.warn(`[Auth] Sign-up failed: ${error?.code}`)
			return { ok: false, error: explain(error) }
		}
	}

	/**
	 * Sign in to an existing account.
	 * @returns {Promise<{ok: boolean, uid?: string, username?: string, error?: string}>}
	 */
	async signIn(username, password) {
		if (!isFirebaseReady()) {
			return {
				ok: false,
				error: 'Sign-in is unavailable — Firebase is not configured.',
			}
		}
		if (!String(username || '').trim() || !password) {
			return {
				ok: false,
				error: 'Enter your callsign and password.',
			}
		}

		try {
			const credential = await signInWithEmailAndPassword(
				auth,
				usernameToEmail(username),
				password
			)
			this._user = credential.user
			const display =
				credential.user.displayName ||
				emailToUsername(credential.user.email)
			console.info(`[Auth] Signed in as "${display}"`)
			this._emit(credential.user)
			return {
				ok: true,
				uid: credential.user.uid,
				username: display,
			}
		} catch (error) {
			console.warn(`[Auth] Sign-in failed: ${error?.code}`)
			return { ok: false, error: explain(error) }
		}
	}

	/**
	 * Play without an account. Progress still syncs to the cloud, but it is
	 * tied to this browser only and cannot be recovered elsewhere.
	 */
	async signInAsGuest() {
		if (!isFirebaseReady()) {
			return {
				ok: false,
				error: 'Firebase is not configured.',
			}
		}
		try {
			const credential = await signInAnonymously(auth)
			this._user = credential.user
			console.info(
				`[Auth] Guest session ${credential.user.uid}`
			)
			this._emit(credential.user)
			return { ok: true, uid: credential.user.uid }
		} catch (error) {
			console.warn(
				`[Auth] Guest sign-in failed: ${error?.code}`
			)
			return { ok: false, error: explain(error) }
		}
	}

	async signOut() {
		if (!isFirebaseReady()) return
		try {
			await firebaseSignOut(auth)
			this._user = null
			this._pendingDisplayName = null
			console.info('[Auth] Signed out')
			this._emit(null)
		} catch (error) {
			console.warn('[Auth] Sign-out failed:', error?.message)
		}
	}

	/** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
	onChange(listener) {
		this._listeners.add(listener)
		if (this._resolved) listener(this._user)
		return () => this._listeners.delete(listener)
	}

	_emit(user) {
		for (const listener of this._listeners) {
			try {
				listener(user)
			} catch (error) {
				console.warn('[Auth] listener threw:', error)
			}
		}
	}
}

export default new AuthService()
