import * as THREE from 'three'

import { Level, clearScene } from '../../core/Level.js'
import { STATUS } from '../../core/GameState.js'
import { SHIPS } from '../../systems/ShipManager.js'
import { CHARACTERS } from '../../systems/CharacterManager.js'
import { HUD } from '../../ui/HUD.js'
import { AsteroidField } from './AsteroidField.js'
import { BlackHole } from './BlackHole.js'
import { Spaceship } from './Spaceship.js'

/**
 * Level 1 balance, all in one place.
 *
 * Distances are signed distances from the black hole's plane (z = 0) along
 * its normal: positive is away from the hole. The ship starts at
 * startDistance, is captured below the black hole's captureDistance (-20),
 * and escapes at escapeDistance.
 */
// Balance was play-tested: holding thrust without ever steering should be
// a gamble (the tough Aegis can often brute-force it, the fragile
// Starfighter usually cannot), so dodging asteroids is what wins runs.
// At the first draft's 3500 units / 14 damage, straight-line thrust won
// in 26s with 69% hull.
export const LEVEL1_TUNING = Object.freeze({
	startDistance: 300,
	escapeDistance: 5000,
	warningDistance: 160,

	// Gravity eases from start to max. Idle, the ship is dragged in after
	// ~10s — long enough for a new player to find the thrust key.
	gravityStart: 25,
	gravityMax: 85,
	gravityRampSeconds: 75,

	// Base handling, scaled per ship by its stats (see handlingFor).
	// thrust must stay above gravityMax for every ship, or escape becomes
	// impossible late in a run.
	thrust: 120,
	maxSpeed: 115,
	turnSpeed: 1.5,
	pitchSpeed: 1.2,

	hitDamage: 20,
	// Lateral spread of the field around the ship. Tighter packs the same
	// number of asteroids closer to the flight path.
	asteroidSpread: 800,
	invulnerableSeconds: 1,
	hitSpeedKept: 0.55, // fraction of velocity kept after an impact
	shakeSeconds: 0.35,
	shakeAmount: 1.6,

	safeStartRadius: 140,
	endDelaySeconds: 1.4, // world keeps drifting before the results appear

	escapeBonus: 2000,
	hullBonusPerPoint: 20,
	parTimeSeconds: 60,
	timeBonusPerSecond: 25,
})

/**
 * Space flies the ship up, but a focused <button> also treats Space as a
 * click. Runs start from LAUNCH / FLY AGAIN and resume from RESUME, all of
 * which keep focus — so without this, climbing would restart the run.
 */
function releaseButtonFocus() {
	const el = document.activeElement
	if (el && el !== document.body && typeof el.blur === 'function')
		el.blur()
}

/** Map a 1-10 stat onto [low, high] across the stat range [from, to]. */
function lerpStat(value, from, to, low, high) {
	const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
	return low + (high - low) * t
}

/**
 * Turn a ship's hangar stats into flight handling, so the ship you pick
 * actually flies differently. The spread is deliberately gentle (about
 * +/-10-20%) so every ship can finish the level.
 */
export function handlingFor(shipKey) {
	const T = LEVEL1_TUNING
	const stats = SHIPS[shipKey]?.stats || {
		speed: 8,
		agility: 8,
		durability: 7,
		shields: 7,
	}
	const speed = lerpStat(stats.speed, 6, 10, 0.9, 1.1)
	const agility = lerpStat(stats.agility, 5, 10, 0.88, 1.12)
	const defence = (stats.durability + stats.shields) / 2
	return {
		thrustPower: T.thrust * speed,
		maxSpeed: T.maxSpeed * speed,
		turnSpeed: T.turnSpeed * agility,
		pitchSpeed: T.pitchSpeed * agility,
		// Multiplier on hull damage per hit: tough ships take less.
		damageTaken: lerpStat(defence, 5, 10, 1.2, 0.8),
	}
}

export class Level1 extends Level {
	/**
	 * @param {object} game
	 * @param {object} [options]
	 * @param {string} [options.shipKey]
	 * @param {string} [options.pilotKey]
	 * @param {(result: object) => void} [options.onEnd] run finished
	 * @param {(paused: boolean) => void} [options.onPauseChange]
	 */
	constructor(
		game,
		{
			shipKey = 'starfighter',
			pilotKey = 'zara',
			onEnd,
			onPauseChange,
		} = {}
	) {
		super(game, 1)
		const T = LEVEL1_TUNING

		this.onEnd = onEnd || (() => {})
		this.onPauseChange = onPauseChange || (() => {})
		this.shipKey = SHIPS[shipKey] ? shipKey : 'starfighter'
		this.pilotKey = CHARACTERS[pilotKey] ? pilotKey : 'zara'
		this.handling = handlingFor(this.shipKey)
		this.audio = game.audio

		// Start from an empty scene (SceneManager's default lights included);
		// this level brings its own. Game re-adds the defaults on the way back
		// to the menu.
		clearScene(this.sceneManager.scene)
		this.addLights()

		this.state = game.gameState
		this.state.reset()
		this.state.currentLevel = 1
		this.state.status = STATUS.PLAYING

		this.timeScale = 1
		this.elapsedPlayTime = 0
		this.bestDistance = T.startDistance
		this.invulnerableFor = 0
		this.shakeFor = 0
		this.warningBeepIn = 0
		this.paused = false
		this.ended = false
		this._endTimer = null

		this.blackHole = new BlackHole(this)
		this.blackHole.gravityStart = T.gravityStart
		this.blackHole.gravityMax = T.gravityMax
		this.blackHole.gravityRampSeconds = T.gravityRampSeconds
		this.blackHole.rampDifficulty(0)

		const ship = SHIPS[this.shipKey]
		this.spaceship = new Spaceship(this, this.blackHole, {
			shipKey: this.shipKey,
			modelPath: ship.model,
			handling: this.handling,
		})
		this.spaceship.position.set(0, 0, T.startDistance)
		this.spaceship.shipGroup.position.copy(this.spaceship.position)

		this.asteroidField = new AsteroidField(this, this.blackHole, {
			spawnRadius: T.asteroidSpread,
		})
		this.asteroidField.clearAround(
			this.spaceship.position,
			T.safeStartRadius
		)

		this.hud = new HUD()
		this.hud.show({
			pilotName: CHARACTERS[this.pilotKey]?.name,
			shipName: ship.name,
		})
		this._updateHud(T.startDistance)

		this.audio?.startThrusterHum()
		releaseButtonFocus()

		this._onKeyDown = (e) => {
			if (e.code !== 'Escape' || this.ended) return
			e.preventDefault()
			this.setPaused(!this.paused)
		}
		// Clicking away from the window pauses rather than letting the ship
		// drift into the hole unattended.
		this._onBlur = () => this.setPaused(true)
		// Switching browser tabs does not always fire window blur, but the
		// browser does stop animation frames — without this the run would
		// sit frozen and UNpaused, and resume the instant the tab returns.
		this._onVisibility = () => {
			if (document.hidden) this.setPaused(true)
		}
		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('blur', this._onBlur)
		document.addEventListener(
			'visibilitychange',
			this._onVisibility
		)
	}

	/** Lights go through addObject() so dispose() removes them. They used to
	 * be added to the scene directly, so every restart stacked four more. */
	addLights() {
		const rim = new THREE.DirectionalLight(0x88bbff, 2)
		rim.position.set(300, 200, 300)
		rim.target.position.set(0, 0, 0)
		this.addObject(rim)
		this.addObject(rim.target)
		this.addObject(new THREE.AmbientLight(0x334466, 0.4))
		this.blackHoleLight = new THREE.PointLight(0xffaa44, 3, 400, 2)
		this.blackHoleLight.position.set(0, 0, 0)
		this.addObject(this.blackHoleLight)
	}

	setPaused(paused) {
		if (this.ended || paused === this.paused) return
		this.paused = paused
		this.state.status = paused ? STATUS.PAUSED : STATUS.PLAYING
		// Keys released while paused never deliver their keyup.
		this.spaceship.clearInput()
		this.audio?.setThrusterLevel(0)
		if (!paused) releaseButtonFocus()
		this.onPauseChange(paused)
	}

	update(delta) {
		if (this.paused) return

		if (this.ended) {
			// Let the field drift on in slow motion behind the result.
			this.asteroidField.updateAsteroidPhysics(delta, 0.2)
			this.blackHole.updateBlackHoleDisk(delta, 0.2)
			return
		}

		const T = LEVEL1_TUNING
		const dt = delta * this.timeScale
		this.elapsedPlayTime += dt
		this.blackHole.rampDifficulty(this.elapsedPlayTime)

		this.asteroidField.updateAsteroidPhysics(delta, this.timeScale)
		this.blackHole.updateBlackHoleDisk(delta, this.timeScale)
		this.spaceship.updatePhysics(delta, this.timeScale)
		this.spaceship.updateCamera(delta, this.timeScale)
		this._applyShake(dt)

		this.invulnerableFor = Math.max(0, this.invulnerableFor - dt)
		if (this.invulnerableFor === 0) {
			const hit = this.asteroidField.checkShipCollision(
				this.spaceship
			)
			if (hit) this._onHit(hit)
		}
		// Blink while invulnerable so the grace period is readable.
		this.spaceship.shipGroup.visible =
			this.invulnerableFor === 0 ||
			Math.floor(this.invulnerableFor * 14) % 2 === 0

		const distance = this.blackHole.getSignedDistance(
			this.spaceship.position
		)
		this.bestDistance = Math.max(this.bestDistance, distance)
		this.state.elapsedTime = this.elapsedPlayTime
		this.state.distanceFromHazard = distance
		this.state.score = this._distanceScore()

		if (!this.state.isAlive()) return this._end('destroyed')
		if (
			this.blackHole.isBeyondEventHorizon(
				this.spaceship.position
			)
		)
			return this._end('captured')
		if (distance >= T.escapeDistance) return this._end('escaped')

		this.audio?.setThrusterLevel(
			this.spaceship.isThrusting ? 1 : 0.15
		)
		this._updateHud(distance)
		this._warningBeep(distance, dt)
	}

	_onHit(asteroid) {
		const T = LEVEL1_TUNING
		// Bigger rocks hurt more (asteroid scale runs ~0.6-2.4).
		const size = 0.75 + asteroid.scale * 0.17
		this.state.damage(
			Math.round(
				T.hitDamage * size * this.handling.damageTaken
			)
		)
		this.invulnerableFor = T.invulnerableSeconds
		this.shakeFor = T.shakeSeconds
		this.spaceship.velocity.multiplyScalar(T.hitSpeedKept)
		this.asteroidField.removeAsteroid(asteroid)
		this.audio?.playImpact()
		this.hud.flashDamage()
	}

	/** Nudge the camera for a moment after an impact. Applied after the
	 * chase camera has settled, so it never accumulates. */
	_applyShake(dt) {
		if (this.shakeFor <= 0) return
		this.shakeFor = Math.max(0, this.shakeFor - dt)
		const T = LEVEL1_TUNING
		const strength =
			T.shakeAmount * (this.shakeFor / T.shakeSeconds)
		const cam = this.sceneManager.camera
		cam.position.x += (Math.random() - 0.5) * strength
		cam.position.y += (Math.random() - 0.5) * strength
	}

	_warningBeep(distance, dt) {
		if (distance >= LEVEL1_TUNING.warningDistance) {
			this.warningBeepIn = 0
			return
		}
		this.warningBeepIn -= dt
		if (this.warningBeepIn <= 0) {
			this.audio?.playWarning()
			this.warningBeepIn = 0.8
		}
	}

	/** Points for the furthest distance reached from the start line. */
	_distanceScore() {
		return Math.max(
			0,
			Math.floor(
				this.bestDistance - LEVEL1_TUNING.startDistance
			)
		)
	}

	_progress(distance) {
		const T = LEVEL1_TUNING
		return (
			(Math.max(distance, T.startDistance) -
				T.startDistance) /
			(T.escapeDistance - T.startDistance)
		)
	}

	_updateHud(distance) {
		this.hud.update({
			integrity: this.state.integrity,
			progress: this._progress(this.bestDistance),
			score: this.state.score,
			time: this.elapsedPlayTime,
			warning: distance < LEVEL1_TUNING.warningDistance,
		})
	}

	/** @param {'escaped'|'captured'|'destroyed'} outcome */
	_end(outcome) {
		if (this.ended) return
		const T = LEVEL1_TUNING
		this.ended = true
		const won = outcome === 'escaped'
		const time = this.elapsedPlayTime
		const hull = Math.max(0, this.state.integrity)

		let score = this._distanceScore()
		if (won) {
			score +=
				T.escapeBonus +
				hull * T.hullBonusPerPoint +
				Math.max(
					0,
					Math.round(
						(T.parTimeSeconds - time) *
							T.timeBonusPerSecond
					)
				)
		}
		this.state.score = score
		this.state.status = won
			? STATUS.LEVEL_COMPLETE
			: STATUS.GAME_OVER

		this.spaceship.clearInput()
		this.audio?.stopThrusterHum()
		if (won) this.audio?.playEscape()
		else this.audio?.playCrash()
		// A destroyed ship is gone; a captured one falls into the dark.
		this.spaceship.shipGroup.visible = outcome !== 'destroyed'

		this.hud.update({
			integrity: hull,
			progress: won ? 1 : this._progress(this.bestDistance),
			score,
			time,
			warning: false,
		})

		const result = {
			outcome,
			won,
			score,
			time,
			hull,
			progress: won ? 1 : this._progress(this.bestDistance),
			level: 1,
		}
		this._endTimer = setTimeout(
			() => this.onEnd(result),
			T.endDelaySeconds * 1000
		)
	}

	dispose() {
		clearTimeout(this._endTimer)
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('blur', this._onBlur)
		document.removeEventListener(
			'visibilitychange',
			this._onVisibility
		)
		this.spaceship?.dispose()
		this.audio?.stopThrusterHum()
		this.hud?.hide()
		super.dispose()
	}
}
