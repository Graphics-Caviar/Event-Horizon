import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

export class AsteroidField {
	constructor(level, blackHole, { spawnRadius = 1000 } = {}) {
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

		this.asteroids = []
		this.createAsteroids(2000)
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

	createAsteroids(count = 2000) {
		const geo = new THREE.IcosahedronGeometry(6, 0)
		geo.computeBoundingSphere()
		this.baseCollisionRadius = geo.boundingSphere.radius
		this.level.own(geo)
		const mat = new THREE.MeshStandardMaterial({
			color: 0x8a8a8a,
			flatShading: true,
		})
		this.level.own(mat)

		this.instancedMesh = new THREE.InstancedMesh(geo, mat, count)
		this.instancedMesh.name = 'asteroidField'
		this.level.addObject(this.instancedMesh)

		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)
		for (let i = 0; i < count; i++) {
			this.asteroids.push(
				this.spawnAsteroid(tangent, bitangent, true)
			)
		}
		this.updateInstanceMatrices()
	}

	/** Respawn one asteroid far ahead — used after it hits the ship, so the
	 * same rock cannot register a second hit on the next frame. */
	removeAsteroid(asteroid) {
		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)
		Object.assign(asteroid, this.spawnAsteroid(tangent, bitangent))
		this.updateInstanceMatrices()
	}

	/** Push every asteroid out of a bubble around `position`. The field is
	 * filled at random on creation, so without this a run could open with a
	 * rock already overlapping the ship — an instant, unavoidable hit. */
	clearAround(position, radius) {
		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)
		const limitSq = radius * radius
		for (const a of this.asteroids) {
			if (a.position.distanceToSquared(position) < limitSq) {
				Object.assign(
					a,
					this.spawnAsteroid(tangent, bitangent)
				)
			}
		}
		this.updateInstanceMatrices()
	}

	checkShipCollision(ship) {
		const shipPos = ship.position
		const shipRadius = ship.collisionRadius
		for (const a of this.asteroids) {
			const combinedRadius =
				this.baseCollisionRadius * a.scale + shipRadius
			if (
				a.position.distanceToSquared(shipPos) <
				combinedRadius * combinedRadius
			) {
				return a
			}
		}
		return null
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
					.multiplyScalar(
						Math.sin(angle) * radius
					)
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
			.addScaledVector(this.blackHole.planeNormal, depth)
			.add(offset)

		const speed =
			this.baseSpeed + Math.random() * this.speedVariance
		const jitter = tangent
			.clone()
			.multiplyScalar((Math.random() - 0.5) * 10)
			.add(
				bitangent
					.clone()
					.multiplyScalar(
						(Math.random() - 0.5) * 10
					)
			)
		const velocity = this.blackHole.planeNormal
			.clone()
			.multiplyScalar(-speed)
			.add(jitter)

		return {
			position,
			velocity,
			scale: 0.6 + Math.random() * 1.8,
			rotationAxis: new THREE.Vector3(
				Math.random(),
				Math.random(),
				Math.random()
			).normalize(),
			rotationSpeed: (Math.random() - 0.5) * 2,
			rotation: 0,
		}
	}

	updateAsteroidPhysics(delta, timeScale) {
		const dt = delta * timeScale
		const { tangent, bitangent } = this.getBasis(
			this.blackHole.planeNormal
		)

		const shipDistance = this.blackHole.getSignedDistance(
			this.level.spaceship.position
		)
		for (const a of this.asteroids) {
			a.position.addScaledVector(a.velocity, dt)
			a.rotation += a.rotationSpeed * dt
			if (
				this.blackHole.getSignedDistance(a.position) -
					shipDistance <
				this.recycleDistance
			) {
				Object.assign(
					a,
					this.spawnAsteroid(tangent, bitangent)
				)
			}
		}
		this.updateInstanceMatrices()
	}

	updateInstanceMatrices() {
		const matrix = new THREE.Matrix4()
		const quat = new THREE.Quaternion()
		for (let i = 0; i < this.asteroids.length; i++) {
			const a = this.asteroids[i]
			quat.setFromAxisAngle(a.rotationAxis, a.rotation)
			matrix.compose(
				a.position,
				quat,
				new THREE.Vector3(a.scale, a.scale, a.scale)
			)
			this.instancedMesh.setMatrixAt(i, matrix)
		}
		this.instancedMesh.instanceMatrix.needsUpdate = true
	}
}
