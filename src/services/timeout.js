/**
 * timeout.js
 * Bounds how long the game will wait on a Firestore call.
 *
 * WHY THIS EXISTS
 * ---------------
 * Firestore's SDK has no request timeout. Against a project whose database
 * has not been created, a browser read takes ~35 SECONDS before it gives up
 * (measured), and a write never settles at all — `setDoc()` only resolves
 * once the server acknowledges it, so with no reachable backend the promise
 * stays pending indefinitely while the SDK retries.
 *
 * That turned a 0.1s account creation into a 35s "CREATING…" spinner,
 * because sign-up was awaiting the profile write. Every Firestore call the
 * game makes is now wrapped so a broken or slow backend degrades to
 * local-only within a few seconds instead of hanging the UI.
 *
 * IMPORTANT: a timed-out WRITE is not cancelled. The Firestore SDK keeps
 * queued writes and replays them when connectivity returns, so the write
 * may still land later. Timing out only stops us *waiting* for it — which
 * is what we want, since the local copy is already saved either way.
 */

/** Generous enough for a slow phone connection, short enough that a dead
 * backend does not look like a hang. */
export const FIRESTORE_TIMEOUT_MS = 8000

/** How long sign-in/sign-up will wait for the profile sync before handing
 * control back to the player. The sync keeps running in the background. */
export const SYNC_BUDGET_MS = 2500

export class TimeoutError extends Error {
	constructor(label, ms) {
		super(`${label} timed out after ${ms}ms`)
		this.name = 'TimeoutError'
		this.code = 'deadline-exceeded'
		this.label = label
		this.ms = ms
	}
}

/**
 * Resolve with `promise`, or reject with a TimeoutError after `ms`.
 *
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label used in the error message, e.g. 'profile read'
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(
	promise,
	ms = FIRESTORE_TIMEOUT_MS,
	label = 'firestore call'
) {
	let timer
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(new TimeoutError(label, ms)),
			ms
		)
	})
	// clearTimeout on either outcome so a settled call does not hold the
	// event loop open (matters for the Node test script, which exits).
	return Promise.race([promise, timeout]).finally(() =>
		clearTimeout(timer)
	)
}

/**
 * Wait for `promise`, but give up after `ms` and resolve with `fallback`
 * instead of rejecting. For the cases where "we tried, move on" is the
 * correct behaviour and the caller has nothing to handle.
 */
export async function withBudget(promise, ms, label, fallback = null) {
	try {
		return await withTimeout(promise, ms, label)
	} catch (error) {
		if (error instanceof TimeoutError) {
			console.info(
				`[Backend] ${label} still in flight after ${ms}ms — continuing without it.`
			)
			return fallback
		}
		throw error
	}
}

/** True when an error came from withTimeout rather than from Firestore. */
export function isTimeout(error) {
	return error instanceof TimeoutError
}
