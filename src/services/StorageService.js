/**
 * StorageService.js
 * Local persistence for player profile data (callsign, settings).
 *
 * This stays the synchronous, always-available source of truth the UI reads
 * at boot. ProfileService mirrors it to Firestore in the background — see
 * the header of that file for why the two are layered rather than merged.
 * Every write goes through save(), so subscribing via onSave() is enough to
 * observe any profile change from anywhere in the game.
 */

import { SHIPS } from '../systems/ShipManager.js'
import { CHARACTERS } from '../systems/CharacterManager.js'

const STORAGE_KEY = 'event-horizon:profile'

// Derived from the ship/character registries rather than hardcoded. The
// previous hardcoded list ('raven', 'phantom', 'interceptor') had drifted
// out of step with ShipManager, so every saved ship failed validation and
// silently reset — ship choice never actually persisted.
const VALID_CHARACTERS = Object.keys(CHARACTERS)
const VALID_SHIPS = Object.keys(SHIPS)

export const DEFAULT_PROFILE = Object.freeze({
	playerName: '',
	selectedCharacter: 'zara',
	selectedShip: 'starfighter',
	settings: Object.freeze({
		muted: false,
	}),
})

export class StorageService {
	constructor() {
		this._listeners = new Set()
	}

	/**
	 * Read the full profile from local storage, falling back to defaults
	 * when nothing is stored yet or the data is corrupt/unavailable.
	 */
	load() {
		const fallback = () => ({
			...DEFAULT_PROFILE,
			settings: { ...DEFAULT_PROFILE.settings },
		})

		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (!raw) return fallback()

			const parsed = JSON.parse(raw)
			const playerName =
				typeof parsed.playerName === 'string' &&
				parsed.playerName.trim()
					? parsed.playerName.trim().slice(0, 16)
					: DEFAULT_PROFILE.playerName

			const selectedCharacter =
				typeof parsed.selectedCharacter === 'string' &&
				VALID_CHARACTERS.includes(
					parsed.selectedCharacter
				)
					? parsed.selectedCharacter
					: DEFAULT_PROFILE.selectedCharacter

			const selectedShip =
				typeof parsed.selectedShip === 'string' &&
				VALID_SHIPS.includes(parsed.selectedShip)
					? parsed.selectedShip
					: DEFAULT_PROFILE.selectedShip

			const muted =
				parsed.settings &&
				typeof parsed.settings.muted === 'boolean'
					? parsed.settings.muted
					: DEFAULT_PROFILE.settings.muted

			return {
				playerName,
				selectedCharacter,
				selectedShip,
				settings: { muted },
			}
		} catch (error) {
			console.warn(
				'[Storage] Falling back to defaults:',
				error
			)
			return fallback()
		}
	}

	/**
	 * Persist the full profile object to local storage, then notify
	 * subscribers with the patch that was applied and the merged result.
	 */
	save(profile, { silent = false } = {}) {
		try {
			const current = this.load()
			const merged = {
				...current,
				...profile,
				settings: {
					...current.settings,
					...(profile && profile.settings
						? profile.settings
						: {}),
				},
			}
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(merged)
			)
			// silent writes are the ones coming back down FROM the cloud
			// sync; re-notifying would bounce them straight back up again.
			if (!silent) this._notify(profile || {}, merged)
		} catch (error) {
			console.warn('[Storage] Could not save profile:', error)
		}
	}

	/**
	 * Observe profile writes. Every setter here routes through save(), so a
	 * single subscriber sees callsign, pilot, ship and settings changes from
	 * every call site in the game — which is how the Firebase mirror stays
	 * in step without Menu.js or CharacterSelect.js knowing it exists.
	 *
	 * @param {(patch: object, merged: object) => void} listener
	 * @returns {() => void} unsubscribe
	 */
	onSave(listener) {
		this._listeners.add(listener)
		return () => this._listeners.delete(listener)
	}

	_notify(patch, merged) {
		for (const listener of this._listeners) {
			try {
				listener(patch, merged)
			} catch (error) {
				console.warn('[Storage] listener threw:', error)
			}
		}
	}

	/**
	 * Wipe the cached profile back to defaults. Used on sign-out so the next
	 * person to use this browser does not inherit the previous pilot's
	 * callsign, ship or settings.
	 */
	reset({ silent = false } = {}) {
		try {
			localStorage.removeItem(STORAGE_KEY)
			if (!silent) this._notify({}, this.load())
		} catch (error) {
			console.warn(
				'[Storage] Could not reset profile:',
				error
			)
		}
	}

	getPlayerName() {
		return this.load().playerName
	}

	setPlayerName(name) {
		const sanitized =
			(name || '').trim().slice(0, 16) ||
			DEFAULT_PROFILE.playerName
		this.save({ playerName: sanitized })
		return sanitized
	}

	getSelectedPilot() {
		return this.load().selectedCharacter
	}

	setSelectedPilot(characterKey) {
		this.save({ selectedCharacter: characterKey })
	}

	getSelectedShip() {
		return this.load().selectedShip
	}

	setSelectedShip(shipKey) {
		this.save({ selectedShip: shipKey })
	}
}

export default new StorageService()
