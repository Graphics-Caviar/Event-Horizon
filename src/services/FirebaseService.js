/**
 * FirebaseService.js
 * The one entry point the game uses to talk to the backend.
 *
 * Game.js calls backend.init() once at boot and otherwise never has to know
 * that auth, profiles, saves, leaderboards and achievements are five
 * separate services. init() is deliberately NOT awaited by the boot path:
 * the menu renders from localStorage immediately and the cloud catches up
 * when it can.
 *
 * init() does NOT sign anyone in. It only restores a persisted session if
 * one exists, so the login screen stays in charge of authentication.
 *
 * Nothing in here throws. If Firebase is unconfigured, unprovisioned or
 * offline, every call resolves to a null/false/empty result and the game
 * runs exactly as it did before the backend existed.
 */

import {
	isFirebaseConfigured,
	isFirebaseReady,
	getInitError,
	useEmulator,
	firebaseConfig,
} from './firebaseConfig.js'
import authService from './AuthService.js'
import profileService from './ProfileService.js'
import saveService, { fromGameState, AUTO_SLOT } from './SaveService.js'
import leaderboardService, { levelIdFor } from './LeaderboardService.js'
import achievementService from './AchievementService.js'
import storage from './StorageService.js'
import { withBudget, SYNC_BUDGET_MS } from './timeout.js'

export class FirebaseService {
	constructor() {
		this.auth = authService
		this.profile = profileService
		this.saves = saveService
		this.leaderboard = leaderboardService
		this.achievements = achievementService

		this._initPromise = null
		this._unsubscribeMirror = null
		this._unsubscribeAuth = null
		this._lastUid = undefined
		this._authListeners = new Set()
	}

	/**
	 * Restore any persisted session, sync that player's profile, and start
	 * mirroring local profile writes to the cloud. Idempotent.
	 * @returns {Promise<object>} the status object (see status()).
	 */
	init() {
		if (!this._initPromise) this._initPromise = this._init()
		return this._initPromise
	}

	async _init() {
		if (!isFirebaseConfigured()) {
			console.info(
				'[Backend] Firebase not configured — running local-only.'
			)
			return this.status()
		}

		// Every profile write in the game routes through StorageService.save(),
		// so this single subscription keeps the cloud copy in step without
		// Menu.js or CharacterSelect.js needing to know the backend exists.
		this._unsubscribeMirror = storage.onSave((patch) => {
			if (!this.auth.isSignedIn) return
			this.profile.update({
				playerName: patch.playerName,
				selectedCharacter: patch.selectedCharacter,
				selectedShip: patch.selectedShip,
				muted: patch.settings?.muted,
			})
		})

		// Re-sync whenever the signed-in player changes, and drop the cached
		// profile on sign-out so the next pilot starts clean.
		this._unsubscribeAuth = this.auth.onChange((user) => {
			const uid = user?.uid || null
			if (uid === this._lastUid) return
			const previous = this._lastUid
			this._lastUid = uid

			if (uid) {
				// Emit straight away so the UI can greet the player from
				// the auth record, THEN again once the profile lands. An
				// earlier version only emitted after the sync, which meant
				// a slow Firestore delayed the greeting by however long the
				// SDK took to give up.
				this._emitAuth(user)
				this.profile
					.sync()
					.then(() => this._emitAuth(user))
					.catch(() => {})
			} else {
				if (previous) this.profile.clearLocal()
				this._emitAuth(null)
			}
		})

		await this.auth.ready()
		if (this.auth.isSignedIn) await this._syncSoon()
		return this.status()
	}

	/** A snapshot of backend health, handy for logging and for a debug HUD. */
	status() {
		return {
			configured: isFirebaseConfigured(),
			ready: isFirebaseReady(),
			signedIn: this.auth.isSignedIn,
			isGuest: this.auth.isGuest,
			username: this.auth.username,
			uid: this.auth.uid,
			projectId: firebaseConfig.projectId || null,
			emulator: useEmulator,
			cloudProfile: Boolean(this.profile.profile),
			error: getInitError()?.message || null,
		}
	}

	// ---------------- authentication ----------------

	/**
	 * Wait briefly for the profile sync, then hand control back regardless.
	 *
	 * The account already exists by the time this runs — the sync is only a
	 * mirror. Awaiting it outright made sign-up appear to take 35 seconds
	 * against a project with no Firestore database, because that is how long
	 * the browser SDK takes to give up on a read. A short budget keeps the
	 * common (healthy) case correct, so the hangar opens with the player's
	 * saved ship, while a broken backend costs a couple of seconds instead
	 * of half a minute. The sync keeps running either way, and the auth
	 * listener re-emits when it lands.
	 */
	_syncSoon() {
		return withBudget(
			this.profile.sync(),
			SYNC_BUDGET_MS,
			'profile sync'
		)
	}

	/** Create an account, then sync a fresh profile for it. */
	async signUp(username, password) {
		const result = await this.auth.signUp(username, password)
		if (result.ok) await this._syncSoon()
		return result
	}

	/** Sign in to an existing account and pull its profile. */
	async signIn(username, password) {
		const result = await this.auth.signIn(username, password)
		if (result.ok) await this._syncSoon()
		return result
	}

	/** Play without an account (progress is tied to this browser). */
	async signInAsGuest() {
		const result = await this.auth.signInAsGuest()
		if (result.ok) await this._syncSoon()
		return result
	}

	async signOut() {
		await this.auth.signOut()
	}

	/** Subscribe to sign-in/sign-out AFTER the profile has been synced, so
	 * listeners never see a signed-in user with a stale profile. Returns an
	 * unsubscribe function. */
	onAuthChange(listener) {
		this._authListeners.add(listener)
		return () => this._authListeners.delete(listener)
	}

	_emitAuth(user) {
		for (const listener of this._authListeners) {
			try {
				listener(user, this.status())
			} catch (error) {
				console.warn(
					'[Backend] auth listener threw:',
					error
				)
			}
		}
	}

	// ---------------- gameplay hooks ----------------

	/**
	 * Submit a finished run: one immutable leaderboard entry for the level,
	 * one for the global board, plus the player's lifetime counters.
	 *
	 * @param {object} gameState the live GameState
	 * @param {{completed?: boolean, quantumOverdriveCount?: number}} options
	 */
	async submitRun(gameState, options = {}) {
		if (!isFirebaseReady() || !this.auth.isSignedIn) return null

		const run = {
			displayName: this.auth.username || gameState.playerName,
			score: gameState.score,
			timeElapsed: gameState.elapsedTime,
			nitrogenCollected: gameState.nitrogenCollected,
		}

		const [scoreId] = await Promise.all([
			this.leaderboard.submitScore(
				levelIdFor(gameState.currentLevel),
				run
			),
			this.leaderboard.submitScore('global', run),
			this.profile.recordRun({
				nitrogenCollected: gameState.nitrogenCollected,
				quantumOverdriveCount:
					options.quantumOverdriveCount || 0,
				// Only advance the unlock marker on an actual completion.
				reachedLevel: options.completed
					? gameState.currentLevel + 1
					: 0,
			}),
		])

		return scoreId
	}

	/** Write the end-of-level / on-death checkpoint immediately. */
	async saveCheckpoint(gameState, extra = {}) {
		return this.saves.save(
			AUTO_SLOT,
			fromGameState(gameState, extra)
		)
	}

	dispose() {
		this._unsubscribeMirror?.()
		this._unsubscribeAuth?.()
		this._unsubscribeMirror = null
		this._unsubscribeAuth = null
		this._authListeners.clear()
	}
}

const backend = new FirebaseService()
export default backend
