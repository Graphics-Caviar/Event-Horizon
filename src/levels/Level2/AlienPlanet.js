import * as THREE from 'three'

import { LavaStream, lavaChannelAt, carveLavaChannel } from './LavaStream.js'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

const noise = new ImprovedNoise()
const sample = (x, z, scale) =>
	noise.noise(x / scale + 41.7, z / scale - 19.3, 8.2)
export const ALIEN_CRATERS = Object.freeze([
	{ x: -145, z: -125, radius: 58, depth: 46 },
	{ x: 210, z: -205, radius: 76, depth: 58 },
	{ x: -250, z: 155, radius: 90, depth: 64 },
])

// Eroded tablelands frame an open, wind-scoured basin.
const MESAS = [
	{ x: -340, z: -190, rx: 120, rz: 270, height: 108 },
	{ x: -250, z: -410, rx: 210, rz: 95, height: 84 },
	{ x: 270, z: -340, rx: 105, rz: 78, height: 68 },
	{ x: 440, z: 160, rx: 100, rz: 210, height: 96 },
	{ x: -330, z: 340, rx: 150, rz: 105, height: 78 },
	{ x: 80, z: 490, rx: 180, rz: 95, height: 65 },
]

// Small erosion basins create wheel-scale dips between the large craters.
const POTHOLES = [
	{ x: -68, z: -52, radius: 8, depth: 3.2 },
	{ x: 72, z: -142, radius: 10, depth: 4.5 },
	{ x: 157, z: -98, radius: 7, depth: 2.8 },
	{ x: -105, z: 70, radius: 11, depth: 4.2 },
	{ x: 214, z: 40, radius: 9, depth: 3.6 },
	{ x: 38, z: 188, radius: 12, depth: 5 },
	{ x: -175, z: -285, radius: 8, depth: 3.8 },
	{ x: 310, z: 275, radius: 10, depth: 4.5 },
]

/** Physical relief sampled by both the mesh and future wheel contact points. */
function roughSurface(x, z) {
	const brokenGround =
		0.55 +
		THREE.MathUtils.smoothstep(sample(x, z, 65), -0.3, 0.35) * 0.65
	// Different scales avoid uniformly spaced bumps or a repeating washboard.
	let relief =
		(sample(x, z, 22) * 7 + sample(x, z, 8) * 3.4) * brokenGround
	const warpedX = x + sample(x, z, 37) * 15
	const rockRidge = Math.pow(1 - Math.abs(sample(warpedX, z, 13)), 7)
	relief += (rockRidge - 0.45) * 3.8 * brokenGround
	// Winding shallow gullies cut across the basin, with solid floors.
	for (const offset of [-95, 185]) {
		const distance =
			x -
			offset -
			Math.sin(z / 48) * 19 -
			sample(x, z, 27) * 8
		const envelope =
			1 -
			THREE.MathUtils.smoothstep(Math.abs(z + 20), 210, 360)
		relief -=
			3.8 * Math.exp(-Math.pow(distance / 5.5, 2)) * envelope
	}
	for (const pit of POTHOLES) {
		const d = Math.hypot(x - pit.x, z - pit.z) / pit.radius
		relief -= pit.depth * Math.exp(-Math.pow(d / 0.72, 4))
		relief +=
			pit.depth *
			0.18 *
			Math.exp(-Math.pow((d - 1) / 0.22, 2))
	}
	return relief
}

/** Dusty basin, steep sedimentary mesas and solid crater bowls; Y-up. */
export function alienTerrainHeight(x, z, baseY = -140) {
	let h =
		baseY +
		10 +
		sample(x, z, 190) * 20 +
		sample(x, z, 72) * 9 +
		sample(x, z, 25) * 3 +
		sample(x, z, 9) * 1.2
	for (const mesa of MESAS) {
		const dx = (x - mesa.x) / mesa.rx
		const dz = (z - mesa.z) / mesa.rz
		const d = Math.hypot(dx, dz) + sample(x, z, 32) * 0.075
		// Broad talus slopes rise into narrow cliff bands and a broken cap.
		const talus = 1 - THREE.MathUtils.smoothstep(d, 0.78, 1.5)
		const cliff = 1 - THREE.MathUtils.smoothstep(d, 0.78, 0.96)
		h +=
			mesa.height * (talus * 0.32 + cliff * 0.68) +
			cliff * sample(x, z, 18) * 2
	}
	for (const crater of ALIEN_CRATERS) {
		const dx = x - crater.x,
			dz = z - crater.z
		const angle = Math.atan2(dz, dx)
		const d =
			Math.hypot(dx, dz) /
			(crater.radius * (1 + Math.sin(angle * 5) * 0.035))
		h -= crater.depth * Math.exp(-Math.pow(d / 0.68, 4))
		h +=
			crater.depth *
			0.22 *
			Math.exp(-Math.pow((d - 1) / 0.19, 2))
	}
	return carveLavaChannel(x, z, h + roughSurface(x, z), baseY)
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
		this.center =
			center?.clone?.() || new THREE.Vector3(0, baseY, 0)
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
		this.scene.background = new THREE.Color(0xb95231)
		this.scene.fog = new THREE.Fog(0xb95231, 250, 1750)

		this._buildTerrain()
		this._buildHorizon()
		this._buildRocks()
		this._buildOutcrops()
		this._buildGravel()
		this._buildSky()
		this.lava = new LavaStream(this)
	}

	_heightFunction(x, z) {
		// Blend safe landing/wreck/rover shelves and the walking corridor.
		let h = alienTerrainHeight(x, z, this.baseY)
		let weight = 0
		for (const zone of this.clearZones) {
			const d = Math.hypot(x - zone.x, z - zone.z)
			weight = Math.max(
				weight,
				1 -
					THREE.MathUtils.smoothstep(
						d,
						zone.radius,
						zone.radius + 65
					)
			)
		}
		if (this.clearZones.length >= 3) {
			const a = this.clearZones[0],
				b = this.clearZones[2]
			const dx = b.x - a.x,
				dz = b.z - a.z
			const t = clamp(
				((x - a.x) * dx + (z - a.z) * dz) /
					(dx * dx + dz * dz || 1),
				0,
				1
			)
			const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t)
			weight = Math.max(
				weight,
				1 - THREE.MathUtils.smoothstep(d, 16, 55)
			)
		}
		return THREE.MathUtils.lerp(
			h,
			this.baseY +
				9 +
				sample(x, z, 18) * 0.75 +
				sample(x, z, 6) * 0.3,
			weight
		)
	}

	/** Sample the visible terrain triangles so steep ground stays solid. */
	heightAt(x, z) {
		const positions = this.terrain?.geometry.attributes.position
		const half = this.size / 2
		const localX = x - this.center.x,
			localZ = z - this.center.z
		if (
			!positions ||
			Math.abs(localX) > half ||
			Math.abs(localZ) > half
		)
			return this._heightFunction(x, z)
		const segments = this.terrain.geometry.parameters.widthSegments
		const gx = (localX / this.size + 0.5) * segments,
			gz = (localZ / this.size + 0.5) * segments
		const ix = Math.min(segments - 1, Math.floor(gx)),
			iz = Math.min(segments - 1, Math.floor(gz))
		const u = gx - ix,
			v = gz - iz,
			stride = segments + 1
		const a = positions.getY(iz * stride + ix),
			b = positions.getY((iz + 1) * stride + ix)
		const c = positions.getY((iz + 1) * stride + ix + 1),
			d = positions.getY(iz * stride + ix + 1)
		return (
			this.baseY +
			(u + v <= 1
				? a + (d - a) * u + (b - a) * v
				: c + (b - c) * (1 - u) + (d - c) * (1 - v))
		)
	}

	/** Return a stable approximation of the surface normal at a world point. */
	normalAt(x, z, sample = 1.6, target = new THREE.Vector3()) {
		const hL = this.heightAt(x - sample, z)
		const hR = this.heightAt(x + sample, z)
		const hD = this.heightAt(x, z - sample)
		const hU = this.heightAt(x, z + sample)

		return target.set(hL - hR, sample * 2, hD - hU).normalize()
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
		position.x = clamp(
			position.x,
			bounds.minX + radius,
			bounds.maxX - radius
		)
		position.z = clamp(
			position.z,
			bounds.minZ + radius,
			bounds.maxZ - radius
		)
		return (
			Math.abs(beforeX - position.x) > 1e-5 ||
			Math.abs(beforeZ - position.z) > 1e-5
		)
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
				if (!collider || collider.enabled === false)
					continue
				const minDistance =
					radius +
					Math.max(0, collider.radius || 0)
				const dx = position.x - collider.x
				const dz = position.z - collider.z
				const distanceSq = dx * dx + dz * dz
				if (distanceSq >= minDistance * minDistance)
					continue

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
		const channel = lavaChannelAt(z, this.baseY)
		if (
			channel.active &&
			Math.abs(x - channel.x) < channel.halfWidth + radius + 4
		)
			return false
		for (const zone of this.clearZones) {
			const dx = x - zone.x
			const dz = z - zone.z
			const minimum = radius + zone.radius
			if (dx * dx + dz * dz < minimum * minimum) return false
		}
		return true
	}

	_buildTerrain() {
		// About 2 m between samples: ruts and rock shelves are actual geometry.
		const segments = 512
		const geometry = this.level.own(
			new THREE.PlaneGeometry(
				this.size,
				this.size,
				segments,
				segments
			)
		)
		const position = geometry.attributes.position
		for (let i = 0; i < position.count; i++) {
			const localX = position.getX(i)
			const localY = position.getY(i)
			const worldX = this.center.x + localX
			const worldZ = this.center.z - localY
			position.setZ(
				i,
				this.heightAt(worldX, worldZ) - this.baseY
			)
		}
		geometry.rotateX(-Math.PI / 2)
		geometry.computeVertexNormals()

		const colors = new Float32Array(position.count * 3)
		const color = new THREE.Color()
		const dust = new THREE.Color('#a34f32'),
			basalt = new THREE.Color('#593023'),
			mineral = new THREE.Color('#c1784c')
		for (let i = 0; i < position.count; i++) {
			const x = this.center.x + position.getX(i),
				z = this.center.z + position.getZ(i)
			const slope = 1 - geometry.attributes.normal.getY(i)
			color.copy(dust).lerp(basalt, clamp(slope * 2.7, 0, 1))
			color.lerp(
				mineral,
				THREE.MathUtils.smoothstep(
					sample(x, z, 42),
					0.1,
					0.5
				) * 0.5
			)
			color.multiplyScalar(
				0.89 +
					0.11 *
						Math.sin(
							position.getY(i) * 1.8 +
								sample(
									x,
									z,
									28
								) *
									0.8
						)
			)
			const channel = lavaChannelAt(z, this.baseY)
			if (channel.active) {
				const bank =
					1 -
					THREE.MathUtils.smoothstep(
						Math.abs(x - channel.x),
						channel.halfWidth + 2,
						channel.halfWidth + 13
					)
				color.lerp(basalt, bank * 0.85)
			}
			color.toArray(colors, i * 3)
		}
		geometry.setAttribute(
			'color',
			new THREE.BufferAttribute(colors, 3)
		)
		this.surfaceTexture = this._createSurfaceTexture()
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0xffffff,
				vertexColors: true,
				map: this.surfaceTexture,
				bumpMap: this.surfaceTexture,
				bumpScale: 0.2,
				roughness: 0.98,
				metalness: 0.02,
			})
		)
		this.terrain = new THREE.Mesh(geometry, material)
		this.terrain.receiveShadow = true
		this.terrain.position.set(
			this.center.x,
			this.baseY,
			this.center.z
		)
		this.terrain.userData.gameplaySurface = true
		this.root.add(this.terrain)
	}

	_buildRocks() {
		const geometry = this.level.own(
			new THREE.IcosahedronGeometry(1, 1)
		)
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x88432c,
				bumpMap: this.surfaceTexture,
				bumpScale: 0.08,
				roughness: 1,
			})
		)

		let placed = 0
		let attempts = 0
		while (placed < 180 && attempts < 850) {
			attempts++
			const x =
				this.center.x +
				(Math.random() - 0.5) * this.size * 0.9
			const z =
				this.center.z +
				(Math.random() - 0.5) * this.size * 0.9
			const sx = 1.2 + Math.random() * 5
			const sy = 0.7 + Math.random() * 7
			const sz = 1.2 + Math.random() * 5
			const radius = Math.max(sx, sz) * 0.82
			if (
				!this._isSpawnClear(x, z, radius + 1.5) ||
				this.slopeDegreesAt(x, z) > 32
			)
				continue

			const rock = new THREE.Mesh(geometry, material)
			rock.position.set(x, this.heightAt(x, z) + 0.6, z)
			rock.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			)
			rock.scale.set(sx, sy, sz)
			rock.castShadow = true
			rock.receiveShadow = true
			this.root.add(rock)
			this._registerCollider(rock, radius, 'rock')
			placed++
		}
	}

	_buildOutcrops() {
		// Repeated rock strata, with undercut bands and a broken flat cap.
		const geometry = this.level.own(
			new THREE.CylinderGeometry(0.72, 1, 1, 9, 18)
		)
		const positions = geometry.attributes.position
		const colors = []
		const color = new THREE.Color()
		for (let i = 0; i < positions.count; i++) {
			const x = positions.getX(i),
				y = positions.getY(i),
				z = positions.getZ(i)
			const angle = Math.atan2(z, x)
			const band =
				Math.sin(y * 64) * 0.065 +
				Math.sin(y * 29) * 0.045
			const erosion =
				1 +
				band +
				Math.sin(angle * 5 + 0.7) * 0.2 +
				Math.cos(angle * 3 + y * 5) * 0.09
			positions.setXYZ(
				i,
				x * erosion,
				y + sample(x, z, 0.4) * 0.035,
				z * erosion
			)
			color.set('#88452e').multiplyScalar(
				0.86 + band * 2 + (y + 0.5) * 0.2
			)
			color.toArray(colors, i * 3)
		}
		geometry.setAttribute(
			'color',
			new THREE.Float32BufferAttribute(colors, 3)
		)
		geometry.computeVertexNormals()
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 1,
				bumpMap: this.surfaceTexture,
				bumpScale: 0.18,
			})
		)
		const sites = [
			[-52, -66],
			[100, -115],
			[-180, 100],
			[70, 210],
			[-280, -210],
			[290, 180],
		]
		for (const [cx, cz] of sites) {
			for (let i = 0; i < 5; i++) {
				const x = cx + Math.sin(i * 13.17) * 19,
					z = cz + Math.cos(i * 8.23) * 17
				const radius = 3 + (i % 3) * 2.1,
					height = 3.5 + (i % 3) * 1.5
				if (!this._isSpawnClear(x, z, radius + 3))
					continue
				const mesh = new THREE.Mesh(geometry, material)
				mesh.scale.set(radius, height, radius * 0.8)
				mesh.rotation.y = i * 1.9
				mesh.position.set(
					x,
					this.heightAt(x, z) + height * 0.38,
					z
				)
				mesh.castShadow = mesh.receiveShadow = true
				this.root.add(mesh)
				this._registerCollider(
					mesh,
					radius * 1.15,
					'layered-outcrop'
				)
			}
		}
	}

	_buildGravel() {
		const geometry = this.level.own(
			new THREE.IcosahedronGeometry(1, 0)
		)
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x91482f,
				roughness: 1,
			})
		)
		const gravel = new THREE.InstancedMesh(geometry, material, 1800)
		const transform = new THREE.Object3D()
		const color = new THREE.Color()
		for (let i = 0; i < gravel.count; i++) {
			const x =
				this.center.x +
				(THREE.MathUtils.seededRandom(i * 4 + 1) -
					0.5) *
					this.size
			const z =
				this.center.z +
				(THREE.MathUtils.seededRandom(i * 4 + 2) -
					0.5) *
					this.size
			const scale =
				0.18 +
				THREE.MathUtils.seededRandom(i * 4 + 3) * 1.15
			transform.position.set(
				x,
				this.heightAt(x, z) + scale * 0.16,
				z
			)
			transform.scale.set(scale * 1.3, scale * 0.6, scale)
			transform.rotation.set(i * 0.37, i * 1.91, i * 0.13)
			transform.updateMatrix()
			gravel.setMatrixAt(i, transform.matrix)
			gravel.setColorAt(
				i,
				color.setScalar(0.65 + (i % 7) * 0.07)
			)
		}
		gravel.receiveShadow = true
		gravel.computeBoundingSphere()
		this.root.add(gravel)
		this.level.own(gravel)
	}

	_buildSky() {
		const hemi = new THREE.HemisphereLight(0xe6bda3, 0x39231c, 1.6)
		this.level.addObject(hemi)

		const key = new THREE.DirectionalLight(0xffdfb5, 3.0)
		key.position.set(
			this.center.x - 180,
			this.baseY + 150,
			this.center.z + 140
		)
		key.target.position.set(
			this.center.x,
			this.baseY,
			this.center.z
		)
		this.level.addObject(key.target)
		key.castShadow = true
		key.shadow.mapSize.set(2048, 2048)
		Object.assign(key.shadow.camera, {
			left: -200,
			right: 200,
			top: 200,
			bottom: -200,
			near: 1,
			far: 700,
		})
		key.shadow.normalBias = 0.8
		key.shadow.bias = -0.0002
		this.level.own(key)
		const renderer = this.level.sceneManager.renderer
		if (renderer) {
			this._renderer = renderer
			this._renderSettings = {
				toneMapping: renderer.toneMapping,
				exposure: renderer.toneMappingExposure,
				shadows: renderer.shadowMap.enabled,
				shadowType: renderer.shadowMap.type,
			}
			renderer.toneMapping = THREE.ACESFilmicToneMapping
			renderer.toneMappingExposure = 1.05
			renderer.shadowMap.enabled = true
			renderer.shadowMap.type = THREE.PCFSoftShadowMap
		}
		this.level.addObject(key)

		const skyGeometry = this.level.own(
			new THREE.SphereGeometry(2400, 32, 20)
		)
		const skyColors = []
		const skyColor = new THREE.Color()
		const horizon = new THREE.Color(0xb95231),
			zenith = new THREE.Color(0x4c190f)
		for (
			let i = 0;
			i < skyGeometry.attributes.position.count;
			i++
		) {
			const elevation = Math.max(
				0,
				skyGeometry.attributes.position.getY(i) / 2400
			)
			skyColor.copy(horizon).lerp(
				zenith,
				Math.pow(elevation, 0.55)
			)
			skyColor.toArray(skyColors, i * 3)
		}
		skyGeometry.setAttribute(
			'color',
			new THREE.Float32BufferAttribute(skyColors, 3)
		)
		const sky = new THREE.Mesh(
			skyGeometry,
			this.level.own(
				new THREE.MeshBasicMaterial({
					vertexColors: true,
					side: THREE.BackSide,
					fog: false,
					depthWrite: false,
				})
			)
		)
		sky.position.set(this.center.x, this.baseY, this.center.z)
		sky.renderOrder = -1
		this.root.add(sky)
	}

	_createSurfaceTexture() {
		if (typeof document === 'undefined') return null
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 512
		const ctx = canvas.getContext('2d')
		const image = ctx.createImageData(512, 512)
		for (let y = 0; y < 512; y++) {
			for (let x = 0; x < 512; x++) {
				// Periodic noise: repeats without seams across the large surface.
				// Tileable toroidal noise produces irregular grain without a grid.
				const u = (x / 512) * Math.PI * 2,
					v = (y / 512) * Math.PI * 2
				const nx = (3 + Math.cos(v)) * Math.cos(u),
					ny = (3 + Math.cos(v)) * Math.sin(u),
					nz = Math.sin(v)
				const coarse = noise.noise(
					nx * 2,
					ny * 2,
					nz * 2
				)
				const fine = noise.noise(
					nx * 19,
					ny * 19,
					nz * 19
				)
				const value = clamp(
					208 + coarse * 46 + fine * 24,
					0,
					255
				)
				const i = (y * 512 + x) * 4
				image.data[i] =
					image.data[i + 1] =
					image.data[i + 2] =
						value
				image.data[i + 3] = 255
			}
		}
		ctx.putImageData(image, 0, 0)
		const texture = this.level.own(new THREE.CanvasTexture(canvas))
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping
		texture.repeat.set(80, 80)
		texture.colorSpace = THREE.SRGBColorSpace
		texture.anisotropy = Math.min(
			8,
			this.level.sceneManager.renderer?.capabilities.getMaxAnisotropy() ||
				1
		)
		return texture
	}

	/** Surround the playable basin with highlands so it reads as a world. */
	_buildHorizon() {
		const size = this.size * 3,
			segments = 120,
			inner = this.size / 2
		const geometry = this.level.own(
			new THREE.PlaneGeometry(size, size, segments, segments)
		)
		geometry.rotateX(-Math.PI / 2)
		const positions = geometry.attributes.position
		for (let i = 0; i < positions.count; i++) {
			positions.setY(
				i,
				this.heightAt(
					this.center.x + positions.getX(i),
					this.center.z + positions.getZ(i)
				) - this.baseY
			)
		}
		const indices = []
		const old = geometry.index.array
		for (let i = 0; i < old.length; i += 3) {
			const a = old[i],
				b = old[i + 1],
				c = old[i + 2]
			const x =
				(positions.getX(a) +
					positions.getX(b) +
					positions.getX(c)) /
				3
			const z =
				(positions.getZ(a) +
					positions.getZ(b) +
					positions.getZ(c)) /
				3
			if (Math.abs(x) >= inner || Math.abs(z) >= inner)
				indices.push(a, b, c)
		}
		geometry.setIndex(indices)
		geometry.computeVertexNormals()
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x995035,
				roughness: 1,
			})
		)
		const mesh = new THREE.Mesh(geometry, material)
		mesh.position.set(this.center.x, this.baseY, this.center.z)
		this.root.add(mesh)
	}

	update(delta) {
		this.lava.update(delta)
	}

	dispose() {
		if (this._renderer && this._renderSettings) {
			this._renderer.toneMapping =
				this._renderSettings.toneMapping
			this._renderer.toneMappingExposure =
				this._renderSettings.exposure
			this._renderer.shadowMap.enabled =
				this._renderSettings.shadows
			this._renderer.shadowMap.type =
				this._renderSettings.shadowType
		}
		this.colliders.length = 0
		this.scene.background = this._previousBackground
		this.scene.fog = this._previousFog
	}
}
