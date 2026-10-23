import * as THREE from 'three'
import { loadVoidModel } from '../levels/Level3/voidAssets.js'

const TAU = Math.PI * 2
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1)

// Fixed seeds make the approach corridor identical on every playthrough.
function randomAt(index, salt = 0) {
	const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
	return value - Math.floor(value)
}

/**
 * A distant, cache-safe cinematic extension of the existing Level 3 ruins.
 * Local -Z is the direction of arrival. The central aperture stays clear:
 * no hull, debris or imported monument enters the 90-unit flight corridor.
 * This set can be reparented above Level 3 without replacing its terrain,
 * monuments, enemy roster or player systems.
 */
export class VoidTransitEnvironment {
	constructor({ assetManager }) {
		this.assetManager = assetManager
		this.group = new THREE.Group()
		this.group.name = 'void-transit-megastructure'
		this._disposed = false
		this._elapsed = 0
		this._arrival = 0
		this._resources = new Set()
		this._instances = []
		this._matrix = new THREE.Object3D()
		this._presenceLights = []
		this._createStructure()
		this._createDebris()
		// Load serially: the existing web GLBs are several MB each. The
		// procedural silhouette is present immediately, including on failure.
		this.ready = this._loadMonuments()
	}

	_own(resource) {
		this._resources.add(resource)
		return resource
	}

	_mesh(geometry, material, parent = this.group) {
		const mesh = new THREE.Mesh(geometry, material)
		mesh.castShadow = false
		mesh.receiveShadow = false
		parent.add(mesh)
		return mesh
	}

	_instancesOf(geometry, material, count) {
		const mesh = new THREE.InstancedMesh(geometry, material, count)
		mesh.castShadow = false
		mesh.receiveShadow = false
		this.group.add(mesh)
		this._instances.push(mesh)
		return mesh
	}

	_createStructure() {
		const hull = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x18242e,
				metalness: 0.65,
				roughness: 0.72,
				emissive: 0x101a28,
				emissiveIntensity: 0.65,
			})
		)
		this._cyan = this._own(
			new THREE.MeshBasicMaterial({
				color: 0x67e9ef,
				transparent: true,
				opacity: 0.62,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
		)
		this._violet = this._own(
			new THREE.MeshBasicMaterial({
				color: 0x9870eb,
				transparent: true,
				opacity: 0.42,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
		)
		const box = this._own(new THREE.BoxGeometry(1, 1, 1))

		// The primary ring is a physical aperture, never a flat portal disc.
		const rings = [
			{ radius: 220, tube: 11, z: 0, x: 0.03, y: -0.04 },
			{ radius: 294, tube: 7, z: -78, x: -0.07, y: 0.08 },
			{ radius: 126, tube: 6, z: -146, x: 0, y: 0 },
		]
		rings.forEach((def, index) => {
			const pivot = new THREE.Group()
			pivot.position.z = def.z
			pivot.rotation.set(def.x, def.y, index * 0.16)
			this.group.add(pivot)
			this._mesh(
				this._own(
					new THREE.TorusGeometry(
						def.radius,
						def.tube,
						8,
						96
					)
				),
				hull,
				pivot
			)
			const channel = this._mesh(
				this._own(
					new THREE.TorusGeometry(
						def.radius - def.tube * 0.2,
						0.9,
						4,
						96
					)
				),
				index === 1 ? this._violet : this._cyan,
				pivot
			)
			channel.position.z = def.tube + 0.6
		})

		const ribs = this._instancesOf(box, hull, 24)
		const runes = this._instancesOf(box, this._cyan, 48)
		for (let index = 0; index < 24; index++) {
			const angle = (index / 24) * TAU
			const radius = 250
			this._matrix.position.set(
				Math.cos(angle) * radius,
				Math.sin(angle) * radius,
				-38
			)
			this._matrix.rotation.set(0, 0, angle - Math.PI / 2)
			this._matrix.scale.set(18, 82, 72)
			this._matrix.updateMatrix()
			ribs.setMatrixAt(index, this._matrix.matrix)
			for (let side = 0; side < 2; side++) {
				this._matrix.position.set(
					Math.cos(angle + side * 0.018) * 221,
					Math.sin(angle + side * 0.018) * 221,
					13
				)
				this._matrix.scale.set(1.1, 14, 1.5)
				this._matrix.updateMatrix()
				runes.setMatrixAt(
					index * 2 + side,
					this._matrix.matrix
				)
			}
		}
		ribs.instanceMatrix.needsUpdate = true
		runes.instanceMatrix.needsUpdate = true

		const monoliths = this._instancesOf(box, hull, 28)
		for (let index = 0; index < monoliths.count; index++) {
			const angle = (index / monoliths.count) * TAU + 0.1
			const radius = 355 + randomAt(index, 1) * 70
			this._matrix.position.set(
				Math.cos(angle) * radius,
				Math.sin(angle) * radius,
				-180 - randomAt(index, 2) * 150
			)
			this._matrix.rotation.set(
				0.1 * Math.sin(angle),
				0.12 * Math.cos(angle),
				angle
			)
			this._matrix.scale.set(
				14 + randomAt(index, 3) * 18,
				65 + randomAt(index, 4) * 100,
				18 + randomAt(index, 5) * 30
			)
			this._matrix.updateMatrix()
			monoliths.setMatrixAt(index, this._matrix.matrix)
		}
		monoliths.instanceMatrix.needsUpdate = true

		// An occluded recess suggests a presence. Only distant slit lights
		// activate; no enemy/boss asset or fully readable silhouette is used.
		const recess = this._mesh(box, hull)
		recess.position.set(0, 238, -225)
		recess.scale.set(98, 56, 40)
		const slitGeometry = this._own(new THREE.BoxGeometry(7, 1.8, 1))
		for (let index = 0; index < 5; index++) {
			const material = this._own(
				new THREE.MeshBasicMaterial({
					color: 0xc19aff,
					transparent: true,
					opacity: 0,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				})
			)
			const slit = this._mesh(slitGeometry, material)
			slit.position.set(-30 + index * 15, 238, -203)
			this._presenceLights.push(slit)
		}
		this._coreLight = new THREE.PointLight(0x6deaff, 2.8, 540, 1.6)
		this._coreLight.position.set(150, 75, 90)
		this._rimLight = new THREE.PointLight(0x956aff, 2.2, 470, 1.6)
		this._rimLight.position.set(-140, -60, 30)
		this.group.add(this._coreLight, this._rimLight)
	}

	_createDebris() {
		const geometry = this._own(new THREE.IcosahedronGeometry(1, 0))
		const material = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x343447,
				roughness: 0.86,
				metalness: 0.3,
				emissive: 0x12101e,
				emissiveIntensity: 0.45,
			})
		)
		this._debris = this._instancesOf(geometry, material, 112)
		this._debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this._debrisData = Array.from(
			{ length: this._debris.count },
			(_, index) => ({
				angle: randomAt(index, 11) * TAU,
				radius: 145 + randomAt(index, 12) * 310,
				z: -380 + randomAt(index, 13) * 650,
				size: 1.6 + randomAt(index, 14) * 6,
				rate: 0.001 + randomAt(index, 15) * 0.003,
			})
		)
		this._updateDebris(0)
	}

	async _loadMonuments() {
		const placements = [
			{
				key: 'bossArena',
				size: 340,
				at: [0, -264, -120],
				yaw: 0.14,
			},
			{
				key: 'ancientReactor',
				size: 92,
				at: [176, 0, -72],
				yaw: -0.4,
			},
			{
				key: 'brokenBridge',
				size: 145,
				at: [-210, -55, -170],
				yaw: 0.18,
			},
		]
		for (const def of placements) {
			if (this._disposed) return
			const model = await loadVoidModel(
				this.assetManager,
				def.key
			)
			if (this._disposed) return
			if (!model) continue
			// A pivot normalises size without modifying any cache-owned mesh,
			// material or geometry. AssetManager's shared-resource flags remain.
			const pivot = new THREE.Group()
			pivot.name = `cinematic-${def.key}`
			pivot.add(model)
			model.updateMatrixWorld(true)
			const bounds = new THREE.Box3().setFromObject(model)
			const dimensions = bounds.getSize(new THREE.Vector3())
			const longest = Math.max(
				dimensions.x,
				dimensions.y,
				dimensions.z
			)
			if (longest > 0) {
				model.scale.multiplyScalar(def.size / longest)
				model.updateMatrixWorld(true)
				model.position.sub(
					new THREE.Box3()
						.setFromObject(model)
						.getCenter(new THREE.Vector3())
				)
			}
			model.traverse((child) => {
				if (child.isMesh) {
					child.castShadow = false
					child.receiveShadow = false
				}
			})
			pivot.position.fromArray(def.at)
			pivot.rotation.y = def.yaw
			this.group.add(pivot)
		}
	}

	setArrival(value) {
		this._arrival = clamp01(value)
	}

	_updateDebris(interference) {
		const attraction = interference * 0.06
		this._debrisData.forEach((piece, index) => {
			const angle =
				piece.angle +
				this._elapsed * piece.rate * (1 + interference)
			const radius = piece.radius * (1 - attraction)
			this._matrix.position.set(
				Math.cos(angle) * radius,
				Math.sin(angle) * radius,
				piece.z - interference * 8
			)
			this._matrix.rotation.set(
				angle * 0.2,
				angle,
				angle * 0.7
			)
			this._matrix.scale.set(
				piece.size,
				piece.size * 0.65,
				piece.size * 1.5
			)
			this._matrix.updateMatrix()
			this._debris.setMatrixAt(index, this._matrix.matrix)
		})
		this._debris.instanceMatrix.needsUpdate = true
		this._debris.computeBoundingSphere()
	}

	update(delta, { interference = 0, presence = 0 } = {}) {
		if (this._disposed) return
		this._elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0)
		const force = clamp01(interference)
		const pulse = Math.sin(this._elapsed * 0.9) * 0.04
		const flicker = force * Math.sin(this._elapsed * 13) * 0.08
		this._cyan.opacity = 0.5 + this._arrival * 0.3 + pulse + flicker
		this._violet.opacity = 0.38 + force * 0.24 + pulse
		this._coreLight.intensity = 2.8 + force * 0.6 + pulse
		this._rimLight.intensity = 2.2 + this._arrival * 0.8
		this._presenceLights.forEach((slit, index) => {
			const activation = clamp01(
				(presence - index * 0.12) * 4
			)
			slit.material.opacity = activation * 0.8
		})
		this._updateDebris(force)
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		this.group.removeFromParent()
		// Imported GLBs share the AssetManager cache. Detach their clones;
		// dispose only geometries/materials created by this controller.
		this.group.clear()
		for (const instance of this._instances) instance.dispose()
		for (const resource of this._resources) resource.dispose()
		this._resources.clear()
		this._instances.length = 0
		this._presenceLights.length = 0
	}
}
