/**
 * HUD.js
 * Drives the in-game overlay already laid out in index.html (#hud).
 *
 * update() runs every frame, so it only touches the DOM when a displayed
 * value actually changes — writing textContent/style 60 times a second for
 * values that have not moved is wasted layout work.
 */

/** 63.4 -> "1:03" */
function formatClock(seconds) {
	const total = Math.max(0, Math.floor(seconds))
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export class HUD {
	constructor() {
		this.root = document.getElementById('hud')
		this.pilotTag = document.getElementById('pilot-tag')
		this.integrityBar = document.getElementById('integrity-bar')
		this.distanceBar = document.getElementById('distance-bar')
		this.distanceReadout = document.getElementById('hud-distance')
		this.scoreEl = document.getElementById('score-value')
		this.timerEl = document.getElementById('hud-timer')
		this.warningEl = document.getElementById('warning-text')
		this.nitrogenRow = document.getElementById('nitrogen-count')
		this.boostEl = document.getElementById('boost-indicator')
		this.boostTimer = document.getElementById('boost-timer')
		this.speed = document.getElementById('speed-tracker')

		this._last = {}
		this._hitTimer = null
	}

	/** @param {{pilotName?: string, shipName?: string}} crew */
	show({ pilotName, shipName } = {}) {
		this._last = {}
		if (this.pilotTag) {
			this.pilotTag.textContent = [pilotName, shipName]
				.filter(Boolean)
				.join(' · ')
				.toUpperCase()
		}
		// Nitrogen pickups and boosts are not implemented yet; hide their
		// rows instead of showing a counter that can never change.
		//this.nitrogenRow?.classList.add('hidden')
		//this.boostEl?.classList.add('hidden')
		this.setWarning(false)
		this.root?.classList.remove('hidden', 'hud-hit')
	}

	hide() {
		clearTimeout(this._hitTimer)
		this.root?.classList.add('hidden')
		this.root?.classList.remove('hud-hit')
		this.setWarning(false)
	}

	/**
	 * @param {object} state
	 * @param {number} state.integrity 0..100
	 * @param {number} state.progress 0..1 of the way to escape
	 * @param {number} state.score
	 * @param {number} state.time seconds elapsed
	 * @param {boolean} state.warning close to the event horizon
	 */
	update({ integrity, progress, score, time, warning, speed, nitrogen, boostTime }) {
		const hull = Math.max(0, Math.round(integrity))
		if (hull !== this._last.hull) {
			this._last.hull = hull
			this.integrityBar.style.width = `${hull}%`
			// Green -> amber -> red as the hull fails.
			this.integrityBar.style.background =
				hull > 50
					? 'var(--green)'
					: hull > 25
						? '#ffb347'
						: 'var(--red)'
		}

		const boost = boostTime / 10;
		if(boost != this._last.boost){
			this._last.boost = boost
			this.boostTimer.textContent = boost;
			if(boost == 0){
				this.boostEl.classList.toggle('hidden', true)
			}
		}

		const pct = Math.max(
			0,
			Math.min(100, Math.floor(progress * 100))
		)
		if (pct !== this._last.pct) {
			this._last.pct = pct
			this.distanceBar.style.width = `${pct}%`
			if (this.distanceReadout)
				this.distanceReadout.textContent = `${pct}% TO SAFE SPACE`
		}

		const shownScore = Math.max(0, Math.floor(score))
		if (shownScore !== this._last.score) {
			this._last.score = shownScore
			this.scoreEl.textContent = shownScore.toLocaleString()
		}

		const _speed = Math.round(speed) 
		if(_speed != this._last.clock){
			this._last.speed = _speed
			this.speed.textContent = _speed;
		}
		const _nitrogen = nitrogen;
		if(_nitrogen != this._last.nitrogen){
			this._last.nitrogen = _nitrogen
			this.nitrogenRow.textContent = _nitrogen
		}

		const clock = formatClock(time)
		if (clock !== this._last.clock) {
			this._last.clock = clock
			if (this.timerEl) this.timerEl.textContent = clock
		}

		this.setWarning(Boolean(warning))
	}

	updateBoost(duration){
		this.boostEl.classList.toggle('hidden', false)
		this.boostTimer.textContent = duration
	}

	setWarning(on) {
		if (on === this._last.warning) return
		this._last.warning = on
		this.warningEl?.classList.toggle('hidden', !on)
	}

	/** Brief red edge flash when the hull takes a hit. */
	flashDamage() {
		if (!this.root) return
		this.root.classList.remove('hud-hit')
		// Force a reflow so re-adding the class restarts the animation even
		// when two hits land close together.
		void this.root.offsetWidth
		this.root.classList.add('hud-hit')
		clearTimeout(this._hitTimer)
		this._hitTimer = setTimeout(
			() => this.root.classList.remove('hud-hit'),
			400
		)
	}

	flashBoost() {
		if (!this.root) return
		this.root.classList.remove('hud-boost')
		// Force a reflow so re-adding the class restarts the animation even
		// when two hits land close together.
		void this.root.offsetWidth
		this.root.classList.add('hud-boost')
		clearTimeout(this._hitTimer)
		this._hitTimer = setTimeout(
			() => this.root.classList.remove('hud-boost'),
			400
		)
	}
}
