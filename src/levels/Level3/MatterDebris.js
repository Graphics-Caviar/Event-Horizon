import * as THREE from 'three'

export const MATTER_DEBRIS_DEFAULTS = Object.freeze({
	fragments: 64,
	poolSize: 14,
	warningSeconds: 3,
	fallSeconds: 2.4,
	interval: 4.3,
	targetPlayer: true,
	damage: 15,
	radius: 5,
})
const noise = (i) => {
	const n = Math.sin(i * 127.1 + 71.7) * 43758.5453
	return n - Math.floor(n)
}

/** Fixed pools, analytic trajectories and one impact per event. Y-up world space. */
export class MatterDebris {
	constructor(level, zones, options = {}) {
		this.level = level
		this.zones = zones
		this.config = { ...MATTER_DEBRIS_DEFAULTS, ...options }
		const c = this.config
		c.fragments = Math.max(
			0,
			Math.min(256, Math.floor(c.fragments))
		)
		c.poolSize = Math.max(1, Math.min(24, Math.floor(c.poolSize)))
		c.warningSeconds = Math.max(2.5, c.warningSeconds)
		c.fallSeconds = Math.max(1, c.fallSeconds)
		c.interval = Math.max(5, c.interval)
		this.group = new THREE.Group()
		this.group.name = 'matter-debris'
		this.time = 0
		this.nextEvent = 6
		this.serial = 0
		this.disposed = false
		this.geometry = new THREE.IcosahedronGeometry(1, 1)
		const rockVertices = this.geometry.attributes.position
		for (let i = 0; i < rockVertices.count; i++) {
			const x = rockVertices.getX(i),
				y = rockVertices.getY(i),
				z = rockVertices.getZ(i)
			const r = 0.82 + Math.sin(x * 9 + y * 5 + z * 7) * 0.18
			rockVertices.setXYZ(i, x * r, y * r, z * r)
		}
		this.geometry.computeVertexNormals()
		this.shardGeometry = new THREE.OctahedronGeometry(0.25, 0)
		this.trailGeometry = new THREE.ConeGeometry(0.45, 7, 5, 1, true)
		this.rockEdges = new THREE.EdgesGeometry(this.geometry, 35)
		this.seamMaterial = new THREE.LineBasicMaterial({
			color: 0xbc79fc,
			transparent: true,
			opacity: 0.55,
		})
		this.fragmentMaterial = new THREE.MeshStandardMaterial({
			color: 0x87739b,
			emissive: 0x632b84,
			emissiveIntensity: 0.7,
			flatShading: true,
		})
		this.architectureGeometry = new THREE.BoxGeometry(1.5, 0.7, 2.4)
		this.architectureEdges = new THREE.EdgesGeometry(
			this.architectureGeometry
		)
		this.material = new THREE.MeshStandardMaterial({
			color: 0x394255,
			roughness: 0.9,
			flatShading: true,
			emissive: 0x201330,
			emissiveIntensity: 0.5,
		})
		this.ringGeometry = new THREE.RingGeometry(0.82, 1, 40)
		this.matrix = new THREE.Object3D()
		this.fragments = new THREE.InstancedMesh(
			this.geometry,
			this.material,
			c.fragments
		)
		this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.group.add(this.fragments)
		this.events = Array.from({ length: c.poolSize }, () => {
			const mesh = new THREE.Mesh(
				this.geometry,
				this.material
			)
			const material = new THREE.MeshBasicMaterial({
				color: 0xffb95c,
				side: THREE.DoubleSide,
				transparent: true,
				depthWrite: false,
			})
			const ring = new THREE.Mesh(
				this.ringGeometry.clone(),
				material
			)
			const outline = new THREE.LineSegments(
				this.rockEdges,
				this.seamMaterial
			)
			outline.scale.setScalar(1.015)
			mesh.add(outline)
			const shards = new THREE.InstancedMesh(
				this.shardGeometry,
				this.fragmentMaterial,
				12
			)
			shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
			shards.frustumCulled = false
			const trailMaterial = new THREE.MeshBasicMaterial({
				color: 0xab75ff,
				transparent: true,
				opacity: 0.25,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			})
			const trail = new THREE.Mesh(
				this.trailGeometry,
				trailMaterial
			)
			const shock = new THREE.Mesh(
				this.ringGeometry,
				material.clone()
			)
			shock.rotation.x = -Math.PI / 2
			const bracket = new THREE.Mesh(
				this.ringGeometry,
				material
			)
			bracket.rotation.x = -Math.PI / 2
			shards.visible =
				trail.visible =
				shock.visible =
				bracket.visible =
					false
			this.group.add(shards, trail, shock, bracket)
			ring.rotation.x = -Math.PI / 2
			mesh.visible = ring.visible = false
			this.group.add(mesh, ring)
			return {
				mesh,
				ring,
				outline,
				shards,
				trail,
				shock,
				bracket,
				active: false,
				age: 0,
				point: new THREE.Vector3(),
			}
		})
		this._updateFragments()
	}

	trigger(
		point,
		{
			cinematic = false,
			major = false,
			medium = false,
			duckable = false,
			airborne = false,
			delay = 0,
		} = {}
	) {
		if (this.disposed) return false
		const e = this.events.find((entry) => !entry.active)
		if (!e) return false
		Object.assign(e, {
			active: true,
			age: -Math.max(0, delay),
			impacted: false,
			cinematic,
			major,
			medium,
			duckable,
			seed: ++this.serial,
		})
		e.mesh.geometry = major
			? this.architectureGeometry
			: this.geometry
		e.outline.geometry = major
			? this.architectureEdges
			: this.rockEdges
		e.shards.visible = e.trail.visible = e.shock.visible = false
		e.bracket.visible = !cinematic
		e.trail.material.color.set(duckable ? 0x6cffff : 0xb178ff)
		e.point.copy(point)
		e.radius =
			this.config.radius *
			(major ? 1.6 : medium || duckable ? 0.45 : 1)
		e.ring.position.copy(point).y += 0.18
		e.ring.scale.setScalar(e.radius)
		// Warp each pooled warning ring to the same terrain triangles as movement.
		const vertices = e.ring.geometry.attributes.position
		for (let i = 0; i < vertices.count; i++) {
			const x = point.x + vertices.getX(i) * e.radius
			const z = point.z - vertices.getY(i) * e.radius
			const ground = airborne
				? point.y
				: (this.level.planet?.heightAt(x, z) ?? point.y)
			vertices.setZ(i, (ground - point.y) / e.radius)
		}
		vertices.needsUpdate = true
		e.ring.geometry.computeBoundingSphere()
		e.ring.material.color.set(duckable ? 0x6cffff : 0xffb95c)
		e.shock.material.color.copy(e.ring.material.color)
		e.ring.visible = !cinematic
		e.mesh.visible = false
		if (!cinematic)
			this.level.voidAudio?.play(
				'charge',
				point,
				0.55,
				this.config.warningSeconds
			)
		return true
	}

	_updateFragments() {
		const origin = this.level.landingSite
		for (let i = 0; i < this.fragments.count; i++) {
			const a = noise(i) * Math.PI * 2
			const r = 65 + noise(i + 100) * 280
			this.matrix.position.set(
				origin.x + Math.cos(a) * r,
				origin.y +
					65 +
					noise(i + 200) * 180 +
					Math.sin(this.time * 0.13 + a) * 8,
				origin.z + Math.sin(a) * r
			)
			this.matrix.rotation.set(
				a + this.time * (0.03 + noise(i + 300) * 0.08),
				a * 2,
				this.time * 0.06
			)
			this.matrix.scale.set(
				0.5 + noise(i + 400) * 2,
				0.8,
				1.6
			)
			this.matrix.updateMatrix()
			this.fragments.setMatrixAt(i, this.matrix.matrix)
		}
		this.fragments.instanceMatrix.needsUpdate = true
		this.fragments.computeBoundingSphere()
	}

	update(delta, { cinematic = false, active = true } = {}) {
		if (
			this.disposed ||
			!Number.isFinite(delta) ||
			delta <= 0 ||
			!active
		)
			return
		this.time += delta
		this._updateFragments()
		if (
			!cinematic &&
			this.time >= this.nextEvent &&
			(this.config.targetPlayer || this.zones.length)
		) {
			this.nextEvent = this.time + (this.level.survival?.remaining <= 0 ? 2.65 : this.config.interval)
			if (this.config.targetPlayer) {
				// A shower has one clearly telegraphed attack plus several scattered
				// visual impacts, not several unavoidable hits on the same spot.
				const center = this.level.playerRoot.position
				const collapsing = this.level.survival?.remaining <= 0
				const count = collapsing ? 4 : 2
				for (let i = 0; i < count; i++) {
					const point = center.clone()
					if (i > 0) {
						const a = noise(this.serial + i * 31 + 5) * Math.PI * 2
						const r = 12 + noise(this.serial + i * 17 + 9) * 25
						point.x += Math.cos(a) * r
						point.z += Math.sin(a) * r
						point.y -= noise(i * 43 + this.serial) * 6
					}
					const duckable = i === 0 && this.serial % 3 === 1
					if (duckable) point.y += 2
					this.trigger(point, {
						delay: delta + i * 0.3,
						duckable,
						medium: i !== 0,
						airborne: true,
						major: i === 0 && !duckable && this.serial % 4 === 3,
					})
				}
			} else {
				const nearby = this.zones.filter(
					(zone) =>
						zone.distanceTo(
							this.level.playerRoot
								.position
						) < 150
				)
				const zone =
					nearby[
						this.serial %
							(nearby.length || 1)
					]
				if (zone) this.trigger(zone, { delay: delta })
			}
		}
		for (const e of this.events) {
			if (!e.active) continue
			e.age += delta
			if (e.age < 0) continue
			const t =
				(e.age - this.config.warningSeconds) /
				this.config.fallSeconds
			e.ring.material.opacity =
				t < 0
					? 0.55 + Math.sin(e.age * 9) * 0.25
					: Math.max(0, 1 - t)
			e.bracket.position.copy(e.point).y += 0.24
			e.bracket.scale.setScalar(
				e.radius * (1.05 + Math.max(0, -t) * 0.35)
			)
			e.bracket.rotation.z = e.age * 0.4
			if (t < 0) continue
			if (t <= 1) {
				e.mesh.visible = true
				e.trail.visible = true
				e.mesh.position.copy(e.point)
				e.mesh.position.y += 100 * (1 - t * t)
				e.mesh.position.x +=
					(1 - t) * (noise(e.seed) - 0.5) * 28
				e.mesh.position.z +=
					(1 - t) *
					(noise(e.seed + 50) - 0.5) *
					24
				e.mesh.scale.set(
					e.radius * 0.65,
					e.radius * 0.5,
					e.radius
				)
				e.mesh.rotation.set(
					e.age * (0.3 + noise(e.seed)),
					e.age * 0.7,
					e.age * 0.4
				)
				e.trail.position.copy(e.mesh.position).y +=
					e.radius * 2.4
				e.trail.scale.set(
					e.radius * 0.55,
					e.radius * 0.65,
					e.radius * 0.55
				)
				e.trail.material.opacity = 0.15 + t * 0.22
			} else if (!e.impacted) {
				e.impacted = true
				e.trail.visible = e.bracket.visible = false
				e.shards.visible = e.shock.visible = true
				this.level._requestShake?.(
					e.cinematic
						? 0
						: Math.max(
								0,
								1 -
									e.point.distanceTo(
										this
											.level
											.playerRoot
											.position
									) /
										65
							) * 0.35
				)
				e.mesh.visible = false
				this.level.voidAudio?.play(
					'shock',
					e.point,
					e.major ? 0.5 : 0.8
				)
				if (!e.cinematic)
					this.level.dust?.spawnBurst(e.point, {
						count: 18,
						strength: 3,
						spread: e.radius,
						size: 1.5,
						upBias: 0.6,
					})
				const player = this.level.playerRoot.position
				if (
					!e.medium &&
					!(
						e.duckable &&
						this.level.crouching &&
						!this.level._airborne
					) &&
					!e.cinematic &&
					!cinematic &&
					!this.level.completed &&
					this.level.damageCooldown <= 0 &&
					Math.hypot(
						player.x - e.point.x,
						player.z - e.point.z
					) <
						e.radius + 0.9 &&
					Math.abs(player.y - e.point.y) < 7
				)
					this.level._applyAlienHit(
						this.config.damage
					)
			}
			if (e.impacted) {
				const age = Math.max(
					0,
					(t - 1) * this.config.fallSeconds
				)
				e.shock.position.copy(e.point).y += 0.25
				e.shock.scale.setScalar(
					e.radius * (1 + age * 3)
				)
				e.shock.material.opacity =
					Math.max(0, 1 - age) * 0.65
				for (let i = 0; i < 12; i++) {
					const a =
						(i / 12) * Math.PI * 2 + e.seed
					const speed = 3 + noise(e.seed + i) * 8
					this.matrix.position.copy(e.point)
					this.matrix.position.x +=
						Math.cos(a) * speed * age
					this.matrix.position.z +=
						Math.sin(a) * speed * age
					this.matrix.position.y +=
						1 + 7 * age - 10 * age * age
					this.matrix.rotation.set(
						age * 4 + i,
						age * 3,
						i
					)
					this.matrix.scale.setScalar(
						Math.max(0, 1 - age) *
							(e.major ? 3 : 1.5)
					)
					this.matrix.updateMatrix()
					e.shards.setMatrixAt(
						i,
						this.matrix.matrix
					)
				}
				e.shards.instanceMatrix.needsUpdate = true
			}
			if (t > 1.4) {
				e.active = false
				e.mesh.visible = e.ring.visible = false
				e.trail.visible =
					e.shards.visible =
					e.shock.visible =
					e.bracket.visible =
						false
			}
		}
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.group.removeFromParent()
		this.fragments.dispose()
		this.geometry.dispose()
		this.shardGeometry.dispose()
		this.trailGeometry.dispose()
		this.rockEdges.dispose()
		this.architectureEdges.dispose()
		this.seamMaterial.dispose()
		this.fragmentMaterial.dispose()
		this.architectureGeometry.dispose()
		this.material.dispose()
		this.ringGeometry.dispose()
		for (const e of this.events) {
			e.shards.dispose()
			e.trail.material.dispose()
			e.shock.material.dispose()
			e.ring.material.dispose()
			e.ring.geometry.dispose()
		}
		this.group.clear()
	}
}
