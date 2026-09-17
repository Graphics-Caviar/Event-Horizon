/**
 * ProfileService.js
 * Reads and writes the player profile document at /users/{uid}
 * (see Database_schema.md section 2.1).
 *
 * WHY THIS IS A SEPARATE LAYER FROM StorageService
 * ------------------------------------------------
 * StorageService.load() is synchronous and is called during the Game
 * constructor, before anything has had a chance to touch the network.
 * Firestore is async. Rather than make boot wait on a round trip (and stall
 * on a dead connection), the two are layered:
 *
 *   StorageService  = the immediate, synchronous truth the UI renders from.
 *   ProfileService  = a background mirror that syncs that truth to the cloud.
 *
 * So the game always starts instantly from localStorage, and the cloud
 * profile is merged in a moment later if it is reachable.
 *
 * MERGE POLICY on sync (documented because it is the part that bites):
 *   - Lifetime counters take the HIGHER of local/cloud. They only ever grow,
 *     so max() can never lose progress made on another device.
 *   - displayName comes from the signed-in account when there is one: the
 *     callsign IS the identity, so it outranks any cached value.
 *   - settings prefer CLOUD, and local fills in only what the cloud lacks.
 *
 * That last rule reads backwards until you see what breaks otherwise.
 * Signing out resets the local cache to DEFAULTS, and defaults are
 * indistinguishable from deliberate choices — so a "local wins" rule made
 * signing back in overwrite the account's real saved ship with
 * 'starfighter'. Preferring cloud costs nothing, because while signed in
 * every local write is mirrored up immediately (see FirebaseService's
 * storage.onSave subscription), so the cloud copy is already current.
 *
 * The one case it does lose: a change made while signed in but OFFLINE,
 * where the mirror write failed and the next sync then prefers the stale
 * cloud value. Losing one preference is the better failure than silently
 * wiping an account's saved progress.
 */

import {
	doc,
	getDoc,
	setDoc,
	updateDoc,
	increment,
	arrayUnion,
	serverTimestamp,
} from 'firebase/firestore'
import { db, isFirebaseReady } from './firebaseConfig.js'
import { withTimeout } from './timeout.js'
import authService from './AuthService.js'
import storage from './StorageService.js'

/** Lifetime counters that must never move backwards. */
const MONOTONIC_FIELDS = [
	'highestUnlockedLevel',
	'totalNitrogenCollected',
	'quantumOverdriveCount',
]

export class ProfileService {
	constructor(auth = authService, localStore = storage) {
		this.auth = auth
		this.storage = localStore
		this._syncPromise = null
		this._syncedUid = undefined
		this._profile = null
		this._listeners = new Set()
	}

	/** The last known cloud profile, or null if we have never synced. */
	get profile() {
		return this._profile
	}

	_docRef(uid) {
		return doc(db, 'users', uid)
	}

	/**
	 * Pull the cloud profile for whoever is signed in, merge it with the
	 * local one, and push the result back.
	 *
	 * Memoized per uid rather than per session: signing out and back in as
	 * a different pilot re-runs the sync instead of handing back the
	 * previous account's profile.
	 *
	 * @returns {Promise<object|null>} the merged profile, or null local-only.
	 */
	sync() {
		const uid = this.auth.uid
		if (this._syncPromise && this._syncedUid === uid) {
			return this._syncPromise
		}
		this._syncedUid = uid
		this._syncPromise = this._sync()
		return this._syncPromise
	}

	/**
	 * Forget the signed-in player's data on sign-out, so the next person to
	 * use this browser does not inherit their callsign, pilot or ship.
	 */
	clearLocal() {
		this._profile = null
		this._syncPromise = null
		this._syncedUid = undefined
		this.storage.reset({ silent: true })
		this._emit()
	}

	async _sync() {
		if (!isFirebaseReady()) return null

		// Prefer the CURRENT uid. auth.ready() is a one-shot promise that
		// resolved at startup — for a player who signs in later it still
		// reports null forever, so awaiting it alone would skip the sync and
		// the profile document would never be created.
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return null

		const local = this.storage.load()

		// When signed in with a real account the callsign IS the identity,
		// so it outranks whatever this browser happens to have cached.
		const accountName = this.auth.username

		try {
			const ref = this._docRef(uid)
			const snapshot = await withTimeout(
				getDoc(ref),
				undefined,
				'profile read'
			)

			if (!snapshot.exists()) {
				const created = {
					userId: uid,
					displayName:
						accountName ||
						local.playerName ||
						'Pilot',
					createdAt: serverTimestamp(),
					lastLoginAt: serverTimestamp(),
					highestUnlockedLevel: 1,
					totalNitrogenCollected: 0,
					quantumOverdriveCount: 0,
					unlockedAchievements: [],
					settings: {
						muted: local.settings.muted,
						selectedCharacter:
							local.selectedCharacter,
						selectedShip:
							local.selectedShip,
					},
				}
				await withTimeout(
					setDoc(ref, created),
					undefined,
					'profile create'
				)
				this._profile = created
				// Write the callsign straight back down, so a
				// brand-new account has a populated local cache
				// instead of an empty one until its first edit.
				this.storage.save(
					{ playerName: created.displayName },
					{ silent: true }
				)
				console.info(
					'[Profile] Created cloud profile for',
					uid
				)
			} else {
				const cloud = snapshot.data()
				const merged = this._merge(local, cloud)

				await withTimeout(
					updateDoc(ref, {
						...merged,
						lastLoginAt: serverTimestamp(),
					}),
					undefined,
					'profile update'
				)
				this._profile = { ...cloud, ...merged }

				// Push anything the cloud knew and this device did not
				// back down into localStorage, so the next synchronous
				// boot starts from the right values.
				this.storage.save(
					{
						playerName: merged.displayName,
						selectedCharacter:
							merged.settings
								.selectedCharacter,
						selectedShip:
							merged.settings
								.selectedShip,
						settings: {
							muted: merged.settings
								.muted,
						},
					},
					{ silent: true }
				)
				console.info(
					'[Profile] Synced cloud profile for',
					uid
				)
			}

			this._emit()
			return this._profile
		} catch (error) {
			console.warn(
				'[Profile] Sync failed, staying local-only:',
				error?.message
			)
			return null
		}
	}

	_merge(local, cloud) {
		const merged = {
			userId: cloud.userId || this.auth.uid,
			displayName:
				this.auth.username ||
				local.playerName ||
				cloud.displayName ||
				'Pilot',
			settings: {
				muted:
					typeof cloud.settings?.muted ===
					'boolean'
						? cloud.settings.muted
						: local.settings.muted,
				selectedCharacter:
					cloud.settings?.selectedCharacter ||
					local.selectedCharacter,
				selectedShip:
					cloud.settings?.selectedShip ||
					local.selectedShip,
			},
		}

		for (const field of MONOTONIC_FIELDS) {
			const floor = field === 'highestUnlockedLevel' ? 1 : 0
			merged[field] = Math.max(
				Number(cloud[field]) || 0,
				floor
			)
		}

		return merged
	}

	/**
	 * The uid to write to, or null when we should not write at all.
	 *
	 * Writes are held back until the first sync has established a profile
	 * document. Without this guard a mirror write can race ahead of
	 * creation: updateDoc() on a missing document throws NOT_FOUND, and a
	 * setDoc merge would instead create a half-built profile with no
	 * createdAt and no counters. Nothing is lost by waiting — the pending
	 * sync pushes the local values up as part of its merge.
	 */
	async _writableUid() {
		if (!isFirebaseReady()) return null
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return null
		if (!this._profile) return null
		return uid
	}

	/** Mirror a profile change (callsign, pilot, ship, mute) to the cloud.
	 * Fire-and-forget: the local save has already happened by the time this
	 * is called, so a failure here costs nothing but a warning. */
	async update(patch) {
		const uid = await this._writableUid()
		if (!uid) return

		const payload = {}
		if (patch.playerName) payload.displayName = patch.playerName
		if (patch.selectedCharacter)
			payload['settings.selectedCharacter'] =
				patch.selectedCharacter
		if (patch.selectedShip)
			payload['settings.selectedShip'] = patch.selectedShip
		if (typeof patch.muted === 'boolean')
			payload['settings.muted'] = patch.muted
		if (typeof patch.highestUnlockedLevel === 'number')
			payload.highestUnlockedLevel =
				patch.highestUnlockedLevel

		if (Object.keys(payload).length === 0) return

		try {
			await withTimeout(
				updateDoc(this._docRef(uid), payload),
				undefined,
				'profile mirror'
			)
			if (patch.playerName)
				this.auth.setDisplayName(patch.playerName)
		} catch (error) {
			console.warn('[Profile] Update failed:', error?.message)
		}
	}

	/**
	 * Add the results of a finished run to the lifetime totals.
	 * @param {{nitrogenCollected?: number, quantumOverdriveCount?: number,
	 *          reachedLevel?: number}} run
	 */
	async recordRun(run = {}) {
		const uid = await this._writableUid()
		if (!uid) return

		const payload = {}
		if (run.nitrogenCollected > 0)
			payload.totalNitrogenCollected = increment(
				run.nitrogenCollected
			)
		if (run.quantumOverdriveCount > 0)
			payload.quantumOverdriveCount = increment(
				run.quantumOverdriveCount
			)
		if (run.reachedLevel > 0)
			payload.highestUnlockedLevel = run.reachedLevel

		if (Object.keys(payload).length === 0) return

		try {
			await withTimeout(
				updateDoc(this._docRef(uid), payload),
				undefined,
				'run totals'
			)
		} catch (error) {
			console.warn(
				'[Profile] recordRun failed:',
				error?.message
			)
		}
	}

	/**
	 * Flag an achievement as unlocked for this player.
	 *
	 * NOTE: Database_schema.md defines /achievements as static reference
	 * data only and has nowhere to record WHICH ones a player earned. A
	 * users/{uid}/achievements subcollection would be the tidier home, but
	 * firestore.rules does not cascade into subcollections (that is why
	 * /saves has its own explicit match block), so that would need a rules
	 * change. Until then this lives as an array on the profile document,
	 * which the existing rules already cover.
	 */
	async unlockAchievement(achievementId) {
		if (!achievementId) return
		const uid = await this._writableUid()
		if (!uid) return

		try {
			await withTimeout(
				updateDoc(this._docRef(uid), {
					unlockedAchievements:
						arrayUnion(achievementId),
				}),
				undefined,
				'achievement unlock'
			)
		} catch (error) {
			console.warn(
				'[Profile] unlockAchievement failed:',
				error?.message
			)
		}
	}

	onChange(listener) {
		this._listeners.add(listener)
		if (this._profile) listener(this._profile)
		return () => this._listeners.delete(listener)
	}

	_emit() {
		for (const listener of this._listeners) {
			try {
				listener(this._profile)
			} catch (error) {
				console.warn('[Profile] listener threw:', error)
			}
		}
	}
}

export default new ProfileService()
