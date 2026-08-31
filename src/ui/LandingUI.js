import { SHIPS } from '../systems/ShipManager.js'
import { CHARACTERS } from '../systems/CharacterManager.js'

/**
 * LandingUI — UI controller for the end-of-stage planetary landing scene.
 * Manages cinematic skip, mission completion telemetry, and post-mission navigation.
 */
export class LandingUI {
	constructor({
		playerName = 'Pilot',
		pilotKey = 'zara',
		shipKey = 'raven',
		onContinue = () => {},
		onReplay = () => {},
		onMenu = () => {},
		onSkip = () => {},
	} = {}) {
		this.playerName = playerName
		this.pilotKey = pilotKey
		this.shipKey = shipKey
		this.onContinue = onContinue
		this.onReplay = onReplay
		this.onMenu = onMenu
		this.onSkip = onSkip

		this.shipConfig = SHIPS[shipKey] || SHIPS.raven
		this.pilotConfig = CHARACTERS[pilotKey] || CHARACTERS.zara

		this.screen = document.getElementById('screen-landing')
		this.debriefPanel = document.getElementById(
			'landing-debrief-panel'
		)
		this.skipBtn = document.getElementById('btn-landing-skip')
		this.continueBtn = document.getElementById(
			'btn-landing-continue'
		)
		this.replayBtn = document.getElementById('btn-landing-replay')
		this.menuBtn = document.getElementById('btn-landing-menu')

		this.vesselNameEl = document.getElementById(
			'landing-vessel-name'
		)
		this.pilotNameEl = document.getElementById('landing-pilot-name')
		this.callsignEl = document.getElementById('landing-callsign')

		this._bindEvents()
		this._populateData()
	}

	_bindEvents() {
		if (this.skipBtn) {
			this.skipBtn.onclick = () => {
				this.onSkip()
				this.showDebrief()
			}
		}

		if (this.continueBtn) {
			this.continueBtn.onclick = () => this.onContinue()
		}

		if (this.replayBtn) {
			this.replayBtn.onclick = () => {
				this.hideDebrief()
				this.onReplay()
			}
		}

		if (this.menuBtn) {
			this.menuBtn.onclick = () => this.onMenu()
		}
	}

	_populateData() {
		if (this.vesselNameEl) {
			this.vesselNameEl.textContent = `${this.shipConfig.name} ${this.shipConfig.mark}`
		}
		if (this.pilotNameEl) {
			this.pilotNameEl.textContent = `${this.pilotConfig.name} (${this.pilotConfig.role})`
		}
		if (this.callsignEl) {
			this.callsignEl.textContent =
				this.playerName || 'Explorer'
		}
	}

	show() {
		if (this.screen) {
			this.screen.classList.remove('hidden')
		}
		if (this.skipBtn) {
			this.skipBtn.classList.remove('hidden')
		}
		if (this.debriefPanel) {
			this.debriefPanel.classList.add('hidden')
		}
	}

	showDebrief() {
		if (this.skipBtn) {
			this.skipBtn.classList.add('hidden')
		}
		if (this.debriefPanel) {
			this.debriefPanel.classList.remove('hidden')
		}
	}

	hideDebrief() {
		if (this.skipBtn) {
			this.skipBtn.classList.remove('hidden')
		}
		if (this.debriefPanel) {
			this.debriefPanel.classList.add('hidden')
		}
	}

	hide() {
		if (this.screen) {
			this.screen.classList.add('hidden')
		}
	}
}
