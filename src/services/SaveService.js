/**
 * SaveService.js
 * Save slots at /users/{uid}/saves/{slotId} (see Database_schema.md 2.2).
 *
 * Two kinds of slot are expected by the schema:
 *   - 'checkpoint_auto'  the rolling autosave the game writes as you play
 *   - 'slot_1', 'slot_2' manual slots, if a save menu ever gets built
 *
 * Autosaves are THROTTLED (see AUTOSAVE_INTERVAL_MS). A level's update()
 * runs every frame, so an unthrottled autosave call from gameplay code
 * would be tens of Firestore writes per second — expensive and pointless.
 */

import {
	doc,
	collection,
	getDoc,
	getDocs,
	setDoc,
	deleteDoc,
	serverTimestamp,
} from 'firebase/firestore'
import { db, isFirebaseReady } from './firebaseConfig.js'
import { withTimeout } from './timeout.js'
import authService from './AuthService.js'

export const AUTO_SLOT = 'checkpoint_auto'

/** Minimum gap between two autosave writes, in milliseconds. */
const AUTOSAVE_INTERVAL_MS = 15000

/**
 * Translate the live GameState into the flat document shape the schema
 * defines. Keeping this in one function means gameplay code never has to
 * know the field names in Firestore.
 */
export function fromGameState(gameState, extra = {}) {
	return {
		currentLevel: gameState.currentLevel ?? 1,
		checkpointId: extra.checkpointId || 'start',
		health: gameState.integrity ?? 100,
		nitrogenStock: gameState.nitrogenCollected ?? 0,
		score: gameState.score ?? 0,
		timeElapsed: Number((gameState.elapsedTime ?? 0).toFixed(2)),
		levelSpecificData: extra.levelSpecificData || {},
	}
}

export class SaveService {
	constructor(auth = authService) {
		this.auth = auth
		this._lastAutosaveAt = 0
	}

	_slotRef(uid, slotId) {
		return doc(db, 'users', uid, 'saves', slotId)
	}

	/**
	 * Write a save slot.
	 * @param {string} slotId
	 * @param {object} data already-shaped payload, e.g. from fromGameState()
	 * @returns {Promise<boolean>} whether it reached the cloud
	 */
	async save(slotId, data) {
		if (!isFirebaseReady()) return false
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return false

		try {
			await withTimeout(
				setDoc(
					this._slotRef(uid, slotId),
					{
						saveId: slotId,
						updatedAt: serverTimestamp(),
						...data,
					},
					{ merge: true }
				),
				undefined,
				`save slot "${slotId}"`
			)
			return true
		} catch (error) {
			console.warn(
				`[Save] Could not write slot "${slotId}":`,
				error?.message
			)
			return false
		}
	}

	/**
	 * Throttled autosave straight from the live GameState. Safe to call
	 * from a level's update loop — calls inside the throttle window are
	 * dropped. Pass force: true for end-of-level or on-death saves.
	 */
	async autosave(gameState, extra = {}) {
		const now = Date.now()
		if (
			!extra.force &&
			now - this._lastAutosaveAt < AUTOSAVE_INTERVAL_MS
		) {
			return false
		}
		this._lastAutosaveAt = now
		return this.save(AUTO_SLOT, fromGameState(gameState, extra))
	}

	/**
	 * Read one slot.
	 * @returns {Promise<object|null>} the save data, or null if absent.
	 */
	async load(slotId = AUTO_SLOT) {
		if (!isFirebaseReady()) return null
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return null

		try {
			const snapshot = await withTimeout(
				getDoc(this._slotRef(uid, slotId)),
				undefined,
				`read slot "${slotId}"`
			)
			return snapshot.exists() ? snapshot.data() : null
		} catch (error) {
			console.warn(
				`[Save] Could not read slot "${slotId}":`,
				error?.message
			)
			return null
		}
	}

	/** Every slot this player has, newest first. */
	async listSlots() {
		if (!isFirebaseReady()) return []
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return []

		try {
			const snapshot = await withTimeout(
				getDocs(collection(db, 'users', uid, 'saves')),
				undefined,
				'list save slots'
			)
			return snapshot.docs
				.map((entry) => entry.data())
				.sort(
					(a, b) =>
						(b.updatedAt?.seconds || 0) -
						(a.updatedAt?.seconds || 0)
				)
		} catch (error) {
			console.warn(
				'[Save] Could not list slots:',
				error?.message
			)
			return []
		}
	}

	async deleteSlot(slotId) {
		if (!isFirebaseReady()) return false
		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return false

		try {
			await withTimeout(
				deleteDoc(this._slotRef(uid, slotId)),
				undefined,
				`delete slot "${slotId}"`
			)
			return true
		} catch (error) {
			console.warn(
				`[Save] Could not delete slot "${slotId}":`,
				error?.message
			)
			return false
		}
	}
}

export default new SaveService()
