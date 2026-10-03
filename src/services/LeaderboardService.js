/**
 * LeaderboardService.js
 * Score submission and top-N reads for /leaderboards/{levelId}/scores
 * (see Database_schema.md 2.3).
 *
 * Two constraints from firestore.rules worth knowing before changing this:
 *   1. A score document can only be created with userId === request.auth.uid,
 *      so submitScore() always stamps the signed-in uid and ignores any
 *      caller-supplied userId.
 *   2. Score documents are immutable (allow update, delete: if false). There
 *      is no "update my best score" — every run appends a new document, and
 *      the leaderboard is the ordered read over all of them.
 *
 * The ordered read needs the composite index in firestore.indexes.json
 * (score DESC, timeElapsed ASC). Without it deployed, getTopScores() fails
 * with 'failed-precondition' and Firestore logs a link that creates it.
 */

import {
	collection,
	doc,
	setDoc,
	getDocs,
	query,
	orderBy,
	limit as limitTo,
	serverTimestamp,
} from 'firebase/firestore'
import { db, isFirebaseReady } from './firebaseConfig.js'
import { withTimeout } from './timeout.js'
import authService from './AuthService.js'

/** Must stay in sync with isValidLevel() in firestore.rules. */
export const LEVEL_IDS = Object.freeze([
	'level_1',
	'level_2',
	'level_3',
	'global',
])

/** Map a numeric level (GameState.currentLevel) to a leaderboard id. */
export function levelIdFor(level) {
	const id = `level_${level}`
	return LEVEL_IDS.includes(id) ? id : 'global'
}

export class LeaderboardService {
	constructor(auth = authService) {
		this.auth = auth
	}

	_scoresRef(levelId) {
		return collection(db, 'leaderboards', levelId, 'scores')
	}

	/**
	 * Append one finished run to a leaderboard.
	 * @param {string} levelId one of LEVEL_IDS
	 * @param {{score: number, timeElapsed: number,
	 *          nitrogenCollected: number, displayName: string}} run
	 * @returns {Promise<string|null>} the new document id, or null on failure
	 */
	async submitScore(levelId, run) {
		if (!isFirebaseReady()) return null
		if (!LEVEL_IDS.includes(levelId)) {
			console.warn(
				`[Leaderboard] Refusing to submit to unknown level "${levelId}".`
			)
			return null
		}

		const uid = this.auth.uid || (await this.auth.ready())
		if (!uid) return null

		// The rules validate types and non-negativity, so coerce here rather
		// than letting a NaN from gameplay code turn into a rejected write.
		const payload = {
			userId: uid,
			displayName: String(run.displayName || 'Pilot').slice(
				0,
				16
			),
			score: Math.max(0, Math.round(Number(run.score) || 0)),
			timeElapsed: Math.max(0, Number(run.timeElapsed) || 0),
			nitrogenCollected: Math.max(
				0,
				Math.round(Number(run.nitrogenCollected) || 0)
			),
			achievedAt: serverTimestamp(),
		}

		try {
			// Generate the ref up front so scoreId can be stored in the
			// document itself, which is what the schema specifies.
			const ref = doc(this._scoresRef(levelId))
			await withTimeout(
				setDoc(ref, { ...payload, scoreId: ref.id }),
				undefined,
				`submit score to ${levelId}`
			)
			console.info(
				`[Leaderboard] Submitted ${payload.score} to ${levelId} as ${payload.displayName}`
			)
			return ref.id
		} catch (error) {
			console.warn(
				`[Leaderboard] Submit to ${levelId} failed:`,
				error?.message
			)
			return null
		}
	}

	/**
	 * Top scores for a level, highest score first, faster time breaking ties.
	 * @returns {Promise<Array<object>>} empty array when unavailable.
	 */
	async getTopScores(levelId = 'global', max = 10) {
		if (!isFirebaseReady()) return []
		if (!LEVEL_IDS.includes(levelId)) return []

		try {
			const snapshot = await withTimeout(
				getDocs(
					query(
						this._scoresRef(levelId),
						orderBy('score', 'desc'),
						orderBy('timeElapsed', 'asc'),
						limitTo(max)
					)
				),
				undefined,
				`read ${levelId} leaderboard`
			)
			return snapshot.docs.map((entry, index) => ({
				rank: index + 1,
				...entry.data(),
			}))
		} catch (error) {
			if (error?.code === 'failed-precondition') {
				console.warn(
					'[Leaderboard] Missing composite index. Deploy it with: firebase deploy --only firestore:indexes'
				)
			} else {
				console.warn(
					`[Leaderboard] Read of ${levelId} failed:`,
					error?.message
				)
			}
			return []
		}
	}

	/** Convenience: submit the finished run for a numeric level. */
	async submitRun(level, run) {
		return this.submitScore(levelIdFor(level), run)
	}
}

export default new LeaderboardService()
