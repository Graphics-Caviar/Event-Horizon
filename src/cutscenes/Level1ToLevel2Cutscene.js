import * as THREE from 'three'
import { clearScene } from '../core/Level.js'
import { CHARACTERS } from '../systems/CharacterManager.js'
import { SHIPS } from '../systems/ShipManager.js'
import { MODEL_YAW } from '../levels/Level1/Spaceship.js'
import { alienTerrainHeight } from '../levels/Level2/AlienPlanet.js'
import { ComicCutsceneRenderer } from './ComicCutsceneRenderer.js'

const SKIP_HINT = 'SPACE / ENTER / ESC  —  SKIP'
const MODEL_WAIT_MS = 6000
const PLANET_RADIUS = 650
const MALFUNCTION_MIN_SECONDS = 5.2
const MALFUNCTION_RAMP_SECONDS = 5.8
const MALFUNCTION_FALLBACK_SECONDS = 9.5
const EJECTION_SURFACE_DISTANCE = 650
const EJECTION_FALLBACK_DISTANCE = 1280
const PLANET_POV_CUT_SECONDS = 1.8
const clamp01 = (value) => Math.min(1, Math.max(0, value))
const smooth = (value) => {
	const t = clamp01(value)
	return t * t * (3 - 2 * t)
}

const PHASE = Object.freeze({
	APPROACH: 'approach',
	MALFUNCTION: 'malfunction',
	EJECTION: 'ejection',
	FREE_FALL: 'free_fall',
	PARACHUTE: 'parachute',
	SHIP_ENTRY: 'ship_entry',
	CRASH: 'crash',
	ALARM: 'alarm',
	LANDING: 'landing',
	REVEAL: 'reveal',
})

const CAMERA_MODE = Object.freeze({
	SHIP_FOLLOW: 'ship_follow',
	SURFACE_SKY: 'surface_sky',
	SURFACE_PILOT: 'surface_pilot',
	SURFACE_CRASH: 'surface_crash',
	REVEAL: 'reveal',
})

const PHASE_DURATION = Object.freeze({
	[PHASE.APPROACH]: 7.5,
	[PHASE.MALFUNCTION]: MALFUNCTION_FALLBACK_SECONDS,
	[PHASE.EJECTION]: 1.4,
	[PHASE.FREE_FALL]: 3.4,
	[PHASE.PARACHUTE]: 3.6,
	[PHASE.CRASH]: 2.4,
	[PHASE.ALARM]: 2.2,
	[PHASE.REVEAL]: 3.2,
})

function vectorFrom(value, fallback) {
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

function quaternionFrom(value, fallback = new THREE.Quaternion()) {
	if (value?.isQuaternion) return value.clone()
	if (
		value &&
		Number.isFinite(value.x) &&
		Number.isFinite(value.y) &&
		Number.isFinite(value.z) &&
		Number.isFinite(value.w)
	) {
		return new THREE.Quaternion(value.x, value.y, value.z, value.w)
	}
	return fallback.clone()
}

/**
 * Level 1 -> Level 2 cinematic.
 *
 * Unlike the earlier timeline prototype, actor positions are never authored
 * per shot. The ship inherits Level 1 position/quaternion/velocity and then
 * integrates velocity + acceleration every frame. The pilot receives an
 * ejection impulse and becomes an independent physics actor. Camera shots
 * move around those actors; they do not move the actors into shot positions.
 */
export class Level1ToLevel2Cutscene {
	constructor(game, { handoff = {}, onComplete } = {}) {
		this.game = game
		this.sceneManager = game.sceneManager
		this.assetManager = game.assetManager
		this.onComplete = onComplete || (() => {})
		this.handoff = handoff || {}
		this.finished = false
		this._disposed = false
		this.ready = false
		this.elapsed = 0
		this.phase = PHASE.APPROACH
		this.phaseTime = 0
		this.ejected = false
		this.parachuteOpen = 0
		this.shipCrashed = false
		this.pilotLanded = false
		this.alarmTriggered = false
		this._alarmBeepIn = 0
		this.cameraMode = null
		this._startedAt = performance.now()

		const scene = this.sceneManager.scene
		const camera = this.sceneManager.camera
		this._base = {
			fov: camera.fov,
			near: camera.near,
			far: camera.far,
			renderPipeline: this.sceneManager.renderPipeline,
			background: scene.background,
			fog: scene.fog,
		}

		clearScene(scene)
		scene.background = new THREE.Color(0x071126)
		scene.fog = new THREE.FogExp2(0x11162a, 0.00012)

		this._initTrajectory()
		this._buildSpaceEnvironment()
		this._buildPlanet()
		this._buildLandingEnvironment()
		this._buildActors()
		this._buildParachute()
		this._buildCrashEffects()
		this._buildOverlays()
		this._setupCamera()
		this.comicRenderer = new ComicCutsceneRenderer(
			this.sceneManager.renderer
		)
		this.sceneManager.setRenderPipeline(this.comicRenderer)

		this._onKeyDown = (event) => {
			if (!['Escape', 'Space', 'Enter'].includes(event.code))
				return
			if (
				event.repeat ||
				performance.now() - this._startedAt < 800
			)
				return
			event.preventDefault()
			this.skip()
		}
		window.addEventListener('keydown', this._onKeyDown)

		console.info('[Cutscene] Loading selected ship and pilot...')
		this._loadModels().finally(() => {
			if (this._disposed) return
			this.ready = true
			this.skipEl.textContent = SKIP_HINT
			console.info(
				'[Cutscene] Playing continuous Level 1 -> Level 2 transition.'
			)
		})
	}

	_initTrajectory() {
		const defaultStart = new THREE.Vector3(0, 40, 5000)
		this.shipPosition = vectorFrom(
			this.handoff.position,
			defaultStart
		)
		this.shipQuaternion = quaternionFrom(this.handoff.quaternion)

		const quaternionForward = new THREE.Vector3(0, 0, -1)
			.applyQuaternion(this.shipQuaternion)
			.normalize()
		this.shipVelocity = vectorFrom(
			this.handoff.velocity,
			quaternionForward.clone().multiplyScalar(95)
		)
		if (this.shipVelocity.lengthSq() < 35 * 35) {
			this.shipVelocity
				.copy(quaternionForward)
				.multiplyScalar(85)
		}

		this.flightForward = this.shipVelocity.clone().normalize()
		let referenceUp = new THREE.Vector3(0, 1, 0)
		if (Math.abs(this.flightForward.dot(referenceUp)) > 0.92) {
			referenceUp = new THREE.Vector3(0, 0, 1)
		}
		this.flightRight = referenceUp
			.clone()
			.cross(this.flightForward)
			.normalize()
		this.flightUp = this.flightForward
			.clone()
			.cross(this.flightRight)
			.normalize()

		this.surfaceBaseY = this.shipPosition.y - 175
		this.terrainCenter = this.shipPosition
			.clone()
			.addScaledVector(this.flightForward, 1710)
		this.terrainCenter.y = this.surfaceBaseY

		this.landingPoint = this.shipPosition
			.clone()
			.addScaledVector(this.flightForward, 1580)
			.addScaledVector(this.flightRight, -105)
		this.landingPoint.y = alienTerrainHeight(
			this.landingPoint.x,
			this.landingPoint.z,
			this.surfaceBaseY
		)

		this.crashGuidePoint = this.shipPosition
			.clone()
			.addScaledVector(this.flightForward, 1810)
			.addScaledVector(this.flightRight, 100)
		this.crashGuidePoint.y = alienTerrainHeight(
			this.crashGuidePoint.x,
			this.crashGuidePoint.z,
			this.surfaceBaseY
		)
		this.crashSite = this.crashGuidePoint.clone()

		this.planetCenter = this.shipPosition
			.clone()
			.addScaledVector(this.flightForward, 2650)
			.addScaledVector(this.flightUp, -700)

		this.shipAngularVelocity = new THREE.Vector3()
		this.pilotPosition = this.shipPosition.clone()
		this.pilotVelocity = new THREE.Vector3()
		this.pilotAngularVelocity = new THREE.Vector3()
	}

	_buildSpaceEnvironment() {
		const scene = this.sceneManager.scene
		scene.add(new THREE.AmbientLight(0x8297c8, 0.9))
		this.skyFill = new THREE.HemisphereLight(
			0xa7c8ff,
			0x441923,
			1.15
		)
		scene.add(this.skyFill)
		this.sun = new THREE.DirectionalLight(0xffcf9e, 2.35)
		this.sun.position.copy(
			this.shipPosition
				.clone()
				.addScaledVector(this.flightRight, -350)
				.addScaledVector(this.flightUp, 450)
		)
		scene.add(this.sun)

		const geometry = new THREE.BufferGeometry()
		const points = []
		for (let i = 0; i < 1900; i++) {
			const x =
				this.shipPosition.x +
				(Math.random() - 0.5) * 3600
			const y =
				this.shipPosition.y +
				(Math.random() - 0.5) * 2200
			const z =
				this.shipPosition.z +
				(Math.random() - 0.5) * 4200
			points.push(x, y, z)
		}
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(points, 3)
		)
		this.stars = new THREE.Points(
			geometry,
			new THREE.PointsMaterial({
				color: 0xdbe8ff,
				size: 1.4,
				sizeAttenuation: true,
			})
		)
		scene.add(this.stars)
	}

	_buildPlanet() {
		const scene = this.sceneManager.scene
		this.planet = new THREE.Mesh(
			new THREE.SphereGeometry(PLANET_RADIUS, 64, 40),
			new THREE.MeshStandardMaterial({
				color: 0x4b171d,
				roughness: 1,
			})
		)
		this.planet.position.copy(this.planetCenter)
		scene.add(this.planet)

		this.planetAtmosphere = new THREE.Mesh(
			new THREE.SphereGeometry(PLANET_RADIUS + 25, 64, 40),
			new THREE.MeshBasicMaterial({
				color: 0xc25057,
				transparent: true,
				opacity: 0.2,
				side: THREE.BackSide,
			})
		)
		this.planetAtmosphere.position.copy(this.planetCenter)
		scene.add(this.planetAtmosphere)

		this.planetLight = new THREE.PointLight(0xff7554, 4.6, 2100)
		this.planetLight.position.copy(
			this.planetCenter
				.clone()
				.addScaledVector(this.flightUp, 520)
		)
		scene.add(this.planetLight)
	}

	_buildLandingEnvironment() {
		this.terrainRoot = new THREE.Group()
		this.terrainRoot.name = 'cutscene-level2-terrain'
		this.terrainRoot.visible = false
		this.sceneManager.scene.add(this.terrainRoot)

		const size = 2300
		const geometry = new THREE.PlaneGeometry(size, size, 120, 120)
		const position = geometry.attributes.position
		for (let i = 0; i < position.count; i++) {
			const localX = position.getX(i)
			const localY = position.getY(i)
			const worldX = this.terrainCenter.x + localX
			const worldZ = this.terrainCenter.z - localY
			position.setZ(
				i,
				alienTerrainHeight(
					worldX,
					worldZ,
					this.surfaceBaseY
				) - this.surfaceBaseY
			)
		}
		geometry.rotateX(-Math.PI / 2)
		geometry.computeVertexNormals()
		this.terrain = new THREE.Mesh(
			geometry,
			new THREE.MeshStandardMaterial({
				color: 0x7a302b,
				roughness: 0.94,
			})
		)
		this.terrain.position.set(
			this.terrainCenter.x,
			this.surfaceBaseY,
			this.terrainCenter.z
		)
		this.terrainRoot.add(this.terrain)

		const rockGeometry = new THREE.DodecahedronGeometry(1, 0)
		const rockMaterial = new THREE.MeshStandardMaterial({
			color: 0x3c252d,
			roughness: 0.96,
		})
		for (let i = 0; i < 65; i++) {
			const x =
				this.terrainCenter.x +
				(Math.random() - 0.5) * 900
			const z =
				this.terrainCenter.z +
				(Math.random() - 0.5) * 900
			const rock = new THREE.Mesh(rockGeometry, rockMaterial)
			rock.position.set(
				x,
				alienTerrainHeight(x, z, this.surfaceBaseY) +
					0.5,
				z
			)
			rock.scale.set(
				1 + Math.random() * 4,
				0.7 + Math.random() * 3,
				1 + Math.random() * 4
			)
			rock.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			)
			this.terrainRoot.add(rock)
		}

		const plantMaterial = new THREE.MeshBasicMaterial({
			color: 0x6df2ff,
		})
		const plantGeometry = new THREE.SphereGeometry(0.7, 10, 8)
		for (let i = 0; i < 38; i++) {
			const x =
				this.terrainCenter.x +
				(Math.random() - 0.5) * 750
			const z =
				this.terrainCenter.z +
				(Math.random() - 0.5) * 750
			const plant = new THREE.Mesh(
				plantGeometry,
				plantMaterial
			)
			plant.position.set(
				x,
				alienTerrainHeight(x, z, this.surfaceBaseY) +
					1 +
					Math.random() * 2,
				z
			)
			plant.scale.y = 1.4 + Math.random() * 2.8
			this.terrainRoot.add(plant)
		}
	}

	_buildActors() {
		const scene = this.sceneManager.scene
		this.shipRoot = new THREE.Group()
		this.shipRoot.name = 'cinematic-ship'
		this.shipRoot.position.copy(this.shipPosition)
		this.shipRoot.quaternion.copy(this.shipQuaternion)
		this.shipModelRoot = new THREE.Group()
		this.shipRoot.add(this.shipModelRoot)
		scene.add(this.shipRoot)

		this.engineRoot = new THREE.Group()
		this.engineRoot.position.set(0, 0, 8.5)
		this.shipRoot.add(this.engineRoot)
		this.engineFlame = new THREE.Mesh(
			new THREE.ConeGeometry(1.1, 6.5, 12),
			new THREE.MeshBasicMaterial({
				color: 0x71d9ff,
				transparent: true,
				opacity: 0.8,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this.engineFlame.rotation.x = Math.PI / 2
		this.engineFlame.position.z = 2.5
		this.engineRoot.add(this.engineFlame)
		this.engineLight = new THREE.PointLight(0x6fdcff, 4, 55, 2)
		this.engineRoot.add(this.engineLight)

		this.entryGlow = new THREE.Mesh(
			new THREE.SphereGeometry(9, 18, 12),
			new THREE.MeshBasicMaterial({
				color: 0xff7b42,
				transparent: true,
				opacity: 0,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this.shipRoot.add(this.entryGlow)

		this.trailCount = 34
		this.trailPositions = new Float32Array(this.trailCount * 3)
		for (let i = 0; i < this.trailCount; i++) {
			this.trailPositions[i * 3] = this.shipPosition.x
			this.trailPositions[i * 3 + 1] = this.shipPosition.y
			this.trailPositions[i * 3 + 2] = this.shipPosition.z
		}
		this.trailGeometry = new THREE.BufferGeometry()
		this.trailGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this.trailPositions, 3)
		)
		this.damageTrail = new THREE.Points(
			this.trailGeometry,
			new THREE.PointsMaterial({
				color: 0x8e8588,
				size: 7,
				transparent: true,
				opacity: 0,
				depthWrite: false,
			})
		)
		scene.add(this.damageTrail)

		this.pilotRoot = new THREE.Group()
		this.pilotRoot.name = 'cinematic-pilot'
		this.pilotModelRoot = new THREE.Group()
		this.pilotRoot.add(this.pilotModelRoot)
		this.pilotRoot.visible = false
		scene.add(this.pilotRoot)
	}

	_buildParachute() {
		this.parachute = new THREE.Group()
		this.parachute.name = 'procedural-parachute'
		this.parachute.visible = false
		this.pilotRoot.add(this.parachute)

		this.canopy = new THREE.Mesh(
			new THREE.SphereGeometry(
				4.8,
				32,
				16,
				0,
				Math.PI * 2,
				0,
				Math.PI / 2
			),
			new THREE.MeshStandardMaterial({
				color: 0xe6dfcf,
				roughness: 0.9,
				side: THREE.DoubleSide,
			})
		)
		this.canopy.rotation.x = Math.PI
		this.canopy.position.y = 7.2
		this.canopy.scale.set(1.45, 0.72, 1.05)
		this.parachute.add(this.canopy)

		const linePositions = []
		for (const [x, z] of [
			[-3.7, -2.2],
			[3.7, -2.2],
			[-3.7, 2.2],
			[3.7, 2.2],
		]) {
			linePositions.push(x, 6.5, z, x * 0.12, 1.0, z * 0.12)
		}
		const lineGeometry = new THREE.BufferGeometry()
		lineGeometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(linePositions, 3)
		)
		this.parachute.add(
			new THREE.LineSegments(
				lineGeometry,
				new THREE.LineBasicMaterial({ color: 0xf5eee3 })
			)
		)
		this.parachute.scale.setScalar(0.001)
	}

	_buildCrashEffects() {
		this.crashRoot = new THREE.Group()
		this.crashRoot.visible = false
		this.sceneManager.scene.add(this.crashRoot)

		this.crashLight = new THREE.PointLight(0xff491c, 0, 150)
		this.crashRoot.add(this.crashLight)
		this.crashFire = new THREE.Mesh(
			new THREE.SphereGeometry(3, 18, 12),
			new THREE.MeshBasicMaterial({
				color: 0xff5a20,
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this.crashRoot.add(this.crashFire)
		this.crashSmoke = new THREE.Mesh(
			new THREE.SphereGeometry(4, 14, 10),
			new THREE.MeshBasicMaterial({
				color: 0x281f25,
				transparent: true,
				opacity: 0.5,
				depthWrite: false,
			})
		)
		this.crashSmoke.position.y = 6
		this.crashRoot.add(this.crashSmoke)
		this.crashRing = new THREE.Mesh(
			new THREE.RingGeometry(1.5, 2.2, 40),
			new THREE.MeshBasicMaterial({
				color: 0xffab66,
				transparent: true,
				opacity: 0.7,
				side: THREE.DoubleSide,
			})
		)
		this.crashRing.rotation.x = -Math.PI / 2
		this.crashRoot.add(this.crashRing)

		this.crashDebris = []
		const debrisGeometry = new THREE.TetrahedronGeometry(0.8, 0)
		const debrisMaterial = new THREE.MeshStandardMaterial({
			color: 0x34282a,
			metalness: 0.45,
			roughness: 0.7,
		})
		for (let i = 0; i < 14; i++) {
			const mesh = new THREE.Mesh(
				debrisGeometry,
				debrisMaterial
			)
			mesh.visible = false
			mesh.scale.setScalar(0.45 + Math.random() * 1.5)
			this.crashRoot.add(mesh)
			this.crashDebris.push({
				mesh,
				velocity: new THREE.Vector3(),
				spin: new THREE.Vector3(
					(Math.random() - 0.5) * 8,
					(Math.random() - 0.5) * 8,
					(Math.random() - 0.5) * 8
				),
			})
		}
	}

	_buildOverlays() {
		this.fadeEl = document.createElement('div')
		Object.assign(this.fadeEl.style, {
			position: 'fixed',
			inset: '0',
			zIndex: '90',
			background: '#000',
			opacity: '1',
			pointerEvents: 'none',
			transition: 'opacity .15s linear',
		})
		this.skipEl = document.createElement('div')
		this.skipEl.textContent = 'LOADING CINEMATIC…'
		Object.assign(this.skipEl.style, {
			position: 'fixed',
			right: '24px',
			bottom: '20px',
			zIndex: '95',
			fontFamily: 'monospace',
			fontSize: '12px',
			letterSpacing: '.18em',
			color: 'rgba(220,232,255,.6)',
			pointerEvents: 'none',
		})
		this.alarmEl = document.createElement('section')
		this.alarmEl.innerHTML =
			'<div>PLANETARY ALERT</div><div style="font-size:.55em;letter-spacing:.18em;margin-top:8px">UNKNOWN VESSEL DETECTED · INTRUDER ALERT</div>'
		Object.assign(this.alarmEl.style, {
			position: 'fixed',
			inset: '0',
			display: 'none',
			placeContent: 'center',
			zIndex: '80',
			textAlign: 'center',
			fontFamily: 'monospace',
			fontSize: 'clamp(22px,3.6vw,50px)',
			letterSpacing: '.12em',
			color: '#ff5c5c',
			background: 'rgba(120,0,0,.08)',
			pointerEvents: 'none',
		})
		this.controlAlertEl = document.createElement('div')
		this.controlAlertEl.innerHTML = `
			<div data-control-alert-title>WARNING · LOSING CONTROL OF SHIP</div>
			<div data-control-alert-sub>FLIGHT CONTROL FAILURE · TRAJECTORY UNSTABLE</div>
		`
		Object.assign(this.controlAlertEl.style, {
			position: 'fixed',
			left: '50%',
			top: 'clamp(34px,6vh,78px)',
			transform: 'translateX(-50%)',
			zIndex: '88',
			display: 'none',
			minWidth: 'min(760px,84vw)',
			padding: '12px 22px 10px',
			boxSizing: 'border-box',
			textAlign: 'center',
			fontFamily: 'monospace',
			fontWeight: '900',
			letterSpacing: '.16em',
			color: '#ff4d4d',
			background: 'rgba(35,0,0,.74)',
			border: '3px solid rgba(255,48,48,.92)',
			boxShadow: '0 0 18px rgba(255,25,25,.35), inset 0 0 18px rgba(255,35,35,.16)',
			pointerEvents: 'none',
			textShadow: '0 0 10px rgba(255,35,35,.85)',
		})
		this.controlAlertTitleEl = this.controlAlertEl.querySelector(
			'[data-control-alert-title]'
		)
		Object.assign(this.controlAlertTitleEl.style, {
			fontSize: 'clamp(15px,2vw,28px)',
			lineHeight: '1.15',
		})
		this.controlAlertSubEl = this.controlAlertEl.querySelector(
			'[data-control-alert-sub]'
		)
		Object.assign(this.controlAlertSubEl.style, {
			marginTop: '7px',
			fontSize: 'clamp(9px,.9vw,13px)',
			letterSpacing: '.12em',
			color: 'rgba(255,160,160,.95)',
		})

		this.comicEl = document.createElement('div')
		this.comicEl.innerHTML = `
			<div data-comic-frame></div>
			<div data-comic-kicker></div>
			<div data-comic-caption></div>
			<div data-comic-split-v></div>
			<div data-comic-split-d></div>
			<div data-comic-impact>IMPACT</div>
		`
		Object.assign(this.comicEl.style, {
			position: 'fixed',
			inset: '0',
			zIndex: '70',
			pointerEvents: 'none',
			opacity: '0',
			overflow: 'hidden',
			fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif',
		})
		this.comicFrameEl =
			this.comicEl.querySelector('[data-comic-frame]')
		Object.assign(this.comicFrameEl.style, {
			position: 'absolute',
			inset: '18px',
			border: 'clamp(5px, .65vw, 10px) solid rgba(7,8,12,.95)',
			boxShadow: 'inset 0 0 0 2px rgba(242,231,205,.28), inset 0 0 70px rgba(0,0,0,.3)',
		})
		this.comicKickerEl = this.comicEl.querySelector(
			'[data-comic-kicker]'
		)
		Object.assign(this.comicKickerEl.style, {
			position: 'absolute',
			left: '34px',
			top: '32px',
			padding: '7px 11px',
			background: '#efe2bd',
			color: '#101016',
			border: '3px solid #101016',
			fontFamily: 'monospace',
			fontWeight: '800',
			fontSize: 'clamp(10px,1vw,14px)',
			letterSpacing: '.12em',
			transform: 'rotate(-1deg)',
		})
		this.comicCaptionEl = this.comicEl.querySelector(
			'[data-comic-caption]'
		)
		Object.assign(this.comicCaptionEl.style, {
			position: 'absolute',
			left: 'clamp(32px,5vw,78px)',
			bottom: 'clamp(34px,6vw,90px)',
			maxWidth: 'min(620px,72vw)',
			padding: '11px 16px 10px',
			background: 'rgba(7,8,12,.92)',
			color: '#f5ead0',
			border: '3px solid #f5ead0',
			boxShadow: '7px 7px 0 rgba(7,8,12,.82)',
			fontSize: 'clamp(18px,2.4vw,38px)',
			letterSpacing: '.06em',
			lineHeight: '1',
			textTransform: 'uppercase',
		})
		this.comicSplitVEl = this.comicEl.querySelector(
			'[data-comic-split-v]'
		)
		Object.assign(this.comicSplitVEl.style, {
			position: 'absolute',
			top: '18px',
			bottom: '18px',
			left: '50%',
			width: '9px',
			background: '#08090d',
			transform: 'translateX(-50%)',
			display: 'none',
		})
		this.comicSplitDEl = this.comicEl.querySelector(
			'[data-comic-split-d]'
		)
		Object.assign(this.comicSplitDEl.style, {
			position: 'absolute',
			top: '-18%',
			left: '51%',
			width: '10px',
			height: '140%',
			background: '#08090d',
			transform: 'rotate(17deg)',
			display: 'none',
		})
		this.comicImpactEl = this.comicEl.querySelector(
			'[data-comic-impact]'
		)
		Object.assign(this.comicImpactEl.style, {
			position: 'absolute',
			left: '50%',
			top: '48%',
			transform: 'translate(-50%,-50%) rotate(-7deg) scale(.7)',
			fontSize: 'clamp(70px,17vw,250px)',
			letterSpacing: '.02em',
			color: '#ffe9a3',
			WebkitTextStroke: 'clamp(3px,.55vw,9px) #160b0b',
			textShadow: '12px 14px 0 rgba(141,22,19,.85)',
			opacity: '0',
		})

		document.body.append(
			this.fadeEl,
			this.comicEl,
			this.controlAlertEl,
			this.alarmEl,
			this.skipEl
		)
	}

	_setupCamera() {
		const camera = this.sceneManager.camera
		camera.fov = 58
		camera.near = 0.1
		camera.far = 9000
		camera.position.copy(
			this.shipPosition
				.clone()
				.addScaledVector(this.flightRight, 18)
				.addScaledVector(this.flightUp, 10)
				.addScaledVector(this.flightForward, -48)
		)
		camera.lookAt(
			this.shipPosition
				.clone()
				.addScaledVector(this.flightForward, 140)
		)
		camera.updateProjectionMatrix()
		this.cameraMode = CAMERA_MODE.SHIP_FOLLOW
	}

	async _loadModels() {
		const shipKey = SHIPS[this.handoff.shipKey]
			? this.handoff.shipKey
			: SHIPS[this.game.gameState.selectedShip]
				? this.game.gameState.selectedShip
				: 'vanguard'
		const pilotKey = CHARACTERS[this.handoff.pilotKey]
			? this.handoff.pilotKey
			: CHARACTERS[this.game.gameState.selectedCharacter]
				? this.game.gameState.selectedCharacter
				: 'zara'

		this._setShip(this._fallbackShip(), shipKey)
		this._setPilot(this._fallbackPilot())

		const loadShip = this.assetManager
			.loadModel(SHIPS[shipKey].model)
			.then((model) => {
				if (this._disposed) return
				this._fit(model, 16)
				this._setShip(model, shipKey)
			})
			.catch((error) =>
				console.warn(
					'[Cutscene] Ship model unavailable:',
					error?.message
				)
			)
		const loadPilot = this.assetManager
			.loadModel(CHARACTERS[pilotKey].model)
			.then((model) => {
				if (this._disposed) return
				this._fit(model, 3.1)
				this._setPilot(model)
			})
			.catch((error) =>
				console.warn(
					'[Cutscene] Pilot model unavailable:',
					error?.message
				)
			)

		await Promise.race([
			Promise.all([loadShip, loadPilot]),
			new Promise((resolve) => {
				this._waitTimer = setTimeout(
					resolve,
					MODEL_WAIT_MS
				)
			}),
		])
		clearTimeout(this._waitTimer)
	}

	_setShip(model, shipKey) {
		this.shipModelRoot.clear()
		const pivot = new THREE.Group()
		pivot.rotation.y = MODEL_YAW[shipKey] || 0
		pivot.add(model)
		this.ship = model
		this.shipModelRoot.add(pivot)
	}

	_setPilot(model) {
		this.pilotModelRoot.clear()
		this.pilot = model
		this.pilotModelRoot.add(model)
	}

	_fallbackShip() {
		const hull = new THREE.Mesh(
			new THREE.ConeGeometry(2.8, 12, 8),
			new THREE.MeshStandardMaterial({
				color: 0x8799aa,
				metalness: 0.65,
				roughness: 0.4,
			})
		)
		hull.rotation.x = -Math.PI / 2
		return hull
	}

	_fallbackPilot() {
		const group = new THREE.Group()
		const body = new THREE.Mesh(
			new THREE.CylinderGeometry(0.5, 0.65, 2.2, 10),
			new THREE.MeshStandardMaterial({ color: 0x536776 })
		)
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(0.45, 12, 10),
			new THREE.MeshStandardMaterial({ color: 0xc48d71 })
		)
		head.position.y = 1.45
		group.add(body, head)
		return group
	}

	_fit(model, target) {
		model.updateMatrixWorld(true)
		let box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const longest = Math.max(size.x, size.y, size.z) || 1
		model.scale.multiplyScalar(target / longest)
		model.updateMatrixWorld(true)
		box = new THREE.Box3().setFromObject(model)
		model.position.sub(box.getCenter(new THREE.Vector3()))
	}

	_setCamera(position, target, smoothing, delta, shake = 0) {
		const camera = this.sceneManager.camera
		const desired = position.clone()
		if (shake > 0) {
			desired.x += (Math.random() - 0.5) * shake
			desired.y += (Math.random() - 0.5) * shake
			desired.z += (Math.random() - 0.5) * shake
		}
		camera.position.lerp(desired, 1 - Math.exp(-smoothing * delta))
		camera.lookAt(target)
	}

	_setCinematicCamera(
		mode,
		position,
		target,
		smoothing,
		delta,
		shake = 0
	) {
		if (this.cameraMode !== mode) {
			this.cameraMode = mode
			this.sceneManager.camera.position.copy(position)
			this.sceneManager.camera.lookAt(target)
			this.sceneManager.camera.updateMatrixWorld(true)
			return
		}
		this._setCamera(position, target, smoothing, delta, shake)
	}

	_surfaceCameraAnchor(
		base,
		rightOffset = 0,
		forwardOffset = 0,
		height = 10
	) {
		const anchor = base
			.clone()
			.addScaledVector(this.flightRight, rightOffset)
			.addScaledVector(this.flightForward, forwardOffset)
		anchor.y =
			alienTerrainHeight(
				anchor.x,
				anchor.z,
				this.surfaceBaseY
			) + height
		return anchor
	}

	_enterPlanetPov() {
		this.terrainRoot.visible = true
		this.sceneManager.scene.fog = new THREE.FogExp2(
			0x351823,
			0.00034
		)
		// Once the camera is standing on the planet, the distant proxy sphere is
		// no longer part of the shot. Hiding it prevents the old "planet ahead"
		// composition from competing with the surface-view storytelling.
		this.planet.visible = false
		this.planetAtmosphere.visible = false
	}

	_setEngine(intensity, unstable = false) {
		const flicker = unstable
			? 0.35 + Math.abs(Math.sin(this.elapsed * 24)) * 0.65
			: 1
		const value = clamp01(intensity) * flicker
		this.engineFlame.visible = value > 0.04
		this.engineFlame.scale.set(
			0.75 + value * 0.5,
			0.75 + value,
			0.75 + value * 0.5
		)
		this.engineFlame.material.opacity = 0.25 + value * 0.65
		this.engineLight.intensity = value * 5
	}

	_integrateShip(delta, mode) {
		const acceleration = new THREE.Vector3()
		if (mode === PHASE.APPROACH) {
			acceleration.addScaledVector(this.flightForward, 1.8)
			this.shipAngularVelocity.multiplyScalar(
				Math.exp(-3 * delta)
			)
			this._setEngine(0.95)
		} else if (mode === PHASE.MALFUNCTION) {
			const severity = clamp01(
				this.phaseTime / MALFUNCTION_RAMP_SECONDS
			)
			acceleration.addScaledVector(
				this.flightForward,
				0.8 - severity * 2.5
			)
			acceleration.addScaledVector(
				this.flightRight,
				Math.sin(this.elapsed * 2.1) * 5 * severity
			)
			acceleration.addScaledVector(
				this.flightUp,
				-3.5 * severity
			)

			// As control is lost, the planet gradually captures the damaged ship.
			// This is acceleration, not a positional correction, so the inherited
			// Level 1 trajectory remains continuous while naturally bending inward.
			const planetward = this.planetCenter
				.clone()
				.sub(this.shipPosition)
			if (planetward.lengthSq() > 1) {
				planetward.normalize()
				const capture =
					0.7 +
					severity * 2.4 +
					Math.max(0, this.phaseTime - 6) * 0.25
				acceleration.addScaledVector(
					planetward,
					capture
				)
			}
			this.shipAngularVelocity.x +=
				(0.25 + severity * 0.75) * delta
			this.shipAngularVelocity.y +=
				Math.sin(this.elapsed * 4.5) * 0.4 * delta
			this.shipAngularVelocity.z +=
				(0.5 + severity * 1.2) * delta
			this._setEngine(0.75 - severity * 0.55, true)
		} else if (
			mode === PHASE.EJECTION ||
			mode === PHASE.FREE_FALL ||
			mode === PHASE.PARACHUTE
		) {
			// After ejection the damaged vessel remains ballistic and independent.
			// It is gently drawn toward the crash corridor while vertical damping
			// prevents it from going below the terrain before the entry shot begins.
			const toCrash = this.crashGuidePoint
				.clone()
				.sub(this.shipPosition)
			if (toCrash.lengthSq() > 1) {
				acceleration.addScaledVector(
					toCrash.normalize(),
					2.0
				)
			}
			acceleration.y += -this.shipVelocity.y * 0.25 - 0.1
			this.shipAngularVelocity.x += 0.85 * delta
			this.shipAngularVelocity.y +=
				Math.sin(this.elapsed * 4.5) * 0.35 * delta
			this.shipAngularVelocity.z += 1.35 * delta
			this._setEngine(0.16, true)
			this.damageTrail.material.opacity = 0.12
			this._updateDamageTrail()
		} else if (mode === PHASE.SHIP_ENTRY) {
			const toCrash = this.crashGuidePoint
				.clone()
				.sub(this.shipPosition)
			const distance = Math.max(toCrash.length(), 1)
			acceleration.addScaledVector(
				toCrash.normalize(),
				42 + clamp01(this.phaseTime / 6) * 30
			)
			acceleration.y -= 15
			this.shipVelocity.multiplyScalar(
				Math.exp(-0.075 * delta)
			)
			this.shipAngularVelocity.x += 1.3 * delta
			this.shipAngularVelocity.z += 1.8 * delta
			this._setEngine(0.1, true)
			this.entryGlow.material.opacity =
				0.18 + clamp01(900 / distance) * 0.45
			this.entryGlow.scale.setScalar(
				0.9 + Math.sin(this.elapsed * 12) * 0.08
			)
			this.damageTrail.material.opacity = 0.42
		}

		this.shipVelocity.addScaledVector(acceleration, delta)
		this.shipPosition.addScaledVector(this.shipVelocity, delta)
		this.shipRoot.position.copy(this.shipPosition)
		this.shipRoot.rotateX(this.shipAngularVelocity.x * delta)
		this.shipRoot.rotateY(this.shipAngularVelocity.y * delta)
		this.shipRoot.rotateZ(this.shipAngularVelocity.z * delta)

		if (mode === PHASE.SHIP_ENTRY) {
			this._updateDamageTrail()
			const ground = alienTerrainHeight(
				this.shipPosition.x,
				this.shipPosition.z,
				this.surfaceBaseY
			)
			if (this.shipPosition.y <= ground + 5)
				this._impactShip(ground)
		}
	}

	_updateDamageTrail() {
		const p = this.trailPositions
		for (let i = this.trailCount - 1; i > 0; i--) {
			p[i * 3] = p[(i - 1) * 3]
			p[i * 3 + 1] = p[(i - 1) * 3 + 1]
			p[i * 3 + 2] = p[(i - 1) * 3 + 2]
		}
		p[0] = this.shipPosition.x
		p[1] = this.shipPosition.y
		p[2] = this.shipPosition.z
		this.trailGeometry.attributes.position.needsUpdate = true
	}

	_ejectPilot() {
		if (this.ejected) return
		this.ejected = true
		this.game.audio?.playImpact()
		this.pilotRoot.visible = true
		this.pilotPosition
			.copy(this.shipPosition)
			.addScaledVector(this.flightUp, 2)
			.addScaledVector(this.flightRight, -2.5)
			.addScaledVector(this.flightForward, -5)
		this.pilotVelocity
			.copy(this.shipVelocity)
			.addScaledVector(this.flightRight, -28)
			.addScaledVector(this.flightUp, 22)
			.addScaledVector(this.flightForward, -12)
		this.pilotAngularVelocity.set(2.8, 1.1, 2.2)
		this.pilotRoot.position.copy(this.pilotPosition)
		this.pilotRoot.quaternion.copy(this.shipRoot.quaternion)

		// Landing/crash targets are projected from the *real* ejection point.
		// This matters now that ejection is proximity-driven: neither actor has
		// to turn around toward coordinates authored for an earlier timeline.
		const forwardSpeed = Math.max(
			60,
			this.pilotVelocity.dot(this.flightForward)
		)
		const landingDrift = THREE.MathUtils.clamp(
			forwardSpeed * 3.05,
			290,
			410
		)
		this.landingPoint
			.copy(this.pilotPosition)
			.addScaledVector(this.flightForward, landingDrift)
			.addScaledVector(this.flightRight, -92)
		this.landingPoint.y = alienTerrainHeight(
			this.landingPoint.x,
			this.landingPoint.z,
			this.surfaceBaseY
		)

		this.crashGuidePoint
			.copy(this.shipPosition)
			.addScaledVector(this.flightForward, 1050)
			.addScaledVector(this.flightRight, 118)
		this.crashGuidePoint.y = alienTerrainHeight(
			this.crashGuidePoint.x,
			this.crashGuidePoint.z,
			this.surfaceBaseY
		)
		this.crashSite.copy(this.crashGuidePoint)
	}

	_integratePilot(delta, parachuteAmount = 0) {
		if (!this.ejected || this.pilotLanded) return
		const open = clamp01(parachuteAmount)
		const acceleration = new THREE.Vector3(0, -18 + open * 8, 0)

		if (open > 0) {
			const toLanding = this.landingPoint
				.clone()
				.sub(this.pilotPosition)
			toLanding.y = 0
			if (toLanding.lengthSq() > 1) {
				acceleration.addScaledVector(
					toLanding.normalize(),
					9 + open * 8
				)
			}
			this.pilotVelocity.multiplyScalar(
				Math.exp(-(0.15 + open * 1.1) * delta)
			)
			if (open > 0.75 && this.pilotVelocity.y < -9)
				this.pilotVelocity.y = -9
		}

		this.pilotVelocity.addScaledVector(acceleration, delta)
		this.pilotPosition.addScaledVector(this.pilotVelocity, delta)
		this.pilotRoot.position.copy(this.pilotPosition)

		if (open < 0.7) {
			this.pilotRoot.rotateX(
				this.pilotAngularVelocity.x * delta
			)
			this.pilotRoot.rotateY(
				this.pilotAngularVelocity.y * delta
			)
			this.pilotRoot.rotateZ(
				this.pilotAngularVelocity.z * delta
			)
			this.pilotAngularVelocity.multiplyScalar(
				Math.exp(-0.16 * delta)
			)
		} else {
			this.pilotRoot.rotation.x *= Math.exp(-4 * delta)
			this.pilotRoot.rotation.z =
				Math.sin(this.elapsed * 1.4) * 0.07 * open
		}

		const ground = alienTerrainHeight(
			this.pilotPosition.x,
			this.pilotPosition.z,
			this.surfaceBaseY
		)
		if (open > 0.65 && this.pilotPosition.y <= ground + 2.1) {
			this.pilotPosition.y = ground + 2.1
			this.pilotRoot.position.y = this.pilotPosition.y
			this.pilotVelocity.set(0, 0, 0)
			this.pilotRoot.rotation.set(0, Math.PI, 0)
			this.pilotLanded = true
			this.landingPoint.copy(this.pilotPosition)
		}
	}

	_deployParachute(amount) {
		this.parachuteOpen = Math.max(
			this.parachuteOpen,
			clamp01(amount)
		)
		const open = smooth(this.parachuteOpen)
		this.parachute.visible = open > 0.01
		this.parachute.scale.set(
			0.35 + open * 0.8,
			Math.max(0.001, open),
			0.35 + open * 0.8
		)
		this.parachute.rotation.z =
			Math.sin(this.elapsed * 1.7) * 0.06 * open
		this.parachute.rotation.x =
			Math.sin(this.elapsed * 1.2) * 0.04 * open
	}

	_impactShip(groundY) {
		if (this.shipCrashed) return
		this.shipCrashed = true
		this.shipPosition.y = groundY + 3
		this.shipRoot.position.copy(this.shipPosition)
		this.shipVelocity.set(0, 0, 0)
		this.crashSite.copy(this.shipPosition)
		this.crashRoot.position.copy(this.crashSite)
		this.crashRoot.visible = true
		this.crashLight.intensity = 110
		this.crashFire.scale.setScalar(1)
		this.crashSmoke.scale.setScalar(1)
		this.crashRing.scale.setScalar(1)
		for (const piece of this.crashDebris) {
			piece.mesh.visible = true
			piece.mesh.position.set(0, 2 + Math.random() * 4, 0)
			piece.velocity.set(
				(Math.random() - 0.5) * 42,
				16 + Math.random() * 30,
				(Math.random() - 0.5) * 42
			)
		}
		this.entryGlow.material.opacity = 0
		this.damageTrail.material.opacity = 0.25
		this.game.audio?.playCrash()
		// The physical impact is what alerts the planet. The warning overlay is
		// shown a beat later so the player still gets a clean crash shot.
		this.game.gameState.alienAlert = true
		this._storeTransitionState()
	}

	_updateCrashEffects(delta) {
		const t = this.phaseTime
		const burst = Math.exp(-2.1 * t)
		this.crashLight.intensity = 8 + burst * 100
		this.crashFire.material.opacity = 0.2 + burst * 0.75
		this.crashFire.scale.setScalar(1 + (1 - burst) * 3.2)
		this.crashSmoke.material.opacity = Math.min(
			0.72,
			0.25 + t * 0.12
		)
		this.crashSmoke.scale.setScalar(1 + t * 1.7)
		this.crashRing.material.opacity = 0.7 * burst
		this.crashRing.scale.setScalar(1 + t * 8)
		for (const piece of this.crashDebris) {
			if (!piece.mesh.visible) continue
			piece.velocity.y -= 22 * delta
			piece.mesh.position.addScaledVector(
				piece.velocity,
				delta
			)
			piece.mesh.rotation.x += piece.spin.x * delta
			piece.mesh.rotation.y += piece.spin.y * delta
			piece.mesh.rotation.z += piece.spin.z * delta
		}
	}

	_triggerAlarm() {
		if (this.alarmTriggered) return
		this.alarmTriggered = true
		this.game.gameState.alienAlert = true
		this._storeTransitionState()
		this.alarmEl.style.display = 'grid'
		this._alarmBeepIn = 0
		this.cameraMode = null
	}

	_storeTransitionState() {
		const state = this.game.gameState
		state.surfaceBaseY = this.surfaceBaseY
		state.crashSite = {
			x: this.crashSite.x,
			y: this.crashSite.y,
			z: this.crashSite.z,
		}
		state.landingSite = {
			x: this.landingPoint.x,
			y: this.landingPoint.y,
			z: this.landingPoint.z,
		}
	}

	_distanceToPlanetSurface() {
		return Math.max(
			0,
			this.shipPosition.distanceTo(this.planetCenter) -
				PLANET_RADIUS
		)
	}

	_setComicText(kicker, caption) {
		if (this.comicKickerEl)
			this.comicKickerEl.textContent = kicker || ''
		if (this.comicCaptionEl)
			this.comicCaptionEl.textContent = caption || ''
	}

	_updateControlAlert() {
		if (!this.controlAlertEl) return

		let visible = false
		let title = ''
		let sub = ''
		let urgency = 0

		if (
			this.phase === PHASE.MALFUNCTION &&
			this.phaseTime >= 0.55
		) {
			visible = true
			urgency = clamp01(
				this.phaseTime / MALFUNCTION_RAMP_SECONDS
			)
			title = 'WARNING · LOSING CONTROL OF SHIP'
			sub =
				this.phaseTime >= PLANET_POV_CUT_SECONDS
					? 'SURFACE TRAJECTORY UNSTABLE · COLLISION RISK RISING'
					: 'FLIGHT CONTROL FAILURE · TRAJECTORY UNSTABLE'
		} else if (
			this.phase === PHASE.EJECTION ||
			this.phase === PHASE.FREE_FALL ||
			this.phase === PHASE.PARACHUTE
		) {
			visible = true
			urgency = 0.82
			title = 'CRITICAL · VESSEL UNCONTROLLED'
			sub = 'PILOT EJECTED · IMPACT TRAJECTORY ACTIVE'
		} else if (this.phase === PHASE.SHIP_ENTRY) {
			visible = true
			urgency = 1
			title = 'CRITICAL · IMPACT IMMINENT'
			sub = 'VESSEL DESCENT UNRECOVERABLE'
		}

		if (!visible) {
			this.controlAlertEl.style.display = 'none'
			return
		}

		this.controlAlertEl.style.display = 'block'
		this.controlAlertTitleEl.textContent = title
		this.controlAlertSubEl.textContent = sub
		const flashRate = 5.5 + urgency * 8.5
		const flash = 0.5 + 0.5 * Math.sin(this.elapsed * flashRate)
		this.controlAlertEl.style.opacity = String(
			0.46 + flash * (0.32 + urgency * 0.18)
		)
		this.controlAlertEl.style.transform = `translateX(-50%) scale(${1 + flash * urgency * 0.012})`
		this.controlAlertEl.style.borderColor = `rgba(255,48,48,${0.62 + flash * 0.38})`
	}

	_updateComicPresentation(delta) {
		if (!this.comicRenderer) return
		this.comicRenderer.update(delta)

		let mix = 0
		let overlay = 0
		let kicker = ''
		let caption = ''
		let splitV = false
		let splitD = false
		let impact = 0
		let style = {
			edgeStrength: 1.12,
			posterizeLevels: 6,
			halftoneStrength: 0.2,
			vignetteStrength: 0.16,
			exposure: 1.12,
			shadowLift: 0.018,
		}

		switch (this.phase) {
			case PHASE.APPROACH: {
				const p = smooth(
					this.phaseTime /
						PHASE_DURATION[PHASE.APPROACH]
				)
				mix = Math.max(0, (p - 0.78) / 0.22) * 0.12
				break
			}
			case PHASE.MALFUNCTION: {
				const p = smooth(this.phaseTime / 2.8)
				mix = 0.12 + p * 0.76
				overlay = p * 0.88
				if (this.phaseTime < PLANET_POV_CUT_SECONDS) {
					kicker =
						'SYSTEM WARNING // FLIGHT CONTROL'
					caption =
						'ENGINE FAILURE — LOSING CONTROL'
				} else {
					kicker = 'ALIEN SURFACE // SKYWARD'
					caption =
						'UNCONTROLLED VESSEL DESCENDING'
				}
				style.edgeStrength = 1.25
				break
			}
			case PHASE.EJECTION:
				mix = 1
				overlay = 1
				kicker = 'EMERGENCY PROTOCOL'
				caption = 'EJECTION — PILOT AND VESSEL SEPARATE'
				splitD = true
				style.edgeStrength = 1.42
				style.posterizeLevels = 4
				break
			case PHASE.FREE_FALL:
				mix = 0.96
				overlay = 0.92
				kicker = 'ALTITUDE FALLING'
				caption = 'FREE FALL'
				break
			case PHASE.PARACHUTE:
				mix = 0.93
				overlay = 0.9
				kicker = 'DESCENT CONTROL'
				caption = 'CANOPY DEPLOYED'
				break
			case PHASE.SHIP_ENTRY:
				mix = 1
				overlay = 0.96
				kicker = 'TWO TRAJECTORIES // ONE SURFACE'
				caption = 'PILOT DESCENT / VESSEL ENTRY'
				splitV = true
				style.halftoneStrength = 0.24
				break
			case PHASE.CRASH:
				mix = 1
				overlay = 1
				kicker = 'SURFACE CONTACT'
				caption = 'VESSEL DOWN'
				impact = 1 - smooth(this.phaseTime / 0.7)
				style = {
					edgeStrength: 1.55,
					posterizeLevels: 5,
					halftoneStrength: 0.28,
					vignetteStrength: 0.22,
					exposure: 1.15,
					shadowLift: 0.02,
				}
				break
			case PHASE.ALARM:
				mix = 1
				overlay = 0.96
				kicker = 'PLANETARY NETWORK'
				caption = 'SIGNAL ACQUIRED'
				style.edgeStrength = 1.5
				break
			case PHASE.LANDING:
				mix = 0.84
				overlay = 0.82
				kicker = 'LANDING ZONE'
				caption = 'TOUCHDOWN'
				break
			case PHASE.REVEAL: {
				const p = smooth(
					this.phaseTime /
						PHASE_DURATION[PHASE.REVEAL]
				)
				mix = 0.84 * (1 - p)
				overlay = 0.82 * (1 - p)
				kicker = 'ALIEN PLANET EXODUS'
				caption = 'SURVIVE THE LANDING'
				break
			}
		}

		this.comicRenderer.setMix(mix)
		this.comicRenderer.setStyle(style)
		if (this.comicEl)
			this.comicEl.style.opacity = String(clamp01(overlay))
		this._setComicText(kicker, caption)
		if (this.comicSplitVEl)
			this.comicSplitVEl.style.display = splitV
				? 'block'
				: 'none'
		if (this.comicSplitDEl)
			this.comicSplitDEl.style.display = splitD
				? 'block'
				: 'none'
		if (this.comicImpactEl) {
			this.comicImpactEl.style.opacity = String(
				clamp01(impact)
			)
			const scale = 0.7 + (1 - clamp01(impact)) * 0.45
			this.comicImpactEl.style.transform = `translate(-50%,-50%) rotate(-7deg) scale(${scale})`
		}
	}

	_advance(nextPhase) {
		this.phase = nextPhase
		this.phaseTime = 0
		if (nextPhase === PHASE.EJECTION) this._ejectPilot()
		if (nextPhase === PHASE.SHIP_ENTRY) {
			this.terrainRoot.visible = true
			this.sceneManager.scene.fog = new THREE.FogExp2(
				0x351823,
				0.0005
			)
		}
		if (nextPhase === PHASE.ALARM) this._triggerAlarm()
	}

	update(delta) {
		if (this.finished || !this.ready) return
		const dt = Math.min(delta, 0.1)
		this.elapsed += dt
		this.phaseTime += dt
		this.stars.rotation.y += dt * 0.002
		this.fadeEl.style.opacity = String(
			clamp01(1 - this.elapsed / 0.9)
		)

		switch (this.phase) {
			case PHASE.APPROACH:
				this._updateApproach(dt)
				break
			case PHASE.MALFUNCTION:
				this._updateMalfunction(dt)
				break
			case PHASE.EJECTION:
				this._updateEjection(dt)
				break
			case PHASE.FREE_FALL:
				this._updateFreeFall(dt)
				break
			case PHASE.PARACHUTE:
				this._updateParachute(dt)
				break
			case PHASE.SHIP_ENTRY:
				this._updateShipEntry(dt)
				break
			case PHASE.CRASH:
				this._updateCrash(dt)
				break
			case PHASE.ALARM:
				this._updateAlarm(dt)
				break
			case PHASE.LANDING:
				this._updateLanding(dt)
				break
			case PHASE.REVEAL:
				this._updateReveal(dt)
				break
		}

		this._updateComicPresentation(dt)
		this._updateControlAlert()
	}

	_updateApproach(delta) {
		this._integrateShip(delta, PHASE.APPROACH)
		const wide = smooth(
			this.phaseTime / PHASE_DURATION[PHASE.APPROACH]
		)
		const cameraPosition = this.shipPosition
			.clone()
			.addScaledVector(this.flightRight, 24 + wide * 18)
			.addScaledVector(this.flightUp, 11 + wide * 5)
			.addScaledVector(this.flightForward, -54 - wide * 15)
		this._setCinematicCamera(
			CAMERA_MODE.SHIP_FOLLOW,
			cameraPosition,
			this.shipPosition
				.clone()
				.addScaledVector(this.flightForward, 180),
			3.2,
			delta
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.APPROACH]) {
			this._advance(PHASE.MALFUNCTION)
		}
	}

	_updateMalfunction(delta) {
		this._integrateShip(delta, PHASE.MALFUNCTION)
		const p = clamp01(this.phaseTime / MALFUNCTION_RAMP_SECONDS)

		if (this.phaseTime < PLANET_POV_CUT_SECONDS) {
			// Give the player one short close-up beat so the failure is readable,
			// then cut away before the planet dominates the composition.
			this._setCinematicCamera(
				CAMERA_MODE.SHIP_FOLLOW,
				this.shipPosition
					.clone()
					.addScaledVector(this.flightRight, 18)
					.addScaledVector(this.flightUp, 8)
					.addScaledVector(
						this.flightForward,
						-38
					),
				this.shipPosition
					.clone()
					.addScaledVector(
						this.flightForward,
						60
					),
				4,
				delta,
				p * 1.1
			)
		} else {
			// Planet POV: the camera is now standing on the alien surface and
			// looking upward at the damaged vessel. Actor physics remain untouched.
			this._enterPlanetPov()
			const anchor = this._surfaceCameraAnchor(
				this.terrainCenter,
				-118,
				-92,
				14
			)
			const lead =
				this.shipVelocity.lengthSq() > 1
					? this.shipVelocity
							.clone()
							.normalize()
							.multiplyScalar(18)
					: new THREE.Vector3()
			this._setCinematicCamera(
				CAMERA_MODE.SURFACE_SKY,
				anchor,
				this.shipPosition.clone().add(lead),
				2.4,
				delta,
				0.12 + p * 0.22
			)
		}

		const surfaceDistance = this._distanceToPlanetSurface()
		const malfunctionEstablished =
			this.phaseTime >= MALFUNCTION_MIN_SECONDS
		const closeEnough = surfaceDistance <= EJECTION_SURFACE_DISTANCE
		const fallbackWindow =
			this.phaseTime >= MALFUNCTION_FALLBACK_SECONDS &&
			surfaceDistance <= EJECTION_FALLBACK_DISTANCE

		if (malfunctionEstablished && (closeEnough || fallbackWindow)) {
			console.info(
				`[Cutscene] Ejection at ${surfaceDistance.toFixed(0)} units above visual planet surface after ${this.phaseTime.toFixed(1)}s of malfunction.`
			)
			this._advance(PHASE.EJECTION)
		}
	}

	_updateEjection(delta) {
		this._enterPlanetPov()
		this._integrateShip(delta, PHASE.EJECTION)
		this._integratePilot(delta, 0)
		const midpoint = this.shipPosition
			.clone()
			.lerp(this.pilotPosition, 0.5)
		const anchor = this._surfaceCameraAnchor(
			this.landingPoint,
			88,
			-105,
			11
		)
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_SKY,
			anchor,
			midpoint,
			2.8,
			delta,
			0.3
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.EJECTION]) {
			this._advance(PHASE.FREE_FALL)
		}
	}

	_updateFreeFall(delta) {
		this._enterPlanetPov()
		this._integrateShip(delta, PHASE.FREE_FALL)
		this._integratePilot(delta, 0)
		const anchor = this._surfaceCameraAnchor(
			this.landingPoint,
			62,
			-72,
			7
		)
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_PILOT,
			anchor,
			this.pilotPosition,
			3.2,
			delta
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.FREE_FALL]) {
			this._advance(PHASE.PARACHUTE)
		}
	}

	_updateParachute(delta) {
		this._enterPlanetPov()
		this._integrateShip(delta, PHASE.PARACHUTE)
		const open = clamp01(this.phaseTime / 2.4)
		this._deployParachute(open)
		this._integratePilot(delta, open)

		// Stay low on the surface so the player can actually watch the canopy
		// open against the sky and see the pilot descend all the way to touchdown.
		const anchor = this._surfaceCameraAnchor(
			this.landingPoint,
			42,
			-48,
			5.5
		)
		const target = this.pilotPosition
			.clone()
			.add(new THREE.Vector3(0, 2.5, 0))
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_PILOT,
			anchor,
			target,
			3.0,
			delta
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.PARACHUTE]) {
			this._advance(PHASE.SHIP_ENTRY)
		}
	}

	_updateShipEntry(delta) {
		this._deployParachute(1)
		this._integratePilot(delta, 1)
		this._integrateShip(delta, PHASE.SHIP_ENTRY)

		// The distant sphere fades only once the same ship has physically flown
		// into the local terrain volume; this is a camera/environment reveal,
		// not a ship teleport.
		this.planet.material.opacity = 1
		this.planet.material.transparent = true
		this.planet.material.opacity = Math.max(
			0,
			1 - this.phaseTime / 2
		)
		this.planetAtmosphere.material.opacity = Math.max(
			0,
			0.2 * (1 - this.phaseTime / 2)
		)
		if (this.planet.material.opacity <= 0.01) {
			this.planet.visible = false
			this.planetAtmosphere.visible = false
		}

		const anchor = this._surfaceCameraAnchor(
			this.crashGuidePoint,
			-92,
			-92,
			10
		)
		const target = this.shipPosition
			.clone()
			.add(new THREE.Vector3(0, 2, 0))
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_CRASH,
			anchor,
			target,
			2.7,
			delta,
			0.45 + clamp01(this.phaseTime / 4) * 0.65
		)

		if (this.shipCrashed) this._advance(PHASE.CRASH)
	}

	_updateCrash(delta) {
		this._deployParachute(1)
		this._integratePilot(delta, 1)
		this._updateCrashEffects(delta)
		const anchor = this._surfaceCameraAnchor(
			this.crashSite,
			-58,
			-62,
			8
		)
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_CRASH,
			anchor,
			this.crashSite.clone().add(new THREE.Vector3(0, 5, 0)),
			3,
			delta,
			Math.max(0, 3 - this.phaseTime) * 0.7
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.CRASH]) {
			this._advance(PHASE.ALARM)
		}
	}

	_updateAlarm(delta) {
		this._deployParachute(1)
		this._integratePilot(delta, 1)
		this._updateCrashEffects(delta)
		this.alarmEl.style.opacity = String(
			0.6 + Math.abs(Math.sin(this.elapsed * 6)) * 0.4
		)
		this._alarmBeepIn -= delta
		if (this._alarmBeepIn <= 0) {
			this.game.audio?.playWarning()
			this._alarmBeepIn = 0.55
		}
		const anchor = this._surfaceCameraAnchor(
			this.crashSite,
			-44,
			-48,
			7
		)
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_CRASH,
			anchor,
			this.crashSite.clone().add(new THREE.Vector3(0, 4, 0)),
			2.8,
			delta
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.ALARM]) {
			this.alarmEl.style.display = 'none'
			this._advance(PHASE.LANDING)
		}
	}

	_updateLanding(delta) {
		this._deployParachute(1)
		this._integratePilot(delta, 1)
		const anchor = this._surfaceCameraAnchor(
			this.landingPoint,
			32,
			-38,
			4.8
		)
		this._setCinematicCamera(
			CAMERA_MODE.SURFACE_PILOT,
			anchor,
			this.pilotPosition
				.clone()
				.add(new THREE.Vector3(0, 2, 0)),
			3.5,
			delta
		)
		if (this.pilotLanded) {
			this._storeTransitionState()
			this._advance(PHASE.REVEAL)
		}
	}

	_updateReveal(delta) {
		const p = smooth(this.phaseTime / PHASE_DURATION[PHASE.REVEAL])
		this.parachute.scale.set(
			Math.max(0.001, 1 - p),
			Math.max(0.001, 1 - p * 0.7),
			Math.max(0.001, 1 - p)
		)
		this.parachute.position.y = -p * 1.8
		this.parachute.position.z = p * 2.8
		const midpoint = this.landingPoint
			.clone()
			.lerp(this.crashSite, 0.32)
		this._setCinematicCamera(
			CAMERA_MODE.REVEAL,
			midpoint
				.clone()
				.addScaledVector(this.flightRight, 55)
				.add(new THREE.Vector3(0, 35 + p * 15, 0))
				.addScaledVector(this.flightForward, -70),
			midpoint,
			2.4,
			delta
		)
		if (this.phaseTime >= PHASE_DURATION[PHASE.REVEAL])
			this._finish()
	}

	skip() {
		if (this.finished) return
		if (!this.shipCrashed) {
			// Skipping is the only non-physical fast-forward path. Store the
			// planned sites so Level 2 still starts coherently.
			this.crashSite.copy(this.crashGuidePoint)
		}
		this.landingPoint.y =
			alienTerrainHeight(
				this.landingPoint.x,
				this.landingPoint.z,
				this.surfaceBaseY
			) + 2.1
		this.pilotLanded = true
		this._triggerAlarm()
		this._storeTransitionState()
		this._finish()
	}

	_finish() {
		if (this.finished) return
		this.finished = true
		this._storeTransitionState()
		console.info(
			`[Cutscene] Complete after ${this.elapsed.toFixed(1)}s; handing off to Level 2.`
		)
		this.onComplete({
			crashSite: this.game.gameState.crashSite,
			landingSite: this.game.gameState.landingSite,
			surfaceBaseY: this.surfaceBaseY,
			alienAlert: true,
		})
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		clearTimeout(this._waitTimer)
		window.removeEventListener('keydown', this._onKeyDown)
		this.alarmEl?.remove()
		this.fadeEl?.remove()
		this.skipEl?.remove()
		this.comicEl?.remove()
		this.controlAlertEl?.remove()
		this.sceneManager.setRenderPipeline(
			this._base.renderPipeline || null
		)
		this.comicRenderer?.dispose()
		clearScene(this.sceneManager.scene)
		const scene = this.sceneManager.scene
		scene.background = this._base.background
		scene.fog = this._base.fog
		const camera = this.sceneManager.camera
		camera.fov = this._base.fov
		camera.near = this._base.near
		camera.far = this._base.far
		camera.updateProjectionMatrix()
	}
}
