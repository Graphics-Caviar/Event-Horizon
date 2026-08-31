/**
 * StorageService.js
 * Local persistence for player profile data (callsign, settings).
 *
 * Currently backed by localStorage so the game runs with no backend setup.
 * The public API is shaped like a Firestore document read/write (load/save
 * of a single profile object), so moving to the DB later only requires
 * rewriting this file -- call sites stay unchanged.
 */

const STORAGE_KEY = 'event-horizon:profile'

export const DEFAULT_PROFILE = Object.freeze({
	playerName: '',
	selectedCharacter: 'zara',
	selectedShip: 'raven',
	settings: Object.freeze({
		muted: false,
	}),
})

export class StorageService {
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

			const validCharacters = ['zara', 'kai', 'nyx']
			const selectedCharacter =
				typeof parsed.selectedCharacter === 'string' &&
				validCharacters.includes(
					parsed.selectedCharacter
				)
					? parsed.selectedCharacter
					: DEFAULT_PROFILE.selectedCharacter

			const validShips = ['raven', 'phantom', 'interceptor']
			const selectedShip =
				typeof parsed.selectedShip === 'string' &&
				validShips.includes(parsed.selectedShip)
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
	 * Persist the full profile object to local storage.
	 */
	save(profile) {
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
		} catch (error) {
			console.warn('[Storage] Could not save profile:', error)
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
