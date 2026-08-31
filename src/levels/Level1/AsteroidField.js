import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

import { generateUniqueVertices, orbitLikeVelocity } from './Helpers.js'

// set to view asteroids from a more zoomed out level with rings around the asteroids to
// identify them easier
const ASTEROID_FIELD_DEBUG = true

export class AsteroidField {
	constructor(level, blackHole) {
		this.level = level

		this.blackHole = blackHole

		this.maxAsteroidSpeed = 60
		this.orbitSpeedFactor = 1.0

		this.asteroids = new Set()
		this.asteroidGroup = new THREE.Group()
		this.asteroidGroup.name = 'asteroids'
		this.populateAsteroids(1000, 5, 50, 500)
		this.addObject(this.asteroidGroup)

		this.noDestroyedAsteroids = 0
	}

	addObject(object) {
		this.level.addObject(object)
	}

	own(resource) {
		this.level.own(resource)
	}

	populateAsteroids(no, radius, minOrbitRadius, maxOrbitRadius) {
		const asteroidPositions = generateUniqueVertices(
			no,
			minOrbitRadius,
			maxOrbitRadius
		)
		const asteroidMaterial = this.createBasicAsteroidMaterial()
		this.own(asteroidMaterial)

		var diskMat
		if (ASTEROID_FIELD_DEBUG) {
			diskMat = new THREE.MeshBasicMaterial({
				color: 0xffcc66,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.8,
				blending: THREE.AdditiveBlending,
			})
			this.own(diskMat)
		}

		for (let i = 0; i < no; i++) {
			const asteroidGeometry =
				this.createBasicAsteroidGeometry(radius, 4)
			const asteroid = new THREE.Mesh(
				asteroidGeometry,
				asteroidMaterial
			)
			const position = asteroidPositions[i]
			asteroid.position.set(
				position.x,
				position.y,
				position.z
			)
			asteroid.velocity = orbitLikeVelocity(
				this.blackHole.getGravityStrength(),
				this.orbitSpeedFactor,
				position
			)

			this.own(asteroidGeometry)
			this.asteroids.add(asteroid)
			this.asteroidGroup.add(asteroid)

			// Change the below if statement to true to see what is actually going on.
			if (ASTEROID_FIELD_DEBUG) {
				const diskGeo = new THREE.RingGeometry(
					radius + radius * 0.1,
					radius,
					64
				)
				this.own(diskGeo)
				const disk = new THREE.Mesh(diskGeo, diskMat)
				asteroid.add(disk)
			}
		}
		console.log(this.asteroids)
		console.log(this.asteroidGroup)
	}

	createBasicAsteroidMaterial() {
		return new THREE.MeshStandardMaterial({
			color: 0x555555,
			roughness: 0.6,
			metalness: 0.4,
			flatShading: true,
		})
	}

	createBasicAsteroidGeometry(radius, detail = 0, seed = 1001) {
		const perlin = new ImprovedNoise()
		const geometry = new THREE.IcosahedronGeometry(radius, detail)
		const pos = geometry.attributes.position
		const vertex = new THREE.Vector3()
		for (let i = 0; i < pos.count; i++) {
			vertex.fromBufferAttribute(pos, i)
			const noiseScale = 0.5
			const noiseImpact = 0.4
			const noise = perlin.noise(
				vertex.x * noiseScale,
				vertex.y * noiseScale,
				vertex.z * noiseScale
			)
			vertex.addScaledVector(
				vertex.clone().normalize(),
				noise * noiseImpact
			)
			pos.setXYZ(i, vertex.x, vertex.y, vertex.z)
		}
		geometry.computeVertexNormals()
		return geometry
	}

	updateAsteroidPhysics(delta, timeScale = 1) {
		const dt = delta * timeScale
		for (const asteroid of this.asteroids) {
			const direction = new THREE.Vector3().subVectors(
				this.blackHole.getPosition(),
				asteroid.position
			)
			const distance = direction.length()
			// Close enough to the black hole that we may as well consider
			// it having fallen in.
			if (distance < this.blackHole.getEventHorizonRadius()) {
				this.destroyAsteroid(asteroid)
				continue
			}
			direction.normalize()

			const force =
				this.blackHole.getGravityStrength() /
				(distance * distance)

			asteroid.velocity.addScaledVector(direction, force * dt)
			if (
				asteroid.velocity.length() >
				this.maxAsteroidSpeed
			) {
				asteroid.velocity
					.normalize()
					.multiplyScalar(this.maxAsteroidSpeed)
			}
			asteroid.position.addScaledVector(asteroid.velocity, dt)
		}
	}

	destroyAsteroid(asteroid) {
		// For the laughs
		this.noDestroyedAsteroids++
		console.log(`${this.noDestroyedAsteroids} mississipi`)
		this.asteroids.delete(asteroid)
		this.asteroidGroup.remove(asteroid)
		this.resources.remove(asteroid.geometry)
		asteroid.geometry.dispose()
	}
}
