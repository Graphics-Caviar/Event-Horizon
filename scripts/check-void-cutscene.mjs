// Run with: node scripts/bundle-void-cutscene.mjs
// Real level, route, radio and physics modules; only browser/audio IO is faked.
import './void-cutscene-shims.mjs'
import * as THREE from 'three'
import {
	bodyEl,
	fireKey,
	hasListener,
	listenerCount,
} from './void-cutscene-shims.mjs'
import { Game } from '../src/core/Game.js'
import { GameState, STATUS } from '../src/core/GameState.js'
import { Level2 } from '../src/levels/Level2/Level2.js'
import { Hazards } from '../src/levels/Level2/Hazards.js'
import { GravityStorm } from '../src/levels/Level2/GravityStorm.js'
import { Level3 } from '../src/levels/Level3/Level3.js'
import { Level2ToLevel3Cutscene } from '../src/cutscenes/Level2ToLevel3Cutscene.js'
import { CinematicShip } from '../src/cutscenes/CinematicShip.js'
import { CinematicMissileStrike } from '../src/cutscenes/CinematicMissileStrike.js'
import { VoidTransitEnvironment } from '../src/cutscenes/VoidTransitEnvironment.js'
import { RadioDialogue } from '../src/audio/RadioDialogue.js'
import { RADIO_SCRIPTS } from '../src/audio/dialogue/radioScripts.js'
import { SHIPS } from '../src/systems/ShipManager.js'
import { VOID_ASSETS } from '../src/levels/Level3/voidAssets.js'

let checks = 0
let failures = 0
const check = (name, condition, detail = '') => {
	checks++
	if (condition) console.log(`  ok ${name}`)
	else {
		failures++
		console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
	}
}
const originalLog = console.log
console.log = (...args) => {
	if (args[0] !== 'Spawned: ') originalLog(...args)
}
process.on('unhandledRejection', (error) => {
	failures++
	console.error('  FAIL unhandled rejection:', error)
})
const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}
const finite = (values) => values.every(Number.isFinite)

function model() {
	const group = new THREE.Group()
	group.add(
		new THREE.Mesh(
			new THREE.BoxGeometry(1.8, 2.5, 4),
			new THREE.MeshStandardMaterial()
		)
	)
	return group
}

// The Web Audio clock advances independently from frame deltas. The real
// RadioDialogue still owns decoding completion, source lifecycle and cue sync.
function makeAudioClock({ recordings = true } = {}) {
	const clock = { t: 0 }
	const log = []
	const sources = new Set()
	const param = () => ({
		value: 0,
		setValueAtTime(value) {
			this.value = value
		},
		exponentialRampToValueAtTime(value) {
			this.value = value
		},
		linearRampToValueAtTime(value) {
			this.value = value
		},
		setTargetAtTime(value) {
			this.value = value
		},
		cancelScheduledValues() {},
	})
	const node = () => ({
		gain: param(),
		frequency: param(),
		Q: param(),
		connect(target) {
			return target
		},
		disconnect() {},
	})
	const ctx = {
		get currentTime() {
			return clock.t
		},
		state: 'running',
		sampleRate: 24000,
		listener: { setPosition() {}, setOrientation() {} },
		createGain: node,
		createBiquadFilter: node,
		createPanner: () => ({ ...node(), setPosition() {} }),
		createOscillator: () => ({ ...node(), start() {}, stop() {} }),
		createBuffer: (channels, length) => ({
			getChannelData: () => new Float32Array(length),
		}),
		resume: async () => {},
		createBufferSource() {
			const source = {
				...node(),
				buffer: null,
				loop: false,
				onended: null,
				start(when = 0, offset = 0) {
					this.endAt =
						Math.max(when, clock.t) +
						(this.buffer?.duration ?? 0) -
						offset
					sources.add(this)
				},
				stop() {
					sources.delete(this)
					this.onended?.()
				},
			}
			return source
		},
	}
	const audio = new Proxy(
		{
			ctx: recordings ? ctx : null,
			masterGain: node(),
			buses: { dialogue: node() },
			ensureContext: () => (recordings ? ctx : null),
		},
		{
			get(target, key) {
				if (key === 'then' || typeof key === 'symbol')
					return undefined
				if (!(key in target))
					target[key] = (...args) =>
						log.push({
							name: key,
							args,
							at: clock.t,
						})
				return target[key]
			},
		}
	)
	return {
		clock,
		audio,
		log,
		advance(delta) {
			clock.t += delta
			for (const source of [...sources]) {
				if (!source.loop && source.endAt <= clock.t) {
					sources.delete(source)
					source.onended?.()
				}
			}
		},
	}
}

function fixture({
	recordings = false,
	shipKey = 'starfighter',
	assetMode = 'normal',
} = {}) {
	const sound = makeAudioClock({ recordings })
	const radio = new RadioDialogue(sound.audio)
	// Cached stand-ins represent decoded recordings; this makes no network calls.
	radio._loadBuffer = async (url) => {
		const script = Object.values(RADIO_SCRIPTS).find((entry) =>
			url?.endsWith(entry.audio)
		)
		return script ? { duration: script.duration } : null
	}
	const subtitles = []
	const show = radio.subtitles.show.bind(radio.subtitles)
	radio.subtitles.show = (speaker, text, options) => {
		subtitles.push({
			speaker: speaker?.name,
			text,
			at: sound.clock.t,
		})
		show(speaker, text, options)
	}
	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000)
	camera.position.set(0, -134, 26)
	camera.lookAt(0, -140, 0)
	const state = new GameState()
	Object.assign(state, {
		currentLevel: 2,
		surfaceBaseY: -140,
		selectedShip: shipKey,
		playerName: 'CINEMATIC TEST',
	})
	const requests = []
	const pending = []
	const renderer = {
		domElement: document.createElement('canvas'),
		capabilities: { getMaxAnisotropy: () => 1 },
		shadowMap: { enabled: false, type: null },
		toneMapping: THREE.NoToneMapping,
		toneMappingExposure: 1,
	}
	const assets = {
		createStarfield: () => new THREE.Group(),
		getCachedModel: () => null,
		getRawModel: () => null,
		preloadModel: async () => {},
		loadModel: (paths) => {
			requests.push(paths)
			if (assetMode === 'missing')
				return Promise.reject(
					new Error('simulated missing asset')
				)
			if (assetMode === 'pending')
				return new Promise((resolve) =>
					pending.push(resolve)
				)
			return Promise.resolve(model())
		},
	}
	const game = Object.assign(Object.create(Game.prototype), {
		gameState: state,
		audio: sound.audio,
		radio,
		assetManager: assets,
		sceneManager: {
			scene,
			camera,
			renderer,
			addLights() {},
			render() {},
		},
		currentLevel: null,
		_activeLevelNumber: 2,
		backend: null,
		levelScreens: {
			hideAll() {},
			showResults() {
				state.resultsShown = true
			},
			setNote() {},
		},
		menu: { hideAll() {} },
	})
	game._showMenu = () => {
		state.menuShown = true
	}
	let completions = 0
	game._onLevel2ToLevel3Complete = function (level) {
		completions++
		return Game.prototype._onLevel2ToLevel3Complete.call(
			this,
			level
		)
	}
	return {
		...sound,
		game,
		radio,
		scene,
		camera,
		state,
		assets,
		requests,
		pending,
		subtitles,
		get completions() {
			return completions
		},
		dispose() {
			game.currentLevel?.dispose()
			game.menuBackground?.dispose()
			radio.dispose()
		},
	}
}

const completion = {
	outcome: 'transited',
	won: true,
	score: 3333,
	time: 75,
	hull: 90,
	progress: 1,
	level: 2,
}
async function start(options = {}) {
	const f = fixture(options)
	const source = new Level2(f.game, {
		onEnd: (result) => f.game._onLevelEnd(result),
	})
	f.game.currentLevel = source
	await source.rover.ready
	await flush()
	// Exercise the actual success condition but route now, so no wall timer is needed.
	const trigger =
		source.roverApproach?.trigger || source.portal.group.position
	source.playerRoot.position.copy(trigger)
	source._syncPlayerToTerrain()
	if (source.roverApproach)
		source._approachWaypoint =
			source.roverApproach.points.length - 1
	if (options.boarded !== false) {
		const p = trigger
		const y = source.planet.heightAt(p.x, p.z)
		source.rover.group.position.set(p.x, y + 1, p.z)
		source.rover.body.setTranslation(
			{ x: p.x, y: y + 3.4, z: p.z },
			true
		)
		source.rover.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
		source.boarded = source._hasBoarded = true
		source.playerRoot.visible = false
		source.rover.getSeatPosition(source.playerRoot.position)
	}
	source._checkPortalArrival()
	check('boarded final approach completes Level 2', source.completed)
	await f.game._onLevelEnd(completion)
	f.source = source
	f.cut = f.game.currentLevel
	return f
}

async function roverApproach() {
	console.log('\nExtended driving corridor and one-shot approach trigger')
	const f = fixture()
	let completedCallbacks = 0
	const level = new Level2(f.game, { onEnd: () => completedCallbacks++ })
	f.game.currentLevel = level
	await level.rover.ready
	await flush()
	const route = level.roverApproach
	check(
		'fighter hub and parked fleet exist before cinematic entry',
		!level.cinematic &&
			level.fighterHub?.group.parent ===
				level.sceneManager.scene &&
			level.fighterHub.fleet.length === 6 &&
			level.fighterHub.hero.group.visible
	)
	level.portalGuide.update(0.016, level.roverSite)
	const ribbon = level.portalGuide
	const colors = ribbon.lineGeometry.attributes.color
	const midpoint = Math.floor(ribbon._samples / 2) * 2
	check(
		'guide ribbon has independent opaque colours for both edges',
		colors.getW(midpoint) > 0.8 &&
			colors.getW(midpoint + 1) > 0.8 &&
			colors.getX(midpoint) === 1 &&
			colors.getX(midpoint + 1) === 1
	)
	const vertices = ribbon.lineGeometry.attributes.position
	let clearance = Infinity
	for (let i = 0; i < ribbon._samples * 2; i++)
		clearance = Math.min(
			clearance,
			vertices.getY(i) -
				level.planet.heightAt(
					vertices.getX(i),
					vertices.getZ(i)
				)
		)
	check('both guide edges remain above uneven terrain', clearance > 0.4)
	const last = (ribbon._samples - 1) * 2
	check(
		'guide follows route bends all the way to the hub approach',
		Math.abs(
			(vertices.getX(last) + vertices.getX(last + 1)) / 2 -
				level.roverApproach.trigger.x
		) < 0.01 &&
			Math.abs(
				(vertices.getZ(last) +
					vertices.getZ(last + 1)) /
					2 -
					level.roverApproach.trigger.z
			) < 0.01
	)
	const previousRoute = [
		[95, -55],
		[300, 150],
		[235, 340],
		[75, 440],
		[130, 350],
	]
	let previousLength = 0
	for (let i = 1; i < previousRoute.length; i++)
		previousLength += Math.hypot(
			previousRoute[i][0] - previousRoute[i - 1][0],
			previousRoute[i][1] - previousRoute[i - 1][1]
		)
	check(
		'four Level 2 lava regions provide seven distinct pools',
		level.lavaHazards?.areas.length === 4 &&
			level.lavaHazards.zones.length === 7
	)
	const lavaZone = level.lavaHazards.zones[0]
	const lavaPoint = new THREE.Vector3(
		lavaZone.x,
		level.planet.heightAt(lavaZone.x, lavaZone.z),
		lavaZone.z
	)
	let damageFlashes = 0
	const lavaProbe = Object.assign(Object.create(Level2.prototype), {
		completed: false,
		transitionHeld: false,
		cinematic: false,
		lavaHazards: level.lavaHazards,
		combatConfig: {
			lavaDamagePerSecond: 25,
			lavaDamageInterval: 0.8,
		},
		_lavaPlayerCooldown: 0,
		_lavaRoverCooldown: 0,
		playerRoot: { position: lavaPoint.clone() },
		pilotWalk: null,
		_feetScratch: new THREE.Vector3(),
		playerHP: 100,
		roverHP: 100,
		boarded: false,
		rover: { isTouchingLava: () => false },
		_flashDamage() {
			damageFlashes++
		},
		_updateLevelHUD() {},
		_gameOver() {},
	})
	lavaProbe._updateLavaDamage(1 / 60)
	lavaProbe._updateLavaDamage(1 / 60)
	check(
		'lava contact damages the pilot at a configurable interval',
		lavaZone && lavaProbe.playerHP === 80 && damageFlashes === 1
	)
	lavaProbe.boarded = true
	lavaProbe.playerHP = 100
	lavaProbe._lavaRoverCooldown = 0
	lavaProbe.rover.isTouchingLava = (lava) => lava.touches(lavaPoint)
	lavaProbe._updateLavaDamage(1 / 60)
	check(
		'rover tyre contact shares controlled lava damage and feedback',
		lavaProbe.roverHP === 80 && damageFlashes === 2
	)
	check(
		'five configurable encounter zones plan 36 total aliens',
		level.encounterStats?.planned === 36 &&
			level.encounters.length === 5
	)
	if (!route) {
		f.dispose()
		return
	}
	check(
		'fighter hub is separated from portal by over 300 metres',
		route.shipSite.distanceTo(level.portalSite) > 300
	)
	const impactSite = route.trigger
		.clone()
		.add(new THREE.Vector3(-25, 0, -25))
	const beforeImpact = level.planet.heightAt(impactSite.x, impactSite.z)
	level.planet.addImpactCrater(impactSite.x, impactSite.z)
	check(
		'missile crater lowers the actual terrain surface',
		level.planet.heightAt(impactSite.x, impactSite.z) <
			beforeImpact - 1
	)
	let length = 0
	let maxSlope = 0
	let inBounds = true
	let clear = true
	let groundFinite = true
	const extraColliders = level.gameplayColliders.filter(
		(collider) => collider !== level.rover.collider
	)
	for (let i = 1; i < route.points.length; i++) {
		const a = route.points[i - 1]
		const b = route.points[i]
		length += Math.hypot(b.x - a.x, b.z - a.z)
		for (let sample = 0; sample <= 80; sample++) {
			const point = a.clone().lerp(b, sample / 80)
			point.y = level.planet.heightAt(point.x, point.z)
			groundFinite &&= Number.isFinite(point.y)
			maxSlope = Math.max(
				maxSlope,
				level.planet.slopeDegreesAt(point.x, point.z)
			)
			inBounds &&= level.planet.isInsideBounds(
				point.x,
				point.z,
				7
			)
			const resolved = point.clone()
			level.planet.resolveCircleCollisions(
				resolved,
				6.8,
				extraColliders
			)
			clear &&=
				Math.hypot(
					resolved.x - point.x,
					resolved.z - point.z
				) < 0.001
		}
	}
	check(
		'extended playable driving route exceeds 750 metres',
		length > 750,
		`length=${length.toFixed(1)}`
	)
	check(
		'Level 2 route is 2–2.5 times longer on expanded traversable terrain',
		route.points.length >= 8 &&
			level.planet.size === 2400 &&
			length / previousLength >= 2 &&
			length / previousLength <= 2.5,
		`ratio=${(length / previousLength).toFixed(2)}`
	)
	for (let i = 0; i < 4; i++) level._updateEncounters(0.6)
	check(
		'outskirts encounter actually spawns its four configured aliens',
		level.encounters[0].started &&
			level.encounters[0].spawned === 4 &&
			level.aliens.length === 4
	)
	level._approachWaypoint = 3
	for (let i = 0; i < 8; i++) level._updateEncounters(0.6)
	check(
		'later route progress queues a second attack without exceeding eight',
		level.encounters[1].started &&
			level.aliens.filter((alien) => !alien.smashed)
				.length === 8 &&
			level.encounterStats.maxSimultaneous <= 8
	)
	await new Promise((resolve) => setTimeout(resolve, 1300))
	for (const alien of level.aliens) level._trackEncounterAlien(alien)
	const loadedAliens = level.aliens.filter((alien) => alien._loaded)
	const fightCenter = route.points[3]
	level.playerRoot.position.copy(fightCenter)
	loadedAliens.forEach((alien, index) => {
		const angle = (index / loadedAliens.length) * Math.PI * 2
		alien.position.set(
			fightCenter.x + Math.cos(angle) * 14,
			level.planet.heightAt(
				fightCenter.x + Math.cos(angle) * 14,
				fightCenter.z + Math.sin(angle) * 14
			) + (alien.kind === 'flyer' ? 22 : 0),
			fightCenter.z + Math.sin(angle) * 14
		)
		alien.update(1 / 60, level.playerRoot.position)
	})
	check(
		'eight loaded aliens can enter combat simultaneously using existing GLBs',
		loadedAliens.length === 8 &&
			loadedAliens.every((alien) => alien.combatMode)
	)
	check(
		'flyers and brutes retain distinct HP and attack tuning',
		loadedAliens.some(
			(alien) =>
				alien.kind === 'flyer' &&
				alien.hp === 60 &&
				alien.attackDamage * 20 === 10
		) &&
			loadedAliens.some(
				(alien) =>
					alien.type.name === 'launcher' &&
					alien.hp === 180 &&
					alien.attackDamage * 20 === 20 &&
					alien.heavyAttackDamage * 20 === 30
			)
	)
	check(
		'driving corridor has finite continuous ground and gentle slopes',
		groundFinite && maxSlope < 12,
		`peak slope=${maxSlope.toFixed(2)} degrees`
	)
	check(
		'full rover footprint remains inside the existing terrain',
		inBounds
	)
	check(
		'rover corridor is clear of existing environment and gameplay colliders',
		clear
	)
	check(
		'wormhole stays beyond the final approach trigger',
		route.trigger.distanceTo(level.portal.group.position) >
			route.radius + 35
	)
	level.playerRoot.position.copy(route.trigger)
	level.rover.group.position.copy(route.trigger)
	level._checkPortalArrival()
	check(
		'walking into the approach cannot start the rover missile event',
		!level.completed
	)
	level.boarded = level._hasBoarded = true
	level.rover.group.position.copy(level.portal.group.position)
	level._checkPortalArrival()
	check(
		'the old portal-arrival trigger does not bypass the rover escape',
		!level.completed
	)
	level.rover.group.position
		.copy(route.trigger)
		.add(new THREE.Vector3(route.radius + 1, 0, 0))
	level._checkPortalArrival()
	check(
		'driving outside the designated approach does not trigger early',
		!level.completed
	)
	level.rover.group.position.copy(route.trigger)
	level._approachWaypoint = 1
	level._checkPortalArrival()
	check(
		'driving straight to the hub cannot bypass preceding route waypoints',
		!level.completed
	)
	level._approachWaypoint = route.points.length - 1
	level.rover.group.position.copy(route.trigger)
	level._checkPortalArrival()
	const timer = level._endTimer
	level._checkPortalArrival()
	check(
		'boarded approach triggers once and holds the existing rover controls',
		level.completed &&
			level._approachTriggered &&
			level.transitionHeld &&
			!level.rover.inputEnabled &&
			level._endTimer === timer
	)
	f.dispose()
	await new Promise((resolve) => setTimeout(resolve, 300))
	check(
		'approach teardown removes the pending completion and listeners',
		completedCallbacks === 0 && listenerCount('keydown') === 0
	)
}

async function cinematicHazards() {
	console.log('\nExisting gameplay hazards stop at cinematic ownership')
	const f = fixture()
	const level = new Level2(f.game)
	f.game.currentLevel = level
	await level.rover.ready
	await flush()
	const hazards = level.hazards
	check(
		'normal Level 2 gameplay retains the real enabled hazard manager',
		hazards instanceof Hazards &&
			hazards.enabled &&
			hazards.active.length === 0
	)
	const storm = hazards.spawn('gravityStorm')
	check(
		'normal gameplay can create the existing storm cloud and ground ring',
		storm instanceof GravityStorm &&
			storm.group.parent === f.scene &&
			storm.ring.parent === f.scene
	)
	hazards.update(4.01)
	check(
		'an active gameplay storm registers a real gravity modifier',
		GravityStorm.active.includes(storm) &&
			hazards.gravityMultiplierAt(storm.center) ===
				storm.multiplier &&
			storm.multiplier !== 1
	)
	const disposals = new Map()
	for (const resource of storm._disposables) {
		disposals.set(resource, 0)
		resource.addEventListener('dispose', () =>
			disposals.set(resource, disposals.get(resource) + 1)
		)
	}
	level.enterCinematic()
	check(
		'cinematic ownership disables future gameplay hazard rolls',
		!hazards.enabled && level.cinematic && level.transitionHeld
	)
	check(
		'cinematic ownership disposes the active storm through its normal lifecycle',
		hazards.active.length === 0 && storm.done
	)
	check(
		'storm cloud and ground ring leave the departure scene',
		!storm.group.parent && !storm.ring.parent
	)
	check(
		'cinematic departure restores normal gravity and unregisters the old zone',
		!GravityStorm.active.includes(storm) &&
			hazards.gravityMultiplierAt(storm.center) === 1 &&
			hazards.getGravityZones().length === 0
	)
	hazards.rollTimer = 0
	for (let frame = 0; frame < 600; frame++) hazards.update(1 / 60)
	check(
		'continued cinematic ambient updates cannot roll or respawn hazards',
		hazards.rollTimer === 0 &&
			hazards.active.length === 0 &&
			hazards.getGravityZones().length === 0
	)
	level.enterCinematic()
	f.dispose()
	check(
		'repeated cinematic entry and level disposal release storm resources once',
		disposals.size > 0 &&
			[...disposals.values()].every((count) => count === 1)
	)
	check(
		'hazard regression teardown leaves no gravity zones or input listeners',
		GravityStorm.active.length === 0 &&
			listenerCount('keydown') === 0
	)
}

const gameplayTicks = new WeakMap()
const level3Update = Level3.prototype.update
Level3.prototype.update = function (delta) {
	gameplayTicks.set(this, (gameplayTicks.get(this) || 0) + 1)
	return level3Update.call(this, delta)
}

async function drive(
	f,
	{
		fps = 60,
		until = () => f.cut.finished,
		seconds = 180,
		sample = () => {},
	} = {}
) {
	const dt = 1 / fps
	const seen = new Set([f.cut.phase])
	for (let frame = 0; frame < seconds * fps && !until(); frame++) {
		f.advance(dt)
		f.radio.update(dt)
		f.cut.update(dt)
		seen.add(f.cut.phase)
		sample(dt)
		if (frame % 8 === 0) await flush()
	}
	await flush()
	return seen
}

async function fullPath(fps, recordings = false, boarded = true) {
	console.log(
		`\nFull path at ${fps} fps (${recordings ? 'recording clock' : 'missing recording fallback'})`
	)
	const f = await start({ recordings, boarded })
	const { cut, source, game, scene, state, camera } = f
	const selectedShip = state.selectedShip
	check(
		'real route owns the cutscene',
		cut instanceof Level2ToLevel3Cutscene
	)
	check(
		'source input listeners removed',
		!hasListener('keydown', source._onKeyDown)
	)
	check(
		'source world retained for departure',
		cut.level === source &&
			scene.children.includes(source.playerRoot)
	)
	check(
		'escape craft uses the existing anomaly ship',
		cut.ship.craft === 'anomaly' &&
			f.requests.some(
				(request) =>
					JSON.stringify(request) ===
					JSON.stringify(
						VOID_ASSETS.anomalyShip.path
					)
			)
	)
	check(
		'finding an alien ship preserves the player ship selection',
		selectedShip === 'starfighter'
	)
	await game._onLevelEnd(completion)
	check(
		'duplicate completion cannot replace the cutscene',
		game.currentLevel === cut
	)
	let lastPosition = null
	let lastRotation = null
	let maxSpeed = 0
	let peakMotion = ''
	let lastMotionPhase = cut.phase
	let maxTurn = 0
	let badCamera = false
	let prematureGameplay = false
	let inputLeak = false
	let blackNormalFrame = false
	let environmentRevealed = false
	let roverDismounted = false
	let discoveredShip = null
	let discoveryDrift = 0
	let wormholeCrossedBeforeLoad = false
	let earlyLevel3Load = false
	let wormholeVisible = false
	let hullEnteredWormhole = false
	let prematureWormholeCrossing = false
	let runningPrevious = null
	let runningDistance = 0
	let runningMaxSpeed = 0
	let runningPeak = ''
	let groundedRun = true
	let visibleRun = true
	let exitBehindPlane = false
	let exitInFrontOfPlane = false
	let exitGateVisible = false
	let fleetSeen = false
	let rolloverSeen = false
	let pursuitSeen = false
	let launchHullClearance = Infinity
	const seen = await drive(f, {
		fps,
		sample(dt) {
			if (
				[
					'rover_approach',
					'missile_detected',
					'missile_impact',
					'rover_disabled',
					'astronaut_exit',
					'run_to_spacefighter',
					'board_spacefighter',
					'engine_start',
				].includes(cut.phase) &&
				cut.ship?.group?.visible
			) {
				const position = cut.ship.group.position.clone()
				if (!discoveredShip) discoveredShip = position
				discoveryDrift = Math.max(
					discoveryDrift,
					discoveredShip.distanceTo(position)
				)
			}
			fleetSeen ||= cut._fleet?.length === 6
			rolloverSeen ||= cut._rollAge > 1.15
			pursuitSeen ||= (cut._chaseMissiles?.length || 0) >= 2
			if (!cut._skipped && cut.level3) {
				wormholeCrossedBeforeLoad ||=
					cut._wormholeCrossed === true
				earlyLevel3Load ||=
					cut._wormholeCrossed !== true
			}
			if (cut.phase === 'run_to_spacefighter') {
				const position = source.playerRoot.position
				if (runningPrevious) {
					const distance = Math.hypot(
						position.x - runningPrevious.x,
						position.z - runningPrevious.z
					)
					runningDistance += distance
					if (distance / dt > runningMaxSpeed) {
						runningMaxSpeed = distance / dt
						runningPeak = `at ${cut.phaseTime.toFixed(3)}s position=${position.x.toFixed(2)},${position.z.toFixed(2)}`
					}
				}
				runningPrevious = position.clone()
				const floor =
					source.planet.heightAt(
						position.x,
						position.z
					) + (source.pilotWalk?.footOffset || 0)
				groundedRun &&=
					Math.abs(position.y - floor) < 0.15
				visibleRun &&=
					source.playerRoot.visible &&
					!source.boarded
			} else runningPrevious = null
			if (cut.phase === 'wormhole_exit') {
				const distance =
					cut.ship.group.position.z -
					cut._exitCenter.z
				exitBehindPlane ||= distance > 10
				exitInFrontOfPlane ||= distance < -20
				exitGateVisible ||=
					cut.wormhole.group.visible &&
					cut.ship.group.visible
			}
			if (cut.phase === 'takeoff' && cut.ship.group.visible) {
				cut.ship.group.updateMatrixWorld(true)
				const bounds = cut.ship.hullBounds
				for (const x of [bounds.min.x, bounds.max.x])
					for (const y of [
						bounds.min.y,
						bounds.max.y,
					])
						for (const z of [
							bounds.min.z,
							bounds.max.z,
						]) {
							const corner =
								new THREE.Vector3(
									x,
									y,
									z
								).applyMatrix4(
									cut.ship
										.group
										.matrixWorld
								)
							launchHullClearance =
								Math.min(
									launchHullClearance,
									corner.y -
										source.planet.heightAt(
											corner.x,
											corner.z
										)
								)
						}
			}
			if (
				cut.phase === 'wormhole_entry' &&
				cut.wormhole?.group
			) {
				wormholeVisible ||= Boolean(
					cut.wormhole.group.visible &&
					cut.wormhole.group.parent
				)
				if (cut._wormholeCrossed) {
					cut.ship.group.updateMatrixWorld(true)
					const bounds = cut.ship.hullBounds
					let nearSide = -Infinity
					for (const x of [
						bounds.min.x,
						bounds.max.x,
					])
						for (const y of [
							bounds.min.y,
							bounds.max.y,
						])
							for (const z of [
								bounds.min.z,
								bounds.max.z,
							]) {
								const corner =
									new THREE.Vector3(
										x,
										y,
										z
									).applyMatrix4(
										cut
											.ship
											.group
											.matrixWorld
									)
								nearSide =
									Math.max(
										nearSide,
										corner
											.sub(
												cut._entryCenter
											)
											.dot(
												cut._entryNormal
											)
									)
							}
					hullEnteredWormhole ||= nearSide < -0.5
					prematureWormholeCrossing ||=
						nearSide >= -0.5
				}
			}
			if (cut.ship?.group?.parent && cut.ship.group.visible) {
				const position =
					cut.ship.group.getWorldPosition(
						new THREE.Vector3()
					)
				position.sub(
					cut._originShift || new THREE.Vector3()
				)
				const rotation =
					cut.ship.group.getWorldQuaternion(
						new THREE.Quaternion()
					)
				if (lastPosition) {
					const speed =
						lastPosition.distanceTo(
							position
						) / dt
					if (speed > maxSpeed) {
						maxSpeed = speed
						peakMotion = `${lastMotionPhase}->${cut.phase} at ${cut.phaseTime.toFixed(3)}s`
					}
				}
				if (lastRotation)
					maxTurn = Math.max(
						maxTurn,
						lastRotation.angleTo(rotation) /
							dt
					)
				lastPosition = position
				lastRotation = rotation
				lastMotionPhase = cut.phase
			} else {
				// Bounded asset preparation is hidden until the grounded hull is
				// stable. Only rendered movement contributes to the flight limit.
				lastPosition = null
				lastRotation = null
			}
			badCamera ||= !finite([
				...camera.position.toArray(),
				...camera.quaternion.toArray(),
				camera.fov,
			])
			if (cut.level3 && !cut.finished) {
				prematureGameplay ||=
					(gameplayTicks.get(cut.level3) || 0) !==
					0
				for (const key of [
					'KeyW',
					'KeyE',
					'KeyF',
					'KeyV',
				])
					fireKey('keydown', key)
				inputLeak ||= cut.level3.keys.size !== 0
			}
			if (['wormhole_exit', 'arrival'].includes(cut.phase))
				environmentRevealed ||= Boolean(
					cut.environment?.group?.visible &&
					cut.environment.group.parent
				)
			if (cut.phase === 'run_to_spacefighter')
				roverDismounted ||=
					!source.boarded &&
					source.playerRoot.visible
			blackNormalFrame ||=
				!cut._skipped &&
				Number(cut.fadeEl?.style.opacity || 0) > 0.95
		},
	})
	check(
		'cinematic finishes without a blocked loading screen',
		cut.finished
	)
	check('alien hub contains six parked fighters', fleetSeen)
	check('missile strike visibly rolls the disabled rover', rolloverSeen)
	check('multiple missiles pursue the stolen fighter', pursuitSeen)
	for (const phase of [
		'rover_approach',
		'missile_detected',
		'missile_impact',
		'rover_disabled',
		'astronaut_exit',
		'run_to_spacefighter',
		'board_spacefighter',
		'engine_start',
		'takeoff',
		'wormhole_entry',
		'level3_loading',
		'wormhole_exit',
		'arrival',
		'handoff',
	])
		check(`story beat present: ${phase}`, seen.has(phase))
	check(
		'boarding the stolen ship completes without a recovery skip',
		!cut._skipped && seen.has('takeoff')
	)
	check(
		'alien craft stays parked until its engines are started',
		discoveredShip !== null && discoveryDrift < 0.001,
		`drift=${discoveryDrift.toFixed(3)}`
	)
	check(
		'normal journey enters the wormhole before loading Level 3',
		wormholeCrossedBeforeLoad && !earlyLevel3Load
	)
	check(
		'wormhole entry keeps the surface gate aperture visible',
		wormholeVisible
	)
	check(
		'whole ship clears the wormhole before transit is complete',
		hullEnteredWormhole && !prematureWormholeCrossing
	)
	check(
		'astronaut visibly runs a real ground route from the rover',
		visibleRun && groundedRun && runningDistance > 10,
		`distance=${runningDistance.toFixed(2)}`
	)
	check(
		'astronaut run has no position jump or foot sliding from excessive speed',
		runningMaxSpeed > 3 && runningMaxSpeed <= 7.1,
		`peak=${runningMaxSpeed.toFixed(2)} units/s ${runningPeak}`
	)
	check(
		'dimensional arrival keeps the consumed ship hidden',
		!exitGateVisible &&
			cut._wormholeExited &&
			!cut.ship.group.visible
	)
	check(
		'cinematic never overwrites the player ship selection',
		state.selectedShip === selectedShip
	)
	if (boarded)
		check(
			'rover arrival stages a real dismount before boarding',
			roverDismounted
		)
	check(
		'destination environment is revealed during wormhole exit',
		environmentRevealed
	)
	check('normal playback has no black transition', !blackNormalFrame)
	check(
		'ship flight has bounded linear motion',
		maxSpeed < 450,
		`peak=${maxSpeed.toFixed(2)} units/s at ${peakMotion}`
	)
	check(
		'launch keeps the complete pitched hull above the terrain',
		launchHullClearance >= -0.05 &&
			Number.isFinite(launchHullClearance),
		`minimum clearance=${launchHullClearance.toFixed(3)}m`
	)
	check(
		'ship turns smoothly through phase changes',
		maxTurn < 1.25,
		`peak=${maxTurn.toFixed(3)} rad/s`
	)
	check('all camera transforms remain finite', !badCamera)
	check(
		'Level 3 gameplay stays frozen during arrival',
		!prematureGameplay
	)
	check('skip and movement keys cannot reach held gameplay', !inputLeak)
	const level3 = game.currentLevel
	check(
		'actual Level 3 receives ownership',
		level3 instanceof Level3 && cut.level3 === level3
	)
	check('handoff calls back exactly once', f.completions === 1)
	check(
		'run and retry point to Level 3',
		state.currentLevel === 3 &&
			state.status === STATUS.PLAYING &&
			game._activeLevelNumber === 3
	)
	check(
		'five progressive encounters configure 28 unique enemies',
		level3?.aliens?.length === 28
	)
	check(
		'encounter sizes match the intended ramp',
		level3?.encounters
			?.map((encounter) => encounter.enemies.length)
			.join(',') === '4,5,6,6,7'
	)
	check(
		'long route is around 2.1 times its previous length',
		level3?.matterDimension?.routeLength > 934 &&
			level3?.matterDimension?.routeLength < 1168
	)
	check(
		'eight visible lava pools flank the traversal corridor',
		level3?.matterDimension?.lavaZones?.length === 8
	)
	check(
		'Level 3 does not render the Level 2 lava stream',
		!level3?.planet?.lava?.mesh
	)
	check('Level 3 starts with 100 HP', level3?.playerHP === 100)
	check('Level 3 removes the surface wreck', !level3?.wreckRoot.parent)
	check(
		'Level 3 hides and disables the surface rover',
		!level3?.rover.group.visible && level3?.roverDisabled
	)
	check(
		'jetpack, blade and monuments preserved',
		level3?.jetpack && level3?.blade && level3?.monuments
	)
	check(
		'on-foot control restored',
		level3 &&
			!level3.boarded &&
			!level3.transitionHeld &&
			level3.playerRoot.visible
	)
	check(
		'Level 3 has no arrival spacecraft and cinematic ship is disposed',
		!level3?.arrivalShip &&
			cut.ship._disposed &&
			!cut.ship.group.parent
	)
	if (level3) {
		const p = level3.playerRoot.position
		const floor =
			level3.planet.heightAt(p.x, p.z) +
			(level3.pilotWalk?.footOffset || 0)
		check(
			'pilot feet meet existing Level 3 terrain',
			Math.abs(p.y - floor) < 0.15,
			`error=${(p.y - floor).toFixed(3)}`
		)
		check(
			'gameplay input handlers remain available',
			hasListener('keydown', level3._onKeyDown)
		)
		check(
			'gameplay HUD visible',
			level3.objectiveEl.style.display !== 'none' &&
				level3.levelHudEl.style.display !== 'none'
		)
		const before = p.clone()
		fireKey('keydown', 'KeyW')
		level3.update(1 / 60)
		fireKey('keyup', 'KeyW')
		check('movement works after handoff', p.distanceTo(before) > 0)
		check(
			'cinematic ship stays absent after gameplay resumes',
			!cut.ship.group.visible && !cut.ship.group.parent
		)
	}
	cut.skip()
	check(
		'skip after completion cannot hand off twice',
		f.completions === 1
	)
	check(
		'Level 3 ambience starts through existing audio',
		f.log.some(
			(entry) =>
				entry.name === 'startAmbience' &&
				entry.args[0] === 'level3'
		)
	)
	check(
		'dialogue subtitles available without synthetic speech',
		f.subtitles.length > 0
	)
	for (const name of [
		'playMissileWarning',
		'playMissileImpact',
		'playWormholeExit',
	])
		check(
			`${name} fires once at its cinematic event`,
			f.log.filter((entry) => entry.name === name).length ===
				1
		)
	const cueTime = (name) => f.log.find((entry) => entry.name === name)?.at
	check(
		'missile warning, impact, footsteps and wormhole exit follow the scene order',
		cueTime('playMissileWarning') < cueTime('playMissileImpact') &&
			cueTime('playMissileImpact') <
				cueTime('playFootstep') &&
			cueTime('playFootstep') < cueTime('playWormholeExit')
	)
	check(
		'handoff stops cinematic-only sound effects',
		f.log.some((entry) => entry.name === 'stopCinematicEffects')
	)
	f.dispose()
	check(
		'Level 3 teardown keeps the cinematic ship disposed',
		cut.ship._disposed && !cut.ship.group.parent
	)
	check(
		'level teardown removes gameplay key listeners',
		listenerCount('keydown') === 0
	)
	console.log(
		`  motion peak ${maxSpeed.toFixed(2)} units/s at ${peakMotion}, ${maxTurn.toFixed(3)} rad/s`
	)
}

async function skips() {
	const phases = [
		'rover_approach',
		'missile_detected',
		'missile_impact',
		'rover_disabled',
		'astronaut_exit',
		'run_to_spacefighter',
		'board_spacefighter',
		'engine_start',
		'takeoff',
		'wormhole_entry',
		'level3_loading',
		'wormhole_exit',
		'arrival',
		'handoff',
	]
	for (const phase of phases) {
		console.log(`\nSkip at ${phase}`)
		const f = await start()
		await drive(f, {
			until: () => f.cut.phase === phase || f.cut.finished,
		})
		check('requested skip phase reached', f.cut.phase === phase)
		// Simulate a deliberate key press after the accidental-press debounce.
		f.cut._startedAt = performance.now() - 1000
		const skipKey = ['Space', 'Enter', 'Escape'][
			phases.indexOf(phase) % 3
		]
		fireKey('keydown', skipKey)
		check(`${skipKey} invokes the skip path`, f.cut._skipped)
		f.cut.skip()
		await drive(f, { seconds: 30 })
		check(
			'skip still loads existing Level 3 once',
			f.game.currentLevel instanceof Level3 &&
				f.completions === 1
		)
		check(
			'skipped scene fully releases inputs',
			!f.game.currentLevel?.transitionHeld
		)
		check(
			'skip never replays Level 2',
			f.game._activeLevelNumber === 3
		)
		check(
			'skipping preserves the player ship selection',
			f.state.selectedShip === 'starfighter'
		)
		f.dispose()
		check(
			'skip teardown leaves no input listeners',
			listenerCount('keydown') === 0
		)
	}
}

async function failureAndCancellation() {
	console.log('\nConstruction failure returns to menu')
	const f = await start()
	let number = f.state.currentLevel
	Object.defineProperty(f.state, 'currentLevel', {
		get: () => number,
		set(value) {
			if (value === 3)
				throw new Error(
					'simulated Level 3 construction failure'
				)
			number = value
		},
		configurable: true,
	})
	f.cut.skip()
	await drive(f, { seconds: 20 })
	check(
		'failed construction returns to menu',
		f.game.currentLevel === null &&
			f.state.status === STATUS.MENU &&
			f.state.menuShown
	)
	check('partial level instance released', !f.cut.level3)
	check(
		'failure leaves no input listeners',
		listenerCount('keydown') === 0
	)
	f.dispose()

	for (const phase of [
		'missile_detected',
		'run_to_spacefighter',
		'takeoff',
		'wormhole_exit',
		'arrival',
	]) {
		console.log(`\nQuit while ${phase}`)
		const q = await start()
		await drive(q, {
			until: () => q.cut.phase === phase || q.cut.finished,
		})
		q.game._exitLevelToMenu()
		await flush()
		check(
			'quit cancels cinematic without handoff',
			q.cut._disposed && q.completions === 0
		)
		check(
			'quit restores menu',
			q.state.status === STATUS.MENU &&
				q.game.currentLevel === null
		)
		check(
			'quit leaves no key handlers',
			listenerCount('keydown') === 0
		)
		q.dispose()
	}
}

function missileStrike() {
	console.log('\nControlled missile flight and terrain-aware impact')
	const start = new THREE.Vector3(45, 160, 110)
	const impact = new THREE.Vector3(20, 3, -10)
	let referenceDust = null
	for (const fps of [30, 60, 120]) {
		const strike = new CinematicMissileStrike({
			start,
			impact,
			heightAt: (x, z) =>
				3 + Math.sin(x * 0.02) + Math.cos(z * 0.03),
		})
		const scene = new THREE.Scene()
		scene.add(strike.group)
		check(
			`missile begins at its authored sky position (${fps}fps)`,
			strike.missilePosition.distanceTo(start) < 1e-8
		)
		let previousDistance = Infinity
		let approachValid = true
		for (let frame = 0; frame <= fps * 3; frame++) {
			strike.setFlightProgress(frame / (fps * 3))
			const distance =
				strike.missilePosition.distanceTo(impact)
			approachValid &&=
				distance <= previousDistance + 1e-6 &&
				finite([
					...strike.missilePosition.toArray(),
					...strike.missile.quaternion.toArray(),
				])
			previousDistance = distance
		}
		check(
			`missile travels continuously to the ground target (${fps}fps)`,
			approachValid && previousDistance < 1e-8
		)
		check(
			`missile impact fires only once (${fps}fps)`,
			strike.impact() === true && strike.impact() === false
		)
		check(
			`impact replaces the missile with dust and shockwave (${fps}fps)`,
			!strike.missile.visible &&
				strike.dust.points.visible &&
				strike.shockwave.visible
		)
		for (let frame = 0; frame < fps; frame++) strike.update(1 / fps)
		const dust = [...strike.dust.geometry.attributes.position.array]
		if (!referenceDust) referenceDust = dust
		check(
			`impact particles are deterministic across frame rates (${fps}fps)`,
			dust.every(
				(value, i) =>
					Number.isFinite(value) &&
					Math.abs(value - referenceDust[i]) <
						1e-4
			)
		)
		let particlesAboveTerrain = true
		for (let i = 0; i < dust.length; i += 3) {
			const floor =
				3 +
				Math.sin(dust[i] * 0.02) +
				Math.cos(dust[i + 2] * 0.03)
			particlesAboveTerrain &&= dust[i + 1] >= floor
		}
		check(
			`impact dust follows the existing terrain floor (${fps}fps)`,
			particlesAboveTerrain
		)
		strike.update(10)
		check(
			`impact visuals stop drawing after their bounded lifetime (${fps}fps)`,
			!strike.dust.points.visible &&
				!strike.debris.visible &&
				!strike.shockwave.visible &&
				!strike.trail.points.visible
		)
		const disposals = new Map()
		for (const resource of strike._owned) {
			disposals.set(resource, 0)
			resource.addEventListener('dispose', () =>
				disposals.set(
					resource,
					disposals.get(resource) + 1
				)
			)
		}
		strike.dispose()
		strike.dispose()
		strike.setFlightProgress(0.5)
		strike.update(1)
		check(
			`missile cleanup is idempotent and cannot resurrect visuals (${fps}fps)`,
			!strike.group.parent &&
				strike.group.children.length === 0 &&
				strike.impact() === false &&
				[...disposals.values()].every(
					(count) => count === 1
				)
		)
	}
	check(
		'missile choreography preserves its input positions',
		start.equals(new THREE.Vector3(45, 160, 110)) &&
			impact.equals(new THREE.Vector3(20, 3, -10))
	)
}

async function assetLifecycles() {
	console.log('\nSelected ship and late asset lifecycle')
	for (const key of Object.keys(SHIPS)) {
		let requested
		const ship = new CinematicShip({
			shipKey: key,
			assetManager: {
				loadModel: async (path) => {
					requested = path
					return model()
				},
			},
		})
		await ship.ready
		check(
			`${key} reuses its manifest model`,
			JSON.stringify(requested) ===
				JSON.stringify(SHIPS[key].model) &&
				ship.loaded &&
				ship.craft === 'selected'
		)
		ship.dispose()
	}
	console.log('\nAlien escape craft model and shared-resource lifecycle')
	const sharedHull = model()
	let sharedDisposals = 0
	sharedHull.traverse((node) => {
		if (!node.isMesh) return
		node.geometry.addEventListener(
			'dispose',
			() => sharedDisposals++
		)
		node.material.addEventListener(
			'dispose',
			() => sharedDisposals++
		)
	})
	const alienRequests = []
	const alien = new CinematicShip({
		craft: 'anomaly',
		shipKey: 'aegis',
		assetManager: {
			preloadModel: async () => {},
			getRawModel: () => null,
			loadModel: async (path) => {
				alienRequests.push(path)
				return sharedHull
			},
		},
	})
	alien.group.position.set(200, 300, -400)
	await alien.ready
	check(
		'alien craft loads the shared anomaly manifest instead of selected craft',
		alien.craft === 'anomaly' &&
			alien.loaded &&
			alienRequests.length === 1 &&
			alienRequests[0] === VOID_ASSETS.anomalyShip.path
	)
	const alienSize = alien.hullBounds.getSize(new THREE.Vector3())
	check(
		'alien hull is fitted and measured in local coordinates',
		finite([...alienSize.toArray(), alien.hullBottom]) &&
			Math.max(...alienSize.toArray()) > 10 &&
			Math.max(...alienSize.toArray()) <= 30 &&
			alien.hullBounds
				.getCenter(new THREE.Vector3())
				.length() < 0.001
	)
	check(
		'alien boarding point stays outside the measured hull',
		alien.hatchLocal.x > alien.hullBounds.max.x &&
			alien.hatchLocal.y >= alien.hullBottom
	)
	alien.dispose()
	check(
		'alien craft teardown preserves AssetManager shared GLB resources',
		sharedDisposals === 0
	)
	for (const cancel of ['dispose', 'lockAppearance']) {
		let resolveAlien
		const lateAlien = new CinematicShip({
			craft: 'anomaly',
			assetManager: {
				preloadModel: async () => {},
				getRawModel: () => null,
				loadModel: () =>
					new Promise((resolve) => {
						resolveAlien = resolve
					}),
			},
		})
		await flush()
		lateAlien[cancel]()
		const children = lateAlien.modelRoot.children.length
		resolveAlien(model())
		await lateAlien.ready
		check(
			`late alien model cannot change the craft after ${cancel}`,
			!lateAlien.loaded &&
				lateAlien.modelRoot.children.length === children
		)
		lateAlien.dispose()
	}
	let resolveShip
	const lateShip = new CinematicShip({
		assetManager: {
			loadModel: () =>
				new Promise((resolve) => {
					resolveShip = resolve
				}),
		},
	})
	lateShip.dispose()
	resolveShip(model())
	await lateShip.ready
	check(
		'late ship cannot resurrect a disposed cutscene',
		lateShip.group.children.length === 0 && !lateShip.loaded
	)
	const missing = new CinematicShip({
		assetManager: {
			loadModel: async () => {
				throw new Error('simulated missing ship')
			},
		},
	})
	await missing.ready
	check(
		'missing model retains a visible fallback',
		!missing.loaded && missing.modelRoot.children.length > 0
	)
	missing.dispose()
	let resolveMonument
	const environment = new VoidTransitEnvironment({
		assetManager: {
			preloadModel: async () => {},
			getRawModel: () => null,
			loadModel: () =>
				new Promise((resolve) => {
					resolveMonument = resolve
				}),
		},
	})
	await flush()
	environment.dispose()
	resolveMonument?.(model())
	await environment.ready
	check(
		'late monument cannot attach to a disposed environment',
		environment.group.children.length === 0
	)

	console.log('\nBounded loading with unresolved assets')
	const f = await start({ assetMode: 'pending' })
	f.cut.skip()
	await drive(f, { seconds: 25 })
	check(
		'pending downloads cannot trap skip on black',
		f.cut.finished && f.game.currentLevel instanceof Level3
	)
	f.dispose()
	for (const resolve of f.pending) resolve(model())
	await flush()
	check(
		'late level loads leave no gameplay input listeners',
		listenerCount('keydown') === 0
	)
}

async function failedLevelDoesNotTransit() {
	console.log('\nFailure path retains existing results flow')
	const f = fixture()
	const level = new Level2(f.game)
	f.game.currentLevel = level
	await f.game._onLevelEnd({
		...completion,
		won: false,
		outcome: 'overrun',
	})
	check(
		'losing Level 2 never starts a cinematic',
		f.game.currentLevel === level && f.state.resultsShown
	)
	f.dispose()
}

async function persistenceAndAudioClock() {
	console.log('\nCompletion snapshot and recording clock')
	const f = fixture({ recordings: true })
	const submissions = []
	f.game.backend = {
		status: () => ({ ready: true, signedIn: true }),
		submitRun: async (snapshot, options) => {
			submissions.push({ snapshot, options })
			return 'test-run'
		},
	}
	const level = new Level2(f.game)
	f.game.currentLevel = level
	await level.rover.ready
	await f.game._onLevelEnd(completion)
	await f.game._onLevelEnd(completion)
	check(
		'duplicate success saves exactly one run',
		submissions.length === 1
	)
	f.game.gameState.currentLevel = 3
	check(
		'saved snapshot remains a completed Level 2 run',
		submissions[0]?.snapshot.currentLevel === 2 &&
			submissions[0]?.snapshot.score === completion.score &&
			submissions[0]?.options.completed
	)
	f.dispose()

	const r = fixture({ recordings: true })
	r.radio.beginLevel(2)
	check(
		'recorded transit conversation accepted',
		r.radio.play('l2.transit')
	)
	await flush()
	r.radio.update(60)
	check(
		'frame deltas cannot advance a stationary recording clock',
		r.radio.playbackTime === 0
	)
	r.advance(5)
	r.radio.update(1 / 120)
	check(
		'subtitles follow the recording clock',
		Math.abs(r.radio.playbackTime - 5) < 0.001 &&
			r.subtitles.length > 0
	)
	r.radio.setPaused(true)
	r.advance(3)
	r.radio.update(3)
	check(
		'paused recording retains its playback position',
		Math.abs(r.radio.playbackTime - 5) < 0.001
	)
	r.radio.setPaused(false)
	r.advance(1)
	r.radio.update(1 / 60)
	check(
		'resuming recording preserves the offset',
		Math.abs(r.radio.playbackTime - 6) < 0.001
	)
	r.dispose()
}

const baselineChildren = bodyEl.children.length
try {
	await failedLevelDoesNotTransit()
	await persistenceAndAudioClock()
	await roverApproach()
	await cinematicHazards()
	missileStrike()
	await fullPath(30)
	await fullPath(60, true)
	await fullPath(120, false, true)
	await skips()
	await failureAndCancellation()
	await assetLifecycles()
	check(
		'no cinematic overlays remain after tests',
		bodyEl.children.length === baselineChildren
	)
} catch (error) {
	failures++
	console.error('Harness stopped:', error.stack || error)
}
console.log(`\n${checks - failures}/${checks} void cutscene checks passed`)
if (failures) process.exitCode = 1
