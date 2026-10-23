import * as THREE from 'three'

export const MATTER_DEBRIS_DEFAULTS = Object.freeze({
	fragments: 64,
	poolSize: 8,
	warningSeconds: 3,
	fallSeconds: 2.4,
	interval: 5,
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
		this.geometry = new THREE.IcosahedronGeometry(1, 0)
		this.architectureGeometry = new THREE.BoxGeometry(1.5, 0.7, 2.4)
		this.material = new THREE.MeshStandardMaterial({
			color: 0x394255,
			roughness: 0.85,
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
			ring.rotation.x = -Math.PI / 2
			mesh.visible = ring.visible = false
			this.group.add(mesh, ring)
			return {
				mesh,
				ring,
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
			this.nextEvent = this.time + this.config.interval
			if (this.config.targetPlayer) {
				const point =
					this.level.playerRoot.position.clone()
				const duckable = this.serial % 3 === 1
				if (duckable) point.y += 2
				this.trigger(point, {
					delay: delta,
					duckable,
					airborne: true,
					major:
						!duckable &&
						this.serial % 4 === 3,
				})
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
			if (t < 0) continue
			if (t <= 1) {
				e.mesh.visible = true
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
			} else if (!e.impacted) {
				e.impacted = true
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
			if (t > 1.4) {
				e.active = false
				e.mesh.visible = e.ring.visible = false
			}
		}
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.group.removeFromParent()
		this.fragments.dispose()
		this.geometry.dispose()
		this.architectureGeometry.dispose()
		this.material.dispose()
		this.ringGeometry.dispose()
		for (const e of this.events) {
			e.ring.material.dispose()
			e.ring.geometry.dispose()
		}
		this.group.clear()
	}
}
