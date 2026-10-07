// Central, plain-object game state shared across systems.
// Kept deliberately dumb (no logic) so any system can read/write it
// without circular imports; Game.js owns the transitions between statuses.

export const STATUS = Object.freeze({
	MENU: 'menu',
	PLAYING: 'playing',
	PAUSED: 'paused',
	CUTSCENE: 'cutscene',
	LEVEL_COMPLETE: 'level_complete',
	GAME_OVER: 'game_over',
})

export class GameState {
	constructor() {
		this.playerName = 'Pilot'
		this.selectedCharacter = 'zara'
		this.selectedShip = 'vanguard'
		this.reset()
	}

	reset() {
		this.status = STATUS.MENU
		this.currentLevel = 1
		this.score = 0
		this.integrity = 100 // hull health, 0 = destroyed
		this.nitrogenCollected = 0
		this.boostTimeRemaining = 0 // seconds of active nitrogen boost
		this.elapsedTime = 0 // seconds since level start
		this.distanceFromHazard = 0 // level-specific "progress" metric
		this.alienAlert = false
		this.crashSite = null
		this.landingSite = null
		this.surfaceBaseY = null
		// playerName, selectedCharacter, selectedShip are intentionally NOT reset here —
		// they are preserved across retries.
	}

	damage(amount) {
		this.integrity = Math.max(0, this.integrity - amount)
	}

	addScore(amount) {
		this.score += amount
	}

	isAlive() {
		return this.integrity > 0
	}
}
