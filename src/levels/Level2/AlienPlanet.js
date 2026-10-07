import * as THREE from 'three'

export function alienTerrainHeight(x, z, baseY = -140) {
	return (
		baseY +
		Math.sin(x * 0.018) * 5.5 +
		Math.cos(z * 0.015) * 6.5 +
		Math.sin((x + z) * 0.009) * 8 +
		Math.sin(x * 0.041 + z * 0.026) * 2.2
	)
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/**
 * Procedural Level 2 environment shared conceptually with the transition
 * cinematic. It deliberately avoids a giant planet GLB: terrain, rocks,
 * vegetation, haze and sky bodies are all ordinary Three.js geometry.
 *
 * Gameplay responsibilities live here too: the environment exposes a stable
 * terrain height/normal, playable bounds and simple XZ obstacle colliders for
 * procedural props. Level2 remains responsible for player movement policy.
 */
export class AlienPlanet {
	constructor(
		level,
		{ center, baseY = -140, size = 1000, clearZones = [] } = {}
	) {
		this.level = level
		this.scene = level.sceneManager.scene
		this.center = center?.clone?.() || new THREE.Vector3(0, baseY, 0)
		this.baseY = baseY
		this.size = size
		this.playableMargin = 34
		this.colliders = []
		this.clearZones = clearZones.map((zone) => ({
			x: zone.x,
			z: zone.z,
			radius: Math.max(0, zone.radius || 0),
		}))

		this.root = new THREE.Group()
		this.root.name = 'alien-planet-environment'
		this.level.addObject(this.root)

		this._previousBackground = this.scene.background
		this._previousFog = this.scene.fog
		this.scene.background = new THREE.Color(0x100913)
		this.scene.fog = new THREE.FogExp2(0x2b111d, 0.00135)

		this._buildTerrain()
		this._buildRocks()
		this._buildVegetation()
		this._buildSky()
	}

	heightAt(x, z) {
		return alienTerrainHeight(x, z, this.baseY)
	}

	/** Return a stable approximation of the surface normal at a world point. */
	normalAt(x, z, sample = 1.6, target = new THREE.Vector3()) {
		const hL = this.heightAt(x - sample, z)
		const hR = this.heightAt(x + sample, z)
		const hD = this.heightAt(x, z - sample)
		const hU = this.heightAt(x, z + sample)

		return target
			.set(hL - hR, sample * 2, hD - hU)
			.normalize()
	}

	slopeDegreesAt(x, z) {
		const normal = this.normalAt(x, z)
		return THREE.MathUtils.radToDeg(
			Math.acos(clamp(normal.y, -1, 1))
		)
	}

	getPlayableBounds(margin = this.playableMargin) {
		const half = this.size * 0.5 - margin
		return {
			minX: this.center.x - half,
			maxX: this.center.x + half,
			minZ: this.center.z - half,
			maxZ: this.center.z + half,
		}
	}

	isInsideBounds(x, z, radius = 0) {
		const bounds = this.getPlayableBounds()
		return (
			x - radius >= bounds.minX &&
			x + radius <= bounds.maxX &&
			z - radius >= bounds.minZ &&
			z + radius <= bounds.maxZ
		)
	}

	/** Clamp a world position to the playable terrain rectangle. */
	clampToBounds(position, radius = 0) {
		const bounds = this.getPlayableBounds()
		const beforeX = position.x
		const beforeZ = position.z
		position.x = clamp(position.x, bounds.minX + radius, bounds.maxX - radius)
		position.z = clamp(position.z, bounds.minZ + radius, bounds.maxZ - radius)
		return Math.abs(beforeX - position.x) > 1e-5 || Math.abs(beforeZ - position.z) > 1e-5
	}

	/**
	 * Push a circular player footprint out of environment + optional gameplay
	 * colliders. This is intentionally simple and deterministic; it is enough
	 * for walking around rocks, plants, wreck debris and vehicles without
	 * introducing a heavyweight physics dependency.
	 */
	resolveCircleCollisions(position, radius, extraColliders = []) {
		const colliders = this.colliders.length
			? this.colliders.concat(extraColliders)
			: extraColliders
		let collided = false

		for (let pass = 0; pass < 4; pass++) {
			let adjusted = false
			for (const collider of colliders) {
				if (!collider || collider.enabled === false) continue
				const minDistance = radius + Math.max(0, collider.radius || 0)
				const dx = position.x - collider.x
				const dz = position.z - collider.z
				const distanceSq = dx * dx + dz * dz
				if (distanceSq >= minDistance * minDistance) continue

				let distance = Math.sqrt(distanceSq)
				let nx
				let nz
				if (distance < 1e-5) {
					nx = 1
					nz = 0
					distance = 0
				} else {
					nx = dx / distance
					nz = dz / distance
				}

				const push = minDistance - distance + 0.015
				position.x += nx * push
				position.z += nz * push
				collided = true
				adjusted = true
			}
			if (!adjusted) break
		}

		return collided
	}

	_registerCollider(object, radius, type) {
		const collider = {
			x: object.position.x,
			z: object.position.z,
			radius,
			type,
			object,
			enabled: true,
		}
		object.userData.gameplayObstacle = true
		object.userData.colliderRadius = radius
		this.colliders.push(collider)
		return collider
	}

	_isSpawnClear(x, z, radius) {
		for (const zone of this.clearZones) {
			const dx = x - zone.x
			const dz = z - zone.z
			const minimum = radius + zone.radius
			if (dx * dx + dz * dz < minimum * minimum) return false
		}
		return true
	}

	_buildTerrain() {
		const segments = 120
		const geometry = this.level.own(
			new THREE.PlaneGeometry(this.size, this.size, segments, segments)
		)
		const position = geometry.attributes.position
		for (let i = 0; i < position.count; i++) {
			const localX = position.getX(i)
			const localY = position.getY(i)
			const worldX = this.center.x + localX
			const worldZ = this.center.z - localY
			position.setZ(i, this.heightAt(worldX, worldZ) - this.baseY)
		}
		geometry.rotateX(-Math.PI / 2)
		geometry.computeVertexNormals()

		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x5b241f,
				roughness: 0.98,
				metalness: 0.02,
			})
		)
		this.terrain = new THREE.Mesh(geometry, material)
		this.terrain.receiveShadow = true
		this.terrain.position.set(this.center.x, this.baseY, this.center.z)
		this.terrain.userData.gameplaySurface = true
		this.root.add(this.terrain)
	}

	_buildRocks() {
		const geometry = this.level.own(new THREE.DodecahedronGeometry(1, 0))
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x241319,
				roughness: 1,
			})
		)

		let placed = 0
		let attempts = 0
		while (placed < 90 && attempts < 450) {
			attempts++
			const x = this.center.x + (Math.random() - 0.5) * this.size * 0.9
			const z = this.center.z + (Math.random() - 0.5) * this.size * 0.9
			const sx = 1.2 + Math.random() * 5
			const sy = 0.7 + Math.random() * 4
			const sz = 1.2 + Math.random() * 5
			const radius = Math.max(sx, sz) * 0.82
			if (!this._isSpawnClear(x, z, radius + 1.5)) continue

			const rock = new THREE.Mesh(geometry, material)
			rock.position.set(x, this.heightAt(x, z) + 0.6, z)
			rock.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			)
			rock.scale.set(sx, sy, sz)
			this.root.add(rock)
			this._registerCollider(rock, radius, 'rock')
			placed++
		}
	}

	_buildVegetation() {
		const stemGeometry = this.level.own(
			new THREE.CylinderGeometry(0.18, 0.4, 5, 7)
		)
		const glowGeometry = this.level.own(new THREE.SphereGeometry(0.6, 12, 8))
		const stemMaterial = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x35132e,
				roughness: 0.9,
			})
		)
		const glowMaterial = this.level.own(
			new THREE.MeshBasicMaterial({ color: 0x6ff4ff })
		)

		let placed = 0
		let attempts = 0
		while (placed < 55 && attempts < 300) {
			attempts++
			const x = this.center.x + (Math.random() - 0.5) * this.size * 0.78
			const z = this.center.z + (Math.random() - 0.5) * this.size * 0.78
			const radius = 0.72
			if (!this._isSpawnClear(x, z, radius + 1.25)) continue

			const plant = new THREE.Group()
			const stem = new THREE.Mesh(stemGeometry, stemMaterial)
			const glow = new THREE.Mesh(glowGeometry, glowMaterial)
			const h = 0.7 + Math.random() * 1.4
			stem.scale.y = h
			stem.position.y = 2.5 * h
			glow.position.y = 5 * h
			glow.scale.setScalar(0.55 + Math.random() * 0.8)
			plant.add(stem, glow)
			plant.position.set(x, this.heightAt(x, z), z)
			this.root.add(plant)
			this._registerCollider(plant, radius, 'vegetation')
			placed++
		}
	}

	_buildSky() {
		const hemi = new THREE.HemisphereLight(0x6e78a8, 0x39120f, 1.25)
		this.level.addObject(hemi)

		const key = new THREE.DirectionalLight(0xff7a55, 2.1)
		key.position.set(-180, 280, 140)
		this.level.addObject(key)

		const moonMaterial = this.level.own(
			new THREE.MeshBasicMaterial({ color: 0x9b829f })
		)
		const moonA = new THREE.Mesh(
			this.level.own(new THREE.SphereGeometry(42, 24, 18)),
			moonMaterial
		)
		moonA.position.set(
			this.center.x - 340,
			this.baseY + 360,
			this.center.z - 520
		)
		this.root.add(moonA)

		const moonB = new THREE.Mesh(
			this.level.own(new THREE.SphereGeometry(18, 20, 14)),
			moonMaterial
		)
		moonB.position.set(
			this.center.x + 270,
			this.baseY + 300,
			this.center.z - 610
		)
		this.root.add(moonB)
	}

	dispose() {
		this.colliders.length = 0
		this.scene.background = this._previousBackground
		this.scene.fog = this._previousFog
	}
}
