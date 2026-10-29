import { StormNotice } from './StormNotice.js'
import { CameraZoom } from './CameraZoom.js'
import { FighterHub } from './FighterHub.js'
import * as THREE from 'three'
import { Level } from '../../core/Level.js'
import { STATUS } from '../../core/GameState.js'
import { CHARACTERS } from '../../systems/CharacterManager.js'
import { SHIPS } from '../../systems/ShipManager.js'
import { MODEL_YAW } from '../Level1/Spaceship.js'
import { AlienPlanet } from './AlienPlanet.js'
import { Rover, MAX_FORWARD_SPEED } from './Rover.js'
import { Hazards } from './Hazards.js'
import { DustParticles } from './DustParticles.js'
import { Alien, ALIEN_MODELS } from './Alien.js'
import { RoverExplosion } from './RoverExplosion.js'
import { Level2LavaHazards } from './Level2LavaHazards.js'
import { Portal } from './Portal.js'
import { WaypointGuide } from './WaypointGuide.js'
import { advanceRouteWaypoint } from './RouteProgress.js'
import { PilotWalk, orientPilot } from './PilotWalk.js'
import { constrainTerrainCamera } from './TerrainCamera.js'

const PLAYER_RADIUS = 0.9
const MAX_WALK_SLOPE = 60
const SLIDE_START_SLOPE = 17.5
const MAX_MOVEMENT_SUBSTEP = 0.8
const LAVA_DAMAGE = 20
const LAVA_HIT_INTERVAL = 0.8
export const LEVEL2_ROUTE_OFFSETS = Object.freeze(
	[
		[300, 150],
		[220, 340],
		[420, 490],
		[650, 420],
		[880, 560],
		[830, 800],
		[1010, 900],
		[960, 1100],
	].map((point) => Object.freeze(point))
)

export const LEVEL2_ENCOUNTER_LAYOUT = Object.freeze(
	[
		{
			id: 'landing-ambush',
			label: 'ALIEN LANDING AMBUSH',
			waypoint: 0,
			nearLanding: true,
			composition: { runner: 4, brute: 2, flyer: 2 },
		},
		{
			id: 'alien-outskirts',
			label: 'ALIEN OUTSKIRTS',
			waypoint: 1,
			composition: { runner: 3, brute: 1, flyer: 2 },
		},
		{
			id: 'lava-crossing',
			label: 'LAVA CROSSING',
			waypoint: 3,
			composition: { runner: 3, brute: 2, flyer: 1 },
		},
		{
			id: 'volcanic-valley',
			label: 'VOLCANIC VALLEY',
			waypoint: 4,
			composition: { runner: 3, brute: 2, flyer: 2 },
		},
		{
			id: 'rocky-alien-territory',
			label: 'ROCKY ALIEN TERRITORY',
			waypoint: 6,
			composition: { runner: 3, brute: 2, flyer: 2 },
		},
		{
			id: 'space-hub-defense',
			label: 'SPACE HUB DEFENSE',
			waypoint: 7,
			major: true,
			composition: { runner: 4, brute: 3, flyer: 2 },
			reinforcements: { runner: 2, brute: 1, flyer: 2 },
			reinforcementDefeats: 2,
		},
	].map((encounter) =>
		Object.freeze({
			...encounter,
			composition: Object.freeze(encounter.composition),
			reinforcements: encounter.reinforcements
				? Object.freeze(encounter.reinforcements)
				: null,
		})
	)
)

const LEVEL2_COMBAT_DEFAULTS = Object.freeze({
	// Original rigged GLBs are heavyweight; keep simultaneous renders bounded.
	maxActiveEnemies: 8,
	maxMajorEnemies: 10,
	spawnInterval: 0.48,
	lavaDamagePerSecond: 25,
	lavaDamageInterval: 0.8,
})

// Wormhole suction around the escape gate: inside this radius the gate
// pulls the rover and the pilot toward the ring, gently at the rim and
// strongly near its throat. The Level 2 escape event begins on the final
// rover approach before this field can take control of the vehicle.
const SUCTION_RADIUS = 60
const SUCTION_MAX_ROVER = 24 // m/s² on the chassis at full pull
const SUCTION_MAX_PILOT = 16

/** Resume/restart buttons treat Space and Enter as clicks while focused. */
function releaseButtonFocus() {
	const el = document.activeElement
	if (el && el !== document.body && typeof el.blur === 'function')
		el.blur()
}

// On-foot locomotion feel. The pilot carries momentum instead of snapping
// to a fixed speed and turns through its body; the measured ground speed
// and turn rate then drive the procedural gait in PilotWalk.
const WALK_SPEED = 4
const RUN_SPEED = 7
const MOVE_ACCEL_DAMP = 6.5 // approach rate while input is held
const MOVE_BRAKE_DAMP = 9.5 // decay rate once input is released

const BASE_GRAVITY = 30 // gravity at multiplier 1 (units/s^2)
const JUMP_HEIGHT = 1.6 // peak of a jump at normal gravity
const MAX_JUMP_HEIGHT = 5 // low-gravity jumps are capped here, not 1 / g
const MIN_GRAVITY_MULT = 0.1 // the pilot never gets zero/negative gravity
const PORTAL_ARRIVE_RADIUS = 8 // XZ distance that counts as reaching the gate
// On-foot footstep dust cadence, in metres of measured travel.
const FOOTSTEP_STRIDE = 2.4

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

/**
 * Level 2 gameplay hand-off.
 *
 * The terrain is now gameplay-functional rather than visual-only:
 * - player elevation follows the procedural surface;
 * - steep uphill movement is rejected and very steep ground causes sliding;
 * - the finite terrain has a playable boundary;
 * - rocks, vegetation and wreck debris have XZ collision volumes;
 * - the exploration rover is boardable (E when close) and drivable with
 *   WASD, using a Rapier chassis and independent wheel suspension;
 * - the on-foot pilot carries momentum, leans into acceleration and turns,
 *   and plays a procedural idle/walk/run gait on its static mesh;
 * - a yellow guide line leads to the rover, then along the longer safe
 *   basin route toward the wormhole and its final cinematic trigger.
 *
 * Existing alien combat and hazards remain active during the playable route.
 */
export class Level2 extends Level {
	constructor(
		game,
		{
			transition = {},
			onEnd = null,
			planetClass = AlienPlanet,
			scriptSet = 2,
			combatConfig = {},
			worldSize = scriptSet === 2 ? 2400 : 1100,
			onPrepared = null,
			onPauseChange = null,
		} = {}
	) {
		super(game, 2)
		this.state = game.gameState
		this.state.currentLevel = 2
		this.state.status = STATUS.PLAYING
		this.transition = transition
		this.onEnd = onEnd
		this.onPauseChange = onPauseChange || (() => {})
		this.audio = game.audio
		// Two-way radio. Level 3 reuses this whole class and passes
		// scriptSet 3, then swaps the individual cue ids it needs.
		this.radio = game.radio || null
		this._radioScriptSet = scriptSet
		this.combatConfig = {
			...LEVEL2_COMBAT_DEFAULTS,
			...combatConfig,
		}
		this._radioIntroIn = 1.2
		this._radioIntroScript =
			scriptSet === 3 ? 'l3.opening' : 'l2.opening'
		this._radioRoverScript = scriptSet === 3 ? null : 'l2.rover'
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
		// The rover waits out across the flats, a short hike from the
		// landing site and clear of the pilot's collider.
		this.roverSite = this.landingSite
			.clone()
			.add(new THREE.Vector3(95, 0, -55))
		// Level 2 winds through the basin before reaching the fighter hub.
		// Level 3 keeps its independent Matter Dimension objective.
		this.portalSite = this.landingSite
			.clone()
			.add(
				new THREE.Vector3(
					...(scriptSet === 2
						? [700, 0, 1300]
						: [-720, 0, 680])
				)
			)
		const matterRoute =
			scriptSet === 3
				? (() => {
						const start = this.landingSite
						const direction =
							this.portalSite
								.clone()
								.sub(start)
								.setY(0)
								.normalize()
						const side = new THREE.Vector3(
							-direction.z,
							0,
							direction.x
						)
						return [
							0, 0.18, 0.38, 0.58,
							0.8, 1,
						].map((progress, index) =>
							start
								.clone()
								.lerp(
									this
										.portalSite,
									progress
								)
								.addScaledVector(
									side,
									[
										0,
										36,
										-38,
										40,
										-24,
										0,
									][index]
								)
						)
					})()
				: []
		this.roverApproach =
			scriptSet === 2
				? {
						points: [
							this.roverSite.clone(),
							...LEVEL2_ROUTE_OFFSETS.map(
								([x, z]) =>
									this.landingSite
										.clone()
										.add(
											new THREE.Vector3(
												x,
												0,
												z
											)
										)
							),
						],
						trigger: this.landingSite
							.clone()
							.add(
								new THREE.Vector3(
									960,
									0,
									1100
								)
							),
						radius: 24,
						shipSite: this.landingSite
							.clone()
							.add(
								new THREE.Vector3(
									1000,
									0,
									1135
								)
							),
						portalSite: this.portalSite,
					}
				: null
		this._approachWaypoint = 1

		const center = this.landingSite
			.clone()
			.lerp(this.crashSite, 0.5)
		if (this.roverApproach) {
			new THREE.Box3()
				.setFromPoints([
					this.landingSite,
					this.crashSite,
					...this.roverApproach.points,
					this.roverApproach.shipSite,
					this.portalSite,
				])
				.getCenter(center)
		} else if (matterRoute.length) {
			new THREE.Box3()
				.setFromPoints([
					this.landingSite,
					this.crashSite,
					...matterRoute,
					this.portalSite,
				])
				.getCenter(center)
		}
		center.y = this.baseY

		this.gameplayColliders = []
		this.planet = new planetClass(this, {
			center,
			baseY: this.baseY,
			size: worldSize,
			terrainSegments: scriptSet === 2 ? 640 : undefined,
			drivingRoute: this.roverApproach
				? [
						...this.roverApproach.points,
						this.portalSite,
					]
				: matterRoute,
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
				...(this.roverApproach
					? [
							{
								x: this
									.roverApproach
									.shipSite
									.x,
								z: this
									.roverApproach
									.shipSite
									.z,
								radius: 115,
							},
						]
					: []),
			],
		})

		// Keep the objectives reachable even when the procedural height
		// function happens to put a nominal marker on one of the steepest
		// ridges. The large clear zones above leave both search areas
		// obstacle-free.
		this.roverSite.copy(this._findWalkableSite(this.roverSite))
		this.portalSite.copy(this._findWalkableSite(this.portalSite))
		if (this.roverApproach) {
			for (const point of [
				...this.roverApproach.points,
				this.roverApproach.trigger,
				this.roverApproach.shipSite,
			])
				point.y = this.planet.heightAt(point.x, point.z)
		}
		this.lavaHazards =
			scriptSet === 2 ? new Level2LavaHazards(this) : null

		this.playerRoot = new THREE.Group()
		this.playerRoot.name = 'level2-pilot'
		this.playerRoot.position.copy(this.landingSite)
		this._syncPlayerToTerrain()
		this.addObject(this.playerRoot)
		this.dust = new DustParticles(this)
		// Momentum-based on-foot locomotion state (see
		// _updatePlayerMovement); the gait layer consumes it every frame.
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
		// Reused movement and footstep-dust scratch vectors.
		this._inputScratch = new THREE.Vector3()
		this._dustScratch = new THREE.Vector3()
		this._footstepDistance = 0
		const pilot =
			CHARACTERS[this.state.selectedCharacter] ||
			CHARACTERS.zara
		const cachedPilot = this.assetManager.getCachedModel(
			pilot.model
		)
		if (cachedPilot) {
			this._installPilot(cachedPilot, pilot.key)
		} else {
			this._setPilot(this._fallbackPilot())
			this.pilotReady = this._loadPilot()
		}

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
			heading: this.roverApproach ? Math.PI / 4 : -0.55,
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
			faceTowards:
				this.roverApproach?.trigger || this.landingSite,
		})
		if (this.roverApproach) this.fighterHub = new FighterHub(this)
		this.guide = new WaypointGuide(this, {
			getTarget: () => this.rover.group.position,
			name: 'rover',
		})
		this.portalGuide = new WaypointGuide(this, {
			getTarget: () => this._getApproachTarget(),
			getPath: () => {
				if (!this.roverApproach) return null
				this._getApproachTarget()
				return this.roverApproach.points.slice(
					this._approachWaypoint
				)
			},
			beacon: false,
			arriveDistance: 10,
			name: 'portal',
		})
		this.aliens = []
		this._alienTimers = []
		this._spawnAliens()

		this.boarded = false
		this.roverDisabled = false
		this._roverExplosion = null
		this._hasBoarded = false
		this.completed = false
		this.paused = false
		// True while the Level 2 -> Level 3 transit cinematic is shooting
		// this still-live world (input parked, HUD hidden, cutscene camera).
		this.cinematic = false
		this.elapsedPlayTime = 0
		this._endTimer = null
		this._eWasDown = false
		this._lastBoardToggle = 0
		// Wormhole suction + camera impact shake state.
		this._suckShake = 0
		this._impactShake = 0
		this._suckPuff = 0
		this._hitScratch = new THREE.Vector3()
		this.cameraZoom = new CameraZoom()
		this.keys = new Set()
		this._onKeyDown = (e) => {
			if (e.code === 'Escape') {
				if (
					e.repeat ||
					this.completed ||
					this.transitionHeld
				)
					return
				e.preventDefault()
				this.setPaused(!this.paused)
				return
			}
			if (
				e.code === 'KeyR' &&
				!e.repeat &&
				!this.paused &&
				!this.completed &&
				!this.transitionHeld
			) {
				e.preventDefault()
				const nearby =
					this.playerRoot.position.distanceTo(
						this.rover.group.position
					) <= 16
				if (this.boarded || nearby) {
					this._showMovementFeedback(
						this.rover.resetOrientation()
							? 'ROVER UPRIGHT — READY TO DRIVE'
							: 'RESET UNAVAILABLE — TIP ROVER NEAR CLEAR GROUND',
						2
					)
				}
				return
			}
			const zoom = CameraZoom.keyDirection(e)
			if (
				zoom &&
				!this.paused &&
				!this.transitionHeld &&
				!this.completed &&
				!this.firstPerson
			) {
				e.preventDefault()
				this.cameraZoom.change(zoom, this.boarded)
				return
			}
			if (!this.paused && !this.transitionHeld)
				this.keys.add(e.code)
		}
		this._onKeyUp = (e) => this.keys.delete(e.code)
		// Losing focus mid-hold never delivers the matching keyup, which
		// would leave the key stuck in the Set (frozen movement, and the
		// E toggle's edge detection blocked forever).
		this._onBlur = () => {
			this.keys.clear()
		}
		this._onVisibility = () => {
			if (document.hidden) this.keys.clear()
		}
		this._onWheel = (e) => {
			if (
				this.paused ||
				this.completed ||
				this.transitionHeld ||
				this.firstPerson ||
				e.ctrlKey ||
				e.deltaY === 0
			)
				return
			e.preventDefault()
			this.cameraZoom.change(
				Math.sign(e.deltaY),
				this.boarded
			)
		}
		this.sceneManager.renderer.domElement.addEventListener(
			'wheel',
			this._onWheel,
			{ passive: false }
		)
		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('keyup', this._onKeyUp)
		window.addEventListener('blur', this._onBlur)
		document.addEventListener(
			'visibilitychange',
			this._onVisibility
		)

		this.feedbackTimer = 0
		this._buildObjective()
		this._buildMovementFeedback()
		this._setupCamera()
		this.firstPerson = false
		this._vWasDown = false
		this.hazards = new Hazards(this)
		this.stormNotice = new StormNotice()
		this.maxPlayerHP = combatConfig.playerHP ?? 100
		this.playerHP = this.maxPlayerHP
		this.maxRoverHP = combatConfig.roverHP ?? 200
		this.roverHP = this.maxRoverHP
		this.roverDamageCooldown = 0
		this.damageCooldown = 0
		this._lavaPlayerCooldown = 0
		this._lavaRoverCooldown = 0
		this._lavaRoverWarned = false
		this._buildLevelHUD()
		this._updateLevelHUD()
		this._buildDamageFlash()
		// Open the radio net for this run and warm the level's voice clips.
		this.radio?.beginLevel(this._radioScriptSet)
		// Surface/atmosphere bed for the level (Level 3 passes scriptSet 3).
		this.audio?.startAmbience(scriptSet === 3 ? 'level3' : 'level2')
		// Dev-only handle so automated smoke tests can inspect and drive
		// the level without a visible viewport; stripped from production
		// builds because import.meta.env.DEV is a static false there.
		if (import.meta.env.DEV) window.__level2 = this
		// Let a transition retain ownership if the derived constructor fails.
		onPrepared?.(this)
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

	/** Track the rover against the actual road segments, not just waypoint radii. */
	_getApproachTarget() {
		const route = this.roverApproach?.points
		if (!route) return this.portal.group.position
		const position = this.boarded
			? this.rover.group.position
			: this.playerRoot.position
		this._approachWaypoint = advanceRouteWaypoint(
			route,
			position,
			this._approachWaypoint
		)
		return route[this._approachWaypoint]
	}

	_alienSpotValid(x, z, radius) {
		if (!this.planet.isInsideBounds(x, z, 12)) return false
		if (this.planet.slopeDegreesAt(x, z) > 20) return false
		if (this.lavaHazards?.isLavaAt?.(x, z, radius + 1)) return false
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

	/** Pause gameplay and its level audio while the pause screen is open. */
	setPaused(paused) {
		if (
			this.completed ||
			this.cinematic ||
			this.transitionHeld ||
			paused === this.paused
		)
			return
		this.paused = paused
		this.state.status = paused ? STATUS.PAUSED : STATUS.PLAYING
		// A key held during blur or pause may never deliver its keyup.
		this.keys.clear()
		this.audio?.stopRoverEngine()
		this.audio?.setAmbiencePaused(paused)
		this.radio?.setPaused(paused)
		if (!paused) releaseButtonFocus()
		this.onPauseChange(paused)
	}

	/** Configure the Level 2 roster; actors are created as route zones activate. */
	_spawnAliens() {
		if (this._radioScriptSet !== 2) return
		this.encounters = LEVEL2_ENCOUNTER_LAYOUT.map((config) => ({
			...config,
			started: false,
			completed: false,
			reinforcementsQueued: false,
			total: 0,
			spawned: 0,
			defeated: 0,
			retired: 0,
			skipped: 0,
			aliens: [],
		}))
		this._pendingAlienSpawns = []
		this._encounterSpawnTimer = 0
		this.encounterStats = {
			planned: LEVEL2_ENCOUNTER_LAYOUT.reduce(
				(total, encounter) =>
					total +
					Object.values(
						encounter.composition
					).reduce(
						(sum, count) => sum + count,
						0
					) +
					Object.values(
						encounter.reinforcements || {}
					).reduce(
						(sum, count) => sum + count,
						0
					),
				0
			),
			spawned: 0,
			loaded: 0,
			defeated: 0,
			maxSimultaneous: 0,
		}
	}

	_queueEncounterWave(encounter, composition, reinforcement = false) {
		const routePoint = encounter.nearLanding
			? this.landingSite : this.roverApproach.points[encounter.waypoint]
		let spawnOrdinal = 0
		for (const [type, count] of Object.entries(composition)) {
			for (let index = 0; index < count; index++) {
				// Distribute all species around the area: don't pile the
				// first predator, brute and flyer on the same coordinates.
				const ordinal = spawnOrdinal++
				const angle = ordinal * 2.399963229728653
				const offset = encounter.nearLanding
					? 28 + (ordinal % 3) * 7 : 27 + (ordinal % 3) * 8
				const home = routePoint
					.clone()
					.add(
						new THREE.Vector3(
							Math.cos(angle) *
								offset,
							0,
							Math.sin(angle) * offset
						)
					)
				const typeConfig = {
					runner: {
						path: ALIEN_MODELS.predator,
						kind: 'ground',
						fit: 5.4,
						speed: 12,
						radius: 2,
						ramDamage: 15,
					},
					brute: {
						path: ALIEN_MODELS.brute,
						kind: 'ground',
						fit: 6.6,
						speed: 9,
						radius: 2.7,
						ramDamage: 30,
					},
					flyer: {
						path: ALIEN_MODELS.flying,
						kind: 'flyer',
						fit: 7.2,
						speed: 33,
						altitude: 28,
						orbitRadius:
							42 + (index % 3) * 9,
						orbitSpeed:
							index % 2
								? -0.15
								: 0.17,
						ramDamage: 15,
					},
				}[type]
				this._pendingAlienSpawns.push({
					encounter,
					reinforcement,
					major: Boolean(encounter.major),
					def: {
						...typeConfig,
						home,
						homeRadius: 75,
						flankAngle: angle,
					},
				})
				encounter.total++
			}
		}
	}

	_spawnEncounterAlien(entry) {
		const { encounter, def } = entry
		const spot = this._findAlienSpot(def.home, def.radius || 2)
		if (!spot) {
			console.warn(
				`[Level2] No safe spawn location for ${encounter.id}; actor skipped.`
			)
			encounter.skipped++
			return
		}
		def.home.copy(spot)
		const alien = new Alien(this, def)
		alien.encounterId = encounter.id
		alien.isMajor = entry.major
		alien._encounterLoaded = false
		alien._encounterDefeated = false
		this.aliens.push(alien)
		encounter.aliens.push(alien)
		encounter.spawned++
		this.encounterStats.spawned++
		const timer = setTimeout(() => alien.load(), 0)
		this._alienTimers.push(timer)
	}

	/** Move expensive off-screen skeleton actors out of memory after the rover
	 * has moved well past them. A later encounter can then use the same slot.
	 */
	_retireDistantAliens() {
		const target = this.boarded ? this.rover.group.position : this.playerRoot.position
		for (let i = this.aliens.length - 1; i >= 0; i--) {
			const alien = this.aliens[i]
			if (!alien._loaded || alien.smashed) continue
			if (Math.hypot(alien.position.x - target.x, alien.position.z - target.z) < 220) continue
			const encounter = this.encounters.find((entry) => entry.id === alien.encounterId)
			if (encounter) {
				encounter.retired++
				encounter.aliens = encounter.aliens.filter((entry) => entry !== alien)
			}
			alien.dispose()
			alien.group.removeFromParent()
			if (alien.collider) {
				const index = this.gameplayColliders.indexOf(alien.collider)
				if (index >= 0) this.gameplayColliders.splice(index, 1)
			}
			this.aliens.splice(i, 1)
		}
	}

	_updateEncounters(delta) {
		if (
			this._radioScriptSet !== 2 ||
			!this.roverApproach ||
			this.completed ||
			this.transitionHeld ||
			this.cinematic
		)
			return
		const progress = this._approachWaypoint
		for (const encounter of this.encounters) {
			if (encounter.started || progress < encounter.waypoint)
				continue
			encounter.started = true
			this._queueEncounterWave(
				encounter,
				encounter.composition
			)
			this._showMovementFeedback(
				`${encounter.label} — HOSTILES INBOUND`,
				3
			)
		}
		const hubDefense = this.encounters.at(-1)
		if (
			hubDefense?.started &&
			hubDefense.reinforcements &&
			!hubDefense.reinforcementsQueued &&
			progress >= hubDefense.waypoint &&
			hubDefense.defeated >= hubDefense.reinforcementDefeats
		) {
			hubDefense.reinforcementsQueued = true
			this._queueEncounterWave(
				hubDefense,
				hubDefense.reinforcements,
				true
			)
			this._showMovementFeedback(
				'HUB DEFENSE — REINFORCEMENTS',
				3
			)
		}

		this._retireDistantAliens()
		const active = this.aliens.filter((alien) => !alien.smashed)
		const majorActive = active.some((alien) => alien.isMajor)
		const pendingMajor = this._pendingAlienSpawns[0]?.major ?? false
		const activeLimit =
			majorActive || pendingMajor
				? this.combatConfig.maxMajorEnemies
				: this.combatConfig.maxActiveEnemies
		this._encounterSpawnTimer -= delta
		const initialWave = this._pendingAlienSpawns[0]?.encounter?.nearLanding
		const initialBurst = initialWave ? 4 : 2
		if (
			this._pendingAlienSpawns.length &&
			active.length < activeLimit &&
			this._encounterSpawnTimer <= 0
		) {
			for (let i = 0; i < initialBurst && this._pendingAlienSpawns.length && active.length + i < activeLimit; i++) {
				this._spawnEncounterAlien(this._pendingAlienSpawns.shift())
			}
			this._encounterSpawnTimer = initialWave ? 0.25 : this.combatConfig.spawnInterval
		}
		for (const encounter of this.encounters) {
			if (
				encounter.started &&
				!encounter.completed &&
				encounter.spawned + encounter.skipped ===
					encounter.total &&
				encounter.defeated + encounter.retired === encounter.spawned &&
				(!encounter.reinforcements ||
					encounter.reinforcementsQueued)
			)
				encounter.completed = true
		}
		this.encounterStats.maxSimultaneous = Math.max(
			this.encounterStats.maxSimultaneous,
			active.length
		)
	}

	_trackEncounterAlien(alien) {
		if (!alien.encounterId) return
		const encounter = this.encounters.find(
			(entry) => entry.id === alien.encounterId
		)
		if (!encounter) return
		if (alien._loaded && !alien._encounterLoaded) {
			alien._encounterLoaded = true
			this.encounterStats.loaded++
		}
		if (alien.smashed && !alien._encounterDefeated) {
			alien._encounterDefeated = true
			encounter.defeated++
			this.encounterStats.defeated++
			const cleanupTimer = setTimeout(() => {
				alien.dispose()
				alien.group.removeFromParent()
				if (alien.collider) {
					const index =
						this.gameplayColliders.indexOf(
							alien.collider
						)
					if (index >= 0)
						this.gameplayColliders.splice(
							index,
							1
						)
				}
				this.aliens = this.aliens.filter(
					(entry) => entry !== alien
				)
				encounter.aliens = encounter.aliens.filter(
					(entry) => entry !== alien
				)
			}, 9000)
			this._alienTimers.push(cleanupTimer)
		}
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
			this._installPilot(model, config.key)
		} catch (error) {
			console.warn(
				'[Level2] Pilot model unavailable:',
				error?.message
			)
		}
	}

	_installPilot(model, key) {
		const oriented = orientPilot(model, key)
		this._fit(oriented, 3.2)
		this._setPilot(oriented, key)
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

	_setPilot(model, character = 'zara') {
		this.pilotWalk?.dispose()
		this.pilotModel?.removeFromParent()
		this.pilotModel = model
		this.pilotWalk = new PilotWalk(this, model, character)
		this.playerRoot.add(model)
		if (!this.boarded) this._syncPlayerToTerrain()
	}

	_setWreck(model) {
		this.wreckModel?.removeFromParent()
		this.wreckModel = model
		this.wreckRoot.add(model)
	}

	_fallbackPilot() {
		const group = new THREE.Group()
		const suit = this.own(
			new THREE.MeshStandardMaterial({
				color: 0x4c6070,
				roughness: 0.55,
			})
		)
		const part = (w, h, d, x, y, z = 0) => {
			const mesh = new THREE.Mesh(
				this.own(new THREE.BoxGeometry(w, h, d)),
				suit
			)
			mesh.position.set(x, y, z)
			group.add(mesh)
		}
		part(0.85, 1.05, 0.5, 0, 1.95)
		for (const side of [-1, 1]) {
			part(0.32, 1.4, 0.36, side * 0.25, 0.7)
			part(0.34, 0.18, 0.6, side * 0.25, 0.09, 0.1)
			part(0.25, 1.05, 0.3, side * 0.6, 1.9)
		}
		const head = new THREE.Mesh(
			this.own(new THREE.SphereGeometry(0.35, 12, 10)),
			this.own(
				new THREE.MeshStandardMaterial({
					color: 0xc48d71,
				})
			)
		)
		head.position.y = 2.85
		group.add(head)
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

	_buildLevelHUD() {
		this.levelHudEl = document.createElement('div')

		Object.assign(this.levelHudEl.style, {
			position: 'fixed',
			top: '18px',
			left: '18px',
			width: '250px',
			padding: '16px',
			boxSizing: 'border-box',
			zIndex: '32',
			color: '#dffcff',
			background: 'rgba(3, 10, 18, 0.82)',
			border: '1px solid rgba(110, 235, 255, 0.45)',
			fontFamily: 'monospace',
			fontSize: '12px',
			letterSpacing: '0.06em',
			pointerEvents: 'none',
		})

		this.levelHudEl.innerHTML = `
			<div style="color:#75eaff; margin-bottom:14px;">
				LEVEL 02 // PLANETARY EXODUS
			</div>

			<div style="margin-bottom:6px;">
				PILOT HP
				<span id="l2-hp-text"
					style="float:right;">5 / 5</span>
			</div>

			<div style="
				height:8px;
				background:rgba(255,255,255,0.12);
				margin-bottom:16px;
			">
				<div id="l2-hp-bar" style="
					height:100%;
					width:100%;
					background:#5cffb1;
					transition:width 120ms linear;
				"></div>
			</div>

			<div style="margin-bottom:10px;">
				ELAPSED TIME
				<span id="l2-time"
					style="float:right;">00:00</span>
			</div>

			<div style="margin-bottom:10px;">
				SPEED
				<span id="l2-speed"
					style="float:right;">0.0 m/s</span>
			</div>

			<div id="l2-controls" style="
				margin-top:16px;
				padding-top:12px;
				border-top:1px solid rgba(110,235,255,0.25);
				line-height:1.8;
				color:rgba(223,252,255,0.75);
			">
				V — CHANGE VIEW<br>
				WHEEL / &lt; / &gt; — ZOOM<br>
				R — RIGHT FLIPPED ROVER<br>
			</div>
		`

		document.body.appendChild(this.levelHudEl)
	}

	_buildDamageFlash() {
		this.damageFlashEl = document.createElement('div')

		Object.assign(this.damageFlashEl.style, {
			position: 'fixed',
			inset: '0',
			background: 'rgba(255, 0, 0, 0)',
			pointerEvents: 'none',
			zIndex: '999',
			transition: 'background 0.08s ease-out',
		})

		document.body.appendChild(this.damageFlashEl)
	}

	_updateLevelHUD() {
		if (!this.levelHudEl) return

		const hp = THREE.MathUtils.clamp(
			this.playerHP,
			0,
			this.maxPlayerHP
		)
		const hpPercent = (hp / this.maxPlayerHP) * 100
		if (!this.roverHealthEl) {
			this.roverHealthEl = document.createElement('div')
			this.roverHealthEl.style.marginBottom = '12px'
			this.levelHudEl.appendChild(this.roverHealthEl)
		}
		this.roverHealthEl.hidden = this._radioScriptSet === 3
		this.roverHealthEl.innerHTML = `ROVER HP ${Math.ceil(this.roverHP)} / ${this.maxRoverHP}<div style="height:6px;background:#263342;margin-top:5px"><div style="height:100%;background:#ffbd66;width:${(100 * this.roverHP) / this.maxRoverHP}%"></div></div>`

		const hpText = this.levelHudEl.querySelector('#l2-hp-text')
		const hpBar = this.levelHudEl.querySelector('#l2-hp-bar')
		const timeEl = this.levelHudEl.querySelector('#l2-time')
		const speedEl = this.levelHudEl.querySelector('#l2-speed')
		const modeEl = this.levelHudEl.querySelector('#l2-mode')
		const controlsEl = this.levelHudEl.querySelector('#l2-controls')

		if (hpText) hpText.textContent = `${hp} / ${this.maxPlayerHP}`

		if (hpBar) {
			hpBar.style.width = `${hpPercent}%`
			hpBar.style.background =
				hpPercent > 40
					? '#5cffb1'
					: hpPercent > 20
						? '#ffb347'
						: '#ff5268'
		}

		const seconds = Math.floor(this.elapsedPlayTime)
		const minutes = Math.floor(seconds / 60)
		const remainder = String(seconds % 60).padStart(2, '0')

		if (timeEl) {
			timeEl.textContent = `${String(minutes).padStart(2, '0')}:${remainder}`
		}

		// Walking speed uses the pilot's measured velocity.
		// Rover speed uses the rover's own physics state.
		const speed = this.boarded
			? Math.abs(this.rover.speed)
			: this.velocity.length()

		if (speedEl) speedEl.textContent = `${speed.toFixed(1)} m/s`
		if (modeEl)
			modeEl.textContent = this.boarded ? 'ROVER' : 'ON FOOT'
	}

	_showMovementFeedback(message, seconds = 0.7) {
		if (!this.feedbackEl) return
		this.feedbackEl.textContent = message
		this.feedbackEl.style.opacity = '1'
		this.feedbackTimer = Math.max(this.feedbackTimer, seconds)
	}

	_pilotCameraOffset() {
		const yaw = this.playerRoot.rotation.y
		const distance = this.cameraZoom.walk
		return new THREE.Vector3(
			-Math.sin(yaw) * distance,
			2 + distance / 3,
			-Math.cos(yaw) * distance
		)
	}

	_setupCamera() {
		const camera = this.sceneManager.camera
		camera.fov = 68
		camera.near = 0.1
		camera.far = Math.max(camera.far, 3000)
		camera.position.copy(
			this.playerRoot.position
				.clone()
				.add(this._pilotCameraOffset())
		)
		this._lookAt = this.playerRoot.position
			.clone()
			.add(new THREE.Vector3(0, 1.8, 0))
		constrainTerrainCamera(
			camera.position,
			this._lookAt.clone(),
			this.planet
		)
		camera.lookAt(this._lookAt)
		camera.updateProjectionMatrix()
	}

	_syncPlayerToTerrain() {
		this.playerRoot.position.y =
			this.planet.heightAt(
				this.playerRoot.position.x,
				this.playerRoot.position.z
			) + (this.pilotWalk?.footOffset ?? 0)
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

		let blockedBySlope =
			(rising && effectiveSlope > MAX_WALK_SLOPE) ||
			(!allowSteepDownhill && effectiveSlope > MAX_WALK_SLOPE)
		const g = this.hazards.gravityMultiplierAt(
			this.playerRoot.position
		)
		if (g < 1) blockedBySlope = false

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
	 * was actually applied this frame (0 = standing firm), so the gait
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
		const g = this.hazards.gravityMultiplierAt(
			this.playerRoot.position
		)
		const slideSpeed = (2.2 + strength * 7.5) * Math.max(0, g)
		this._slideDir.copy(downhill).normalize()
		this._movePlayerDirection(this._slideDir, slideSpeed * delta, {
			sliding: true,
		})
		return slideSpeed
	}

	_toggleBoardRover() {
		if (this.transitionHeld || this.roverDisabled) return
		// Debounce: duplicated synthetic key events must not flap the
		// board state through two toggles in one user action.
		const now = performance.now()
		if (now - this._lastBoardToggle < 300) return
		this._lastBoardToggle = now

		if (!this.boarded) {
			if (!this.rover.vehicle) {
				this._showMovementFeedback(
					this.rover.physicsError
						? 'ROVER PHYSICS UNAVAILABLE — RELOAD TO RETRY'
						: 'ROVER INITIALIZING'
				)
				return
			}
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
			// The pilot rides inside the cockpit from here on: hide them
			// exactly like Level 1 hides the pilot in the ship, so the
			// chase camera follows the rover alone.
			this.playerRoot.visible = false
			this.audio?.playHatch()
			this.radio?.play(this._radioRoverScript)
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
		this.playerRoot.visible = true
		this.audio?.playHatch()
	}

	/**
	 * Park gameplay for the Level 2 -> Level 3 transit cinematic. Input can
	 * never reach the world again (the key listeners are removed outright,
	 * so no toggle or drive key can re-arm), the HUDs step aside for the
	 * letterbox, and the world itself keeps living under the cutscene's
	 * camera — the cinematic drives level.update() itself.
	 */
	enterCinematic() {
		this.cinematic = true
		this.stormNotice.update([], this.playerRoot.position, false)
		this.transitionHeld = true
		// The completed encounter no longer rolls gameplay anomalies. Clear
		// active gravity zones through their normal teardown so a random
		// storm cannot lift the disabled rover or obscure the escape shots.
		this.hazards.enabled = false
		this.hazards.dispose()
		this._radioIntroIn = 0
		this.sceneManager.renderer.domElement.removeEventListener(
			'wheel',
			this._onWheel
		)
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
		window.removeEventListener('blur', this._onBlur)
		document.removeEventListener(
			'visibilitychange',
			this._onVisibility
		)
		this.keys.clear()
		this.firstPerson = false
		// The completion timer has already fired (it is what started the
		// cinematic); drop the stale handle defensively.
		if (this._endTimer) {
			clearTimeout(this._endTimer)
			this._endTimer = null
		}
		this.rover.inputEnabled = false
		this.objectiveEl.style.display = 'none'
		this.levelHudEl.style.display = 'none'
		this.feedbackEl.style.display = 'none'
	}

	/** Controlled braking keeps the captured approach momentum visible. */
	stopRoverForCinematic(delta, { disabled = false } = {}) {
		if (disabled) this.roverDisabled = true
		this.rover.inputEnabled = false
		const dt = THREE.MathUtils.clamp(delta || 0, 0, 0.1)
		const retention = Math.exp(-(this.roverDisabled ? 8 : 0.6) * dt)
		const velocity = this.rover.body?.linvel?.()
		if (velocity) {
			const x =
				Math.abs(velocity.x * retention) < 0.025
					? 0
					: velocity.x * retention
			const z =
				Math.abs(velocity.z * retention) < 0.025
					? 0
					: velocity.z * retention
			this.rover.body.setLinvel({ x, y: velocity.y, z }, true)
			const angular = this.rover.body.angvel()
			const rotationRetention = Math.exp(-6 * dt)
			this.rover.body.setAngvel(
				{
					x: angular.x * rotationRetention,
					y: angular.y * rotationRetention,
					z: angular.z * rotationRetention,
				},
				true
			)
		}
		this.rover.speed *= retention
		if (Math.abs(this.rover.speed) < 0.025) this.rover.speed = 0
	}

	disableRoverForCinematic() {
		this.roverDisabled = true
		this.rover.inputEnabled = false
		this.audio?.stopRoverEngine()
	}

	/** Lateral exit uses the real rover footprint and existing collision policy. */
	getCinematicExitPosition(target = new THREE.Vector3()) {
		this.rover.getExitPosition(target)
		const collider = this.rover.collider
		const colliderEnabled = collider?.enabled
		if (collider) collider.enabled = false
		try {
			this.planet.clampToBounds(target, PLAYER_RADIUS)
			this.planet.resolveCircleCollisions(
				target,
				PLAYER_RADIUS,
				this.gameplayColliders
			)
		} finally {
			if (collider) collider.enabled = colliderEnabled
		}
		target.y =
			this.planet.heightAt(target.x, target.z) +
			(this.pilotWalk?.footOffset ?? 0)
		return target
	}

	/**
	 * Step the pilot out of the rover for cinematic boarding,
	 * mirroring the disembark half of _toggleBoardRover (edge detection and
	 * debounce are meaningless here — the cinematic calls this exactly once).
	 */
	dismountForCinematic() {
		if (!this.boarded) return this.playerRoot.position.clone()
		this.boarded = false
		this.rover.inputEnabled = false
		this.rover.speed = 0
		this.velocity.set(0, 0, 0)
		this._airborne = false
		this._verticalSpeed = 0
		this._jumpWasDown = false
		const exit = this.getCinematicExitPosition()
		this.playerRoot.position.copy(exit)
		this.playerRoot.visible = true
		this.audio?.playHatch()
		return exit
	}

	/**
	 * Opening transmission: fire once the surface scene is live, not during
	 * construction. Level 3 overrides _radioIntroScript to its own opening.
	 */
	_updateRadio(delta) {
		if (!this.radio || this._radioIntroIn <= 0) return
		this._radioIntroIn -= delta
		if (this._radioIntroIn > 0) return
		if (this._radioIntroScript)
			this.radio.play(this._radioIntroScript)
	}

	/**
	 * Drive the rover engine loop: idle while parked, revving with
	 * throttle and rolling speed while driving. AudioManager owns the
	 * synthesis; this only decides how hard the engine works.
	 */
	_updateRoverAudio() {
		if (!this.boarded || this.roverDisabled) {
			this.audio?.stopRoverEngine()
			return
		}
		this.audio?.startRoverEngine()
		const throttle =
			this.keys.has('KeyW') || this.keys.has('KeyS') ? 1 : 0
		const speedRatio = clamp01(
			Math.abs(this.rover.speed) / MAX_FORWARD_SPEED
		)
		this.audio?.setRoverEngineLevel(
			clamp01(Math.max(speedRatio, throttle * 0.5))
		)
	}

	_jumpGravityMult() {
		return Math.max(
			this.hazards.gravityMultiplierAt(
				this.playerRoot.position
			),
			MIN_GRAVITY_MULT
		)
	}

	_startJump() {
		const g = this._jumpGravityMult()
		const peak = Math.min(JUMP_HEIGHT / g, MAX_JUMP_HEIGHT)
		this._verticalSpeed = Math.sqrt(2 * BASE_GRAVITY * g * peak)
		this._airborne = true
	}

	_updatePlayerMovement(delta) {
		const startX = this.playerRoot.position.x
		const startZ = this.playerRoot.position.z
		const inputX =
			(this.keys.has('KeyD') ? 1 : 0) -
			(this.keys.has('KeyA') ? 1 : 0)
		const inputZ =
			(this.keys.has('KeyS') ? 1 : 0) -
			(this.keys.has('KeyW') ? 1 : 0)
		// Body-relative steering keeps movement stable while the chase camera
		// pans behind the pilot. A/D turn; W/S move forward/backward.
		if (!this._airborne) {
			const turn = -inputX * 2.4
			this.playerRoot.rotation.y += turn * delta
			this._turnRate = THREE.MathUtils.damp(
				this._turnRate,
				turn,
				10,
				delta
			)
		}
		const yaw = this.playerRoot.rotation.y
		const input = this._inputScratch.set(
			-Math.sin(yaw) * inputZ,
			0,
			-Math.cos(yaw) * inputZ
		)
		const hasInput = inputZ !== 0

		// Jump: a fresh Space press on the ground launches the pilot;
		// gravity takes over until the feet touch terrain again.
		const jumpDown = this.keys.has('Space')
		if (jumpDown && !this._jumpWasDown && !this._airborne) {
			this._startJump()
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
			(running ? RUN_SPEED : WALK_SPEED) *
			slopePenalty *
			this.hazards.speedFactorAt(this.playerRoot.position)

		// Only the grounded pilot can accelerate, brake or steer. A standing
		// jump stays vertical; a moving jump carries its takeoff momentum.
		if (!this._airborne) {
			const authority = hasInput
				? MOVE_ACCEL_DAMP
				: MOVE_BRAKE_DAMP
			this.velocity.lerp(
				input.clone().multiplyScalar(targetSpeed),
				1 - Math.exp(-authority * delta)
			)
		}

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

		// Facing is controlled above; walking backwards must not flip the body.
		if (this._airborne) this._turnRate = 0

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
			this._verticalSpeed -=
				BASE_GRAVITY * this._jumpGravityMult() * delta
			this.playerRoot.position.y +=
				this._verticalSpeed * delta
			const groundY =
				this.planet.heightAt(
					this.playerRoot.position.x,
					this.playerRoot.position.z
				) + (this.pilotWalk?.footOffset ?? 0)
			if (
				this._verticalSpeed > 0 &&
				this.playerRoot.position.y < groundY
			) {
				this.playerRoot.position.y = groundY
			}
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
				this._feetScratch.copy(this.playerRoot.position)
				this._feetScratch.y -=
					this.pilotWalk?.footOffset ?? 0
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

		// Footfall dust: one small puff per stride of measured travel
		// (walking, sprinting or sliding), sized by how fast the pilot
		// is actually moving; landings keep their own bigger burst.
		const travelled = Math.hypot(
			this.playerRoot.position.x - startX,
			this.playerRoot.position.z - startZ
		)
		const groundSpeed = Math.max(speed, this._slideSpeed)
		if (!this._airborne) {
			this._footstepDistance += travelled
		}
		if (
			!this._airborne &&
			groundSpeed > 1.5 &&
			this._footstepDistance >= FOOTSTEP_STRIDE
		) {
			this._footstepDistance %= FOOTSTEP_STRIDE
			this._dustScratch.copy(this.playerRoot.position)
			this._dustScratch.y -= this.pilotWalk?.footOffset ?? 0
			this.dust.spawnFoot(this._dustScratch, {
				ratio: clamp01(groundSpeed / RUN_SPEED),
			})
		}

		// Feed the measured travel distance to the shader gait so the
		// stride rate tracks the actual ground speed.
		this.pilotWalk?.update(delta, travelled, false)
	}

	_updateMovementFeedback(delta) {
		if (this.feedbackTimer <= 0) return
		this.feedbackTimer -= delta
		if (this.feedbackTimer <= 0 && this.feedbackEl) {
			this.feedbackEl.style.opacity = '0'
		}
	}

	/**
	 * The wormhole pulls everything nearby in: the rover through its
	 * physics body, the pilot through direct displacement. Pull strength
	 * ramps steeply, so the rim is an escapeable tug and the throat is a
	 * one-way trip — exactly how the run is meant to finish.
	 */
	_applyWormholeSuction(delta) {
		if (this.completed) {
			// The transit cinematic scripts the vortex strength itself while
			// it shoots the approach; otherwise park the swirl.
			if (!this.cinematic) this.portal.suckLevel = 0
			this._suckShake = 0
			return
		}
		const portal = this.portal.group.position
		const falloffAt = (x, z) => {
			const d = Math.hypot(x - portal.x, z - portal.z)
			if (d >= SUCTION_RADIUS) return 0
			return Math.pow(1 - d / SUCTION_RADIUS, 1.8)
		}

		let strongest = 0

		// The rover is always fair game, driven or parked.
		const roverPos = this.rover.group.position
		const roverPull = falloffAt(roverPos.x, roverPos.z)
		if (roverPull > 0) {
			strongest = Math.max(strongest, roverPull)
			const dx = portal.x - roverPos.x
			const dz = portal.z - roverPos.z
			const d = Math.hypot(dx, dz) || 1
			const nx = dx / d
			const nz = dz / d
			// A tangential swirl drags it into a spiral, not a beeline.
			const pull =
				SUCTION_MAX_ROVER *
				roverPull *
				this.rover.mass *
				delta
			const swirl = pull * 0.35
			this.rover.applyImpulse(
				nx * pull - nz * swirl,
				0,
				nz * pull + nx * swirl
			)
		}

		// The pilot on foot feels the draft too; boarded rides the rover.
		if (!this.boarded) {
			const p = this.playerRoot.position
			const pilotPull = falloffAt(p.x, p.z)
			if (pilotPull > 0) {
				strongest = Math.max(strongest, pilotPull)
				const dx = portal.x - p.x
				const dz = portal.z - p.z
				const d = Math.hypot(dx, dz) || 1
				const nx = dx / d
				const nz = dz / d
				const pull =
					SUCTION_MAX_PILOT * pilotPull * delta
				const swirl = pull * 0.35
				p.x += nx * pull - nz * swirl
				p.z += nz * pull + nx * swirl
				this._syncPlayerToTerrain()
				// Dust whipping past sells the inflow.
				this._suckPuff -= delta
				if (this._suckPuff <= 0 && pilotPull > 0.25) {
					this._suckPuff = 0.4
					this.dust.spawnBurst(
						{
							x: p.x + nx * 4,
							y: p.y,
							z: p.z + nz * 4,
						},
						{
							count: 5,
							strength: 2.4,
							spread: 1.6,
							size: 0.8,
							upBias: 0.2,
						}
					)
				}
			}
		}

		this.portal.suckLevel = strongest
		this._suckShake = strongest * 0.22
	}

	/** Keep fighting aliens from stacking into one blob. */
	_separateAliens() {
		const aliens = this.aliens
		for (let i = 0; i < aliens.length; i++) {
			const a = aliens[i]
			if (!a.combatMode || a.smashed || a.kind === 'flyer')
				continue
			for (let j = i + 1; j < aliens.length; j++) {
				const b = aliens[j]
				if (
					!b.combatMode ||
					b.smashed ||
					b.kind === 'flyer'
				)
					continue
				const dx = b.position.x - a.position.x
				const dz = b.position.z - a.position.z
				const min = a.radius + b.radius
				const d = Math.hypot(dx, dz)
				if (d >= min || d < 0.001) continue
				const push = (min - d) / 2
				const nx = dx / d
				const nz = dz / d
				a.position.x -= nx * push
				a.position.z -= nz * push
				b.position.x += nx * push
				b.position.z += nz * push
			}
		}
	}

	/** Contact damage is independent of alien attack invulnerability. */
	_updateLavaDamage(delta) {
		if (this.completed || this.transitionHeld || this.cinematic)
			return false
		const lava = this.lavaHazards || this.planet.lava
		if (!lava || typeof lava.touches !== 'function') return false
		const interval =
			this.combatConfig?.lavaDamageInterval ??
			LAVA_HIT_INTERVAL
		const damage =
			(this.combatConfig?.lavaDamagePerSecond ??
				LAVA_DAMAGE / LAVA_HIT_INTERVAL) * interval
		this._lavaPlayerCooldown = Math.max(
			0,
			this._lavaPlayerCooldown - delta
		)
		this._lavaRoverCooldown = Math.max(
			0,
			this._lavaRoverCooldown - delta
		)
		let hurt = false
		if (!this.boarded && this._lavaPlayerCooldown <= 0) {
			this._feetScratch.copy(this.playerRoot.position)
			this._feetScratch.y -= this.pilotWalk?.footOffset ?? 0
			if (lava.touches(this._feetScratch)) {
				this.playerHP = Math.max(
					0,
					this.playerHP - damage
				)
				this._lavaPlayerCooldown = interval
				this._flashDamage()
				hurt = true
			}
		}
		// Check contact every frame, even during the damage cooldown, so
		// the warning reflects an actual crossing rather than one wheel tick.
		const roverOnLava = this.roverHP > 0 && this.rover.isTouchingLava(lava)
		if (roverOnLava && !this._lavaRoverWarned) {
			this._showMovementFeedback('WARNING — LAVA IS DAMAGING THE ROVER', 2)
		}
		this._lavaRoverWarned = roverOnLava
		// The hull takes the heat while driving; the seated pilot is safe.
		if (roverOnLava && this._lavaRoverCooldown <= 0) {
			this.roverHP = Math.max(0, this.roverHP - damage)
			this._lavaRoverCooldown = interval
			if (this.boarded) {
				this._flashDamage()
				this._requestShake(0.35)
			}
			hurt = true
		}
		if (hurt) {
			this._updateLevelHUD()
			if (this.playerHP <= 0 || this.roverHP <= 0) {
				this._gameOver(this.roverHP <= 0 ? 'rover' : 'pilot')
				return true
			}
		}
		return false
	}

	/** Hull damage from a bite or talon strike; true when it was fatal. */
	_applyAlienHit(amount = 1) {
		if (this.completed || this.transitionHeld) return false
		if (this.boarded) return this._applyRoverHit(amount)
		if (this.damageCooldown > 0) return false
		this.playerHP = Math.max(this.playerHP - amount, 0)
		this.damageCooldown = 0.8
		this._flashDamage()
		this._updateLevelHUD()
		if (this.playerHP <= 0) {
			this._gameOver()
			return true
		}
		return false
	}

	_alienAttackDamage(alien) {
		return alien.currentAttackDamage ?? alien.attackDamage ?? 1
	}

	_applyRoverHit(amount = 1) {
		if (
			this.completed ||
			this.transitionHeld ||
			this.roverHP <= 0 ||
			this.roverDamageCooldown > 0
		)
			return false
		this.roverHP = Math.max(0, this.roverHP - amount)
		this.roverDamageCooldown = 0.8
		this._requestShake(0.35)
		this._updateLevelHUD()
		if (this.boarded) this._flashDamage()
		if (this.roverHP <= 0) {
			this._showMovementFeedback(
				'ROVER DESTROYED - MISSION FAILED',
				5
			)
			this._gameOver('rover')
			return true
		}
		return false
	}

	/** Impact shake for the camera; the strongest request this frame wins. */
	_requestShake(amount) {
		this._impactShake = Math.max(this._impactShake, amount)
	}

	/** The rover reaches the final escape approach; Level 3 keeps its gate. */
	_checkPortalArrival() {
		if (this.completed) return
		if (this.roverApproach) {
			if (!this.boarded || this._approachTriggered) return
			if (
				this._approachWaypoint <
				this.roverApproach.points.length - 1
			)
				return
			const position = this.rover.group.position
			const trigger = this.roverApproach.trigger
			if (
				Math.hypot(
					position.x - trigger.x,
					position.z - trigger.z
				) > this.roverApproach.radius
			)
				return
			this._approachTriggered = true
			this._completeMission()
			return
		}
		const dx =
			this.playerRoot.position.x -
			this.portal.group.position.x
		const dz =
			this.playerRoot.position.z -
			this.portal.group.position.z
		const distance = Math.hypot(dx, dz)
		// No recording exists for the gate approach, so the radio stays
		// silent and the portal itself carries the arrival.
		if (distance > PORTAL_ARRIVE_RADIUS) return
		this._completeMission()
	}

	_completeMission() {
		if (this.completed) return
		this.completed = true
		this.transitionHeld = true
		this.keys.clear()
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
		// Transit owns the arrival burst and sound; completion only parks play.
		this._endTimer = setTimeout(() => {
			this.onEnd?.({
				outcome: 'transited',
				won: true,
				score,
				time,
				hull: Math.max(0, this.state.integrity),
				progress: 1,
				level: this.level,
			})
		}, 250)
	}

	update(delta) {
		if (this.paused) return
		// Keep the explosion alive after gameplay has been frozen.
		this._roverExplosion?.update(delta)
		if (this.completed && this._roverExplosion) return
		this._updateRadio(delta)
		this.planet.update(delta)
		this.fighterHub?.update(delta)
		this.hazards.update(delta)
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
		const vDown = this.keys.has('KeyV')

		if (vDown && !this._vWasDown) {
			this.firstPerson = !this.firstPerson
		}

		this._vWasDown = vDown

		if (this.cinematic) this.stopRoverForCinematic(delta)
		this.rover.update(delta)
		this._updateRoverAudio()
		// Throttled: while grinding against a steep bank the message would
		// otherwise be re-asserted every frame. Tells the driver how to
		// recover instead of just reporting the block.
		if (this.rover.blockedBySlope && this.feedbackTimer <= 0) {
			this._showMovementFeedback(
				'TOO STEEP — HOLD S TO BACK OUT'
			)
		}

		if (this.boarded) {
			// The pilot itself is hidden in the cockpit while driving
			// (see _toggleBoardRover); keeping the walk layer warm parks
			// the seated pose for the frame the hatch opens again.
			this.pilotWalk?.update(delta, 0, true)
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
			if (!this.cinematic)
				this.pilotWalk?.update(delta, 0, false)
		} else {
			this._updatePlayerMovement(delta)
		}
		this.stormNotice.update(
			this.hazards.active,
			this.boarded
				? this.rover.group.position
				: this.playerRoot.position,
			!this.cinematic &&
				!this.completed &&
				!this.transitionHeld
		)
		// Guidance, dust and ambient life keep running every frame: the
		// rover guide retires once the rover has been boarded, and the
		// portal guide takes over to lead the way to the escape gate.
		this.elapsedPlayTime += delta
		this._applyWormholeSuction(delta)
		this.portal.update(delta)
		this.lavaHazards?.update?.(delta)
		// No waypoints on camera: the cinematic's gate is its own landmark,
		// and a guide ribbon to the rover would cut through every wide shot.
		this.guide.update(delta, this.playerRoot.position, {
			active:
				!this.cinematic &&
				this._radioScriptSet !== 3 &&
				!this.boarded &&
				!this._hasBoarded,
		})
		this.portalGuide.update(
			delta,
			this.boarded ? this.rover.group.position : this.playerRoot.position,
			{
				active:
					!this.cinematic &&
					(this._hasBoarded ||
						this._radioScriptSet === 3) &&
					!this.completed,
			}
		)
		this._updateEncounters(delta)
		this.dust.update(delta)
		this.damageCooldown = Math.max(0, this.damageCooldown - delta)
		this.roverDamageCooldown = Math.max(
			0,
			this.roverDamageCooldown - delta
		)

		if (this._updateLavaDamage(delta)) return

		for (const alien of this.aliens) {
			alien.update(
				delta,
				this.boarded
				? this.rover.group.position
				: this.playerRoot.position
			)
			this._trackEncounterAlien(alien)

			if (this.completed || !alien.combatMode) continue

			// A flyer's talon pass connects: hull damage plus a shove.
			if (alien.pendingStrike) {
				alien.pendingStrike = false
				if ((this.boarded ? this.roverDamageCooldown : this.damageCooldown) <= 0) {
					if (
						this._applyAlienHit(
							this._alienAttackDamage(
								alien
							)
						)
					)
						return
					const away = this._hitScratch
						.copy(this.playerRoot.position)
						.sub(alien.position)
					away.y = 0
					if (away.lengthSq() > 0.001)
						away.normalize()
					if (this.boarded) {
						this.rover.applyImpulse(
							away.x *
								this.rover
									.mass *
								3.2,
							0,
							away.z *
								this.rover
									.mass *
								3.2
						)
					} else {
						this.velocity.addScaledVector(
							away,
							6.5
						)
					}
				}
			}

			// Ramming at speed hurts the alien; slow contact earns a snap.
			const roverContact = alien.checkRoverCollision(
				this.rover
			)
			if (roverContact === 'ram') {
				this.dust.spawnBurst(
					{
						x: alien.position.x,
						y: this.planet.heightAt(
							alien.position.x,
							alien.position.z
						),
						z: alien.position.z,
					},
					{
						count: 10,
						strength: 1.9,
						spread: 2,
						size: 1,
						upBias: 0.6,
					}
				)
				this.audio?.playImpact()
				this._requestShake(0.45)
			} else if (
				roverContact === 'bite' &&
				this.roverDamageCooldown <= 0
			) {
				if (
					this._applyRoverHit(
						this._alienAttackDamage(alien)
					)
				)
					return
			}

			if (
				!this.boarded &&
				this.damageCooldown <= 0 &&
				alien.checkPlayerCollision(this.playerRoot)
			) {
				if (
					this._applyAlienHit(
						this._alienAttackDamage(alien)
					)
				)
					return
				// Knock the pilot back out of the jaws.
				const away = this._hitScratch
					.copy(this.playerRoot.position)
					.sub(alien.position)
				away.y = 0
				if (away.lengthSq() > 0.001) away.normalize()
				this.velocity.addScaledVector(away, 6.5)
			}
		}
		this._separateAliens()
		this._updateMovementFeedback(delta)
		this._checkPortalArrival()

		// The transit cinematic now owns the camera, the HUD and the pilot;
		// everything above keeps the valley alive under its shots.
		if (this.cinematic) return

		const camera = this.sceneManager.camera

		if (this.firstPerson) {
			if (this.boarded) {
				// FIRST PERSON: ROVER
				const forward = this.rover
					.forwardVector(new THREE.Vector3())
					.normalize()

				// Place the camera inside the cockpit.
				camera.position.copy(this.rover.group.position)
				camera.position.y += 3.0
				camera.position.addScaledVector(forward, 10)

				// Look forward in the direction the rover is driving.
				this._lookAt
					.copy(camera.position)
					.addScaledVector(forward, 10)

				camera.lookAt(this._lookAt)
			} else {
				// FIRST PERSON: ON FOOT
				camera.position.set(
					this.playerRoot.position.x,
					this.playerRoot.position.y + 1.5,
					this.playerRoot.position.z
				)

				const yaw = this.playerRoot.rotation.y
				const forward = new THREE.Vector3(
					Math.sin(yaw),
					0,
					Math.cos(yaw)
				)

				this._lookAt
					.copy(camera.position)
					.addScaledVector(forward, 10)

				camera.lookAt(this._lookAt)
			}

			// Hide the pilot's body in first person.
			if (this.pilotModel) {
				this.pilotModel.visible = false
			}
		} else {
			// THIRD PERSON: restore the pilot when on foot.
			if (this.pilotModel && !this.boarded) {
				this.pilotModel.visible = true
			}

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
							-this.cameraZoom.rover
						)
						.add(
							new THREE.Vector3(
								0,
								3.5 +
									this
										.cameraZoom
										.rover *
										(8.5 /
											26),
								0
							)
						)
				: focus.clone().add(this._pilotCameraOffset())

			const followSpeed = this.boarded ? 5 : 3
			camera.position.lerp(
				desired,
				1 - Math.exp(-followSpeed * delta)
			)

			const targetHeight = this.boarded ? 3.5 : 1.8

			constrainTerrainCamera(
				camera.position,
				focus
					.clone()
					.add(
						new THREE.Vector3(
							0,
							targetHeight,
							0
						)
					),
				this.planet
			)

			const lookLead = this.boarded
				? this.rover
						.forwardVector(
							new THREE.Vector3()
						)
						.multiplyScalar(
							Math.abs(
								this.rover.speed
							) * 0.22
						)
				: this.velocity.clone().multiplyScalar(0.22)

			const lookTarget = focus
				.clone()
				.add(new THREE.Vector3(0, targetHeight, 0))
				.add(lookLead)

			this._lookAt.lerp(lookTarget, 1 - Math.exp(-9 * delta))

			camera.lookAt(this._lookAt)
		}

		// Wormhole draft + impact kicks, applied after lookAt so they
		// jitter the view without fighting the tracking.
		const shake = this._suckShake + this._impactShake
		if (shake > 0.002) {
			camera.position.x += (Math.random() - 0.5) * shake
			camera.position.y += (Math.random() - 0.5) * shake
			camera.position.z += (Math.random() - 0.5) * shake
		}
		this._impactShake = 0

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
		const distanceLabel = Math.ceil(roverDistance)
		const displayKey = `${objectiveKey}:${distanceLabel}`
		if (
			this.objectiveEl &&
			displayKey !== this._objectiveKey &&
			this.playerHP != 0
		) {
			this._objectiveKey = displayKey
			const objectiveText = {
				default: `<strong>REACH THE ROVER · ${distanceLabel} m</strong><br><span style="font-size:12px;opacity:.8">WASD to walk · Left Shift to sprint · E to board when close.</span>`,
				located: '<strong>ROVER LOCATED</strong><br><span style="font-size:12px;opacity:.8">Get closer to board the rover.</span>',
				board: '<strong>ROVER LOCATED</strong><br><span style="font-size:12px;opacity:.8">Press E to board the rover.</span>',
				portal: this.roverApproach
					? '<strong>REACH THE ALIEN FIGHTER HUB</strong><br><span style="font-size:12px;opacity:.8">Follow the yellow guide around the lava basin toward the alien fleet hangars.</span>'
					: '<strong>ESCAPE VIA THE PORTAL</strong><br><span style="font-size:12px;opacity:.8">Follow the yellow guide line · drive through the ring.</span>',
				complete: this.roverApproach
					? '<strong>FINAL APPROACH</strong><br><span style="font-size:12px;opacity:.8">Stay with the rover — the fighter hub is ahead.</span>'
					: '<strong>PORTAL REACHED</strong><br><span style="font-size:12px;opacity:.8">You made it off the planet.</span>',
			}
			this.objectiveEl.innerHTML = objectiveText[objectiveKey]
		}
		this._updateLevelHUD()
	}

	_flashDamage() {
		if (!this.damageFlashEl) return

		// Make the screen briefly flash red.
		this.damageFlashEl.style.transition = 'none'
		this.damageFlashEl.style.background = 'rgba(255, 0, 0, 0.4)'

		// Force the browser to apply the red state before fading.
		void this.damageFlashEl.offsetWidth

		this.damageFlashEl.style.transition = 'background 0.3s ease-out'
		this.damageFlashEl.style.background = 'rgba(255, 0, 0, 0)'
	}

	_gameOver(cause = 'pilot') {
		if (this.completed) return

		// A destroyed rover ends the run for its pilot as well, including
		// when the pilot has stepped out. Trigger once, before freezing.
		if (cause === 'rover' && this._radioScriptSet === 2) {
			this.roverHP = 0
			this.playerHP = 0
			this.roverDisabled = true
			this._roverExplosion = new RoverExplosion(this, this.rover.group.position)
			this.rover.group.visible = false
			this.playerRoot.visible = false
			if (this.rover.collider) this.rover.collider.enabled = false
			this._updateLevelHUD()
		}

		this.completed = true
		this.state.status = STATUS.GAME_OVER

		// Stop the rover and player.
		this.keys.clear()
		this.velocity.set(0, 0, 0)
		this.rover.inputEnabled = false
		this.rover.speed = 0

		this.audio?.stopRoverEngine()
		this.audio?.playCrash()
		// The pilot cannot report a loss of signal that already happened.
		this.radio?.stop()

		const time = this.elapsedPlayTime
		const score = 0

		this.state.score = score

		// Brief delay before showing the results screen.
		this._endTimer = setTimeout(() => {
			this.onEnd?.({
				outcome: 'overrun',
				won: false,
				score,
				time,
				hull: 0,
				progress: 0,
				level: 2,
			})
		}, this._roverExplosion ? 2400 : 1000)
	}

	dispose() {
		this.sceneManager.renderer.domElement.removeEventListener(
			'wheel',
			this._onWheel
		)
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
		window.removeEventListener('blur', this._onBlur)
		document.removeEventListener(
			'visibilitychange',
			this._onVisibility
		)
		if (this._endTimer) clearTimeout(this._endTimer)
		for (const timer of this._alienTimers || []) clearTimeout(timer)
		this._roverExplosion?.dispose()
		for (const alien of this.aliens || []) alien.dispose()
		this.pilotWalk?.dispose()
		this.objectiveEl?.remove()
		this.feedbackEl?.remove()
		this.fighterHub?.dispose()
		this.lavaHazards?.dispose?.()
		this.rover?.dispose()
		this.audio?.stopRoverEngine()
		this.audio?.stopAmbience()
		this.radio?.stop()
		this.gameplayColliders.length = 0
		this.stormNotice?.dispose()
		this.hazards?.dispose()
		this.planet?.dispose()
		this.levelHudEl?.remove()
		this.damageFlashEl?.remove()
		super.dispose()
	}
}
