import * as THREE from 'three'
import { SHIPS } from '../systems/ShipManager.js'
import { MODEL_YAW } from '../levels/Level1/Spaceship.js'
import { loadVoidModel, VOID_ASSETS } from '../levels/Level3/voidAssets.js'

const SHIP_SIZE = 12
const ANOMALY_SIZE = 18

/** A visual ship for cinematic paths, with no flight controller or input. */
export class CinematicShip {
	constructor({
		assetManager,
		shipKey = 'vanguard',
		craft = 'selected',
	} = {}) {
		this.assetManager = assetManager
		this.shipKey = SHIPS[shipKey] ? shipKey : 'vanguard'
		this.craft = craft === 'anomaly' ? 'anomaly' : 'selected'
		this.assetPath =
			this.craft === 'anomaly'
				? VOID_ASSETS.anomalyShip.path
				: SHIPS[this.shipKey].model
		this.group = new THREE.Group()
		this.group.name = 'cinematic-ship'
		this.modelRoot = new THREE.Group()
		this.modelRoot.name = 'cinematic-ship-hull'
		this.group.add(this.modelRoot)
		this.loaded = false
		this.hullBounds = new THREE.Box3()
		this.hullBottom = -1.6
		this.hatchLocal = new THREE.Vector3(5, -1.25, 2)
		this._disposed = false
		this._time = 0
		this._owned = new Set()
		this._fallbackResources = new Set()
		this._fallback = this._createFallback()
		this.modelRoot.add(this._fallback)
		this._measureHull(this._fallback)
		this._createEngine()
		this._createRunningLights()
		this._positionEffects()
		this.update(0)
		this.ready = this._loadModel()
	}

	_own(resource, fallback = false) {
		this._owned.add(resource)
		if (fallback) this._fallbackResources.add(resource)
		return resource
	}

	_createFallback() {
		if (this.craft === 'anomaly')
			return this._createAnomalyFallback()
		// The same nose-forward cone used by Level 1 remains a readable ship
		// if the chosen GLB is unavailable. A canopy and swept wings give the
		// grounded silhouette enough detail for the boarding shot.
		const root = new THREE.Group()
		root.name = 'cinematic-ship-loading-fallback'
		const hullMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x8799aa,
				metalness: 0.65,
				roughness: 0.4,
			}),
			true
		)
		const hullGeometry = this._own(
			new THREE.ConeGeometry(1.6, 12, 10),
			true
		)
		hullGeometry.rotateX(-Math.PI / 2)
		const hull = new THREE.Mesh(hullGeometry, hullMaterial)
		const wingGeometry = this._own(
			new THREE.BoxGeometry(9, 0.16, 3),
			true
		)
		const wings = new THREE.Mesh(wingGeometry, hullMaterial)
		wings.position.set(0, -0.3, 1.4)
		const canopyGeometry = this._own(
			new THREE.SphereGeometry(1, 12, 8),
			true
		)
		const canopyMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x112738,
				metalness: 0.45,
				roughness: 0.22,
			}),
			true
		)
		const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial)
		canopy.position.set(0, 0.8, -1.7)
		canopy.scale.set(0.75, 0.65, 1.4)
		root.add(hull, wings, canopy)
		return root
	}

	_createAnomalyFallback() {
		// Keep the stolen craft recognisably distinct even if its GLB cannot
		// load: an angular dark hull, swept wings and paired violet engines.
		const root = new THREE.Group()
		root.name = 'cinematic-anomaly-loading-fallback'
		const hullMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x292637,
				metalness: 0.7,
				roughness: 0.48,
			}),
			true
		)
		const hullGeometry = this._own(
			new THREE.ConeGeometry(2.2, ANOMALY_SIZE, 6),
			true
		)
		hullGeometry.rotateX(-Math.PI / 2)
		const hull = new THREE.Mesh(hullGeometry, hullMaterial)
		hull.scale.y = 0.55
		root.add(hull)
		const wingGeometry = this._own(
			new THREE.BoxGeometry(4.4, 0.2, 2.6),
			true
		)
		const engineGeometry = this._own(
			new THREE.CylinderGeometry(0.85, 0.85, 4, 8),
			true
		)
		engineGeometry.rotateX(Math.PI / 2)
		for (const side of [-1, 1]) {
			const wing = new THREE.Mesh(wingGeometry, hullMaterial)
			wing.position.set(side * 2.9, -0.3, 3.2)
			wing.rotation.y = side * -0.3
			const engine = new THREE.Mesh(
				engineGeometry,
				hullMaterial
			)
			engine.position.set(side * 1.6, 0.2, 5.1)
			root.add(wing, engine)
		}
		return root
	}

	async _loadModel() {
		if (!this.assetManager?.loadModel) return false
		try {
			const model =
				this.craft === 'anomaly'
					? await loadVoidModel(
							this.assetManager,
							'anomalyShip'
						)
					: await this.assetManager.loadModel(
							this.assetPath
						)
			// AssetManager owns the returned clone's shared GLB resources. A late
			// result can simply be abandoned; disposing it would break gameplay.
			if (this._disposed || this._appearanceLocked || !model)
				return false
			const pivot = new THREE.Group()
			pivot.name = `cinematic-${this.craft === 'anomaly' ? 'anomaly' : this.shipKey}`
			if (this.craft === 'anomaly') {
				// Verified against front, side and top renders of the real GLB.
				// Its authored nose is mostly +Y, tilted toward +X/-Z; +Z is
				// dorsal. Align the measured nozzle-to-nose line with local -Z.
				const forward = new THREE.Vector3(
					0.28,
					1.52,
					-0.74
				).normalize()
				const up = new THREE.Vector3(0, 0, 1)
					.addScaledVector(forward, -forward.z)
					.normalize()
				const right = new THREE.Vector3()
					.crossVectors(forward, up)
					.normalize()
				const basis = new THREE.Matrix4().makeBasis(
					right,
					up,
					forward.negate()
				)
				pivot.quaternion.setFromRotationMatrix(
					basis.invert()
				)
			} else {
				pivot.rotation.y = MODEL_YAW[this.shipKey] || 0
			}
			pivot.add(model)
			pivot.updateMatrixWorld(true)
			const precise = this.craft === 'anomaly'
			const box = new THREE.Box3().setFromObject(
				pivot,
				precise
			)
			const size = box.getSize(new THREE.Vector3())
			const longest = Math.max(size.x, size.y, size.z)
			if (!Number.isFinite(longest) || longest <= 0)
				return false
			pivot.scale.setScalar(
				(precise ? ANOMALY_SIZE : SHIP_SIZE) / longest
			)
			pivot.updateMatrixWorld(true)
			box.setFromObject(pivot, precise)
			pivot.position.sub(box.getCenter(new THREE.Vector3()))
			pivot.updateMatrixWorld(true)
			// Measure while detached so a moving cinematic root cannot affect
			// the local landing clearance or engine attachment positions.
			this._measureHull(pivot)
			this._fallback.removeFromParent()
			this.modelRoot.add(pivot)
			this.model = model
			this.loaded = true
			for (const resource of this._fallbackResources) {
				resource.dispose()
				this._owned.delete(resource)
			}
			this._fallbackResources.clear()
			this._fallback = null
			this._positionEffects()
			return true
		} catch (error) {
			if (!this._disposed) {
				console.warn(
					'[CinematicShip] Using fallback ship:',
					error?.message
				)
			}
			return false
		}
	}

	/** Keep boarding geometry stable if a download misses its bounded wait. */
	lockAppearance() {
		this._appearanceLocked = true
	}

	_measureHull(model) {
		model.traverse((node) => {
			if (node.isMesh)
				node.castShadow = node.receiveShadow = true
		})
		model.updateMatrixWorld(true)
		this.hullBounds.setFromObject(model, this.craft === 'anomaly')
		this.hullBottom = this.hullBounds.min.y
		// The walking endpoint stays clear of every selected hull, including
		// the wide Starfighter. The anomaly mesh has no articulated hatch;
		// its endpoint is beside the forward fuselage, ahead of the wings.
		this.hatchLocal.set(
			this.hullBounds.max.x + 0.65,
			this.hullBottom + 0.35,
			this.craft === 'anomaly'
				? this.hullBounds.min.z * 0.18
				: Math.min(2, this.hullBounds.max.z * 0.55)
		)
	}

	_createEngine() {
		this.engineRoot = new THREE.Group()
		this.engineRoot.name = 'cinematic-ship-engine'
		this.group.add(this.engineRoot)
		this._coreMaterial = this._own(
			new THREE.MeshBasicMaterial({
				color: 0x9cecff,
				transparent: true,
				opacity: 0.65,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			})
		)
		this._core = new THREE.Mesh(
			this._own(new THREE.SphereGeometry(0.6, 12, 8)),
			this._coreMaterial
		)
		this._core.scale.set(1, 0.7, 0.3)
		this._flameMaterial = this._own(
			new THREE.MeshBasicMaterial({
				color: 0x66ccff,
				transparent: true,
				opacity: 0.18,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				side: THREE.DoubleSide,
				toneMapped: false,
			})
		)
		const flameGeometry = this._own(
			new THREE.ConeGeometry(0.52, 2.8, 12, 1, true)
		)
		// Geometry starts at the tail and tapers down the exhaust's +Z axis.
		flameGeometry.translate(0, 1.4, 0)
		flameGeometry.rotateX(Math.PI / 2)
		this._flame = new THREE.Mesh(flameGeometry, this._flameMaterial)
		this._flame.position.z = 0.08
		this._engineLight = new THREE.PointLight(0x66ccff, 0.3, 10, 2)
		this._engineLight.castShadow = false
		this._engineLight.position.z = 0.35
		this.engineRoot.add(this._core, this._flame, this._engineLight)
		if (this.craft === 'anomaly') {
			this._coreMaterial.color.setHex(0xbd9eff)
			this._flameMaterial.color.setHex(0x9277ff)
			this._engineLight.color.setHex(0x9277ff)
			this._secondCore = this._core.clone()
			this._secondFlame = this._flame.clone()
			this.engineRoot.add(this._secondCore, this._secondFlame)
		}
	}

	_createRunningLights() {
		const geometry = this._own(
			new THREE.SphereGeometry(0.065, 8, 6)
		)
		this._runningLights = [0xff7777, 0x8cddf1, 0xf0f5ff].map(
			(color) => {
				const material = this._own(
					new THREE.MeshBasicMaterial({
						color,
						transparent: true,
						opacity: 0.7,
						toneMapped: false,
					})
				)
				const light = new THREE.Mesh(geometry, material)
				this.group.add(light)
				return light
			}
		)
	}

	_positionEffects() {
		const box = this.hullBounds
		this.engineRoot.position.set(0, 0, box.max.z - 0.08)
		if (this.craft === 'anomaly') {
			const width = box.max.x - box.min.x
			const height = box.max.y - box.min.y
			// Actual twin nozzles sit inboard of the wings, above the keel.
			this.engineRoot.position.set(
				0,
				box.min.y + height * 0.75,
				box.max.z * 0.73
			)
			this._core.position.x = this._flame.position.x =
				-width * 0.21
			this._secondCore.position.x =
				this._secondFlame.position.x = width * 0.21
		}
		this._runningLights[0].position.set(
			box.min.x,
			0.05,
			box.max.z * 0.2
		)
		this._runningLights[1].position.set(
			box.max.x,
			0.05,
			box.max.z * 0.2
		)
		this._runningLights[2].position.set(
			0,
			box.max.y + 0.03,
			box.max.z * 0.55
		)
		if (this.craft === 'anomaly') {
			const wingY = box.min.y + (box.max.y - box.min.y) * 0.66
			for (let i = 0; i < 2; i++) {
				this._runningLights[i].position.y = wingY
				this._runningLights[i].position.z =
					box.max.z * 0.46
			}
			this._runningLights[2].position.z = 0
		}
	}

	setTransitOpacity(opacity) {
		if (!this._transitMaterials) {
			this._transitMaterials = []
			this.group.traverse((node) => {
				if (!node.isMesh) return
				const clone = (source) => {
					const material = this._own(
						source.clone()
					)
					this._transitMaterials.push({
						material,
						opacity: source.opacity,
					})
					material.transparent = true
					return material
				}
				node.material = Array.isArray(node.material)
					? node.material.map(clone)
					: clone(node.material)
			})
		}
		for (const entry of this._transitMaterials)
			entry.material.opacity = entry.opacity * opacity
	}

	update(delta, { thrust = 0.3, interference = 0 } = {}) {
		if (this._disposed) return
		this._time += Number.isFinite(delta) ? Math.max(0, delta) : 0
		const power = THREE.MathUtils.clamp(
			Number.isFinite(thrust) ? thrust : 0,
			0,
			1
		)
		const disturbance = THREE.MathUtils.clamp(
			Number.isFinite(interference) ? interference : 0,
			0,
			1
		)
		// A stable engine at normal thrust; the anomaly alone introduces a
		// small deterministic flicker instead of a permanently noisy flame.
		const flicker =
			1 +
			disturbance *
				0.055 *
				(Math.sin(this._time * 31) +
					0.4 * Math.sin(this._time * 53))
		this._coreMaterial.opacity = (0.2 + power * 0.5) * flicker
		this._flameMaterial.opacity = power * 0.25 * flicker
		this._flame.scale.set(
			0.7 + power * 0.3,
			0.7 + power * 0.3,
			0.2 + power * 1.2
		)
		this._flame.visible = power > 0.005
		if (this._secondFlame) {
			this._secondFlame.scale.copy(this._flame.scale)
			this._secondFlame.visible = this._flame.visible
		}
		this._engineLight.intensity = power * 0.5 * flicker
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		this.group.removeFromParent()
		this.group.clear()
		this.modelRoot.clear()
		this.model = null
		for (const resource of this._owned) resource.dispose()
		this._owned.clear()
		this._fallbackResources.clear()
	}
}
