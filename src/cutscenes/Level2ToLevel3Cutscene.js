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

// Seconds. Movement phases share one continuous curve and clock; shot changes
// never reset either actor. Event phases have bounded waits for failed assets.
export const CUTSCENE_DURATIONS = Object.freeze({
	victory: 3,
	discovery: 6,
	boarding: 22,
	ascent: 10,
	signal: 6,
	reveal: 8,
	interference: 6,
	presence: 5,
	approach: 6,
	wormhole: 6,
	level3_loading: 5,
	arrival: 8,
	disembark: 6,
	handoff: 4,
})
const FLIGHT_PHASES = [
	'ascent',
	'signal',
	'reveal',
	'interference',
	'presence',
	'approach',
]
const UP = new THREE.Vector3(0, 1, 0)
const clamp = (v) => THREE.MathUtils.clamp(v, 0, 1)
const ease = (v) => {
	const t = clamp(v)
	return t * t * (3 - 2 * t)
}
const offset = (p, x, y, z) => new THREE.Vector3(p.x + x, p.y + y, p.z + z)
const angleDelta = (to, from) =>
	Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** THE CALL OF THE VOID. Owns the existing Level 2 until ascent, then hands
 * an actual Level3 instance back to Game. It never substitutes a playable
 * space level for the existing on-foot level. The astronaut commandeers a
 * parked alien anomaly ship; the original ship selection remains unchanged.
 */
export class Level2ToLevel3Cutscene {
	constructor(
		game,
		{ level = null, result = null, onComplete, durations = {} } = {}
	) {
		this.game = game
		this.sceneManager = game.sceneManager
		this.audio = game.audio
		this.radio = game.radio
		this.level = level
		this.result = result
		this.level3 = null
		this.onComplete = onComplete || (() => {})
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
		this.phase = 'victory'
		this.phaseTime = this.elapsed = this.flightTime = 0
		this.finished =
			this._disposed =
			this._skipped =
			this._levelDisposed =
				false
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
		this.space = new THREE.Group()
		this.space.visible = false
		this.root.add(this.space)
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
		this._desiredPosition = new THREE.Vector3()
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
			const gate = level.portal.group.position
			const heading = new THREE.Vector3()
				.subVectors(level.landingSite, gate)
				.setY(0)
				.normalize()
			const right = new THREE.Vector3(
				heading.z,
				0,
				-heading.x
			)
			this._landing = gate
				.clone()
				.addScaledVector(heading, 20)
				.addScaledVector(right, 8)
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
			this._shipSettled = false
			this.ship.ready.then(() => {
				if (
					this._disposed ||
					this.finished ||
					this.phase !== 'victory'
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
		this.titleEl.textContent = 'THE CALL OF THE VOID'
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
		this.phase = phase
		this.phaseTime = 0
		this.scannerEl.style.opacity = '0'
		if (phase === 'discovery') {
			this.ship.group.visible = true
			this._conversation('l2.transit')
		}
		if (phase === 'boarding') {
			this.level.dismountForCinematic()
			this._makeRamp()
		}
		if (phase === 'ascent') {
			this._commandeered = true
			this.audio?.startThrusterHum?.()
			this.level.playerRoot.visible = false
			this.ramp.visible = false
			this.audio?.playHatch?.()
			this._buildFlight()
		}
		if (phase === 'signal') {
			this.audio?.playRadioTone?.({
				freq: 880,
				duration: 0.12,
				volume: 0.035,
			})
			this.audio?.playRadioNoise?.(0.4, 0.16)
		}
		if (phase === 'interference')
			this.audio?.playRadioNoise?.(0.8, 0.22)
		if (phase === 'presence')
			this.audio?.playRadioTone?.({
				freq: 68,
				duration: 0.9,
				volume: 0.05,
			})
		if (phase === 'wormhole') {
			const center = this.wormhole.group.position
			this._wormholeCurve = new THREE.CubicBezierCurve3(
				this.ship.group.position.clone(),
				offset(center, 0, 0, 85),
				offset(center, 0, 0, 12),
				offset(center, 0, 0, -55)
			)
		}
		if (phase === 'level3_loading') this._loadLevel3()
		if (phase === 'arrival') {
			this._conversation('l3.opening')
			this.titleEl.textContent = 'VOID OF GODS'
		}
		if (phase === 'disembark') this.audio?.playHatch?.()
		if (phase === 'handoff') {
			this.level3.keys.clear()
		}
	}

	update(delta) {
		if (this.finished || this._disposed) return
		const dt = Math.max(0, Math.min(delta, 0.05))
		this.elapsed += dt
		this.phaseTime += dt
		if (this.level) this.level.update(dt)
		if (this.level3) {
			// These are ambient visuals only: no attacks, jetpack, pickup, or
			// movement may run before the player's arrival is visible.
			this.level3.planet.update(dt)
			this.level3.stormLandscape?.update(dt)
			this.level3.voidAudio?.update(this.sceneManager.camera)
		}
		this._updateConversation(dt)
		this.wormhole.update(dt)
		const disturbance =
			this.phase === 'interference'
				? Math.sin(
						clamp(
							this.phaseTime /
								this.durations
									.interference
						) * Math.PI
					)
				: this.phase === 'presence'
					? 0.25
					: 0
		const thrust = ['ascent', 'wormhole'].includes(this.phase)
			? 0.8
			: this.phase === 'arrival'
				? 0.4
				: FLIGHT_PHASES.includes(this.phase)
					? 0.24
					: 0
		this.ship.update(dt, { thrust, interference: disturbance })
		this.audio?.setThrusterLevel?.(thrust * (1 - disturbance * 0.2))
		this.audio?.setCinematicDrone?.(
			disturbance * 0.65 +
				(['reveal', 'presence', 'approach'].includes(
					this.phase
				)
					? 0.18
					: 0)
		)
		this.environment.update(dt, {
			interference: disturbance,
			presence:
				this.phase === 'presence'
					? ease(
							this.phaseTime /
								this.durations
									.presence
						)
					: this.phase === 'approach'
						? 1
						: 0,
		})
		if (FLIGHT_PHASES.includes(this.phase))
			this._updateFlight(dt, disturbance)
		else if (this.phase === 'victory') this._victory(dt)
		else if (this.phase === 'discovery') this._discovery(dt)
		else if (this.phase === 'boarding') this._boarding(dt)
		else if (this.phase === 'wormhole') this._updateWormhole(dt)
		else if (this.phase === 'level3_loading') this._loading(dt)
		else if (this.phase === 'arrival') this._arrival(dt)
		else if (this.phase === 'disembark') this._disembark(dt)
		else if (this.phase === 'handoff') this._handoff(dt)
	}

	_victory(dt) {
		const p = this.level.playerRoot.position
		this.titleEl.style.opacity = String(ease(this.phaseTime))
		this._camera(offset(p, 15, 12, 25), offset(p, 0, 2, 0), dt, {
			terrain: this.level.planet,
			response: 0.7,
			fov: 60,
		})
		if (
			this.phaseTime >= this.durations.victory &&
			(this._shipSettled ||
				this.phaseTime >= this.durations.victory + 5)
		) {
			this.ship.lockAppearance()
			this._setPhase('discovery')
		}
	}
	_discovery(dt) {
		const t = ease(this.phaseTime / this.durations.discovery)
		const pilot = this.level.playerRoot.position
		const look = pilot.clone().lerp(this.ship.group.position, 0.65)
		this._camera(offset(this._landing, 25, 11, 34), look, dt, {
			terrain: this.level.planet,
			response: 0.9,
			fov: 58,
		})
		this._message(
			'UNREGISTERED ALIEN VESSEL\nPOWER SIGNATURE: ACTIVE',
			t
		)
		this.titleEl.style.opacity = String(
			1 - ease(this.phaseTime / 2)
		)
		if (t >= 1) this._setPhase('boarding')
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
		hatch.x -= 0.9
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
				.copy(this._rampFoot)
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
		const distance = Math.max(
			30,
			p.distanceTo(this.ship.group.position) * 1.1
		)
		this._camera(
			offset(composition, distance * 0.65, 10, distance),
			offset(composition, 0, 1.6, 0),
			dt,
			{ terrain: level.planet, fov: 56 }
		)
		this._message(
			'ALIEN VESSEL // ACCESSING FLIGHT SYSTEMS',
			clamp(this.phaseTime / this.durations.boarding)
		)
		if (boarded) this._setPhase('ascent')
		else if (this.phaseTime >= this.durations.boarding) {
			// Never teleport a blocked astronaut into a hull. Show a clear
			// failure to board, then recover through the same safe skip path.
			console.warn(
				'[Cutscene] Boarding route blocked; recovering to Level 3.'
			)
			this.skip()
		}
	}

	_buildFlight() {
		const p = this.ship.group.position.clone()
		this._launch = p.clone()
		this.environment.group.position.copy(offset(p, 0, 740, -2650))
		this._flightCurve = new THREE.CatmullRomCurve3(
			[
				p,
				offset(p, 4, 65, -60),
				offset(p, 35, 300, -330),
				offset(p, 45, 620, -850),
				offset(p, -80, 670, -1400),
				offset(p, -100, 650, -1760),
				offset(p, 0, 620, -1950),
			],
			false,
			'centripetal'
		)
		this._flightDuration = FLIGHT_PHASES.reduce(
			(sum, key) => sum + this.durations[key],
			0
		)
		this.wormhole.group.position.copy(offset(p, 0, 620, -2080))
		this._buildSpace(p)
	}
	_buildSpace(p) {
		const stars = this.game.assetManager.createStarfield(1600, 5000)
		stars.traverse((node) => {
			if (node.geometry) this.own(node.geometry)
			if (node.material) this.own(node.material)
		})
		stars.position.copy(offset(p, 0, 600, -1500))
		this.space.add(stars)
		const sun = new THREE.DirectionalLight(0xa4cfea, 2.1)
		sun.position.set(-200, 180, 100)
		this.space.add(
			new THREE.HemisphereLight(0x8ca4cb, 0x151020, 0.9),
			sun
		)
		this.planetSphere = this.mesh(
			new THREE.SphereGeometry(760, 48, 32),
			new THREE.MeshStandardMaterial({
				color: 0x736950,
				roughness: 1,
			})
		)
		this.planetSphere.position.copy(
			offset(p, 0, -760 - this.ship.hullBottom, 0)
		)
		this.space.add(this.planetSphere)
		const atmosphere = this.mesh(
			new THREE.SphereGeometry(774, 40, 24),
			new THREE.ShaderMaterial({
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.BackSide,
				vertexShader:
					'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
				fragmentShader:
					'varying vec3 n; varying vec3 v; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(.28,.43,.56,rim*.3);}',
			})
		)
		atmosphere.position.copy(this.planetSphere.position)
		this.space.add(atmosphere)
	}
	_updateFlight(dt, disturbance) {
		this.flightTime = Math.min(
			this._flightDuration,
			this.flightTime + dt
		)
		const t = ease(this.flightTime / this._flightDuration)
		const p = this._flightCurve.getPointAt(t)
		const direction = this._flightCurve.getTangentAt(
			Math.min(t, 0.9999)
		)
		this._moveShip(
			p,
			direction,
			dt,
			0.16 * Math.sin(t * Math.PI * 3)
		)
		const q = this.ship.group.quaternion
		const cameraOffset =
			this.phase === 'reveal'
				? new THREE.Vector3(55, 24, 85)
				: this.phase === 'presence'
					? new THREE.Vector3(9, 4, 24)
					: new THREE.Vector3(20, 10, 36)
		this._desiredPosition
			.copy(cameraOffset)
			.applyQuaternion(q)
			.add(p)
		const look = p
			.clone()
			.addScaledVector(
				direction,
				this.phase === 'reveal' ? 45 : 8
			)
		if (this.phase !== 'ascent')
			look.lerp(
				this.environment.group.position,
				this.phase === 'reveal' ? 0.2 : 0.06
			)
		this._camera(this._desiredPosition, look, dt, {
			response: 1.6,
			fov: this.phase === 'reveal' ? 65 : 52,
			shake: disturbance * 0.11,
		})
		if (this.phase === 'ascent') {
			const altitude = p.y - this._launch.y
			if (altitude > 110 && !this._levelDisposed)
				this._leaveSurface()
			this.hazeEl.style.opacity = String(
				0.12 *
					Math.sin(
						clamp(
							this.phaseTime /
								this.durations
									.ascent
						) * Math.PI
					)
			)
		}
		const progress = clamp(
			this.phaseTime / this.durations[this.phase]
		)
		const messages = {
			signal: 'UNKNOWN SIGNAL DETECTED\nORIGIN: UNIDENTIFIED\nENERGY SIGNATURE: UNSTABLE',
			reveal: 'ANCIENT STRUCTURE // UNCHARTED',
			interference:
				'NAVIGATION DRIFT\nEXTERNAL GRAVITATIONAL FIELD',
			presence: 'WARNING: UNKNOWN ENERGY SIGNATURE',
			approach: 'VOID OF GODS\nAPPROACH VECTOR CONFIRMED',
		}
		if (messages[this.phase])
			this._message(messages[this.phase], progress)
		this.hazeEl.style.opacity =
			this.phase === 'approach'
				? String(ease(progress) * 0.24)
				: this.hazeEl.style.opacity
		if (this.phaseTime >= this.durations[this.phase]) {
			const next =
				FLIGHT_PHASES[
					FLIGHT_PHASES.indexOf(this.phase) + 1
				]
			this._setPhase(next || 'wormhole')
		}
	}
	_updateWormhole(dt) {
		const t = ease(this.phaseTime / this.durations.wormhole)
		const center = this.wormhole.group.position
		const position = this._wormholeCurve.getPoint(t)
		this._moveShip(position, new THREE.Vector3(0, 0, -1), dt)
		this.wormhole.setIntensity(0.35 + t * 0.65)
		const cameraPosition = offset(position, 18, 8, 42)
		cameraPosition.z = Math.max(cameraPosition.z, center.z + 24)
		this._camera(cameraPosition, offset(position, 0, 0, -35), dt, {
			response: 2.6,
			fov: 62,
			shake: 0.05 * Math.sin(t * Math.PI),
		})
		this._message(
			'WORMHOLE LOCK ACQUIRED\nTRANSIT VECTOR CONFIRMED',
			t
		)
		this.hazeEl.style.opacity = String(
			ease((t - 0.65) / 0.35) * 0.24
		)
		if (!this._wormholeFired && position.z < center.z + 35) {
			this._wormholeFired = true
			this.audio?.playEscape?.()
			this.audio?.playRadioNoise?.(0.6, 0.25)
		}
		if (position.z < center.z - 18) this._wormholeCrossed = true
		if (t >= 1 && this._wormholeCrossed)
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
	_leaveSurface() {
		this.root.removeFromParent()
		this.level?.dispose()
		this.level = null
		this._levelDisposed = true
		clearScene(this.sceneManager.scene)
		this.sceneManager.scene.add(this.root)
		this.space.visible = true
		this.environment.group.visible = true
		this.wormhole.group.visible = true
		this.sceneManager.scene.background = new THREE.Color(0x030710)
		this.sceneManager.scene.fog = new THREE.FogExp2(
			0x080c1a,
			0.00016
		)
		this.audio?.startAmbience?.('level1', { volume: 0.13, fade: 3 })
	}

	_loadLevel3() {
		if (this.level3 || this._loadFailed) return
		const camera = this.sceneManager.camera
		const cameraFov = camera.fov
		this.wormhole.group.visible = !this._skipped
		this.root.removeFromParent()
		this.level?.dispose()
		this.level = null
		this._levelDisposed = true
		clearScene(this.sceneManager.scene)
		try {
			this.level3 = new Level3(this.game, {
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
		const arrivalStart = offset(this._arrivalTarget, 0, 180, 340)
		const shift = new THREE.Vector3().subVectors(
			arrivalStart,
			this.ship.group.position
		)
		this._originShift.add(shift)
		this.ship.group.position.add(shift)
		this.environment.group.position.add(shift)
		// Carry the same aperture through the world-origin change. The lens
		// follows the ship through it during arrival, preserving its occlusion
		// while the destination replaces space behind the throat.
		this.wormhole.group.position.add(shift)
		if (!this._flightCurve)
			this.environment.group.position.copy(
				offset(this._spawn, 0, 300, -460)
			)
		this.environment.group.visible = true
		this.space.visible = false
		this.ramp && (this.ramp.visible = false)
		this._camPos.add(shift)
		this._camLook.add(shift)
		this._arrivalCurve = new THREE.CubicBezierCurve3(
			arrivalStart,
			offset(arrivalStart, 0, -10, -140),
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
			} else this._setPhase('arrival')
		}
	}
	_arrival(dt) {
		const t = ease(this.phaseTime / this.durations.arrival)
		const direction = this._arrivalCurve.getTangent(
			Math.min(t, 0.98)
		)
		direction.lerp(new THREE.Vector3(0, 0, -1), ease(t)).normalize()
		this._moveShip(this._arrivalCurve.getPoint(t), direction, dt)
		const p = this.ship.group.position
		this._camera(
			offset(p, 22, 10, 34),
			p.clone().lerp(this._spawn, 0.3),
			dt,
			{ fov: 58 }
		)
		this.hazeEl.style.opacity = String((1 - ease(t * 2)) * 0.24)
		this.titleEl.style.opacity = String(Math.sin(t * Math.PI))
		this.environment.setArrival(t)
		if (
			this.sceneManager.camera.position.z <
			this.wormhole.group.position.z - 3
		)
			this.wormhole.group.visible = false
		if (t >= 1) {
			this._makeRamp()
			this._setPhase('disembark')
		}
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

	_walkPilot(level, target, dt) {
		const position = level.playerRoot.position
		const dx = target.x - position.x,
			dz = target.z - position.z
		const distance = Math.hypot(dx, dz)
		if (distance < 0.7) {
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
			Math.min(3.2, distance * 2) *
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
		{ response = 2, fov = 58, terrain = null, shake = 0 } = {}
	) {
		this._camPos.lerp(position, 1 - Math.exp(-response * dt))
		this._camLook.lerp(look, 1 - Math.exp(-response * dt))
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
			this.ship.group.visible = true
			level.adoptArrivalBackdrop(this.environment, this.ship)
			this._shipTransferred = true
			this._backdropTransferred = true
		}
		this._teardown()
		this.onComplete(level)
	}
	_teardown() {
		window.removeEventListener('keydown', this._onKeyDown)
		this.overlay?.remove()
		if (!this._shipTransferred) this.ship.dispose()
		this.wormhole.dispose()
		if (!this._backdropTransferred) this.environment.dispose()
		this.root.removeFromParent()
		for (const resource of this._resources) resource.dispose()
		this._resources.clear()
		const camera = this.sceneManager.camera
		camera.near = this._cameraBase.near
		camera.far = Math.max(this._cameraBase.far, 3000)
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
