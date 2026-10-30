import * as THREE from 'three'
import { MatterDebris } from './MatterDebris.js'
import { MatterStormFX } from './MatterStormFX.js'

const LAVA_PROGRESS = [
	[0.18, -1],
	[0.22, 1],
	[0.4, 1],
	[0.44, -1],
	[0.61, -1],
	[0.65, 1],
	[0.82, 1],
	[0.86, -1],
]

/** Flat, walkable top; irregular rocky sides and a fractured underside.
 * Top stays at local +1.5 to match supportHeightAt collision geometry.
 * Uses one shared, low-poly geometry for every floating platform. */
function createRockIslandGeometry() {
	const vertices = []
	const colors = []
	const n = 16
	const top = []
	const mid = []
	const low = []
	for (let i = 0; i < n; i++) {
		const angle = (i / n) * Math.PI * 2
		const c = Math.cos(angle),
			t = Math.sin(angle)
		const edge = 0.95 + Math.sin(i * 3.6) * 0.045
		const x = Math.sign(c) * Math.pow(Math.abs(c), 0.55) * 9 * edge
		const z = Math.sign(t) * Math.pow(Math.abs(t), 0.55) * 11 * edge
		top.push([x, 1.5, z])
		mid.push([
			x * (0.78 + 0.07 * Math.sin(i * 1.9)),
			-2.5 - (i % 3) * 0.5,
			z * 0.79,
		])
		low.push([x * 0.36, -6 - (i % 4) * 0.7, z * 0.4])
	}
	function triangle(a, b, c, color) {
		for (const v of [a, b, c]) {
			vertices.push(...v)
			colors.push(...color)
		}
	}
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n
		triangle([0, 1.5, 0], top[j], top[i], [0.24, 0.23, 0.34])
		triangle(top[i], top[j], mid[j], [0.15, 0.15, 0.24])
		triangle(top[i], mid[j], mid[i], [0.15, 0.15, 0.24])
		triangle(mid[i], mid[j], low[j], [0.11, 0.1, 0.19])
		triangle(mid[i], low[j], low[i], [0.11, 0.1, 0.19])
		triangle(low[i], low[j], [0, -9.8, 0], [0.07, 0.06, 0.13])
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(vertices, 3)
	)
	g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	g.computeVertexNormals()
	return g
}

/** Additive route dressing: the existing triangle terrain remains authoritative. */
export class MatterDimension {
	constructor(level) {
		this.level = level
		this.group = new THREE.Group()
		this.group.name = 'matter-dimension'
		this.resources = []
		this.floaters = []
		this.platforms = []
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const box = own(new THREE.BoxGeometry(1, 1, 1))
		const shardGeometry = own(new THREE.ConeGeometry(1, 1, 5))
		const islandGeometry = own(createRockIslandGeometry())
		const islandMaterial = own(
			new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 0.96,
				metalness: 0.08,
				flatShading: true,
				emissive: 0x12051e,
				emissiveIntensity: 0.3,
			})
		)
		const crackMaterial = own(
			new THREE.LineBasicMaterial({
				color: 0x9357df,
				transparent: true,
				opacity: 0.72,
			})
		)
		const crackGeometry = own(new THREE.BufferGeometry())
		crackGeometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(
				[
					-7, 1.56, -4, -2, 1.56, -1, -2, 1.56,
					-1, 1, 1.56, -3, 1, 1.56, -3, 6, 1.56,
					3, -4, 1.56, 6, 0, 1.56, 2, 0, 1.56, 2,
					5, 1.56, 7,
				],
				3
			)
		)
		const metal = own(
			new THREE.MeshStandardMaterial({
				color: 0x222538,
				metalness: 0.6,
				roughness: 0.7,
				emissive: 0x221335,
				emissiveIntensity: 0.6,
			})
		)
		const cyan = own(
			new THREE.MeshBasicMaterial({ color: 0x6ceaff })
		)
		const violet = own(
			new THREE.MeshBasicMaterial({ color: 0xaf75ff })
		)
		this.routePoints = (
			level.planet.drivingRoute?.length > 1
				? level.planet.drivingRoute
				: [level.landingSite, level.portalSite]
		).map(
			(point) =>
				new THREE.Vector3(
					point.x,
					level.planet.heightAt(point.x, point.z),
					point.z
				)
		)
		this.routeLengths = [0]
		for (let i = 1; i < this.routePoints.length; i++) {
			this.routeLengths.push(
				this.routeLengths[i - 1] +
					this.routePoints[i].distanceTo(
						this.routePoints[i - 1]
					)
			)
		}
		this.routeLength =
			this.routeLengths[this.routeLengths.length - 1]
		this.encounterSites = [0.1, 0.31, 0.52, 0.73, 0.96].map(
			(progress) => this.routePointAt(progress)
		)
		const mesh = (material, point, scale) => {
			const m = new THREE.Mesh(box, material)
			m.position.copy(point)
			m.scale.fromArray(scale)
			this.group.add(m)
			return m
		}
		this.zones = []
		for (let i = 1; i < 30; i++) {
			const { point: p, direction } = this.routeSample(i / 30)
			const side = new THREE.Vector3(
				-direction.z,
				0,
				direction.x
			)
			for (const sign of [-1, 1]) {
				const edge = p
					.clone()
					.addScaledVector(side, sign * 11)
				edge.y =
					level.planet.heightAt(edge.x, edge.z) +
					0.6
				const routeBlock = mesh(
					i < 9 ? cyan : violet,
					edge,
					[0.5, 1.2, 5]
				)
				level._registerGameplayCollider(
					edge.x,
					edge.z,
					2.6,
					'route-block',
					routeBlock
				)
				const floating = p
					.clone()
					.addScaledVector(
						side,
						sign * (36 + (i % 3) * 7)
					)
				floating.y += 28 + (i % 4) * 9
				const slab = new THREE.Mesh(
					islandGeometry,
					islandMaterial
				)
				slab.name = 'floating-fractured-rock-island'
				slab.position.copy(floating)
				slab.rotation.y = Math.atan2(
					direction.x,
					direction.z
				)
				slab.add(
					new THREE.LineSegments(
						crackGeometry,
						crackMaterial
					)
				)
				this.group.add(slab)
				this.platforms.push({
					mesh: slab,
					side: side.clone(),
					direction: direction.clone(),
				})
				this.floaters.push({
					mesh: slab,
					y: floating.y,
					phase: i + sign,
				})
			}
			if ([5, 9, 13, 17, 21, 25].includes(i))
				this.zones.push(p)
		}
		// Core reinforces the existing reactor objective, rather than adding one.
		const coreSite = level.monuments.sites.reactor
		const core = new THREE.Mesh(
			own(new THREE.IcosahedronGeometry(7, 1)),
			violet
		)
		core.position.copy(coreSite)
		core.position.y =
			level.planet.heightAt(coreSite.x, coreSite.z) + 34
		this.core = core
		this.group.add(core)
		const light = new THREE.PointLight(0x9165ff, 4, 160)
		light.position.copy(core.position)
		this.group.add(light)
		this.lava = this._buildLava(own)
		this.debris = new MatterDebris(level, this.zones)
		this.group.add(this.debris.group)
		this.storm = new MatterStormFX(level)
		this.group.add(this.storm.group)
		level.addObject(this.group)
		this.time = 0
		this.arrivalStarted = false
		this.lavaDamageTimer = 0
	}

	routeSample(progress) {
		const distance =
			THREE.MathUtils.clamp(progress, 0, 1) * this.routeLength
		let segment = this.routeLengths.findIndex(
			(length, index) => index > 0 && distance <= length
		)
		if (segment < 1) segment = this.routePoints.length - 1
		const start = this.routePoints[segment - 1]
		const end = this.routePoints[segment]
		const segmentLength =
			this.routeLengths[segment] -
			this.routeLengths[segment - 1]
		const t =
			(distance - this.routeLengths[segment - 1]) /
			Math.max(segmentLength, 1e-6)
		return {
			point: start.clone().lerp(end, t),
			direction: end.clone().sub(start).setY(0).normalize(),
		}
	}

	routePointAt(progress) {
		return this.routeSample(progress).point
	}

	routeProgress(position) {
		let closestDistanceSq = Infinity
		let progress = 0
		for (let i = 1; i < this.routePoints.length; i++) {
			const a = this.routePoints[i - 1]
			const b = this.routePoints[i]
			const dx = b.x - a.x
			const dz = b.z - a.z
			const lengthSq = dx * dx + dz * dz
			const t = THREE.MathUtils.clamp(
				((position.x - a.x) * dx +
					(position.z - a.z) * dz) /
					Math.max(lengthSq, 1e-6),
				0,
				1
			)
			const x = a.x + dx * t
			const z = a.z + dz * t
			const distanceSq =
				(position.x - x) ** 2 + (position.z - z) ** 2
			if (distanceSq < closestDistanceSq) {
				closestDistanceSq = distanceSq
				const segmentLength =
					this.routeLengths[i] -
					this.routeLengths[i - 1]
				progress =
					(this.routeLengths[i - 1] +
						segmentLength * t) /
					this.routeLength
			}
		}
		return progress
	}

	_buildLava(own) {
		const level = this.level
		const sourceGeometry = own(new THREE.CircleGeometry(1, 48))
		const material = own(
			new THREE.ShaderMaterial({
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				uniforms: { time: { value: 0 } },
				vertexShader: `
					varying vec2 vUv;
					void main() {
						vUv = uv;
						gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
					}`,
				fragmentShader: `
					uniform float time;
					varying vec2 vUv;
					void main() {
						vec2 p = (vUv - 0.5) * 2.0;
						float edge = 1.0 - smoothstep(0.78, 1.0, length(p));
						float flow = sin(p.x * 17.0 + p.y * 11.0 - time * 1.8)
							* cos(p.y * 21.0 + time * 1.1);
						float crack = smoothstep(0.15, 0.82, flow);
						vec3 lava = mix(vec3(0.42, 0.025, 0.004), vec3(1.0, 0.22, 0.018), crack);
						lava += vec3(0.34, 0.07, 0.006) * (0.5 + 0.5 * sin(time * 2.0 + p.x * 8.0));
						gl_FragColor = vec4(lava, edge * 0.94);
					}`,
			})
		)
		this.lavaZones = []
		const rockGeometry = own(new THREE.DodecahedronGeometry(1, 0))
		const rockMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x211c26,
				roughness: 0.95,
				flatShading: true,
				emissive: 0x351006,
				emissiveIntensity: 0.25,
			})
		)
		const rocks = new THREE.InstancedMesh(
			rockGeometry,
			rockMaterial,
			LAVA_PROGRESS.length * 5
		)
		const transform = new THREE.Object3D()
		let rockIndex = 0
		for (const [progress, sideSign] of LAVA_PROGRESS) {
			const { point, direction } = this.routeSample(progress)
			const side = new THREE.Vector3(
				-direction.z,
				0,
				direction.x
			)
			const offset = side
				.clone()
				.multiplyScalar(sideSign * 38)
			const center = point.clone().add(offset)
			const ground = level.planet.heightAt(center.x, center.z)
			center.y = ground + 0.1
			const geometry = own(sourceGeometry.clone())
			const positions = geometry.attributes.position
			for (let i = 0; i < positions.count; i++) {
				const x = positions.getX(i) * 31
				const z = -positions.getY(i) * 30
				const worldX = center.x + x
				const worldZ = center.z + z
				positions.setXYZ(
					i,
					x,
					-z,
					level.planet.heightAt(worldX, worldZ) -
						ground
				)
			}
			positions.needsUpdate = true
			geometry.computeVertexNormals()
			const lava = new THREE.Mesh(geometry, material)
			lava.position.copy(center)
			lava.rotation.x = -Math.PI / 2
			lava.renderOrder = 2
			this.group.add(lava)
			this.lavaZones.push({ center, radius: 30, ground })
			for (let i = 0; i < 5; i++) {
				const angle = (i / 5) * Math.PI * 2
				const radius = 30 + (i % 2) * 4
				transform.position.set(
					center.x + Math.cos(angle) * radius,
					level.planet.heightAt(
						center.x +
							Math.cos(angle) *
								radius,
						center.z +
							Math.sin(angle) * radius
					) + 1.4,
					center.z + Math.sin(angle) * radius
				)
				transform.rotation.set(
					angle * 0.7,
					angle,
					Math.sin(angle) * 0.25
				)
				const scale = 2 + (i % 3) * 1.1
				transform.scale.set(scale * 1.4, scale, scale)
				transform.updateMatrix()
				rocks.setMatrixAt(rockIndex++, transform.matrix)
			}
		}
		rocks.count = rockIndex
		rocks.instanceMatrix.needsUpdate = true
		this.group.add(rocks)
		this.lavaSparks = new THREE.Points(
			own(new THREE.BufferGeometry()),
			own(
				new THREE.PointsMaterial({
					color: 0xff9d42,
					size: 1.2,
					sizeAttenuation: true,
					transparent: true,
					opacity: 0.85,
					depthWrite: false,
				})
			)
		)
		const sparkPositions = new Float32Array(
			this.lavaZones.length * 8 * 3
		)
		this.lavaSparks.geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(sparkPositions, 3)
		)
		this.lavaSparkBase = sparkPositions.slice()
		for (let i = 0; i < sparkPositions.length / 3; i++) {
			const zone = this.lavaZones[Math.floor(i / 8)]
			const angle = i * 2.39996
			const radius = 8 + (i % 8) * 2.5
			this.lavaSparkBase[i * 3] =
				zone.center.x + Math.cos(angle) * radius
			this.lavaSparkBase[i * 3 + 1] = zone.ground + 0.5
			this.lavaSparkBase[i * 3 + 2] =
				zone.center.z + Math.sin(angle) * radius
		}
		sparkPositions.set(this.lavaSparkBase)
		this.lavaSparks.geometry.attributes.position.needsUpdate = true
		this.group.add(this.lavaSparks)
		this.lavaLights = this.lavaZones
			.filter((_, index) => index % 2 === 0)
			.map((zone) => {
				const light = new THREE.PointLight(
					0xff5214,
					8,
					70,
					1.8
				)
				light.position.set(
					zone.center.x,
					zone.ground + 3,
					zone.center.z
				)
				this.group.add(light)
				return light
			})
		return { material, geometry: sourceGeometry }
	}

	updateLavaDamage(delta) {
		if (
			this.disposed ||
			this.level.completed ||
			this.level.transitionHeld
		)
			return
		this.lavaDamageTimer = Math.max(0, this.lavaDamageTimer - delta)
		if (this.lavaDamageTimer > 0) return
		const player = this.level.playerRoot.position
		const feet = player.y - (this.level.pilotWalk?.footOffset ?? 0)
		const touching = this.lavaZones.some(
			(zone) =>
				Math.hypot(
					player.x - zone.center.x,
					player.z - zone.center.z
				) < zone.radius &&
				feet <=
					this.level.planet.heightAt(
						player.x,
						player.z
					) +
						3.2
		)
		if (!touching) return
		if ((this.level.damageCooldown ?? 0) > 0) {
			this.lavaDamageTimer = Math.min(
				0.1,
				this.level.damageCooldown
			)
			return
		}
		this.lavaDamageTimer =
			this.level.combatConfig.lavaDamageInterval
		this.level._requestShake?.(0.14)
		this.level.audio?.playImpact?.()
		this.level._applyAlienHit?.(
			this.level.combatConfig.lavaDamagePerSecond *
				this.level.combatConfig.lavaDamageInterval
		)
	}

	isLavaAt(x, z, padding = 0) {
		return this.lavaZones.some(
			(zone) =>
				Math.hypot(
					x - zone.center.x,
					z - zone.center.z
				) <
				zone.radius + padding
		)
	}

	avoidLava(point, padding = 0) {
		for (const zone of this.lavaZones) {
			let dx = point.x - zone.center.x
			let dz = point.z - zone.center.z
			let distance = Math.hypot(dx, dz)
			const safeRadius = zone.radius + padding
			if (distance >= safeRadius) continue
			if (distance < 1e-4) {
				dx = 1
				dz = 0
				distance = 1
			}
			const scale = (safeRadius + 2) / distance
			point.x = zone.center.x + dx * scale
			point.z = zone.center.z + dz * scale
		}
		point.y = this.level.planet.heightAt(point.x, point.z)
		return point
	}

	/** One-way landing surfaces for the existing jetpack; terrain stays intact below. */
	supportHeightAt(x, z, feetY) {
		let floor =
			this.level.survival?.supportHeightAt(x, z, feetY) ??
			this.level.planet.heightAt(x, z)
		for (const p of this.platforms) {
			if (
				this.level.survival?.isGone(
					p.mesh.position.x,
					p.mesh.position.z
				)
			)
				continue
			const dx = x - p.mesh.position.x,
				dz = z - p.mesh.position.z
			const top = p.mesh.position.y + 1.5
			if (
				Math.abs(dx * p.side.x + dz * p.side.z) <= 9 &&
				Math.abs(
					dx * p.direction.x + dz * p.direction.z
				) <= 11 &&
				feetY >= top - 0.65
			)
				floor = Math.max(floor, top)
		}
		return floor
	}

	beginArrival(exitCenter) {
		if (this.arrivalStarted) return
		this.arrivalStarted = true
		// Choreographed outside the ship's central descent corridor.
		for (const [x, y, z, major, delay] of [
			[45, -60, -110, true, 0],
			[-55, -75, -165, false, 0.8],
			[70, -100, -210, false, 1.6],
		]) {
			const point = exitCenter
				.clone()
				.add(new THREE.Vector3(x, y, z))
			this.debris.trigger(point, {
				cinematic: true,
				major,
				delay,
			})
		}
	}

	update(delta, cinematic = false) {
		if (this.disposed || !Number.isFinite(delta) || delta <= 0)
			return
		this.time += delta
		this.core.rotation.y = this.time * 0.18
		for (const f of this.floaters)
			f.mesh.position.y =
				f.y + Math.sin(this.time * 0.3 + f.phase) * 1.3
		this.lava.material.uniforms.time.value = this.time
		const sparks = this.lavaSparks.geometry.attributes.position
		for (let i = 0; i < sparks.count; i++) {
			sparks.setY(
				i,
				this.lavaSparkBase[i * 3 + 1] +
					((this.time * 2 + i * 0.37) % 4)
			)
		}
		sparks.needsUpdate = true
		for (let i = 0; i < this.lavaLights.length; i++)
			this.lavaLights[i].intensity =
				7.2 + Math.sin(this.time * 2.3 + i * 1.7) * 1.2
		this.debris.update(delta, {
			cinematic,
			active: cinematic || !this.level.completed,
		})
		this.storm.update(delta, cinematic)
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.debris.dispose()
		this.storm.dispose()
		this.group.removeFromParent()
		this.group.clear()
		for (const r of this.resources) r.dispose()
	}
}
