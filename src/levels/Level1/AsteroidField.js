import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { NitrogenCanister } from './Nitrogen'
import { AssetManager } from '../../core/AssetManager'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const ASTEROID_MODELS = ['/public/assets/models/asteroids/asteroid_01.glb']

export class AsteroidField {
	constructor(
		level,
		blackHole,
		{
			spawnRadius = 1000,
			count = 1000,
			models = ASTEROID_MODELS,
			modelRadius = 6,
			colliderScale = 1, // <1 shrinks the shard colliders (more forgiving hits)
			lodDistance = 400, // asteroids farther than this from the ship draw as a cheap proxy
			farDetail = 0, // icosahedron detail for that proxy (0 = 20 triangles)
			debrisSpeed = 60, // how fast shards fly apart when an asteroid is hit (units/s)
			debrisLife = 3, // seconds before the shards have shrunk away
			debrisInherit = 0.1, // fraction of the asteroid's own velocity the shards keep
		} = {}
	) {
		this.level = level
		this.blackHole = blackHole
		this.spawnRadius = spawnRadius // lateral spread, perpendicular to the gravity axis
		this.spawnJitter = 500 // spread along the travel axis when (re)spawning near the front
		this.spawnDistance = 1000 // how far out along +normal asteroids start
		// Recycle an asteroid once it is this far BEHIND THE SHIP (signed, so
		// negative). It used to be measured from the black hole instead, so
		// asteroids only respawned after flying all the way back to z = -20:
		// as the ship escaped, the field ended up trailing behind it and the
		// space ahead thinned out, making the late game trivially easy.
		this.recycleDistance = -150
		this.baseSpeed = 200
		this.speedVariance = 100
		this.assetManager = new AssetManager()

		this.count = count
		this.modelUrls = models
		this.modelRadius = modelRadius
		this.colliderScale = colliderScale
		this.lodDistanceSq = lodDistance * lodDistance
		this.farDetail = farDetail
		this.farMesh = null // one shared low-poly InstancedMesh for every far asteroid

		this.debrisSpeed = debrisSpeed
		this.debrisLife = debrisLife
		this.debrisInherit = debrisInherit
		this.maxDebris = 6 // live shatter effects at once; the oldest is dropped past this
		this.debris = []
		this.debrisRoot = null
		this._spin = new THREE.Quaternion()

		this.models = [] // { pieces, colliders, radius, matrices }
		this.asteroids = []

		this.canisters = []
		this.canisterGroup = new THREE.Group()
		this.canisterGroup.name = 'nitrogenCanisters'
		this.level.addObject(this.canisterGroup)

		// eliminate overhead for object instantiation in matrix update
		this._matrix = new THREE.Matrix4()
		this._quat = new THREE.Quaternion()
		this._scale = new THREE.Vector3()
		this._center = new THREE.Vector3()

		this.loaded = false
		this._pendingClear = null

		this.ready = this.createAsteroids()
			.then(() => {
				// the ship's spawn bubble was requested before there were any
				// asteroids to clear, so apply it now
				if (this._pendingClear) {
					const { position, radius } =
						this._pendingClear
					this._pendingClear = null
					this.clearAround(position, radius)
				}
			})
			.catch((err) => {
				console.error(
					'AsteroidField: failed to load asteroid models',
					err
				)
			})
	}

	getBasis(normal) {
		const arbitrary =
			Math.abs(normal.y) < 0.99
				? new THREE.Vector3(0, 1, 0)
				: new THREE.Vector3(1, 0, 0)
		const tangent = new THREE.Vector3()
			.crossVectors(arbitrary, normal)
			.normalize()
		const bitangent = new THREE.Vector3()
			.crossVectors(normal, tangent)
			.normalize()
		return { tangent, bitangent }
	}

	loadModel(loader, url) {
		return loader
			.loadAsync(url)
			.then((gltf) => this.buildModel(gltf, url))
	}

	buildModel(gltf, url) {
		gltf.scene.updateMatrixWorld(true)

		const pieces = []
		gltf.scene.traverse((obj) => {
			if (!obj.isMesh) return
			const geometry = obj.geometry
				.clone()
				.applyMatrix4(obj.matrixWorld)
			pieces.push({ geometry, material: obj.material })
		})
		if (!pieces.length) throw new Error(`No meshes found in ${url}`)

		// centre the combined model on the origin so it tumbles around its middle
		const box = new THREE.Box3()
		for (const p of pieces) {
			p.geometry.computeBoundingBox()
			box.union(p.geometry.boundingBox)
		}
		const center = box.getCenter(new THREE.Vector3())

		let radius = 0
		for (const p of pieces) {
			p.geometry.translate(-center.x, -center.y, -center.z)
			p.geometry.computeBoundingSphere()
			const s = p.geometry.boundingSphere
			radius = Math.max(radius, s.center.length() + s.radius)
		}

		// normalise radius of rendered model to the desired this.modelRadius
		const scale = this.modelRadius / radius
		const colliders = []
		const shards = []
		for (const p of pieces) {
			p.geometry.scale(scale, scale, scale)
			p.geometry.computeBoundingSphere()
			const s = p.geometry.boundingSphere
			colliders.push({
				center: s.center.clone(),
				radius: s.radius * this.colliderScale,
			})
			const shardGeo = p.geometry.clone()

			// a copy re-centred on its own middle, so a debris chunk can
			// tumble in place when the asteroid shatters
			shardGeo.translate(
				-s.center.x,
				-s.center.y,
				-s.center.z
			)
			this.level.own(shardGeo)
			shards.push({
				geometry: shardGeo,
				material: p.material,
				center: s.center.clone(),
			})

			// this.level.own(p.geometry)
			this.level.own(p.material)
			for (const v of Object.values(p.material)) {
				if (v && v.isTexture) this.level.own(v)
			}
		}

		// `radius` is the whole-model sphere (centred on the origin), used as
		// the cheap broad-phase check before testing individual shards
		return {
			parts: this.mergeShards(pieces),
			shards, // per-shard geometry + local centre, used by shatter()
			colliders,
			radius: this.modelRadius,
			matrices: null,
			meshes: [], // the near-LOD InstancedMeshes (one per merged part)
			nearCount: 0, // how many of this model's asteroids are near this frame
		}
	}

	/** Shards only matter for collision. For drawing they all move rigidly
	 * together, so merge them into one geometry per material: roughly one
	 * draw call per model instead of one per shard. */
	mergeShards(pieces) {
		const byMaterial = new Map()
		for (const p of pieces) {
			if (!byMaterial.has(p.material))
				byMaterial.set(p.material, [])
			byMaterial.get(p.material).push(p.geometry)
		}

		const parts = []
		for (const [material, geometries] of byMaterial) {
			const merged =
				geometries.length > 1
					? mergeGeometries(geometries, false)
					: geometries[0]
			if (merged) {
				parts.push({ geometry: merged, material })
			} else {
				// mergeGeometries returns null if the shards' attributes differ
				// (e.g. some have UVs and some don't) — fall back to one each
				console.warn(
					'AsteroidField: could not merge shards, drawing them separately'
				)
				for (const g of geometries)
					parts.push({ geometry: g, material })
			}
		}
		for (const part of parts) this.level.own(part.geometry)
		return parts
	}

	createAsteroids() {
		const loader = new GLTFLoader()
		return Promise.all(
			this.modelUrls.map((url) => this.loadModel(loader, url))
		).then((models) => {
			this.models = models
			this.populate()
		})
	}

	populate() {
		// equal split of models as asteroids
		const n = this.models.length
		const base = Math.floor(this.count / n)
		const extra = this.count % n

		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)

		this.models.forEach((model, modelIndex) => {
			// number of instances of this model for an equal share
			const instances = base + (modelIndex < extra ? 1 : 0)
			if (instances === 0) return

			// One InstancedMesh per shard. They all share a single instance
			// matrix buffer, so a shard always sits exactly where the rest of
			// its asteroid is and we only write each asteroid's matrix once.
			model.parts.forEach((part, partIndex) => {
				const mesh = new THREE.InstancedMesh(
					part.geometry,
					part.material,
					instances
				)
				mesh.name = `asteroidField_${modelIndex}_${partIndex}`
				// instance bounds are only computed once by three.js, but the
				// asteroids keep moving, so never cull these
				mesh.frustumCulled = false
				if (model.matrices)
					mesh.instanceMatrix = model.matrices
				else model.matrices = mesh.instanceMatrix

				// near the ship are drawn: count is set each frame
				mesh.count = 0
				model.meshes.push(mesh)
				this.level.addObject(mesh)
			})

			for (let i = 0; i < instances; i++) {
				if (Math.random() < 0.05) {
					const canister = this.spawnCanister(
						tangent,
						bitangent,
						true
					)

					this.canisters.push(canister)
				} else {
					const asteroid = this.spawnAsteroid(
						tangent,
						bitangent,
						true
					)

					asteroid.modelIndex = modelIndex
					this.asteroids.push(asteroid)
				}
			}
		})

		// Far LOD: one cheap flat-shaded proxy shared by every asteroid that
		// is beyond lodDistance. Same radius as the models, so sizes match.
		const farGeo = new THREE.IcosahedronGeometry(
			this.modelRadius,
			this.farDetail
		)
		const farMat = new THREE.MeshStandardMaterial({
			color: 0x8a8a8a,
			flatShading: true,
		})
		this.level.own(farGeo)
		this.level.own(farMat)
		this.farMesh = new THREE.InstancedMesh(
			farGeo,
			farMat,
			this.asteroids.length
		)
		this.farMesh.name = 'asteroidFieldFar'
		this.farMesh.frustumCulled = false
		this.farMesh.count = 0
		this.level.addObject(this.farMesh)

		// all shatter debris lives under one group, added to the scene once
		this.debrisRoot = new THREE.Group()
		this.debrisRoot.name = 'asteroidDebris'
		this.level.addObject(this.debrisRoot)

		this.loaded = true
		this.updateInstanceMatrices()
	}

	/** Respawn one asteroid far ahead after it hits the ship, so the
	 * same rock cannot register a second hit on the next frame. */
	removeAsteroid(asteroid, shatter = true) {
		if (shatter) this.shatter(asteroid)
		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)

		this.replaceAsteroid(asteroid, tangent, bitangent)
	}

	/** Push every asteroid out of a bubble around `position`. The field is
	 * filled at random on creation, so without this a run could open with a
	 * rock already overlapping the ship — an instant, unavoidable hit. */
	clearAround(position, radius) {
		if (!this.loaded) {
			this._pendingClear = {
				position: position.clone(),
				radius,
			}
			return
		}
		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)

		const limitSq = radius * radius

		for (const a of this.asteroids) {
			if (a.position.distanceToSquared(position) < limitSq) {
				this.replaceAsteroid(a, tangent, bitangent)
			}
		}
		for (const canister of this.canisters) {
			if (
				canister.position.distanceToSquared(position) <
				limitSq
			) {
				this.replaceCanister(canister)
			}
		}
	}

	/** Two-phase test: a cheap sphere around the whole asteroid first, then
	 * the individual shard spheres (rotated/scaled/translated into world space)
	 * only for the few asteroids that are actually close to the ship. */
	checkShipCollision(ship) {
		const shipPos = ship.position
		const shipRadius = ship.collisionRadius
		const quat = this._quat
		const center = this._center

		for (const a of this.asteroids) {
			const model = this.models[a.modelIndex]
			const broad = model.radius * a.scale + shipRadius
			if (
				a.position.distanceToSquared(shipPos) >
				broad * broad
			)
				continue

			quat.setFromAxisAngle(a.rotationAxis, a.rotation)
			for (const c of model.colliders) {
				center.copy(c.center)
					.multiplyScalar(a.scale)
					.applyQuaternion(quat)
					.add(a.position)
				const r = c.radius * a.scale + shipRadius
				if (center.distanceToSquared(shipPos) < r * r)
					return a
			}
		}

		return null
	}

	checkCanisterCollision(ship) {
		const shipPos = ship.position
		const shipRadius = ship.collisionRadius

		for (const canister of this.canisters) {
			const combinedRadius =
				canister.collisionRadius + shipRadius

			if (
				canister.position.distanceToSquared(shipPos) <
				combinedRadius * combinedRadius
			) {
				return canister
			}
		}

		return null
	}

	/** Break a hit asteroid into its fracture shards. Each shard becomes a
	 * normal mesh that flies outward, tumbles, then shrinks away. It starts
	 * at exactly the asteroid's position, rotation and scale, so the swap from
	 * the instanced rock to the debris is seamless. Debris is cosmetic only:
	 * it is never collision-tested. */
	shatter(a) {
		const model = this.models[a.modelIndex]
		if (!model || !this.debrisRoot) return

		// keep the number of live shatter effects bounded
		while (this.debris.length >= this.maxDebris) {
			this.removeDebris(this.debris.shift())
		}

		const quat = new THREE.Quaternion().setFromAxisAngle(
			a.rotationAxis,
			a.rotation
		)
		const pieces = []
		for (const shard of model.shards) {
			const offset = shard.center
				.clone()
				.multiplyScalar(a.scale)
				.applyQuaternion(quat)

			const mesh = new THREE.Mesh(
				shard.geometry,
				shard.material
			)
			mesh.position.copy(a.position).add(offset)
			mesh.quaternion.copy(quat)
			mesh.scale.setScalar(a.scale)

			// outward from the asteroid's centre plus some randomness (shards
			// near the middle have no meaningful "outward"), on top of a share
			// of the asteroid's own velocity
			const velocity = offset
				.clone()
				.normalize()
				.addScaledVector(randomUnit(), 0.6)
				.normalize()
				.multiplyScalar(
					this.debrisSpeed * (0.5 + Math.random())
				)
				.addScaledVector(a.velocity, this.debrisInherit)

			pieces.push({
				mesh,
				velocity,
				spinAxis: randomUnit(),
				spinSpeed: (Math.random() - 0.5) * 8,
				baseScale: a.scale,
			})
			this.debrisRoot.add(mesh)
		}
		this.debris.push({ pieces, age: 0 })
	}

	updateDebris(dt) {
		for (let i = this.debris.length - 1; i >= 0; i--) {
			const cloud = this.debris[i]
			cloud.age += dt
			const t = cloud.age / this.debrisLife
			if (t >= 1) {
				this.removeDebris(cloud)
				this.debris.splice(i, 1)
				continue
			}

			// full size for the first half of its life, then shrink away
			const shrink =
				t < 0.5 ? 1 : Math.max(1 - (t - 0.5) * 2, 0.001)
			for (const p of cloud.pieces) {
				p.mesh.position.addScaledVector(p.velocity, dt)
				this._spin.setFromAxisAngle(
					p.spinAxis,
					p.spinSpeed * dt
				)
				p.mesh.quaternion.premultiply(this._spin)
				p.mesh.scale.setScalar(p.baseScale * shrink)
			}
		}
	}

	removeDebris(cloud) {
		// geometry and materials are shared with the field, so only detach
		for (const p of cloud.pieces) p.mesh.removeFromParent()
	}

	spawnAsteroid(tangent, bitangent, fillVolume = false) {

		const angle = Math.random() * Math.PI * 2
		const radius = Math.sqrt(Math.random()) * this.spawnRadius

		const offset = tangent
			.clone()
			.multiplyScalar(Math.cos(angle) * radius)
			.add(
				bitangent
					.clone()
					.multiplyScalar(Math.sin(angle) * radius)
			)

		const depth = fillVolume
			? THREE.MathUtils.lerp(
				this.recycleDistance,
				this.spawnDistance,
				Math.random()
			)
			: this.spawnDistance +
			(Math.random() - 0.5) * this.spawnJitter

		const shipPos = this.level.spaceship.position

		const position = shipPos
			.clone()
			.addScaledVector(
				this.blackHole.planeNormal,
				depth
			)
			.add(offset)

		const speed =
			this.baseSpeed +
			Math.random() * this.speedVariance

		const jitter = tangent
			.clone()
			.multiplyScalar((Math.random() - 0.5) * 10)
			.add(
				bitangent
					.clone()
					.multiplyScalar((Math.random() - 0.5) * 10)
			)

		const velocity = this.blackHole.planeNormal
			.clone()
			.multiplyScalar(-speed)
			.add(jitter)

		const scale = 0.6 + Math.random() * 1.8

		//object.position.copy(position)
		//object.scale.setScalar(scale)

		return {
			position,
			velocity,
			scale,
			collisionRadius: 6 * scale,

			rotationAxis: new THREE.Vector3(
				Math.random(),
				Math.random(),
				Math.random()
			).normalize(),

			rotationSpeed: (Math.random() - 0.5) * 2,
			rotation: 0,
		}
	}

	spawnCanister(tangent, bitangent, fillVolume = false) {
		const angle = Math.random() * Math.PI * 2
		const radius = Math.sqrt(Math.random()) * this.spawnRadius

		const offset = tangent
			.clone()
			.multiplyScalar(Math.cos(angle) * radius)
			.add(
				bitangent
					.clone()
					.multiplyScalar(Math.sin(angle) * radius)
			)

		const depth = fillVolume
			? THREE.MathUtils.lerp(
				this.recycleDistance,
				this.spawnDistance,
				Math.random()
			)
			: this.spawnDistance +
				(Math.random() - 0.5) * this.spawnJitter

		const shipPos = this.level.spaceship.position

		const position = shipPos
			.clone()
			.addScaledVector(
				this.blackHole.planeNormal,
				depth
			)
			.add(offset)

		const speed =
			this.baseSpeed +
			Math.random() * this.speedVariance

		const jitter = tangent
			.clone()
			.multiplyScalar((Math.random() - 0.5) * 10)
			.add(
				bitangent
					.clone()
					.multiplyScalar((Math.random() - 0.5) * 10)
			)

		const velocity = this.blackHole.planeNormal
			.clone()
			.multiplyScalar(-speed)
			.add(jitter)

		const canister = new NitrogenCanister(
			this.assetManager
		)

		const object = canister.object

		object.position.copy(position)
		object.scale.setScalar(1)

		this.canisterGroup.add(object)

		return {
			object,
			position,
			velocity,

			rotationAxis: new THREE.Vector3(
				Math.random(),
				Math.random(),
				Math.random()
			).normalize(),

			rotationSpeed: (Math.random() - 0.5) * 2,
			rotation: 0,

			collisionRadius: 3,
		}
	}

	updateAsteroidPhysics(delta, timeScale) {
		const dt = delta * timeScale

		this.updateDebris(dt)

		const { tangent, bitangent } =
			this.getBasis(this.blackHole.planeNormal)

		const shipDistance =
			this.blackHole.getSignedDistance(
				this.level.spaceship.position
			)

		// Normal asteroids
		for (const a of this.asteroids) {
			a.position.addScaledVector(
				a.velocity,
				dt
			)

			a.rotation +=
				a.rotationSpeed * dt

			if (
				this.blackHole.getSignedDistance(a.position) -
					shipDistance <
				this.recycleDistance
			) {
				this.replaceAsteroid(
					a,
					tangent,
					bitangent
				)
			}
		}

		// Nitrogen canisters
		for (const canister of this.canisters) {
			canister.position.addScaledVector(
				canister.velocity,
				dt
			)

			canister.rotation +=
				canister.rotationSpeed * dt

			canister.object.position.copy(
				canister.position
			)

			canister.object.quaternion.setFromAxisAngle(
				canister.rotationAxis,
				canister.rotation
			)

			if (
				this.blackHole.getSignedDistance(
					canister.position
				) - shipDistance <
				this.recycleDistance
			) {
				this.replaceCanister(canister)
			}
		}

		// Update the InstancedMeshes
		this.updateInstanceMatrices()
	}


	replaceAsteroid(asteroid, tangent, bitangent) {
		const modelIndex = asteroid.modelIndex

		const replacement = this.spawnAsteroid(
			tangent,
			bitangent
		)

		Object.assign(asteroid, replacement)

		asteroid.modelIndex = modelIndex
	}

	replaceCanister(canister) {
		this.canisterGroup.remove(canister.object)

		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)

		const replacement = this.spawnCanister(
			tangent,
			bitangent
		)

		Object.assign(canister, replacement)
	}

	updateInstanceMatrices() {
		if (!this.loaded) return
		const matrix = this._matrix
		const quat = this._quat
		const scale = this._scale
		const shipPos = this.level.spaceship.position
		const farArray = this.farMesh.instanceMatrix.array
		let farCount = 0
		for (const model of this.models) model.nearCount = 0

		for (const a of this.asteroids) {
			quat.setFromAxisAngle(a.rotationAxis, a.rotation)
			scale.setScalar(a.scale)
			matrix.compose(a.position, quat, scale)

			if (
				a.position.distanceToSquared(shipPos) <
				this.lodDistanceSq
			) {
				const model = this.models[a.modelIndex]
				matrix.toArray(
					model.matrices.array,
					model.nearCount * 16
				)
				model.nearCount++
			} else {
				matrix.toArray(farArray, farCount * 16)
				farCount++
			}
		}
		for (const model of this.models) {
			if (!model.matrices) continue
			for (const mesh of model.meshes)
				mesh.count = model.nearCount
			model.matrices.needsUpdate = true
		}
		this.farMesh.count = farCount
		this.farMesh.instanceMatrix.needsUpdate = true
	}

	// updateInstanceMatrices() {
	// 	const matrix = new THREE.Matrix4()
	// 	const quat = new THREE.Quaternion()
	// 	for (let i = 0; i < this.asteroids.length; i++) {
	// 		const a = this.asteroids[i]
	// 		quat.setFromAxisAngle(a.rotationAxis, a.rotation)
	// 		matrix.compose(
	// 			a.position,
	// 			quat,
	// 			new THREE.Vector3(a.scale, a.scale, a.scale)
	// 		)
	// 		this.instancedMesh.setMatrixAt(i, matrix)
	// 	}
	// 	this.instancedMesh.instanceMatrix.needsUpdate = true
	// }
}
