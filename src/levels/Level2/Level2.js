import * as THREE from 'three'
import { Level } from '../../core/Level.js'
import { STATUS } from '../../core/GameState.js'
import { CHARACTERS } from '../../systems/CharacterManager.js'
import { SHIPS } from '../../systems/ShipManager.js'
import { MODEL_YAW } from '../Level1/Spaceship.js'
import { AlienPlanet } from './AlienPlanet.js'
import { Rover } from './Rover.js'
import { PilotMotion } from './PilotMotion.js'
import { DustParticles } from './DustParticles.js'
import { Alien, ALIEN_MODELS } from './Alien.js'
import { Portal } from './Portal.js'
import { WaypointGuide } from './WaypointGuide.js'

const PLAYER_RADIUS = 0.9
const PLAYER_BASE_OFFSET = 2.2
const MAX_WALK_SLOPE = 16
const SLIDE_START_SLOPE = 17.5
const MAX_MOVEMENT_SUBSTEP = 0.8

// On-foot locomotion feel. The pilot carries momentum instead of snapping
// to a fixed speed and turns through its body; the measured ground speed
// and turn rate then drive the procedural gait in PilotMotion.
const WALK_SPEED = 12
const RUN_SPEED = 20
const MOVE_ACCEL_DAMP = 6.5 // approach rate while input is held
const MOVE_BRAKE_DAMP = 9.5 // decay rate once input is released
const TURN_DAMP = 11 // heading approach rate while moving
const U_TURN_DAMP = 16 // ... and on reversals, so 180s stay playable
const U_TURN_ANGLE = 2 // radians; beyond this a turn counts as a reversal
const JUMP_SPEED = 10.5 // takeoff vertical speed (units/s)
const GRAVITY = 30 // keeps the hop ~1.7 units high
const AIR_CONTROL = 0.35 // input authority while airborne
const AIR_DRAG = 0.12 // horizontal decay while airborne without input
const PIVOT_ANGLE = 0.5 // min facing error before turning in place
const PORTAL_ARRIVE_RADIUS = 8 // XZ distance that counts as reaching the gate

const vec3From = (value, fallback = new THREE.Vector3()) => {
	if (value?.isVector3) return value.clone()
	if (
		value &&
		Number.isFinite(value.x) &&
		Number.isFinite(value.y) &&
		Number.isFinite(value.z)
	) {
		return new THREE.Vector3(value.x, value.y, value.z)
	}
	return fallback.clone()
}

const clamp01 = (value) => Math.max(0, Math.min(1, value))

/** Signed shortest angular distance from the current heading to the target. */
const shortestAngle = (target, current) => {
	let diff = (target - current) % (Math.PI * 2)
	if (diff > Math.PI) diff -= Math.PI * 2
	if (diff < -Math.PI) diff += Math.PI * 2
	return diff
}

/**
 * Level 2 gameplay hand-off.
 *
 * The terrain is now gameplay-functional rather than visual-only:
 * - player elevation follows the procedural surface;
 * - steep uphill movement is rejected and very steep ground causes sliding;
 * - the finite terrain has a playable boundary;
 * - rocks, vegetation and wreck debris have XZ collision volumes;
 * - the exploration rover is boardable (E when close) and drivable with
 *   WASD, using the same slope/bounds/collision rules as the on-foot pilot;
 * - the on-foot pilot carries momentum, leans into acceleration and turns,
 *   and plays a procedural idle/walk/run gait on its static mesh;
 * - a yellow guide line leads to the rover, then retargets to the escape
 *   portal once the rover is boarded — reaching the portal wins the level.
 *
 * Alien combat remains deliberately out of scope for this cinematic milestone.
 */
export class Level2 extends Level {
	constructor(game, { transition = {}, onEnd = null } = {}) {
		super(game, 2)
		this.state = game.gameState
		this.state.currentLevel = 2
		this.state.status = STATUS.PLAYING
		this.transition = transition
		this.onEnd = onEnd
		this.audio = game.audio
		this.baseY = Number.isFinite(this.state.surfaceBaseY)
			? this.state.surfaceBaseY
			: -140

		this.landingSite = vec3From(
			transition.landingSite || this.state.landingSite,
			new THREE.Vector3(0, this.baseY, 0)
		)
		this.crashSite = vec3From(
			transition.crashSite || this.state.crashSite,
			this.landingSite
				.clone()
				.add(new THREE.Vector3(120, 0, 90))
		)
		this.roverSite = this.landingSite
			.clone()
			.add(new THREE.Vector3(95, 0, -55))
		// The escape portal waits across the valley, well away from the
		// rover and the wreck, so reaching it means a real traversal.
		this.portalSite = this.landingSite
			.clone()
			.add(new THREE.Vector3(-150, 0, 135))

		const center = this.landingSite
			.clone()
			.lerp(this.crashSite, 0.5)
		center.y = this.baseY

		this.gameplayColliders = []
		this.planet = new AlienPlanet(this, {
			center,
			baseY: this.baseY,
			size: 1100,
			clearZones: [
				{
					x: this.landingSite.x,
					z: this.landingSite.z,
					radius: 28,
				},
				{
					x: this.crashSite.x,
					z: this.crashSite.z,
					radius: 42,
				},
				{
					x: this.roverSite.x,
					z: this.roverSite.z,
					radius: 46,
				},
				{
					x: this.portalSite.x,
					z: this.portalSite.z,
					radius: 40,
				},
			],
		})

		// Keep the objectives reachable even when the procedural height
		// function happens to put a nominal marker on one of the steepest
		// ridges. The large clear zones above leave both search areas
		// obstacle-free.
		this.roverSite.copy(this._findWalkableSite(this.roverSite))
		this.portalSite.copy(this._findWalkableSite(this.portalSite))

		this.playerRoot = new THREE.Group()
		this.playerRoot.name = 'level2-pilot'
		this.playerRoot.position.copy(this.landingSite)
		this._syncPlayerToTerrain()
		this.addObject(this.playerRoot)
		this.dust = new DustParticles(this)
		this.motion = new PilotMotion(this.playerRoot, {
			baseOffset: PLAYER_BASE_OFFSET,
			onFootfall: ({ ratio }) => this._onFootfall(ratio),
		})
		// Momentum-based on-foot locomotion state (see
		// _updatePlayerMovement); the motion layer consumes it every frame.
		this.velocity = new THREE.Vector3()
		this._speed = 0
		this._prevSpeed = 0
		this._accel = 0
		this._turnRate = 0
		this._slideSpeed = 0
		this._slideDir = new THREE.Vector3()
		this._groundNormal = new THREE.Vector3(0, 1, 0)
		this._slopeDegrees = 0
		this._airborne = false
		this._verticalSpeed = 0
		this._jumpWasDown = false
		this._feetScratch = new THREE.Vector3()
		this._setPilot(this._fallbackPilot())
		this._loadPilot()

		this.wreckRoot = new THREE.Group()
		this.wreckRoot.name = 'crashed-spaceship'
		this.wreckRoot.position.copy(this.crashSite)
		this.wreckRoot.position.y =
			this.planet.heightAt(
				this.crashSite.x,
				this.crashSite.z
			) + 1.5
		this.wreckRoot.rotation.set(0.18, 0.75, -0.42)
		this.addObject(this.wreckRoot)
		this._registerGameplayCollider(
			this.wreckRoot.position.x,
			this.wreckRoot.position.z,
			8.5,
			'wreck',
			this.wreckRoot
		)
		this._setWreck(this._fallbackWreck())
		this._buildWreckEffects()
		this._loadWreck()

		this.rover = new Rover(this, {
			position: this.roverSite,
			heading: -0.55,
		})
		this.rover.collider = this._registerGameplayCollider(
			this.rover.group.position.x,
			this.rover.group.position.z,
			6.8,
			'rover',
			this.rover.group
		)
		// The portal gate is its own destination marker (it has its own
		// beacon visuals), so its guide line runs without a second beacon.
		this.portal = new Portal(this, {
			position: this.portalSite,
			faceTowards: this.landingSite,
		})
		this.guide = new WaypointGuide(this, {
			getTarget: () => this.rover.group.position,
			name: 'rover',
		})
		this.portalGuide = new WaypointGuide(this, {
			getTarget: () => this.portal.group.position,
			beacon: false,
			arriveDistance: 10,
			name: 'portal',
		})
		this.aliens = []
		this._alienTimers = []
		this._spawnAliens()

		this.boarded = false
		this._hasBoarded = false
		this.completed = false
		this.elapsedPlayTime = 0
		this._endTimer = null
		this._eWasDown = false
		this._lastBoardToggle = 0
		this.keys = new Set()
		this._onKeyDown = (e) => this.keys.add(e.code)
		this._onKeyUp = (e) => this.keys.delete(e.code)
		// Losing focus mid-hold never delivers the matching keyup, which
		// would leave the key stuck in the Set (frozen movement, and the
		// E toggle's edge detection blocked forever).
		this._onBlur = () => this.keys.clear()
		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('keyup', this._onKeyUp)
		window.addEventListener('blur', this._onBlur)

		this.feedbackTimer = 0
		this._buildObjective()
		this._buildMovementFeedback()
		this._setupCamera()
		// Dev-only handle so automated smoke tests can inspect and drive
		// the level without a visible viewport; stripped from production
		// builds because import.meta.env.DEV is a static false there.
		if (import.meta.env.DEV) window.__level2 = this
	}

	_findWalkableSite(origin) {
		const candidate = origin.clone()
		const radii = [0, 8, 16, 24, 32]
		for (const radius of radii) {
			const samples = radius === 0 ? 1 : 16
			for (let i = 0; i < samples; i++) {
				const angle =
					samples === 1
						? 0
						: (i / samples) * Math.PI * 2
				candidate.set(
					origin.x + Math.cos(angle) * radius,
					0,
					origin.z + Math.sin(angle) * radius
				)
				if (
					!this.planet.isInsideBounds(
						candidate.x,
						candidate.z,
						8
					)
				)
					continue
				if (
					this.planet.slopeDegreesAt(
						candidate.x,
						candidate.z
					) >
					MAX_WALK_SLOPE - 1
				)
					continue
				const crashDx = candidate.x - this.crashSite.x
				const crashDz = candidate.z - this.crashSite.z
				if (Math.hypot(crashDx, crashDz) < 25) continue
				return candidate.clone()
			}
		}
		return origin.clone()
	}

	_onFootfall(ratio) {
		this._feetScratch.copy(this.playerRoot.position)
		this._feetScratch.y -= PLAYER_BASE_OFFSET
		this.dust.spawnFoot(this._feetScratch, { ratio })
	}

	_alienSpotValid(x, z, radius) {
		if (!this.planet.isInsideBounds(x, z, 12)) return false
		if (this.planet.slopeDegreesAt(x, z) > 20) return false
		// _isSpawnClear already fences off the lava channel and the
		// landing/crash/rover clear zones.
		return this.planet._isSpawnClear(x, z, radius)
	}

	_findAlienSpot(origin, radius) {
		const candidate = origin.clone()
		for (const r of [0, 12, 24, 36, 48, 60]) {
			const samples = r === 0 ? 1 : 12
			for (let i = 0; i < samples; i++) {
				const angle =
					samples === 1
						? 0
						: (i / samples) * Math.PI * 2
				candidate.set(
					origin.x + Math.cos(angle) * r,
					0,
					origin.z + Math.sin(angle) * r
				)
				if (
					this._alienSpotValid(
						candidate.x,
						candidate.z,
						radius
					)
				)
					return candidate.clone()
			}
		}
		return null
	}

	/**
	 * Ambient alien life. Loads are staggered so the three ~37 MB GLBs do
	 * not all parse in the same frame; each alien pops in when ready.
	 * The planet is meant to feel inhabited, so the roster is a crowd —
	 * distance culling in Alien.update keeps only the nearby bodies on
	 * the render list.
	 */
	_spawnAliens() {
		const midRover = this.landingSite
			.clone()
			.lerp(this.roverSite, 0.45)
		const midCrash = this.landingSite
			.clone()
			.lerp(this.crashSite, 0.6)
		const midPortal = this.landingSite
			.clone()
			.lerp(this.portalSite, 0.5)
		const midRoverPortal = this.roverSite
			.clone()
			.lerp(this.portalSite, 0.5)
		const defs = [
			// Predator packs patrol the routes between the landmarks.
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: midRover
					.clone()
					.add(new THREE.Vector3(-30, 0, -34)),
				fit: 5.4,
				speed: 4.4,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: this.crashSite
					.clone()
					.add(new THREE.Vector3(-58, 0, -30)),
				fit: 5.4,
				speed: 3.8,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: this.roverSite
					.clone()
					.add(new THREE.Vector3(-26, 0, 46)),
				fit: 5.2,
				speed: 4.1,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: this.portalSite
					.clone()
					.add(new THREE.Vector3(-44, 0, -26)),
				fit: 5.6,
				speed: 4.6,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: this.landingSite
					.clone()
					.add(new THREE.Vector3(52, 0, -78)),
				fit: 5.3,
				speed: 3.6,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: midCrash
					.clone()
					.add(new THREE.Vector3(40, 0, 30)),
				fit: 5.5,
				speed: 4.2,
				radius: 2,
			},
			{
				path: ALIEN_MODELS.predator,
				kind: 'ground',
				home: midPortal
					.clone()
					.add(new THREE.Vector3(36, 0, -18)),
				fit: 5.4,
				speed: 3.9,
				radius: 2,
			},
			// Armored brutes guard the objectives.
			{
				path: ALIEN_MODELS.brute,
				kind: 'ground',
				home: this.portalSite
					.clone()
					.add(new THREE.Vector3(30, 0, 40)),
				fit: 6.6,
				speed: 3.1,
				radius: 2.7,
			},
			{
				path: ALIEN_MODELS.brute,
				kind: 'ground',
				home: this.crashSite
					.clone()
					.add(new THREE.Vector3(54, 0, 44)),
				fit: 6.4,
				speed: 2.9,
				radius: 2.7,
			},
			{
				path: ALIEN_MODELS.brute,
				kind: 'ground',
				home: midRoverPortal
					.clone()
					.add(new THREE.Vector3(-20, 0, 24)),
				fit: 6.8,
				speed: 3.2,
				radius: 2.7,
			},
			// Flying predators circle different landmarks at different
			// heights so the sky never feels scripted.
			{
				path: ALIEN_MODELS.flying,
				kind: 'flyer',
				home: this.crashSite.clone(),
				fit: 7.5,
				altitude: 34,
				orbitRadius: 52,
				orbitSpeed: 0.16,
			},
			{
				path: ALIEN_MODELS.flying,
				kind: 'flyer',
				home: this.landingSite.clone(),
				fit: 6.5,
				altitude: 44,
				orbitRadius: 74,
				orbitSpeed: -0.1,
			},
			{
				path: ALIEN_MODELS.flying,
				kind: 'flyer',
				home: this.portalSite.clone(),
				fit: 7,
				altitude: 40,
				orbitRadius: 60,
				orbitSpeed: 0.13,
			},
			{
				path: ALIEN_MODELS.flying,
				kind: 'flyer',
				home: midPortal.clone(),
				fit: 6.8,
				altitude: 52,
				orbitRadius: 84,
				orbitSpeed: -0.08,
			},
		]

		defs.forEach((def, index) => {
			if (def.kind === 'ground') {
				const spot = this._findAlienSpot(
					def.home,
					def.radius
				)
				if (!spot) {
					console.warn(
						'[Level2] No clear spot for an alien; skipped.'
					)
					return
				}
				def.home.copy(spot)
			}
			const alien = new Alien(this, def)
			this.aliens.push(alien)
			this._alienTimers.push(
				setTimeout(
					() => alien.load(),
					600 + index * 550
				)
			)
		})
	}

	async _loadPilot() {
		const config =
			CHARACTERS[this.state.selectedCharacter] ||
			CHARACTERS.zara
		try {
			const model = await this.assetManager.loadModel(
				config.model
			)
			if (!this.playerRoot.parent) return
			this._fit(model, 3.2)
			this._setPilot(model)
		} catch (error) {
			console.warn(
				'[Level2] Pilot model unavailable:',
				error?.message
			)
		}
	}

	async _loadWreck() {
		const shipKey = SHIPS[this.state.selectedShip]
			? this.state.selectedShip
			: 'vanguard'
		try {
			const model = await this.assetManager.loadModel(
				SHIPS[shipKey].model
			)
			if (!this.wreckRoot.parent) return
			this._fit(model, 18)
			const pivot = new THREE.Group()
			pivot.rotation.y = MODEL_YAW[shipKey] || 0
			pivot.add(model)
			this._setWreck(pivot)
		} catch (error) {
			console.warn(
				'[Level2] Wreck model unavailable:',
				error?.message
			)
		}
	}

	_setPilot(model) {
		this.pilotModel?.removeFromParent()
		this.pilotModel = model
		// The motion layer reparents the mesh under its feet pivot and
		// grounds it on the terrain.
		this.motion.setModel(model)
	}

	_setWreck(model) {
		this.wreckModel?.removeFromParent()
		this.wreckModel = model
		this.wreckRoot.add(model)
	}

	_fallbackPilot() {
		const group = new THREE.Group()
		const body = new THREE.Mesh(
			this.own(
				new THREE.CylinderGeometry(0.55, 0.7, 2.2, 10)
			),
			this.own(
				new THREE.MeshStandardMaterial({
					color: 0x4c6070,
					metalness: 0.35,
					roughness: 0.55,
				})
			)
		)
		const head = new THREE.Mesh(
			this.own(new THREE.SphereGeometry(0.48, 12, 10)),
			this.own(
				new THREE.MeshStandardMaterial({
					color: 0xc48d71,
				})
			)
		)
		head.position.y = 1.45
		group.add(body, head)
		return group
	}

	_fallbackWreck() {
		const mesh = new THREE.Mesh(
			this.own(new THREE.ConeGeometry(3, 12, 8)),
			this.own(
				new THREE.MeshStandardMaterial({
					color: 0x26323a,
					metalness: 0.75,
					roughness: 0.4,
				})
			)
		)
		mesh.rotation.x = -Math.PI / 2
		return mesh
	}

	_registerGameplayCollider(x, z, radius, type, object = null) {
		const collider = { x, z, radius, type, object, enabled: true }
		this.gameplayColliders.push(collider)
		if (object) {
			object.userData.gameplayObstacle = true
			object.userData.colliderRadius = radius
		}
		return collider
	}

	_buildWreckEffects() {
		this.wreckFire = new THREE.PointLight(0xff5a28, 5, 75, 2)
		this.wreckFire.position.set(0, 5, 0)
		this.wreckRoot.add(this.wreckFire)

		const flame = new THREE.Mesh(
			this.own(new THREE.SphereGeometry(2.2, 12, 8)),
			this.own(
				new THREE.MeshBasicMaterial({
					color: 0xff5a20,
					transparent: true,
					opacity: 0.72,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				})
			)
		)
		flame.position.set(0, 3.2, 0)
		this.wreckRoot.add(flame)
		this.wreckFlame = flame

		const smoke = new THREE.Mesh(
			this.own(new THREE.SphereGeometry(3.5, 12, 8)),
			this.own(
				new THREE.MeshBasicMaterial({
					color: 0x211c20,
					transparent: true,
					opacity: 0.45,
					depthWrite: false,
				})
			)
		)
		smoke.position.set(0, 8, 0)
		this.wreckRoot.add(smoke)
		this.wreckSmoke = smoke

		const debrisGeometry = this.own(
			new THREE.TetrahedronGeometry(0.8, 0)
		)
		const debrisMaterial = this.own(
			new THREE.MeshStandardMaterial({
				color: 0x2e2527,
				metalness: 0.4,
				roughness: 0.75,
			})
		)
		const world = new THREE.Vector3()
		for (let i = 0; i < 16; i++) {
			const debris = new THREE.Mesh(
				debrisGeometry,
				debrisMaterial
			)
			const angle = Math.random() * Math.PI * 2
			const radius = 10 + Math.random() * 24
			debris.position.set(
				Math.cos(angle) * radius,
				-1 + Math.random() * 2,
				Math.sin(angle) * radius
			)
			debris.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			)
			const scale = 0.5 + Math.random() * 1.8
			debris.scale.setScalar(scale)
			this.wreckRoot.add(debris)
			debris.getWorldPosition(world)
			this._registerGameplayCollider(
				world.x,
				world.z,
				Math.max(0.55, scale * 0.7),
				'debris',
				debris
			)
		}
	}

	_fit(model, target) {
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true
				child.receiveShadow = true
			}
		})
		model.updateMatrixWorld(true)
		let box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const longest = Math.max(size.x, size.y, size.z) || 1
		model.scale.multiplyScalar(target / longest)
		model.updateMatrixWorld(true)
		box = new THREE.Box3().setFromObject(model)
		model.position.sub(box.getCenter(new THREE.Vector3()))
	}

	_buildObjective() {
		this.objectiveEl = document.createElement('div')
		Object.assign(this.objectiveEl.style, {
			position: 'fixed',
			left: '50%',
			top: '7%',
			transform: 'translateX(-50%)',
			zIndex: '30',
			padding: '12px 18px',
			border: '1px solid rgba(110,235,255,.45)',
			background: 'rgba(3,10,18,.72)',
			color: '#dffcff',
			fontFamily: 'monospace',
			letterSpacing: '.08em',
			textAlign: 'center',
			pointerEvents: 'none',
		})
		this.objectiveEl.innerHTML =
			'<strong>SURVIVE THE LANDING</strong><br><span style="font-size:12px;opacity:.8">Follow the yellow guide beam to the exploration rover.</span>'
		this._objectiveKey = 'default'
		document.body.appendChild(this.objectiveEl)
	}

	_buildMovementFeedback() {
		this.feedbackEl = document.createElement('div')
		Object.assign(this.feedbackEl.style, {
			position: 'fixed',
			left: '50%',
			bottom: '9%',
			transform: 'translateX(-50%)',
			zIndex: '31',
			padding: '7px 12px',
			border: '1px solid rgba(255,190,100,.35)',
			background: 'rgba(20,8,8,.72)',
			color: '#ffd5a2',
			fontFamily: 'monospace',
			fontSize: '12px',
			letterSpacing: '.08em',
			opacity: '0',
			transition: 'opacity 120ms linear',
			pointerEvents: 'none',
		})
		document.body.appendChild(this.feedbackEl)
	}

	_showMovementFeedback(message, seconds = 0.7) {
		if (!this.feedbackEl) return
		this.feedbackEl.textContent = message
		this.feedbackEl.style.opacity = '1'
		this.feedbackTimer = Math.max(this.feedbackTimer, seconds)
	}

	_setupCamera() {
		const camera = this.sceneManager.camera
		camera.fov = 68
		camera.near = 0.1
		camera.far = Math.max(camera.far, 3000)
		camera.position.copy(
			this.playerRoot.position
				.clone()
				.add(new THREE.Vector3(10, 8, 18))
		)
		this._lookAt = this.playerRoot.position
			.clone()
			.add(new THREE.Vector3(0, 1.8, 0))
		camera.lookAt(this._lookAt)
		camera.updateProjectionMatrix()
	}

	_syncPlayerToTerrain() {
		this.playerRoot.position.y =
			this.planet.heightAt(
				this.playerRoot.position.x,
				this.playerRoot.position.z
			) + PLAYER_BASE_OFFSET
	}

	_validateMovementCandidate(
		from,
		candidate,
		{ allowSteepDownhill = true } = {}
	) {
		const hitBoundary = this.planet.clampToBounds(
			candidate,
			PLAYER_RADIUS
		)
		const hitObstacle = this.planet.resolveCircleCollisions(
			candidate,
			PLAYER_RADIUS,
			this.gameplayColliders
		)
		this.planet.clampToBounds(candidate, PLAYER_RADIUS)

		const dx = candidate.x - from.x
		const dz = candidate.z - from.z
		const horizontal = Math.hypot(dx, dz)
		if (horizontal < 1e-5) {
			return {
				ok: false,
				hitBoundary,
				hitObstacle,
				blockedBySlope: false,
			}
		}

		const currentHeight = this.planet.heightAt(from.x, from.z)
		const nextHeight = this.planet.heightAt(
			candidate.x,
			candidate.z
		)
		const rising = nextHeight > currentHeight + 0.025
		const gradeDegrees = THREE.MathUtils.radToDeg(
			Math.atan2(
				Math.abs(nextHeight - currentHeight),
				horizontal
			)
		)
		const surfaceSlope = this.planet.slopeDegreesAt(
			candidate.x,
			candidate.z
		)
		const effectiveSlope = Math.max(gradeDegrees, surfaceSlope)

		const blockedBySlope =
			(rising && effectiveSlope > MAX_WALK_SLOPE) ||
			(!allowSteepDownhill && effectiveSlope > MAX_WALK_SLOPE)

		return {
			ok: !blockedBySlope,
			hitBoundary,
			hitObstacle,
			blockedBySlope,
			slope: effectiveSlope,
		}
	}

	_movePlayerDirection(direction, distance, { sliding = false } = {}) {
		if (distance <= 0 || direction.lengthSq() < 1e-8) return false
		const dir = direction.clone().setY(0).normalize()
		const steps = Math.max(
			1,
			Math.ceil(distance / MAX_MOVEMENT_SUBSTEP)
		)
		const stepDistance = distance / steps
		let moved = false

		for (let i = 0; i < steps; i++) {
			const from = this.playerRoot.position.clone()
			const candidate = from
				.clone()
				.addScaledVector(dir, stepDistance)
			const result = this._validateMovementCandidate(
				from,
				candidate,
				{
					allowSteepDownhill: true,
				}
			)

			if (result.hitBoundary && !sliding) {
				this._showMovementFeedback(
					'MISSION AREA BOUNDARY'
				)
			}

			if (result.ok) {
				this.playerRoot.position.x = candidate.x
				this.playerRoot.position.z = candidate.z
				moved = true
				continue
			}

			// If a diagonal move is too steep, try each axis independently. This
			// makes the player naturally skim along ridges instead of sticking.
			let best = null
			for (const axis of ['x', 'z']) {
				const alternative = from.clone()
				alternative[axis] += dir[axis] * stepDistance
				if (
					Math.abs(
						alternative[axis] - from[axis]
					) < 1e-5
				)
					continue
				const altResult =
					this._validateMovementCandidate(
						from,
						alternative,
						{
							allowSteepDownhill: true,
						}
					)
				if (!altResult.ok) continue
				const progress = Math.hypot(
					alternative.x - from.x,
					alternative.z - from.z
				)
				if (!best || progress > best.progress) {
					best = {
						position: alternative,
						progress,
					}
				}
			}

			if (best) {
				this.playerRoot.position.x = best.position.x
				this.playerRoot.position.z = best.position.z
				moved = true
				continue
			}

			if (result.blockedBySlope && !sliding) {
				this._showMovementFeedback(
					'TOO STEEP — FIND ANOTHER ROUTE'
				)
			}
			break
		}

		return moved
	}

	/**
	 * Steep ground carries the pilot downhill. Returns the slide speed that
	 * was actually applied this frame (0 = standing firm), so the motion
	 * layer can sell the loss of footing.
	 */
	_applySlopeSlide(delta) {
		const slope = this.planet.slopeDegreesAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z
		)
		if (slope <= SLIDE_START_SLOPE) return 0

		const normal = this.planet.normalAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z
		)
		const downhill = new THREE.Vector3(normal.x, 0, normal.z)
		if (downhill.lengthSq() < 1e-7) return 0

		const strength = clamp01((slope - SLIDE_START_SLOPE) / 18)
		const slideSpeed = 2.2 + strength * 7.5
		this._slideDir.copy(downhill).normalize()
		this._movePlayerDirection(this._slideDir, slideSpeed * delta, {
			sliding: true,
		})
		return slideSpeed
	}

	_toggleBoardRover() {
		// Debounce: duplicated synthetic key events must not flap the
		// board state through two toggles in one user action.
		const now = performance.now()
		if (now - this._lastBoardToggle < 300) return
		this._lastBoardToggle = now

		if (!this.boarded) {
			const dx =
				this.playerRoot.position.x -
				this.rover.group.position.x
			const dz =
				this.playerRoot.position.z -
				this.rover.group.position.z
			if (Math.hypot(dx, dz) > 9) return
			this.boarded = true
			this._hasBoarded = true
			this.rover.inputEnabled = true
			this.rover.speed = 0
			this.velocity.set(0, 0, 0)
			this._airborne = false
			this._verticalSpeed = 0
			this._jumpWasDown = this.keys.has('Space')
			return
		}

		this.boarded = false
		this.rover.inputEnabled = false
		this.rover.speed = 0
		this.velocity.set(0, 0, 0)
		this._airborne = false
		this._verticalSpeed = 0
		this._jumpWasDown = this.keys.has('Space')
		const exit = this.rover.getExitPosition(new THREE.Vector3())
		if (this.rover.collider) this.rover.collider.enabled = false
		this.planet.clampToBounds(exit, PLAYER_RADIUS)
		this.planet.resolveCircleCollisions(
			exit,
			PLAYER_RADIUS,
			this.gameplayColliders
		)
		if (this.rover.collider) this.rover.collider.enabled = true
		this.playerRoot.position.x = exit.x
		this.playerRoot.position.z = exit.z
		this._syncPlayerToTerrain()
	}

	_updatePlayerMovement(delta) {
		const input = new THREE.Vector3(
			(this.keys.has('KeyD') ? 1 : 0) -
				(this.keys.has('KeyA') ? 1 : 0),
			0,
			(this.keys.has('KeyS') ? 1 : 0) -
				(this.keys.has('KeyW') ? 1 : 0)
		)
		const hasInput = input.lengthSq() > 0
		if (hasInput) input.normalize()

		// Jump: a fresh Space press on the ground launches the pilot;
		// gravity takes over until the feet touch terrain again.
		const jumpDown = this.keys.has('Space')
		if (jumpDown && !this._jumpWasDown && !this._airborne) {
			this._airborne = true
			this._verticalSpeed = JUMP_SPEED
		}
		this._jumpWasDown = jumpDown

		this._slopeDegrees = this.planet.slopeDegreesAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z
		)
		this.planet.normalAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z,
			1.6,
			this._groundNormal
		)
		const slopePenalty =
			1 - Math.min(0.28, this._slopeDegrees / 180)
		const running =
			this.keys.has('ShiftLeft') ||
			this.keys.has('ShiftRight')
		const targetSpeed =
			(running ? RUN_SPEED : WALK_SPEED) * slopePenalty

		// Momentum: velocity chases the input-driven target speed, so
		// starts, stops and direction flips read as a body with weight
		// instead of a switch. Acceleration stays high enough to feel
		// responsive on the shortest input taps. In the air the authority
		// drops so momentum carries the jump, and releasing the keys
		// mid-jump barely bleeds horizontal speed.
		const authority = this._airborne
			? hasInput
				? MOVE_ACCEL_DAMP * AIR_CONTROL
				: MOVE_BRAKE_DAMP * AIR_DRAG
			: hasInput
				? MOVE_ACCEL_DAMP
				: MOVE_BRAKE_DAMP
		this.velocity.lerp(
			input.multiplyScalar(targetSpeed),
			1 - Math.exp(-authority * delta)
		)

		const speed = this.velocity.length()
		if (speed > 0.02) {
			const moved = this._movePlayerDirection(
				this.velocity.clone().divideScalar(speed),
				speed * delta
			)
			if (!moved) {
				// Fully blocked: bleed momentum fast so it cannot fight
				// the obstacle on the next frame.
				this.velocity.multiplyScalar(
					Math.exp(-14 * delta)
				)
			}
		} else {
			this.velocity.set(0, 0, 0)
		}

		// Slopes only pull when the boots are on the ground.
		this._slideSpeed = this._airborne
			? 0
			: this._applySlopeSlide(delta)

		// Rotate toward the actual travel direction (or downhill while
		// sliding) through the body instead of snapping the yaw.
		let targetYaw = null
		if (this._slideSpeed > 0.4) {
			targetYaw = Math.atan2(
				this._slideDir.x,
				this._slideDir.z
			)
		} else if (speed > 0.6) {
			targetYaw = Math.atan2(this.velocity.x, this.velocity.z)
		} else if (hasInput && !this._airborne) {
			// Standing start: pivot in place toward the input heading.
			const inputYaw = Math.atan2(input.x, input.z)
			if (
				Math.abs(
					shortestAngle(
						inputYaw,
						this.playerRoot.rotation.y
					)
				) > PIVOT_ANGLE
			) {
				targetYaw = inputYaw
			}
		}
		if (targetYaw !== null) {
			const diff = shortestAngle(
				targetYaw,
				this.playerRoot.rotation.y
			)
			const turnResponse =
				Math.abs(diff) > U_TURN_ANGLE
					? U_TURN_DAMP
					: TURN_DAMP
			const step =
				diff * (1 - Math.exp(-turnResponse * delta))
			this.playerRoot.rotation.y += step
			this._turnRate = THREE.MathUtils.damp(
				this._turnRate,
				step / Math.max(delta, 1e-4),
				10,
				delta
			)
		} else {
			this._turnRate = THREE.MathUtils.damp(
				this._turnRate,
				0,
				10,
				delta
			)
		}

		// Measured, not requested: blocked movement produces honest
		// numbers, and the gait leans off those.
		this._accel = THREE.MathUtils.damp(
			this._accel,
			THREE.MathUtils.clamp(
				(speed - this._prevSpeed) /
					Math.max(delta, 1e-4),
				-140,
				140
			),
			6,
			delta
		)
		this._prevSpeed = speed
		this._speed = speed

		if (this._airborne) {
			// Ballistic arc: integrate vertical speed and land when the
			// feet fall back through the terrain surface.
			this._verticalSpeed -= GRAVITY * delta
			this.playerRoot.position.y +=
				this._verticalSpeed * delta
			const groundY =
				this.planet.heightAt(
					this.playerRoot.position.x,
					this.playerRoot.position.z
				) + PLAYER_BASE_OFFSET
			if (
				this._verticalSpeed <= 0 &&
				this.playerRoot.position.y <= groundY
			) {
				this.playerRoot.position.y = groundY
				const impact = THREE.MathUtils.clamp(
					-this._verticalSpeed / 16,
					0.15,
					1
				)
				this._airborne = false
				this._verticalSpeed = 0
				this.motion.notifyLanding(impact)
				this._feetScratch.copy(this.playerRoot.position)
				this._feetScratch.y -= PLAYER_BASE_OFFSET
				this.dust.spawnBurst(this._feetScratch, {
					count: Math.round(6 + impact * 10),
					strength: 1.6 + impact * 1.6,
					spread: 1.5,
					size: 0.9,
					upBias: 0.45,
				})
			}
		} else {
			this._syncPlayerToTerrain()
		}
	}

	_updateMovementFeedback(delta) {
		if (this.feedbackTimer <= 0) return
		this.feedbackTimer -= delta
		if (this.feedbackTimer <= 0 && this.feedbackEl) {
			this.feedbackEl.style.opacity = '0'
		}
	}

	/** Did the pilot (or the driven rover) reach the portal gate? */
	_checkPortalArrival() {
		if (this.completed) return
		const dx =
			this.playerRoot.position.x -
			this.portal.group.position.x
		const dz =
			this.playerRoot.position.z -
			this.portal.group.position.z
		if (Math.hypot(dx, dz) > PORTAL_ARRIVE_RADIUS) return
		this._completeMission()
	}

	_completeMission() {
		if (this.completed) return
		this.completed = true
		// Stop the rover where it crossed; the pilot freeze happens in
		// update() off the completed flag.
		this.rover.inputEnabled = false
		const time = this.elapsedPlayTime
		const score = Math.round(
			1500 +
				Math.max(0, 600 - time) * 3 +
				(this._hasBoarded ? 500 : 0)
		)
		this.state.score = score
		this.state.status = STATUS.LEVEL_COMPLETE
		this.audio?.playEscape()
		this.portal.playArrival()
		// A beat of arrival burst before the results screen takes over.
		this._endTimer = setTimeout(() => {
			this.onEnd?.({
				outcome: 'transited',
				won: true,
				score,
				time,
				hull: Math.max(0, this.state.integrity),
				progress: 1,
				level: 2,
			})
		}, 1500)
	}

	update(delta) {
		this.planet.update(delta)
		if (this.wreckFlame) {
			const pulse =
				0.88 +
				Math.sin(performance.now() * 0.012) * 0.12
			this.wreckFlame.scale.setScalar(pulse)
			this.wreckFire.intensity = 4 + pulse * 2
			this.wreckSmoke.rotation.y += delta * 0.12
		}

		const eDown = this.keys.has('KeyE')
		if (eDown && !this._eWasDown) this._toggleBoardRover()
		this._eWasDown = eDown

		this.rover.update(delta)
		// Throttled: while grinding against a steep bank the message would
		// otherwise be re-asserted every frame. Tells the driver how to
		// recover instead of just reporting the block.
		if (this.rover.blockedBySlope && this.feedbackTimer <= 0) {
			this._showMovementFeedback(
				'TOO STEEP — HOLD S TO BACK OUT'
			)
		}

		if (this.boarded) {
			this.rover.getSeatPosition(this.playerRoot.position)
			this.playerRoot.rotation.y = this.rover.heading
			this.velocity.set(0, 0, 0)
			this._speed = 0
			this._prevSpeed = 0
			this._accel = 0
			this._slideSpeed = 0
			this._turnRate = THREE.MathUtils.damp(
				this._turnRate,
				0,
				10,
				delta
			)
		} else if (this.completed) {
			// The run is over; park the pilot so the results screen
			// isn't chasing a still-walking character.
			this.velocity.set(0, 0, 0)
			this._speed = 0
		} else {
			this._updatePlayerMovement(delta)
		}
		this.motion.update(delta, {
			speed: this._speed + this._slideSpeed,
			maxSpeed: RUN_SPEED,
			accel: this._accel,
			turnRate: this._turnRate,
			normal: this._groundNormal,
			sliding: this._slideSpeed > 0.4,
			seated: this.boarded,
			airborne: this._airborne,
			verticalSpeed: this._verticalSpeed,
		})
		// Guidance, dust and ambient life keep running every frame: the
		// rover guide retires once the rover has been boarded, and the
		// portal guide takes over to lead the way to the escape gate.
		this.elapsedPlayTime += delta
		this.portal.update(delta)
		this.guide.update(delta, this.playerRoot.position, {
			active: !this.boarded && !this._hasBoarded,
		})
		this.portalGuide.update(delta, this.playerRoot.position, {
			active: this._hasBoarded && !this.completed,
		})
		this.dust.update(delta)
		for (const alien of this.aliens) {
			alien.update(delta, this.playerRoot.position)
		}
		this._updateMovementFeedback(delta)
		this._checkPortalArrival()

		const camera = this.sceneManager.camera
		const focus = this.boarded
			? this.rover.group.position
			: this.playerRoot.position
		const desired = this.boarded
			? focus
					.clone()
					.addScaledVector(
						this.rover.forwardVector(
							new THREE.Vector3()
						),
						-26
					)
					.add(new THREE.Vector3(0, 12, 0))
			: focus.clone().add(new THREE.Vector3(10, 8, 18))
		camera.position.lerp(desired, 1 - Math.exp(-5 * delta))
		// The look target follows with its own damping and a slight lead in
		// the direction of travel, so sustained runs and turns stop feeling
		// like the camera is welded to the pilot's chest.
		const lookLead = this.boarded
			? this.rover
					.forwardVector(new THREE.Vector3())
					.multiplyScalar(
						Math.abs(this.rover.speed) *
							0.22
					)
			: this.velocity.clone().multiplyScalar(0.22)
		const lookTarget = focus
			.clone()
			.add(new THREE.Vector3(0, this.boarded ? 3.5 : 1.8, 0))
			.add(lookLead)
		this._lookAt.lerp(lookTarget, 1 - Math.exp(-9 * delta))
		camera.lookAt(this._lookAt)

		const dx =
			this.playerRoot.position.x - this.rover.group.position.x
		const dz =
			this.playerRoot.position.z - this.rover.group.position.z
		const roverDistance = Math.hypot(dx, dz)
		const objectiveKey = this.completed
			? 'complete'
			: this.boarded
				? 'portal'
				: roverDistance < 9
					? 'board'
					: roverDistance < 16
						? 'located'
						: 'default'
		if (this.objectiveEl && objectiveKey !== this._objectiveKey) {
			this._objectiveKey = objectiveKey
			const objectiveText = {
				default: '<strong>SURVIVE THE LANDING</strong><br><span style="font-size:12px;opacity:.8">Follow the yellow guide beam to the exploration rover.</span>',
				located: '<strong>ROVER LOCATED</strong><br><span style="font-size:12px;opacity:.8">Get closer to board the rover.</span>',
				board: '<strong>ROVER LOCATED</strong><br><span style="font-size:12px;opacity:.8">Press E to board the rover.</span>',
				portal: '<strong>ESCAPE VIA THE PORTAL</strong><br><span style="font-size:12px;opacity:.8">Follow the yellow guide line · drive through the ring.</span>',
				complete: '<strong>PORTAL REACHED</strong><br><span style="font-size:12px;opacity:.8">You made it off the planet.</span>',
			}
			this.objectiveEl.innerHTML = objectiveText[objectiveKey]
		}
	}

	dispose() {
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
		window.removeEventListener('blur', this._onBlur)
		if (this._endTimer) clearTimeout(this._endTimer)
		for (const timer of this._alienTimers || []) clearTimeout(timer)
		this.objectiveEl?.remove()
		this.feedbackEl?.remove()
		this.gameplayColliders.length = 0
		this.planet?.dispose()
		super.dispose()
	}
}
