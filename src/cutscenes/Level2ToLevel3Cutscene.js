import * as THREE from 'three'
import { clearScene } from '../core/Level.js'
import { STATUS } from '../core/GameState.js'
import { Level3 } from '../levels/Level3/Level3.js'
import { constrainTerrainCamera } from '../levels/Level2/TerrainCamera.js'
import {
	RADIO_SCRIPTS,
	SPEAKERS,
	cueAt,
} from '../audio/dialogue/radioScripts.js'
import { CinematicShip } from './CinematicShip.js'
import { VoidTransitEnvironment } from './VoidTransitEnvironment.js'
import { CinematicWormhole } from './CinematicWormhole.js'
import { CinematicMissileStrike } from './CinematicMissileStrike.js'
import { CinematicMissileSalvo } from './CinematicMissileSalvo.js'

// Seconds. Movement phases share one continuous curve and clock; shot changes
// never reset either actor. Event phases have bounded waits for failed assets.
export const CUTSCENE_DURATIONS = Object.freeze({
	rover_approach: 2.2,
	missile_detected: 3.2,
	missile_impact: 0.9,
	rover_disabled: 1.4,
	astronaut_exit: 1.8,
	run_to_spacefighter: 18,
	board_spacefighter: 4,
	engine_start: 3.2,
	takeoff: 16,
	wormhole_entry: 4,
	level3_loading: 5,
	wormhole_exit: 4,
	arrival: 8,
	disembark: 6,
	handoff: 4,
})
const UP = new THREE.Vector3(0, 1, 0)
const clamp = (v) => THREE.MathUtils.clamp(v, 0, 1)
const ease = (v) => {
	const t = clamp(v)
	return t * t * (3 - 2 * t)
}
const offset = (p, x, y, z) => new THREE.Vector3(p.x + x, p.y + y, p.z + z)
const angleDelta = (to, from) =>
	Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** ESCAPE TO THE VOID. Owns the existing Level 2 until portal crossing, then hands
 * an actual Level3 instance back to Game. It never substitutes a playable
 * space level for the existing on-foot level. The astronaut commandeers a
 * parked alien anomaly ship; the original ship selection remains unchanged.
 */
export class Level2ToLevel3Cutscene {
	constructor(
		game,
		{
			level = null,
			result = null,
			onComplete,
			onPauseChange,
			durations = {},
		} = {}
	) {
		this.game = game
		this.sceneManager = game.sceneManager
		this.audio = game.audio
		this.radio = game.radio
		this.level = level
		this.result = result
		this.level3 = null
		this.onComplete = onComplete || (() => {})
		this.onPauseChange = onPauseChange || (() => {})
		this.durations = Object.fromEntries(
			Object.entries(CUTSCENE_DURATIONS).map(
				([key, value]) => [
					key,
					Number.isFinite(durations[key])
						? Math.max(0.2, durations[key])
						: value,
				]
			)
		)
		this.phase = 'rover_approach'
		this.phaseTime = this.elapsed = this.flightTime = 0
		this.finished = this._disposed = this._skipped = false
		this._originShift = new THREE.Vector3()
		this._resources = new Set()
		this.root = new THREE.Group()
		this.root.name = 'call-of-the-void-cinematic'
		this.sceneManager.scene.add(this.root)
		this.ship = new CinematicShip({
			assetManager: game.assetManager,
			shipKey: game.gameState.selectedShip,
			craft: 'anomaly',
		})
		this.environment = new VoidTransitEnvironment({
			assetManager: game.assetManager,
		})
		this.wormhole = new CinematicWormhole()
		this.wormhole.group.visible = false
		this._wormholeCrossed = false
		this.root.add(
			this.ship.group,
			this.environment.group,
			this.wormhole.group
		)
		this.environment.group.visible = false
		// Reveal a fully grounded hull after the model's measured bounds are
		// ready. Placeholder preparation must not move a visible ship.
		this.ship.group.visible = false
		const camera = this.sceneManager.camera
		this._cameraBase = {
			near: camera.near,
			far: camera.far,
			fov: camera.fov,
		}
		this._camPos = camera.position.clone()
		this._camLook = camera.position
			.clone()
			.addScaledVector(
				camera.getWorldDirection(new THREE.Vector3()),
				24
			)
		this._rotation = new THREE.Quaternion()
		this._matrix = new THREE.Matrix4()
		this._startedAt = performance.now()
		this._buildOverlay()
		this._onKeyDown = (event) => {
			if (
				!['Space', 'Enter', 'Escape'].includes(
					event.code
				) ||
				event.repeat ||
				performance.now() - this._startedAt < 800
			)
				return
			event.preventDefault()
			this.skip()
		}
		window.addEventListener('keydown', this._onKeyDown)
		if (import.meta.env.DEV) window.__l2l3 = this
		if (level) {
			level.enterCinematic()
			const gate = level.portal.group
			gate.updateMatrixWorld(true)
			this._entryCenter = gate.localToWorld(
				new THREE.Vector3(0, 8.35, 0)
			)
			this._entryRotation = gate.getWorldQuaternion(
				new THREE.Quaternion()
			)
			this._entryNormal = new THREE.Vector3(
				0,
				0,
				1
			).applyQuaternion(this._entryRotation)
			this._landing =
				level.roverApproach?.shipSite?.clone() ||
				level.rover.group.position
					.clone()
					.add(new THREE.Vector3(22, 0, 18))
			this._landing.copy(
				level._findWalkableSite(this._landing)
			)
			this._landing.y =
				level.planet.heightAt(
					this._landing.x,
					this._landing.z
				) -
				this.ship.hullBottom +
				0.3
			// The alien vessel is already parked when the rover arrives. The
			// camera discovers it; no rescue ship flies into the scene.
			this.ship.group.position.copy(this._landing)
			// Nose faces the very same gate the player followed across the basin.
			this.ship.group.quaternion.copy(this._entryRotation)
			this._frameSurfaceLighting()
			this.wormhole.group.position.copy(this._entryCenter)
			this.wormhole.group.quaternion.copy(this._entryRotation)
			this.wormhole.group.scale.setScalar(
				7.6 / this.wormhole.radius
			)
			const roverPosition = level.rover.group.position.clone()
			const impact = roverPosition
				.clone()
				.add(new THREE.Vector3(-11, 0, -7))
			impact.y = level.planet.heightAt(impact.x, impact.z)
			this.strike = new CinematicMissileStrike({
				start: offset(impact, -90, 150, -65),
				impact,
				heightAt: (x, z) => level.planet.heightAt(x, z),
			})
			this.root.add(this.strike.group)
			this.strike.group.visible = false
			this._shipSettled = false
			this.ship.ready.then(() => {
				if (
					this._disposed ||
					this.finished ||
					this.phase !== 'rover_approach'
				)
					return
				this._shipSettled = true
				const y =
					level.planet.heightAt(
						this._landing.x,
						this._landing.z
					) -
					this.ship.hullBottom +
					0.3
				this._landing.y = y
				this.ship.group.position.copy(this._landing)
			})
		} else this.skip()
	}

	own(resource) {
		this._resources.add(resource)
		return resource
	}
	_frameSurfaceLighting() {
		const level = this.level
		const sun = level.objects.find(
			(node) => node.isDirectionalLight && node.castShadow
		)
		if (!sun) return
		const lightingOffset = sun.position
			.clone()
			.sub(sun.target.position)
		const focus = level.rover.group.position
			.clone()
			.add(this._landing)
			.add(this._entryCenter)
			.multiplyScalar(1 / 3)
		focus.y = level.planet.heightAt(focus.x, focus.z)
		sun.target.position.copy(focus)
		sun.position.copy(focus).add(lightingOffset)
		sun.shadow.camera.left = sun.shadow.camera.bottom = -110
		sun.shadow.camera.right = sun.shadow.camera.top = 110
		sun.shadow.normalBias = 0.2
		sun.shadow.camera.updateProjectionMatrix()
		sun.target.updateMatrixWorld(true)
	}
	mesh(geometry, material) {
		return new THREE.Mesh(this.own(geometry), this.own(material))
	}

	_buildOverlay() {
		this.overlay = document.createElement('div')
		Object.assign(this.overlay.style, {
			position: 'fixed',
			inset: '0',
			pointerEvents: 'none',
			zIndex: '85',
			fontFamily: 'monospace',
			color: '#d0e9ef',
		})
		const make = (style) => {
			const el = document.createElement('div')
			Object.assign(el.style, style)
			this.overlay.append(el)
			return el
		}
		const bar = {
			position: 'absolute',
			left: '0',
			right: '0',
			height: '10vh',
			background: '#000',
		}
		make({ ...bar, top: '0' })
		make({ ...bar, bottom: '0' })
		this.titleEl = make({
			position: 'absolute',
			left: '7%',
			top: '17%',
			letterSpacing: '.25em',
			fontSize: 'clamp(15px,2.4vw,32px)',
			opacity: '0',
			transition: 'opacity 1s',
		})
		this.titleEl.textContent = 'ESCAPE TO THE VOID'
		this.scannerEl = make({
			position: 'absolute',
			right: '6%',
			top: '18%',
			textAlign: 'right',
			letterSpacing: '.14em',
			fontSize: 'clamp(11px,1.1vw,15px)',
			lineHeight: '1.9',
			whiteSpace: 'pre-line',
			opacity: '0',
			transition: 'opacity .8s',
		})
		this.skipEl = make({
			position: 'absolute',
			right: '24px',
			bottom: '20px',
			opacity: '.6',
			fontSize: '11px',
			letterSpacing: '.13em',
		})
		this.skipEl.textContent = 'SPACE / ENTER / ESC | SKIP'
		this.hazeEl = make({
			position: 'absolute',
			inset: '10vh 0',
			background: '#a3b9cd',
			opacity: '0',
		})
		this.fadeEl = make({
			position: 'absolute',
			inset: '0',
			background: '#000',
			opacity: '0',
		})
		document.body.append(this.overlay)
	}

	_setPhase(phase) {
		if (this.finished || this._disposed || this.phase === phase)
			return
		this.phase = phase
		this.phaseTime = 0
		this.scannerEl.style.opacity = '0'
		if (phase === 'missile_detected') {
			// Predict the short remaining coast on the existing brake curve so
			// the strike stays beside a fast rover rather than its old position.
			const rover = this.level.rover
			const velocity = rover.body?.linvel?.() || {
				x: 0,
				z: 0,
			}
			const coast =
				(1 -
					Math.exp(
						-0.6 *
							this.durations
								.missile_detected
					)) /
				0.6
			const impact = rover.group.position
				.clone()
				.add(
					new THREE.Vector3(
						velocity.x * coast,
						0,
						velocity.z * coast - 12
					)
				)
			impact.y = this.level.planet.heightAt(
				impact.x,
				impact.z
			)
			this.strike.dispose()
			const planet = this.level.planet
			this.strike = new CinematicMissileStrike({
				start: offset(impact, -90, 150, -65),
				impact,
				heightAt: (x, z) => planet.heightAt(x, z),
				onImpact: (p) =>
					planet.addImpactCrater(p.x, p.z),
			})
			this.root.add(this.strike.group)
			this.strike.group.visible = true
			this.salvo?.dispose()
			this.salvo = new CinematicMissileSalvo({
				impact,
				heightAt: (x, z) => planet.heightAt(x, z),
				onImpact: (p) =>
					planet.addImpactCrater(p.x, p.z),
				duration: this.durations.missile_detected,
			})
			this.root.add(this.salvo.group)
			this.audio?.playMissileWarning?.()
			this.audio?.startMissileIncoming?.()
		}
		if (phase === 'missile_impact') {
			this.strike.setFlightProgress(1)
			if (this.strike.impact()) {
				this.audio?.stopMissileIncoming?.()
				this.audio?.playMissileImpact?.()
				this.level.disableRoverForCinematic()
				this._roverRoll =
					this.level.rover.group.quaternion.clone()
			}
		}
		if (phase === 'astronaut_exit') this._makeRamp()
		if (phase === 'run_to_spacefighter') this._walkSpeed = 0
		if (phase === 'board_spacefighter') {
			this._climbTime = 0
			this._climbStart =
				this.level.playerRoot.position.clone()
			this._climbStart.y -=
				this.level.pilotWalk?.footOffset ?? 0
			this.audio?.playHatch?.()
		}
		if (phase === 'engine_start') {
			this._commandeered = true
			this.level.playerRoot.visible = false
			this.ramp.visible = false
			this.audio?.startThrusterHum?.()
			this.audio?.playHatch?.()
		}
		if (phase === 'takeoff') this._buildFlight()
		if (phase === 'level3_loading') this._loadLevel3()
		if (phase === 'wormhole_exit') {
			this.ship.group.visible = false
			this.audio?.playWormholeExit?.()
			this._conversation('l3.opening')
			this.titleEl.textContent = 'VOID OF GODS'
		}
		if (phase === 'disembark') this.audio?.playHatch?.()
		if (phase === 'handoff') this.level3.keys.clear()
	}

	update(delta) {
		if (this.finished || this._disposed) return
		const dt = Number.isFinite(delta)
			? Math.max(0, Math.min(delta, 0.05))
			: 0
		this.elapsed += dt
		this.phaseTime += dt
		this.level?.update(dt)
		if (this._roverRoll && this.level) {
			this._rollAge = (this._rollAge || 0) + dt
			const roll = ease(this._rollAge / 1.15) * Math.PI * 0.52
			this.level.rover.group.quaternion
				.copy(this._roverRoll)
				.multiply(
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 0, 1),
						roll
					)
				)
		}
		this._updatePursuit(dt)
		if (this.level3) {
			// Ambient visuals only: gameplay remains held throughout the arrival.
			this.level3.planet.update(dt)
			this.level3.matterDimension?.update(dt, true)
			this.level3.stormLandscape?.update(dt)
			this.level3.voidAudio?.update(this.sceneManager.camera)
		}
		this._updateConversation(dt)
		this.strike?.update(dt)
		this.salvo?.update(dt)
		this.wormhole.update(dt)
		const thrust =
			this.phase === 'engine_start'
				? ease(
						this.phaseTime /
							this.durations
								.engine_start
					) * 0.45
				: [
							'takeoff',
							'wormhole_entry',
							'wormhole_exit',
					  ].includes(this.phase)
					? 0.8
					: this.phase === 'arrival'
						? 0.4
						: 0
		this.ship.update(dt, { thrust })
		this.audio?.setThrusterLevel?.(thrust)
		this.environment.update(dt)
		const handlers = {
			rover_approach: this._roverApproach,
			missile_detected: this._missileDetected,
			missile_impact: this._missileImpact,
			rover_disabled: this._roverDisabled,
			astronaut_exit: this._astronautExit,
			run_to_spacefighter: this._runToSpacefighter,
			board_spacefighter: this._boarding,
			engine_start: this._engineStart,
			takeoff: this._takeoff,
			wormhole_entry: this._updateWormhole,
			level3_loading: this._loading,
			wormhole_exit: this._wormholeExit,
			arrival: this._arrival,
			disembark: this._disembark,
			handoff: this._handoff,
		}
		handlers[this.phase]?.call(this, dt)
	}

	_roverApproach(dt) {
		const p = this.level.rover.group.position
		this.titleEl.style.opacity = String(ease(this.phaseTime))
		this._camera(
			offset(p, 24, 14, 32),
			p.clone().lerp(this._landing, 0.28),
			dt,
			{
				terrain: this.level.planet,
				response: 1.2,
				fov: 62,
			}
		)
		if (
			this.phaseTime >= this.durations.rover_approach &&
			(this._shipSettled ||
				this.phaseTime >=
					this.durations.rover_approach + 5)
		) {
			this.ship.lockAppearance()
			// Refit once while hidden; a slow download must never move a visible hull.
			this._landing.y =
				this.level.planet.heightAt(
					this._landing.x,
					this._landing.z
				) -
				this.ship.hullBottom +
				0.3
			this.ship.group.position.copy(this._landing)
			this.ship.group.visible = true
			this._buildFighterHub()
			this._setPhase('missile_detected')
		}
	}
	_missileDetected(dt) {
		const t = clamp(
			this.phaseTime / this.durations.missile_detected
		)
		this.strike.setFlightProgress(t * t)
		this.audio?.setMissileIncomingLevel?.(0.15 + t * 0.85)
		const missile = this.strike.missilePosition
		this._camera(offset(missile, 11, 4, 19), missile, dt, {
			terrain: this.level.planet,
			response: 2.2,
			lookResponse: 14,
			fov: 48 + t * 10,
		})
		this._message('INCOMING // MISSILE SALVO\nEVASIVE ACTION', t)
		this.titleEl.style.opacity = String(1 - ease(t * 3))
		if (t >= 1) this._setPhase('missile_impact')
	}
	_missileImpact(dt) {
		const t = clamp(this.phaseTime / this.durations.missile_impact)
		const rover = this.level.rover.group.position
		const composition = rover
			.clone()
			.lerp(this.strike.impactPosition, 0.5)
		this._camera(
			offset(composition, 20, 12, 26),
			offset(composition, 0, 1.5, 0),
			dt,
			{
				terrain: this.level.planet,
				response: 6,
				lookResponse: 12,
				fov: 60,
				shake: 0.32 * (1 - t) ** 2,
			}
		)
		if (t >= 1) this._setPhase('rover_disabled')
	}
	_roverDisabled(dt) {
		const p = this.level.rover.group.position
		this._camera(offset(p, 13, 5, 17), offset(p, 0, 2, 0), dt, {
			terrain: this.level.planet,
			response: 2,
			fov: 55,
		})
		this._message(
			'ROVER DRIVE OFFLINE\nUNREGISTERED CRAFT // ESCAPE VECTOR',
			clamp(this.phaseTime / this.durations.rover_disabled)
		)
		if (this.phaseTime >= this.durations.rover_disabled)
			this._setPhase('astronaut_exit')
	}
	_astronautExit(dt) {
		const level = this.level
		const rover = level.rover.group.position
		// The static rover has no opening door or authored exit clip. Look
		// across its roof toward the ship while the body conceals the handoff.
		const side = new THREE.Vector3(14, 5.5, -10).applyQuaternion(
			level.rover.group.quaternion
		)
		this._camera(
			rover.clone().add(side),
			rover.clone().lerp(this._landing, 0.4),
			dt,
			{
				terrain: level.planet,
				response: 3.5,
				fov: 54,
			}
		)
		if (
			!this._dismounted &&
			this.phaseTime >= this.durations.astronaut_exit * 0.5
		) {
			level.dismountForCinematic()
			this._dismounted = true
		}
		if (this.phaseTime >= this.durations.astronaut_exit)
			this._setPhase('run_to_spacefighter')
	}
	_runToSpacefighter(dt) {
		const level = this.level
		const arrived = this._walkPilot(level, this._rampFoot, dt, 7)
		const p = level.playerRoot.position
		const forward = this._rampFoot
			.clone()
			.sub(p)
			.setY(0)
			.normalize()
		const side = new THREE.Vector3(forward.z, 0, -forward.x)
		const cameraPosition = p
			.clone()
			.addScaledVector(forward, -9)
			.addScaledVector(side, 7)
		cameraPosition.y += 3.8
		this._camera(
			cameraPosition,
			offset(p, forward.x * 4, 1.5, forward.z * 4),
			dt,
			{
				terrain: level.planet,
				response: 3,
				fov: 57,
			}
		)
		this._message(
			'ALIEN FIGHTER HUB // STEAL A SHIP',
			clamp(this.phaseTime / 5)
		)
		if (arrived) this._setPhase('board_spacefighter')
		else if (this.phaseTime >= this.durations.run_to_spacefighter)
			this.skip()
	}
	_engineStart(dt) {
		const t = ease(this.phaseTime / this.durations.engine_start)
		const p = this.ship.group.position
		const angle = -0.5 + t * 0.8
		const orbit = new THREE.Vector3(
			Math.cos(angle) * 22,
			3.5 + t * 3,
			Math.sin(angle) * 22
		)
		orbit.applyQuaternion(this.ship.group.quaternion).add(p)
		this._camera(orbit, offset(p, 0, 1, 0), dt, {
			terrain: this.level.planet,
			response: 2.2,
			fov: 51,
		})
		if (t >= 1) this._setPhase('takeoff')
	}
	_makeRamp() {
		if (!this.ramp) {
			this.ramp = this.mesh(
				new THREE.BoxGeometry(4, 0.12, 1.6),
				new THREE.MeshStandardMaterial({
					color: 0x536370,
					metalness: 0.7,
					roughness: 0.65,
				})
			)
			this.root.add(this.ramp)
		}
		const ground = this.level?.planet || this.level3.planet
		const hatch = this.ship.hatchLocal.clone()
		hatch.x += 0.4 // leave a full pilot-radius clearance from the static hull
		hatch.applyQuaternion(this.ship.group.quaternion).add(
			this.ship.group.position
		)
		this._hatch = hatch
		this._rampRight = new THREE.Vector3(1, 0, 0)
			.applyQuaternion(this.ship.group.quaternion)
			.setY(0)
			.normalize()
		this._rampFoot = hatch
			.clone()
			.addScaledVector(this._rampRight, 3.4)
		this._rampFoot.y = ground.heightAt(
			this._rampFoot.x,
			this._rampFoot.z
		)
		hatch.y = Math.max(hatch.y, this._rampFoot.y + 0.75)
		this.ramp.position.copy(hatch).lerp(this._rampFoot, 0.5)
		const rampX = this._rampFoot.clone().sub(hatch).normalize()
		const rampZ = new THREE.Vector3()
			.crossVectors(rampX, UP)
			.normalize()
		const rampY = new THREE.Vector3()
			.crossVectors(rampZ, rampX)
			.normalize()
		this.ramp.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(rampX, rampY, rampZ)
		)
		this.ramp.visible = true
	}
	_boarding(dt) {
		const level = this.level
		let boarded = false
		if (this._climbTime != null) {
			this._climbTime += dt
			const t = ease(this._climbTime / 1.6)
			const from = level.playerRoot.position.clone()
			const facing = this._hatch.clone().sub(this._rampFoot)
			level.playerRoot.rotation.y +=
				angleDelta(
					Math.atan2(facing.x, facing.z),
					level.playerRoot.rotation.y
				) *
				(1 - Math.exp(-8 * dt))
			level.playerRoot.position
				.copy(this._climbStart)
				.lerp(this._hatch, t)
			level.playerRoot.position.y +=
				level.pilotWalk?.footOffset ?? 0
			this._gait(
				level,
				from.distanceTo(level.playerRoot.position),
				dt
			)
			boarded = t >= 1
		} else if (this._walkPilot(level, this._rampFoot, dt)) {
			this._climbTime = 0
			this.audio?.playHatch?.()
		}
		const p = level.playerRoot.position
		const composition = p
			.clone()
			.lerp(this.ship.group.position, 0.5)
		// View the far side of the static cockpit. The hull masks the last
		// step and the visibility transfer; there is no invented hatch clip.
		const boardingCamera = new THREE.Vector3(-19, 4.5, -8)
			.applyQuaternion(this.ship.group.quaternion)
			.add(this.ship.group.position)
		this._camera(
			boardingCamera,
			offset(composition, 0, 1.6, 0),
			dt,
			{ terrain: level.planet, fov: 56 }
		)
		this._message(
			'STOLEN FIGHTER // BYPASSING SECURITY',
			clamp(
				this.phaseTime /
					this.durations.board_spacefighter
			)
		)
		if (boarded) this._setPhase('engine_start')
		else if (this.phaseTime >= this.durations.board_spacefighter) {
			// Never teleport a blocked astronaut into a hull. Show a clear
			// failure to board, then recover through the same safe skip path.
			console.warn(
				'[Cutscene] Boarding route blocked; recovering to Level 3.'
			)
			this.skip()
		}
	}

	_buildFighterHub() {
		if (this._hubBuilt) return
		this._hubBuilt = true
		const hub = this.level.fighterHub
		this._hub = hub?.group
		this._fleet = hub?.fleet || []
		if (hub) hub.hero.group.visible = false
	}

	_updatePursuit(dt) {
		if (!this.level || !this._fleet?.length) return
		const flying = ['takeoff', 'wormhole_entry'].includes(
			this.phase
		)
		if (!flying) return
		const p = this.ship.group.position
		for (let i = 0; i < 3; i++) {
			const fighter = this._fleet[i]
			const target = new THREE.Vector3(
				(i - 1) * 20 +
					Math.sin(this.elapsed * 2 + i) * 8,
				5 + i * 4,
				38 + i * 15
			)
				.applyQuaternion(this.ship.group.quaternion)
				.add(p)
			target.y = Math.max(
				target.y,
				this.level.planet.heightAt(target.x, target.z) +
					15
			)
			fighter.position.lerp(target, 1 - Math.exp(-dt * 2.5))
			fighter.quaternion.slerp(
				this.ship.group.quaternion,
				1 - Math.exp(-dt * 4)
			)
		}
		this._chaseMissiles ||= []
		this._chaseClock = (this._chaseClock || 0) + dt
		if (this._chaseClock >= 0.7) {
			this._chaseClock = 0
			const index = (this._chaseIndex =
				(this._chaseIndex || 0) + 1)
			const target = p
				.clone()
				.addScaledVector(
					this._flightCurve.getTangentAt(
						Math.min(
							1,
							Math.pow(
								this
									.flightTime /
									this
										._flightDuration,
								2
							)
						)
					),
					32
				)
			target.x += index % 2 ? 9 : -9
			const strike = new CinematicMissileStrike({
				start: this._fleet[index % 3].position.clone(),
				impact: target,
				heightAt: (x, z) =>
					this.level?.planet.heightAt(x, z) ??
					target.y,
			})
			this.root.add(strike.group)
			this._chaseMissiles.push({ strike, age: 0 })
		}
		for (const missile of this._chaseMissiles) {
			missile.age += dt
			missile.strike.setFlightProgress(
				Math.min(1, missile.age / 0.85)
			)
			if (missile.age >= 0.85) missile.strike.impact()
			missile.strike.update(dt)
		}
		this._chaseMissiles = this._chaseMissiles.filter(
			({ strike, age }) => {
				if (age < 3) return true
				strike.dispose()
				return false
			}
		)
	}

	_buildFlight() {
		const p = this.ship.group.position.clone()
		const center = this._entryCenter
		const normal = this._entryNormal
		const beforeGate = center.clone().addScaledVector(normal, 32)
		// A single distance-parameterized curve spans takeoff and entry. The
		// flight clock never resets at the camera/phase boundary.
		const lift = offset(p, 0, 13, 0).addScaledVector(normal, -2)
		const climb = center.clone().addScaledVector(normal, 54)
		climb.y = Math.max(climb.y + 13, lift.y)
		this._flightCurve = new THREE.CatmullRomCurve3(
			[
				p,
				lift,
				climb,
				beforeGate,
				center.clone().addScaledVector(normal, 6),
				center.clone().addScaledVector(normal, -28),
			],
			false,
			'centripetal'
		)
		this._flightDuration =
			this.durations.takeoff + this.durations.wormhole_entry
		this.flightTime = 0
		this.wormhole.group.visible = true
		// Keep the existing surface gate's torus and beacon. Only the depth
		// aperture is added inside it so the real hull vanishes at the plane.
		this.wormhole.rimMaterial.visible = false
		this.wormhole.haloMaterial.visible = false
	}
	_advanceDeparture(dt) {
		this.flightTime = Math.min(
			this._flightDuration,
			this.flightTime + dt
		)
		const clock = clamp(this.flightTime / this._flightDuration)
		const progress = clock * clock
		const position = this._flightCurve.getPointAt(progress)
		const direction = this._flightCurve.getTangentAt(
			Math.min(progress, 0.99999)
		)
		// Lift vertically with a level hull before pitching into forward
		// flight. Following the initial near-vertical tangent would bury
		// the long tail in the launch pad while the pivot has barely risen.
		const clearance =
			position.y +
			this.ship.hullBottom -
			this.level.planet.heightAt(position.x, position.z)
		const pitchBlend = ease((clearance - 8) / 10)
		const horizontal = direction.clone().setY(0).normalize()
		direction
			.lerpVectors(horizontal, direction.clone(), pitchBlend)
			.normalize()
		this._moveShip(
			position,
			direction,
			dt,
			Math.sin(progress * Math.PI * 2) * 0.1 * pitchBlend
		)
		this.wormhole.setIntensity(0.25 + progress * 0.75)
		return clock
	}
	_takeoff(dt) {
		this._advanceDeparture(dt)
		const p = this.ship.group.position
		const chase = new THREE.Vector3(14, 7, 25)
			.applyQuaternion(this.ship.group.quaternion)
			.add(p)
		this._camera(chase, p, dt, {
			terrain: this.level.planet,
			response: 2.2,
			lookResponse: 8,
			fov: 58,
		})
		this._message(
			'HOSTILE FIGHTERS // MISSILE LOCK\nFULL THRUST ? REACH THE PORTAL',
			clamp(this.phaseTime / this.durations.takeoff)
		)
		if (this.phaseTime >= this.durations.takeoff)
			this._setPhase('wormhole_entry')
	}
	_updateWormhole(dt) {
		const clock = this._advanceDeparture(dt)
		const position = this.ship.group.position
		const normal = this._entryNormal
		const center = this._entryCenter
		const distance = position.clone().sub(center).dot(normal)
		const side = new THREE.Vector3(1, 0, 0).applyQuaternion(
			this._entryRotation
		)
		const cameraPosition = center
			.clone()
			.addScaledVector(normal, 47)
			.addScaledVector(side, 26)
		cameraPosition.y += 15
		this._camera(
			cameraPosition,
			center.clone().lerp(position, 0.25),
			dt,
			{
				terrain: this.level.planet,
				response: 2.1,
				fov: 59,
			}
		)
		this._message(
			'WORMHOLE LOCK ACQUIRED\nTRANSIT VECTOR CONFIRMED',
			clamp(this.phaseTime / this.durations.wormhole_entry)
		)
		if (!this._wormholeFired && distance < 20) {
			this._wormholeFired = true
			this.audio?.playEscape?.()
			this.audio?.playRadioNoise?.(0.6, 0.2)
		}
		// Project the measured hull onto the portal normal, including its
		// bounded rotation: completion is a geometric crossing, not a timer.
		this.ship.group.updateMatrixWorld(true)
		const bounds = this.ship.hullBounds
		let nearSide = -Infinity
		let farSide = Infinity
		for (const x of [bounds.min.x, bounds.max.x])
			for (const y of [bounds.min.y, bounds.max.y])
				for (const z of [bounds.min.z, bounds.max.z]) {
					const corner = new THREE.Vector3(
						x,
						y,
						z
					).applyMatrix4(
						this.ship.group.matrixWorld
					)
					farSide = Math.min(
						farSide,
						corner
							.clone()
							.sub(center)
							.dot(normal)
					)
					nearSide = Math.max(
						nearSide,
						corner.sub(center).dot(normal)
					)
				}
		this.ship.setTransitOpacity(
			clamp(nearSide / Math.max(1, nearSide - farSide))
		)
		if (nearSide < -0.5) {
			this._wormholeCrossed = true
			this.ship.group.visible = false
		}
		if (clock >= 1 && this._wormholeCrossed)
			this._setPhase('level3_loading')
	}
	_moveShip(position, direction, dt, bank = 0) {
		this.ship.group.position.copy(position)
		this._matrix.lookAt(
			position,
			position.clone().add(direction),
			UP
		)
		this._rotation.setFromRotationMatrix(this._matrix)
		this._rotation.multiply(
			new THREE.Quaternion().setFromAxisAngle(
				new THREE.Vector3(0, 0, 1),
				bank
			)
		)
		this.ship.group.quaternion.rotateTowards(
			this._rotation,
			dt * 1.2
		)
	}
	_loadLevel3() {
		if (this.level3 || this._loadFailed) return
		const camera = this.sceneManager.camera
		const cameraFov = camera.fov
		this.wormhole.group.visible = !this._skipped
		if (this._hub) this._hub.visible = false
		for (const missile of this._chaseMissiles || [])
			missile.strike.dispose()
		this._chaseMissiles = []
		for (const fighter of this._fleet || []) fighter.visible = false
		this.root.removeFromParent()
		this.level?.dispose()
		this.level = null
		clearScene(this.sceneManager.scene)
		try {
			this.level3 = new Level3(this.game, {
				onPauseChange: this.onPauseChange,
				onPrepared: (level) => {
					this.level3 = level
				},
				onEnd: (result) =>
					this.game._onLevelEnd(result),
			})
		} catch (error) {
			console.error(
				'[Cutscene] Level 3 failed to start:',
				error
			)
			this._loadFailed = true
			this.level3?.dispose()
			this.level3 = null
			this._finish(null)
			return
		}
		const level = this.level3
		level.transitionHeld = true
		level.keys.clear()
		level.objectiveEl.style.display = 'none'
		level.levelHudEl.style.display = 'none'
		level.feedbackEl.style.display = 'none'
		level.playerRoot.visible = this._skipped
		this._spawn = level.playerRoot.position.clone()
		this._spawnRotation = level.playerRoot.quaternion.clone()
		this._arrivalTarget = offset(this._spawn, -14, 0, 0)
		this._arrivalTarget.y =
			level.planet.heightAt(
				this._arrivalTarget.x,
				this._arrivalTarget.z
			) -
			this.ship.hullBottom +
			0.3
		this._exitCenter = offset(this._arrivalTarget, 0, 155, 410)
		const arrivalStart = offset(this._exitCenter, 0, 0, 28)
		const shift = new THREE.Vector3().subVectors(
			arrivalStart,
			this.ship.group.position
		)
		this._originShift.add(shift)
		// The departing hull is fully occluded before this matched gate shot.
		// Frame the destination side of the exit while assets prepare, then
		// let the same craft emerge through its depth-writing plane.
		this.ship.group.position.copy(arrivalStart)
		this.ship.group.quaternion.identity()
		this.ship.group.visible = false
		this.wormhole.group.position.copy(this._exitCenter)
		this.wormhole.group.quaternion.identity()
		this.wormhole.group.scale.setScalar(0.55)
		this.wormhole.rimMaterial.visible = true
		this.wormhole.haloMaterial.visible = true
		this.environment.group.position.copy(
			offset(this._spawn, 0, 300, -460)
		)
		this.environment.group.visible = true
		this.ramp && (this.ramp.visible = false)
		this._camPos.copy(offset(this._exitCenter, -48, 12, -90))
		this._camLook.copy(this._exitCenter)
		this._exitEnd = offset(this._exitCenter, 0, -8, -65)
		this._exitCurve = new THREE.CubicBezierCurve3(
			arrivalStart,
			offset(this._exitCenter, 0, 0, 12),
			offset(this._exitCenter, 0, -5, -38),
			this._exitEnd.clone()
		)
		this._arrivalCurve = new THREE.CubicBezierCurve3(
			this._exitEnd.clone(),
			// Match the exit curve's final velocity at the beginning of descent.
			offset(this._exitEnd, 0, -6, -54),
			offset(this._arrivalTarget, 0, 45, 15),
			this._arrivalTarget.clone()
		)
		if (this._skipped) {
			this.ship.group.visible = false
			this._camPos.copy(camera.position)
			this._camLook.copy(level._lookAt)
		} else {
			camera.position.copy(this._camPos)
			camera.lookAt(this._camLook)
		}
		this.sceneManager.scene.add(this.root)
		this.game.gameState.status = STATUS.CUTSCENE
		camera.fov = this._skipped ? 68 : cameraFov
		camera.far = Math.max(6000, camera.far)
		camera.updateProjectionMatrix()
		this._loadReady = false
		Promise.allSettled([
			level.pilotReady,
			level.rover.ready,
			this.environment.ready,
		]).then(() => {
			if (!this._disposed && !this.finished)
				this._loadReady = true
		})
	}
	_loading(dt) {
		if (this._loadFailed || !this.level3) return
		if (!this._skipped)
			this._camera(this._camPos, this._camLook, dt, {
				response: 1,
				fov: 52,
			})
		if (
			(this._loadReady && this.phaseTime >= 0.2) ||
			this.phaseTime >= this.durations.level3_loading
		) {
			if (this._skipped) {
				this.fadeEl.style.opacity = '0'
				this.fadeEl.style.transition =
					'opacity .5s ease'
				this._conversation('l3.opening')
				this._setPhase('handoff')
			} else this._setPhase('wormhole_exit')
		}
	}
	_wormholeExit(dt) {
		this.level3.matterDimension?.beginArrival(this._exitCenter)
		const t = clamp(this.phaseTime / this.durations.wormhole_exit)
		const p = this._exitCurve.getPoint(t)
		this._moveShip(p, this._exitCurve.getTangent(t), dt)
		this.wormhole.setIntensity(1 - t * 0.45)
		this._camera(
			offset(
				this._exitCenter,
				-48 - t * 12,
				12,
				-90 - t * 24
			),
			this._exitCenter.clone().lerp(p, 0.6),
			dt,
			{
				terrain: this.level3.planet,
				response: 2,
				fov: 60,
			}
		)
		this.titleEl.style.opacity = String(Math.sin(t * Math.PI))
		if (t >= 1) {
			this._wormholeExited = true
			this._setPhase('arrival')
		}
	}
	_arrival(dt) {
		const t = clamp(this.phaseTime / this.durations.arrival)
		this.ship.group.visible = false
		this.level3.playerRoot.visible = true
		this.level3.playerRoot.position.copy(this._spawn)
		this._camera(offset(this._spawn, 22, 12, 34), this._spawn, dt, {
			fov: 58,
		})
		this.hazeEl.style.opacity = String((1 - ease(t)) * 0.5)
		this.titleEl.style.opacity = String(Math.sin(t * Math.PI))
		this.environment.setArrival(t)
		this.wormhole.group.visible = t < 0.5
		if (t >= 1) this._setPhase('handoff')
	}

	_disembark(dt) {
		const level = this.level3
		level.playerRoot.visible = true
		if (this.phaseTime <= 1.6) {
			const before = level.playerRoot.position.clone()
			level.playerRoot.position
				.copy(this._hatch)
				.lerp(
					this._rampFoot,
					ease(this.phaseTime / 1.6)
				)
			level.playerRoot.position.y +=
				level.pilotWalk?.footOffset ?? 0
			level.playerRoot.rotation.set(
				0,
				Math.atan2(
					this._rampRight.x,
					this._rampRight.z
				),
				0
			)
			this._gait(
				level,
				before.distanceTo(level.playerRoot.position),
				dt
			)
		} else {
			if (this._walkPilot(level, this._spawn, dt))
				this._setPhase('handoff')
		}
		this._camera(
			offset(this._spawn, 12, 6, 22),
			offset(level.playerRoot.position, 0, 1.8, 0),
			dt,
			{ terrain: level.planet, fov: 62 }
		)
		if (
			this.phase === 'disembark' &&
			this.phaseTime >= this.durations.disembark
		)
			this._setPhase('handoff')
	}
	_handoff(dt) {
		const level = this.level3
		const t = ease(
			this.phaseTime /
				(this._skipped ? 0.6 : this.durations.handoff)
		)
		if (this.ramp) this.ramp.visible = false
		const target = offset(level.playerRoot.position, 10, 8, 18)
		const look = offset(level.playerRoot.position, 0, 1.8, 0)
		this._camera(target, look, dt, {
			terrain: level.planet,
			response: 5,
			fov: 68,
		})
		level._lookAt.copy(this._camLook)
		this.overlay.style.opacity = String(1 - t)
		if (t >= 1) this._finish(level)
	}

	_walkPilot(level, target, dt, maxSpeed = 3.2) {
		const position = level.playerRoot.position
		const dx = target.x - position.x,
			dz = target.z - position.z
		const distance = Math.hypot(dx, dz)
		if (distance < 0.12) {
			this._gait(level, 0, dt)
			return true
		}
		const direction = new THREE.Vector3(
			dx / distance,
			0,
			dz / distance
		)
		// Preview legal nearby steps, using gameplay terrain/prop collision rules.
		let best = -Infinity,
			bestDirection = direction.clone()
		for (const angle of [0, 0.5, -0.5, 1, -1, 1.4, -1.4]) {
			const candidateDirection = direction
				.clone()
				.applyAxisAngle(UP, angle)
			const candidate = position
				.clone()
				.addScaledVector(candidateDirection, 0.7)
			const result = level._validateMovementCandidate(
				position,
				candidate
			)
			const score = candidate
				.clone()
				.sub(position)
				.dot(direction)
			if (result.ok && !result.hitBoundary && score > best) {
				best = score
				bestDirection = candidateDirection
			}
		}
		const yaw = Math.atan2(bestDirection.x, bestDirection.z)
		const error = angleDelta(yaw, level.playerRoot.rotation.y)
		level.playerRoot.rotation.y += error * (1 - Math.exp(-8 * dt))
		this._walkSpeed = THREE.MathUtils.damp(
			this._walkSpeed || 0,
			Math.min(maxSpeed, distance * 3) *
				Math.max(0, Math.cos(error)),
			4.5,
			dt
		)
		const before = position.clone()
		level._movePlayerDirection(
			bestDirection,
			Math.min(distance, this._walkSpeed * dt)
		)
		level._syncPlayerToTerrain()
		this._gait(level, position.distanceTo(before), dt)
		return false
	}
	_gait(level, distance, dt) {
		const previous = level.pilotWalk?.phase || 0
		level.pilotWalk?.update(dt, distance, false)
		if (
			distance > 0.0001 &&
			Math.floor((level.pilotWalk?.phase || 0) / Math.PI) >
				Math.floor(previous / Math.PI)
		) {
			this.audio?.playFootstep?.()
			const foot = level.playerRoot.position.clone()
			foot.y -= level.pilotWalk?.footOffset || 0
			level.dust.spawnFoot(foot, { ratio: 0.4 })
		}
	}
	_camera(
		position,
		look,
		dt,
		{
			response = 2,
			lookResponse = response,
			fov = 58,
			terrain = null,
			shake = 0,
		} = {}
	) {
		this._camPos.lerp(position, 1 - Math.exp(-response * dt))
		this._camLook.lerp(look, 1 - Math.exp(-lookResponse * dt))
		if (terrain)
			constrainTerrainCamera(
				this._camPos,
				this._camLook,
				terrain
			)
		const camera = this.sceneManager.camera
		camera.position.copy(this._camPos)
		if (shake) {
			camera.position.x += Math.sin(this.elapsed * 19) * shake
			camera.position.y +=
				Math.sin(this.elapsed * 27) * shake * 0.65
		}
		camera.lookAt(this._camLook)
		camera.fov = THREE.MathUtils.damp(camera.fov, fov, 2, dt)
		camera.far = Math.max(camera.far, 6000)
		camera.updateProjectionMatrix()
	}
	_message(text, progress) {
		this.scannerEl.textContent = text
		this.scannerEl.style.opacity = String(
			ease(progress * 6) * (1 - ease((progress - 0.8) * 5))
		)
	}
	_conversation(id) {
		if (!this.radio?.play(id, { interrupt: true }))
			this._fallback = {
				script: RADIO_SCRIPTS[id],
				time: 0,
				key: null,
			}
		else this._pendingConversation = { id, wait: 0, heard: false }
	}
	_updateConversation(dt) {
		const pending = this._pendingConversation
		if (pending) {
			pending.wait += dt
			if ((this.radio?.playbackTime || 0) > 0.05)
				pending.heard = true
			if (!this.radio?.isPlaying()) {
				if (!pending.heard)
					this._fallback = {
						script: RADIO_SCRIPTS[
							pending.id
						],
						time: 0,
						key: null,
					}
				this._pendingConversation = null
			} else if (pending.wait > 24) {
				this.radio.stop()
				this._pendingConversation = null
			}
		}
		const fallback = this._fallback
		if (!fallback?.script) return
		fallback.time += dt
		const cue = cueAt(fallback.script, fallback.time)
		if (cue && fallback.key !== cue.start) {
			fallback.key = cue.start
			this.radio?.subtitles?.show(
				SPEAKERS[cue.speaker] || SPEAKERS.pilot,
				cue.text,
				{ urgency: fallback.script.urgency }
			)
		}
		if (fallback.time >= fallback.script.duration) {
			this.radio?.subtitles?.hide()
			this._fallback = null
		}
	}

	skip() {
		if (this.finished || this._disposed || this._skipped) return
		this._skipped = true
		this.audio?.stopCinematicEffects?.()
		this.radio?.stop()
		this._pendingConversation = this._fallback = null
		this.fadeEl.style.opacity = '1'
		this.hazeEl.style.opacity = '0'
		if (this.level3) {
			this.ship.group.visible = false
			this.level3.playerRoot.visible = true
			// Skip during a ramp descent returns to the established safe spawn.
			this.level3.playerRoot.position.copy(this._spawn)
			this.level3._syncPlayerToTerrain()
			this.fadeEl.style.transition = 'opacity .5s ease'
			this.fadeEl.style.opacity = '0'
			this._setPhase('handoff')
		} else this._setPhase('level3_loading')
	}
	_finish(level) {
		if (this.finished) return
		this.finished = true
		this.phase = 'complete'
		if (this._fallback) {
			this.radio?.subtitles?.hide()
			this._fallback = null
		}
		this.radio?.setCinematic(false)
		this.audio?.stopThrusterHum?.()
		this.audio?.stopCinematicDrone?.()
		this.audio?.stopCinematicEffects?.()
		if (level) {
			level._syncPlayerToTerrain()
			level.transitionHeld = false
			level.keys.clear()
			level.playerRoot.visible = true
			level.objectiveEl.style.display = ''
			level.levelHudEl.style.display = ''
			level.feedbackEl.style.display = ''
			level._radioIntroIn = 0 // the actual l3.opening already played on arrival
			level._lookAt.copy(this._camLook)
			this.environment.group.removeFromParent()
			this.ship.group.removeFromParent()
			this.ship.lockAppearance()
			this._arrivalTarget.y =
				level.planet.heightAt(
					this._arrivalTarget.x,
					this._arrivalTarget.z
				) -
				this.ship.hullBottom +
				0.3
			this.ship.group.position.copy(this._arrivalTarget)
			this.ship.group.quaternion.identity()
			this.ship.group.visible = false
			level.adoptArrivalBackdrop(this.environment)
			this._backdropTransferred = true
		}
		this._teardown()
		this.onComplete(level)
	}
	_teardown() {
		window.removeEventListener('keydown', this._onKeyDown)
		this.overlay?.remove()
		if (!this._shipTransferred) this.ship.dispose()
		this.strike?.dispose()
		for (const missile of this._chaseMissiles || [])
			missile.strike.dispose()
		this.salvo?.dispose()
		this.wormhole.dispose()
		if (!this._backdropTransferred) this.environment.dispose()
		this.root.removeFromParent()
		for (const resource of this._resources) resource.dispose()
		this._resources.clear()
		const camera = this.sceneManager.camera
		camera.near = this._cameraBase.near
		camera.far = Math.max(this._cameraBase.far, 3000)
		camera.fov =
			this.finished && this.level3 ? 68 : this._cameraBase.fov
		camera.updateProjectionMatrix()
		if (import.meta.env.DEV && window.__l2l3 === this)
			delete window.__l2l3
	}
	dispose() {
		if (this._disposed) return
		this._disposed = true
		if (!this.finished) {
			this.audio?.stopThrusterHum?.()
			this.audio?.stopCinematicDrone?.()
			this.audio?.stopCinematicEffects?.()
			this.radio?.stop()
			this.level?.dispose()
			this.level = null
			this.level3?.dispose()
			this.level3 = null
			this._teardown()
			clearScene(this.sceneManager.scene)
		}
	}
}
