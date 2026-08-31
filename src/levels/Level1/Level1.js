import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

import { Level, clearScene } from '../../core/Level.js'

// set to view asteroids from a more zoomed out level with rings around the asteroids to
// identify them easier
const ASTEROID_FIELD_DEBUG = true

export class Level1 extends Level {
	constructor(game) {
		super(game, 1)
		this.clearStartMenu()

		this.addLights()

		this.sceneManager.camera.position.set(0, 0, 800)
		// Adjust this to simulate a 'fast-forward'
		this.timeScale = 50

		this.blackHoleGroup = new THREE.Group()
		this.blackHoleGroup.name = 'blackhole'
		this.createBlackHole(10, 50)
		this.addObject(this.blackHoleGroup)

		this.blackHolePosition = new THREE.Vector3(0, 0, 0)
		this.blackHoleGravityStrength = 20000
		this.blackHoleEventHorizonRadius = 15

		this.maxAsteroidSpeed = 60
		this.orbitSpeedFactor = 1.0

		this.asteroids = new Set()
		this.asteroidGroup = new THREE.Group()
		this.asteroidGroup.name = 'asteroids'
		this.populateAsteroids(1000, 5, 50, 500)
		this.addObject(this.asteroidGroup)

		this.noDestroyedAsteroids = 0
	}

	clearStartMenu() {
		document.body.querySelector(
			'#screen-start.screen'
		).style.display = 'none'
		clearScene(this.game.sceneManager.scene)
		this.game.menuBackground = null
	}

	addLights() {
		const rim = new THREE.DirectionalLight(0x88bbff, 2)
		rim.position.set(300, 200, 300)
		rim.target.position.set(0, 0, 0)
		this.sceneManager.scene.add(rim)
		this.sceneManager.scene.add(rim.target)
		const ambientLight = new THREE.AmbientLight(0x334466, 0.4)
		this.sceneManager.scene.add(ambientLight)
		this.blackHoleLight = new THREE.PointLight(0xffaa44, 3, 400, 2)
		this.blackHoleLight.position.set(0, 0, 0)
		this.sceneManager.scene.add(this.blackHoleLight)
	}

	createBlackHole(singularityRadius, diskRadius) {
		const singularityGeo = new THREE.SphereGeometry(
			singularityRadius,
			32,
			32
		)
		this.own(singularityGeo)
		const singularityMat = new THREE.MeshBasicMaterial({
			color: 0x000000,
		})
		this.own(singularityMat)
		const singularity = new THREE.Mesh(
			singularityGeo,
			singularityMat
		)
		this.blackHoleGroup.add(singularity)

		const diskGeo = new THREE.RingGeometry(
			singularityRadius + singularityRadius * 0.1,
			diskRadius,
			64
		)
		this.own(diskGeo)
		const diskMat = new THREE.MeshBasicMaterial({
			color: 0xffcc66,
			emissive: 0xffcc66,
			emissiveIntensity: 1.5,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.8,
			blending: THREE.AdditiveBlending,
		})
		this.own(diskMat)
		this.blackHoleDisk = new THREE.Mesh(diskGeo, diskMat)
		this.blackHoleGroup.add(this.blackHoleDisk)

		console.log(this.blackHoleGroup)
	}

	populateAsteroids(no, radius, minOrbitRadius, maxOrbitRadius) {
		const asteroidPositions = this.generateUniqueVertices(
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
			asteroid.velocity = this.orbitLikeVelocity(position)

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

	generateUniqueVertices(count, min, max) {
		const vertices = []
		const seen = new Set()

		while (vertices.length < count) {
			const x = Math.random() * (max - min) + min
			const y = Math.random() * (max - min) + min
			const z = Math.random() * (max - min) + min

			const precision = 4
			const key = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`

			if (!seen.has(key)) {
				seen.add(key)
				vertices.push(new THREE.Vector3(x, y, z))
			}
		}

		return vertices
	}

	orbitLikeVelocity(position) {
		// Asteroids should go fast enough perpendicular to the pull so asteroids
		// look like they are orbiting the blackhole.
		// Adjust orbitSpeedFactor to modify whether it is below that threshold
		// or above, with 1.0 meaning that it should try to be exactly on orbit.
		const r = Math.max(position.length(), 1)
		const speed =
			Math.sqrt(this.blackHoleGravityStrength / r) *
			this.orbitSpeedFactor

		// Get direction of black hole (since it is in origin) and calculate
		// the tangent of that so it is perpendicular to the force applied by the
		// black hole (our celestial body).
		const radial = position.clone().normalize()
		const up = new THREE.Vector3(0, 1, 0)
		// Cross product of the radial and our up should give something perpendicular to
		// both of these vectors.
		let tangent = new THREE.Vector3().crossVectors(up, radial)
		if (tangent.lengthSq() < 1e-6) {
			tangent = new THREE.Vector3(1, 0, 0)
		}
		tangent.normalize()

		// Now we apply the magnitude fo the required speed to the direction required
		// to get the velocity.
		return tangent.multiplyScalar(speed)
	}

	updateAsteroidPhysics(delta) {
		// Time multiplier.
		const dt = delta * this.timeScale
		for (const asteroid of this.asteroids) {
			const direction = new THREE.Vector3().subVectors(
				this.blackHolePosition,
				asteroid.position
			)
			const distance = direction.length()
			// Close enough to the black hole that we may as well consider
			// it having fallen in.
			if (distance < this.blackHoleEventHorizonRadius) {
				this.destroyAsteroid(asteroid)
				continue
			}
			direction.normalize()

			const force =
				this.blackHoleGravityStrength /
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

	updateBlackHoleDisk(delta) {
		if (this.blackHoleDisk) {
			this.blackHoleDisk.rotation.z += 0.005 * this.timeScale
			this.blackHoleDisk.rotation.x += 0.005 * this.timeScale
			this.blackHoleDisk.rotation.y += 0.005 * this.timeScale
		}
	}

	completeLevel() {
		this.game.showLandingScene(this.game.gameState.selectedShip, this.game.gameState.selectedCharacter);
	}

	update(delta) {
		super.update(delta)
		this.updateAsteroidPhysics(delta)
		this.updateBlackHoleDisk(delta)
	}
}
