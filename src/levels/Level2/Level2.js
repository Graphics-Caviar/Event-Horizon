import * as THREE from 'three'
import { Level } from '../../core/Level.js'
import { STATUS } from '../../core/GameState.js'
import { CHARACTERS } from '../../systems/CharacterManager.js'
import { SHIPS } from '../../systems/ShipManager.js'
import { MODEL_YAW } from '../Level1/Spaceship.js'
import { AlienPlanet, alienTerrainHeight } from './AlienPlanet.js'

const PLAYER_RADIUS = 0.9
const MAX_WALK_SLOPE = 16
const SLIDE_START_SLOPE = 17.5
const MAX_MOVEMENT_SUBSTEP = 0.8

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
 * - rocks, vegetation, wreck/debris and the rover have XZ collision volumes.
 *
 * Alien combat remains deliberately out of scope for this cinematic milestone.
 */
export class Level2 extends Level {
	constructor(game, { transition = {} } = {}) {
		super(game, 2)
		this.state = game.gameState
		this.state.currentLevel = 2
		this.state.status = STATUS.PLAYING
		this.transition = transition
		this.baseY = Number.isFinite(this.state.surfaceBaseY)
			? this.state.surfaceBaseY
			: -140

		this.landingSite = vec3From(
			transition.landingSite || this.state.landingSite,
			new THREE.Vector3(0, this.baseY, 0)
		)
		this.crashSite = vec3From(
			transition.crashSite || this.state.crashSite,
			this.landingSite.clone().add(new THREE.Vector3(120, 0, 90))
		)
		this.roverSite = this.landingSite
			.clone()
			.add(new THREE.Vector3(95, 0, -55))

		const center = this.landingSite.clone().lerp(this.crashSite, 0.5)
		center.y = this.baseY

		this.gameplayColliders = []
		this.planet = new AlienPlanet(this, {
			center,
			baseY: this.baseY,
			size: 1100,
			clearZones: [
				{ x: this.landingSite.x, z: this.landingSite.z, radius: 28 },
				{ x: this.crashSite.x, z: this.crashSite.z, radius: 42 },
				{ x: this.roverSite.x, z: this.roverSite.z, radius: 46 },
			],
		})

		// Keep the rover objective reachable even when the procedural height
		// function happens to put the nominal marker on one of the steepest
		// ridges. The large clear zone above leaves this search area obstacle-free.
		this.roverSite.copy(this._findWalkableRoverSite(this.roverSite))

		this.playerRoot = new THREE.Group()
		this.playerRoot.name = 'level2-pilot'
		this.playerRoot.position.copy(this.landingSite)
		this._syncPlayerToTerrain()
		this.addObject(this.playerRoot)
		this._setPilot(this._fallbackPilot())
		this._loadPilot()

		this.wreckRoot = new THREE.Group()
		this.wreckRoot.name = 'crashed-spaceship'
		this.wreckRoot.position.copy(this.crashSite)
		this.wreckRoot.position.y =
			alienTerrainHeight(this.crashSite.x, this.crashSite.z, this.baseY) + 1.5
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

		this.rover = this._buildRoverMarker()
		this.addObject(this.rover)
		this._registerGameplayCollider(
			this.rover.position.x,
			this.rover.position.z,
			6.8,
			'rover',
			this.rover
		)

		this.keys = new Set()
		this._onKeyDown = (e) => this.keys.add(e.code)
		this._onKeyUp = (e) => this.keys.delete(e.code)
		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('keyup', this._onKeyUp)

		this.feedbackTimer = 0
		this._buildObjective()
		this._buildMovementFeedback()
		this._setupCamera()
	}

	_findWalkableRoverSite(origin) {
		const candidate = origin.clone()
		const radii = [0, 8, 16, 24, 32]
		for (const radius of radii) {
			const samples = radius === 0 ? 1 : 16
			for (let i = 0; i < samples; i++) {
				const angle = samples === 1 ? 0 : (i / samples) * Math.PI * 2
				candidate.set(
					origin.x + Math.cos(angle) * radius,
					0,
					origin.z + Math.sin(angle) * radius
				)
				if (!this.planet.isInsideBounds(candidate.x, candidate.z, 8)) continue
				if (this.planet.slopeDegreesAt(candidate.x, candidate.z) > MAX_WALK_SLOPE - 1) continue
				const crashDx = candidate.x - this.crashSite.x
				const crashDz = candidate.z - this.crashSite.z
				if (Math.hypot(crashDx, crashDz) < 25) continue
				return candidate.clone()
			}
		}
		return origin.clone()
	}

	async _loadPilot() {
		const config = CHARACTERS[this.state.selectedCharacter] || CHARACTERS.zara
		try {
			const model = await this.assetManager.loadModel(config.model)
			if (!this.playerRoot.parent) return
			this._fit(model, 3.2)
			this._setPilot(model)
		} catch (error) {
			console.warn('[Level2] Pilot model unavailable:', error?.message)
		}
	}

	async _loadWreck() {
		const shipKey = SHIPS[this.state.selectedShip]
			? this.state.selectedShip
			: 'vanguard'
		try {
			const model = await this.assetManager.loadModel(SHIPS[shipKey].model)
			if (!this.wreckRoot.parent) return
			this._fit(model, 18)
			const pivot = new THREE.Group()
			pivot.rotation.y = MODEL_YAW[shipKey] || 0
			pivot.add(model)
			this._setWreck(pivot)
		} catch (error) {
			console.warn('[Level2] Wreck model unavailable:', error?.message)
		}
	}

	_setPilot(model) {
		this.pilotModel?.removeFromParent()
		this.pilotModel = model
		this.playerRoot.add(model)
	}

	_setWreck(model) {
		this.wreckModel?.removeFromParent()
		this.wreckModel = model
		this.wreckRoot.add(model)
	}

	_fallbackPilot() {
		const group = new THREE.Group()
		const body = new THREE.Mesh(
			this.own(new THREE.CylinderGeometry(0.55, 0.7, 2.2, 10)),
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
			this.own(new THREE.MeshStandardMaterial({ color: 0xc48d71 }))
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

		const debrisGeometry = this.own(new THREE.TetrahedronGeometry(0.8, 0))
		const debrisMaterial = this.own(
			new THREE.MeshStandardMaterial({
				color: 0x2e2527,
				metalness: 0.4,
				roughness: 0.75,
			})
		)
		const world = new THREE.Vector3()
		for (let i = 0; i < 16; i++) {
			const debris = new THREE.Mesh(debrisGeometry, debrisMaterial)
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

	_buildRoverMarker() {
		const root = new THREE.Group()
		root.name = 'exploration-rover-marker'
		const bodyMaterial = this.own(
			new THREE.MeshStandardMaterial({
				color: 0x263943,
				metalness: 0.65,
				roughness: 0.4,
			})
		)
		const wheelMaterial = this.own(
			new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.9 })
		)
		const body = new THREE.Mesh(
			this.own(new THREE.BoxGeometry(7.5, 2.2, 11)),
			bodyMaterial
		)
		body.position.y = 2.4
		root.add(body)

		const wheelGeometry = this.own(
			new THREE.CylinderGeometry(1.35, 1.35, 1, 14)
		)
		for (const z of [-3.8, 0, 3.8]) {
			for (const x of [-4.2, 4.2]) {
				const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
				wheel.rotation.z = Math.PI / 2
				wheel.position.set(x, 1.25, z)
				root.add(wheel)
			}
		}

		root.position.copy(this.roverSite)
		root.position.y =
			alienTerrainHeight(root.position.x, root.position.z, this.baseY) + 0.5
		root.rotation.y = -0.55

		const beacon = new THREE.PointLight(0x5ef2ff, 4, 65)
		beacon.position.set(0, 5, 0)
		root.add(beacon)
		return root
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
			'<strong>SURVIVE THE LANDING</strong><br><span style="font-size:12px;opacity:.8">The crash alerted the planet. Reach the exploration rover.</span>'
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
			this.playerRoot.position.clone().add(new THREE.Vector3(10, 8, 18))
		)
		camera.lookAt(
			this.playerRoot.position.clone().add(new THREE.Vector3(0, 1.8, 0))
		)
		camera.updateProjectionMatrix()
	}

	_syncPlayerToTerrain() {
		this.playerRoot.position.y =
			alienTerrainHeight(
				this.playerRoot.position.x,
				this.playerRoot.position.z,
				this.baseY
			) + 2.2
	}

	_validateMovementCandidate(from, candidate, { allowSteepDownhill = true } = {}) {
		const hitBoundary = this.planet.clampToBounds(candidate, PLAYER_RADIUS)
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
		const nextHeight = this.planet.heightAt(candidate.x, candidate.z)
		const rising = nextHeight > currentHeight + 0.025
		const gradeDegrees = THREE.MathUtils.radToDeg(
			Math.atan2(Math.abs(nextHeight - currentHeight), horizontal)
		)
		const surfaceSlope = this.planet.slopeDegreesAt(candidate.x, candidate.z)
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
		const steps = Math.max(1, Math.ceil(distance / MAX_MOVEMENT_SUBSTEP))
		const stepDistance = distance / steps
		let moved = false

		for (let i = 0; i < steps; i++) {
			const from = this.playerRoot.position.clone()
			const candidate = from.clone().addScaledVector(dir, stepDistance)
			const result = this._validateMovementCandidate(from, candidate, {
				allowSteepDownhill: true,
			})

			if (result.hitBoundary && !sliding) {
				this._showMovementFeedback('MISSION AREA BOUNDARY')
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
				if (Math.abs(alternative[axis] - from[axis]) < 1e-5) continue
				const altResult = this._validateMovementCandidate(from, alternative, {
					allowSteepDownhill: true,
				})
				if (!altResult.ok) continue
				const progress = Math.hypot(
					alternative.x - from.x,
					alternative.z - from.z
				)
				if (!best || progress > best.progress) {
					best = { position: alternative, progress }
				}
			}

			if (best) {
				this.playerRoot.position.x = best.position.x
				this.playerRoot.position.z = best.position.z
				moved = true
				continue
			}

			if (result.blockedBySlope && !sliding) {
				this._showMovementFeedback('TOO STEEP — FIND ANOTHER ROUTE')
			}
			break
		}

		return moved
	}

	_applySlopeSlide(delta) {
		const slope = this.planet.slopeDegreesAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z
		)
		if (slope <= SLIDE_START_SLOPE) return

		const normal = this.planet.normalAt(
			this.playerRoot.position.x,
			this.playerRoot.position.z
		)
		const downhill = new THREE.Vector3(normal.x, 0, normal.z)
		if (downhill.lengthSq() < 1e-7) return

		const strength = clamp01((slope - SLIDE_START_SLOPE) / 18)
		const slideSpeed = 2.2 + strength * 7.5
		this._movePlayerDirection(downhill.normalize(), slideSpeed * delta, {
			sliding: true,
		})
	}

	_updatePlayerMovement(delta) {
		const move = new THREE.Vector3(
			(this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
			0,
			(this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0)
		)

		if (move.lengthSq() > 0) {
			move.normalize()
			const currentSlope = this.planet.slopeDegreesAt(
				this.playerRoot.position.x,
				this.playerRoot.position.z
			)
			const slopePenalty = 1 - Math.min(0.28, currentSlope / 180)
			const baseSpeed = this.keys.has('ShiftLeft') ? 20 : 12
			const moved = this._movePlayerDirection(
				move,
				baseSpeed * slopePenalty * delta
			)
			if (moved) this.playerRoot.rotation.y = Math.atan2(move.x, move.z)
		}

		this._applySlopeSlide(delta)
		this._syncPlayerToTerrain()
	}

	_updateMovementFeedback(delta) {
		if (this.feedbackTimer <= 0) return
		this.feedbackTimer -= delta
		if (this.feedbackTimer <= 0 && this.feedbackEl) {
			this.feedbackEl.style.opacity = '0'
		}
	}

	update(delta) {
		if (this.wreckFlame) {
			const pulse = 0.88 + Math.sin(performance.now() * 0.012) * 0.12
			this.wreckFlame.scale.setScalar(pulse)
			this.wreckFire.intensity = 4 + pulse * 2
			this.wreckSmoke.rotation.y += delta * 0.12
		}

		this._updatePlayerMovement(delta)
		this._updateMovementFeedback(delta)

		const camera = this.sceneManager.camera
		const desired = this.playerRoot.position
			.clone()
			.add(new THREE.Vector3(10, 8, 18))
		camera.position.lerp(desired, 1 - Math.exp(-5 * delta))
		camera.lookAt(
			this.playerRoot.position.clone().add(new THREE.Vector3(0, 1.8, 0))
		)

		const dx = this.playerRoot.position.x - this.rover.position.x
		const dz = this.playerRoot.position.z - this.rover.position.z
		if (this.objectiveEl && Math.hypot(dx, dz) < 16) {
			this.objectiveEl.innerHTML =
				'<strong>ROVER LOCATED</strong><br><span style="font-size:12px;opacity:.8">Vehicle systems are not enabled in this cinematic milestone yet.</span>'
		}
	}

	dispose() {
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
		this.objectiveEl?.remove()
		this.feedbackEl?.remove()
		this.gameplayColliders.length = 0
		this.planet?.dispose()
		super.dispose()
	}
}
