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
import { Level3 } from '../src/levels/Level3/Level3.js'
import { Level2ToLevel3Cutscene } from '../src/cutscenes/Level2ToLevel3Cutscene.js'
import { CinematicShip } from '../src/cutscenes/CinematicShip.js'
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
		sceneManager: { scene, camera, addLights() {}, render() {} },
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
	source.playerRoot.position.copy(source.portal.group.position)
	source._syncPlayerToTerrain()
	if (options.boarded) {
		const p = source.portal.group.position
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
	check('portal arrival completes Level 2', source.completed)
	await f.game._onLevelEnd(completion)
	f.source = source
	f.cut = f.game.currentLevel
	return f
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

async function fullPath(fps, recordings = false, boarded = false) {
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
	const seen = await drive(f, {
		fps,
		sample(dt) {
			if (cut.phase === 'discovery' && cut.ship?.group) {
				const position = cut.ship.group.position.clone()
				if (!discoveredShip) discoveredShip = position
				discoveryDrift = Math.max(
					discoveryDrift,
					discoveredShip.distanceTo(position)
				)
			}
			if (!cut._skipped && cut.level3) {
				wormholeCrossedBeforeLoad ||=
					cut._wormholeCrossed === true
				earlyLevel3Load ||=
					cut._wormholeCrossed !== true
			}
			if (cut.phase === 'wormhole' && cut.wormhole?.group) {
				wormholeVisible ||= Boolean(
					cut.wormhole.group.visible &&
					cut.wormhole.group.parent
				)
				const ship = cut.ship.group.getWorldPosition(
					new THREE.Vector3()
				)
				const aperture =
					cut.wormhole.group.getWorldPosition(
						new THREE.Vector3()
					)
				if (cut._wormholeCrossed) {
					hullEnteredWormhole ||=
						ship.z < aperture.z - 18
					prematureWormholeCrossing ||=
						ship.z >= aperture.z - 18
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
			if (
				['reveal', 'interference', 'presence'].includes(
					cut.phase
				)
			)
				environmentRevealed ||= Boolean(
					cut.environment?.group?.visible &&
					cut.environment.group.parent
				)
			if (cut.phase === 'boarding')
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
	for (const phase of [
		'victory',
		'discovery',
		'boarding',
		'ascent',
		'signal',
		'reveal',
		'interference',
		'presence',
		'approach',
		'wormhole',
		'arrival',
		'disembark',
		'handoff',
	])
		check(`story beat present: ${phase}`, seen.has(phase))
	check(
		'boarding the stolen ship completes without a recovery skip',
		!cut._skipped && seen.has('ascent')
	)
	check(
		'alien craft stays parked throughout its discovery',
		discoveredShip !== null && discoveryDrift < 0.001,
		`drift=${discoveryDrift.toFixed(3)}`
	)
	check(
		'normal journey enters the wormhole before loading Level 3',
		wormholeCrossedBeforeLoad && !earlyLevel3Load
	)
	check(
		'wormhole entry shows a dedicated aperture in space',
		wormholeVisible
	)
	check(
		'whole ship clears the wormhole before transit is complete',
		hullEnteredWormhole && !prematureWormholeCrossing
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
		'megastructure appears before the landing approach',
		environmentRevealed
	)
	check('normal playback has no black transition', !blackNormalFrame)
	check(
		'ship flight has bounded linear motion',
		maxSpeed < 450,
		`peak=${maxSpeed.toFixed(2)} units/s at ${peakMotion}`
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
		'existing nine-enemy roster preserved',
		level3?.aliens?.length === 9
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
		'Level 3 retains the same landed alien ship without a clone',
		level3?.arrivalShip === cut.ship &&
			!cut.ship._disposed &&
			Boolean(cut.ship.group.parent)
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
		const parkedShip = cut.ship.group.position.clone()
		fireKey('keydown', 'KeyW')
		level3.update(1 / 60)
		fireKey('keyup', 'KeyW')
		check('movement works after handoff', p.distanceTo(before) > 0)
		check(
			'alien ship remains parked after on-foot gameplay resumes',
			cut.ship.group.position.distanceTo(parkedShip) < 0.001
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
	f.dispose()
	check(
		'Level 3 teardown releases its adopted alien ship',
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
	for (const phase of [
		'victory',
		'discovery',
		'boarding',
		'signal',
		'presence',
		'wormhole',
		'arrival',
		'disembark',
		'handoff',
	]) {
		console.log(`\nSkip at ${phase}`)
		const f = await start()
		await drive(f, {
			until: () => f.cut.phase === phase || f.cut.finished,
		})
		check('requested skip phase reached', f.cut.phase === phase)
		// Simulate a deliberate key press after the accidental-press debounce.
		f.cut._startedAt = performance.now() - 1000
		const skipKey = ['Space', 'Enter', 'Escape'][
			[
				'victory',
				'discovery',
				'boarding',
				'signal',
				'presence',
				'wormhole',
				'arrival',
				'disembark',
				'handoff',
			].indexOf(phase) % 3
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

	for (const phase of ['ascent', 'reveal', 'arrival']) {
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
