/**
 * authRules.js
 * Pure callsign/password rules, with no Firebase import of any kind.
 *
 * WHY THIS IS NOT JUST PART OF AuthService
 * ----------------------------------------
 * AuthScreen needs these validators to check a form before it hits the
 * network. But AuthService imports `firebase/auth`, and Game.js imports
 * AuthScreen statically — so importing the validators from AuthService put
 * the whole ~490 kB Firebase SDK back into the main bundle and undid the
 * lazy-chunk split that keeps it out of first load.
 *
 * Keeping the rules in their own dependency-free module means the form and
 * the service still share exactly one definition of what a valid callsign
 * is, while the browser only downloads Firebase when it is actually needed.
 */

/** Internal-only domain for the synthetic login addresses. Deliberately
 * not a real one — see AuthService's header for why callsigns map to
 * emails at all. */
export const CALLSIGN_DOMAIN = 'pilots.eventhorizon.game'

export const USERNAME_MIN = 3
export const USERNAME_MAX = 16
export const PASSWORD_MIN = 8

/** Lowercased form used to build the login address, so callsigns are
 * case-insensitive for sign-in while keeping their original casing on
 * screen. */
export function normalizeUsername(username) {
	return String(username || '')
		.trim()
		.toLowerCase()
}

export function usernameToEmail(username) {
	return `${normalizeUsername(username)}@${CALLSIGN_DOMAIN}`
}

/** Recover the callsign from a synthetic address. */
export function emailToUsername(email) {
	return String(email || '').split('@')[0]
}

/** @returns {{ok: boolean, error?: string}} */
export function validateUsername(username) {
	const trimmed = String(username || '').trim()
	if (!trimmed) return { ok: false, error: 'Enter a callsign.' }
	if (trimmed.length < USERNAME_MIN)
		return {
			ok: false,
			error: `Callsign must be at least ${USERNAME_MIN} characters.`,
		}
	if (trimmed.length > USERNAME_MAX)
		return {
			ok: false,
			error: `Callsign must be ${USERNAME_MAX} characters or fewer.`,
		}
	if (!/^[A-Za-z]/.test(trimmed))
		return {
			ok: false,
			error: 'Callsign must start with a letter.',
		}
	if (!/^[A-Za-z0-9_-]+$/.test(trimmed))
		return {
			ok: false,
			error: 'Callsign can only use letters, numbers, _ and -.',
		}
	return { ok: true }
}

/** @returns {{ok: boolean, error?: string}} */
export function validatePassword(password) {
	const value = String(password || '')
	if (!value) return { ok: false, error: 'Enter a password.' }
	if (value.length < PASSWORD_MIN)
		return {
			ok: false,
			error: `Password must be at least ${PASSWORD_MIN} characters.`,
		}
	if (value.length > 128)
		return { ok: false, error: 'Password is too long.' }
	return { ok: true }
}
