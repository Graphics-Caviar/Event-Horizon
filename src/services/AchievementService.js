/**
 * AchievementService.js
 * Reads the static achievement definitions at /achievements
 * (see Database_schema.md 2.4) and records unlocks against the player.
 *
 * /achievements is public read, write-denied reference data — it is
 * populated by scripts/seedFirestore.js, never by the game. The definitions
 * are cached for the session because they never change at runtime.
 */

import { collection, getDocs } from 'firebase/firestore'
import { db, isFirebaseReady } from './firebaseConfig.js'
import { withTimeout } from './timeout.js'
import profileService from './ProfileService.js'

export class AchievementService {
	constructor(profile = profileService) {
		this.profile = profile
		this._definitions = null
		this._fetchPromise = null
	}

	/**
	 * All achievement definitions, fetched once per session.
	 * @returns {Promise<Array<object>>} empty array when unavailable.
	 */
	getDefinitions() {
		if (!this._fetchPromise) this._fetchPromise = this._fetch()
		return this._fetchPromise
	}

	async _fetch() {
		if (!isFirebaseReady()) return []

		try {
			const snapshot = await withTimeout(
				getDocs(collection(db, 'achievements')),
				undefined,
				'read achievements'
			)
			this._definitions = snapshot.docs.map((entry) => ({
				achievementId: entry.id,
				...entry.data(),
			}))

			if (this._definitions.length === 0) {
				console.info(
					'[Achievements] /achievements is empty — run `npm run seed` to populate it.'
				)
			}
			return this._definitions
		} catch (error) {
			console.warn(
				'[Achievements] Could not load definitions:',
				error?.message
			)
			// Reset so a later call can retry after the network comes back.
			this._fetchPromise = null
			return []
		}
	}

	/** Achievement ids this player has already earned. */
	getUnlockedIds() {
		return this.profile.profile?.unlockedAchievements || []
	}

	/** Definitions annotated with whether this player has earned each one. */
	async getWithProgress() {
		const definitions = await this.getDefinitions()
		const unlocked = new Set(this.getUnlockedIds())
		return definitions.map((definition) => ({
			...definition,
			unlocked: unlocked.has(definition.achievementId),
		}))
	}

	/**
	 * Record an unlock, skipping the write if the player already has it.
	 * @returns {Promise<boolean>} true if this call newly unlocked it.
	 */
	async unlock(achievementId) {
		if (!achievementId) return false
		if (this.getUnlockedIds().includes(achievementId)) return false

		await this.profile.unlockAchievement(achievementId)

		// Keep the in-memory profile in step so a second call in the same
		// session is a no-op rather than a duplicate write.
		const cached = this.profile.profile
		if (cached) {
			cached.unlockedAchievements = [
				...(cached.unlockedAchievements || []),
				achievementId,
			]
		}
		console.info(`[Achievements] Unlocked ${achievementId}`)
		return true
	}
}

export default new AchievementService()
