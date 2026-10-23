import * as THREE from 'three'
import { MatterDebris } from './MatterDebris.js'

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
		const start = level.landingSite
		const end = level.portalSite
		const direction = end.clone().sub(start).setY(0).normalize()
		const side = new THREE.Vector3(-direction.z, 0, direction.x)
		const mesh = (material, point, scale) => {
			const m = new THREE.Mesh(box, material)
			m.position.copy(point)
			m.scale.fromArray(scale)
			m.rotation.y = Math.atan2(direction.x, direction.z)
			this.group.add(m)
			return m
		}
		this.zones = []
		// Paired edge beacons lead along the established safe terrain corridor.
		// Broken elevated spans frame it, never introduce invisible obstacles.
		for (let i = 1; i < 18; i++) {
			const p = start.clone().lerp(end, i / 18)
			p.y = level.planet.heightAt(p.x, p.z)
			for (const sign of [-1, 1]) {
				const edge = p
					.clone()
					.addScaledVector(side, sign * 11)
				edge.y =
					level.planet.heightAt(edge.x, edge.z) +
					0.6
				mesh(i < 9 ? cyan : violet, edge, [0.5, 1.2, 5])
				const floating = p
					.clone()
					.addScaledVector(
						side,
						sign * (38 + (i % 3) * 8)
					)
				floating.y += 28 + (i % 4) * 9
				const slab = mesh(metal, floating, [18, 3, 22])
				const shard = new THREE.Mesh(
					shardGeometry,
					metal
				)
				shard.rotation.z = Math.PI
				shard.position.y = -2
				shard.scale.set(0.65, 3.5, 0.65)
				slab.add(shard)
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
				const stripe = new THREE.Mesh(
					box,
					sign < 0 ? cyan : violet
				)
				stripe.position.y = 0.54
				stripe.scale.set(0.6 / 18, 0.2 / 3, 17 / 22)
				slab.add(stripe)
			}
			if ([6, 10, 14].includes(i)) this.zones.push(p)
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
		this.debris = new MatterDebris(level, this.zones)
		this.group.add(this.debris.group)
		level.addObject(this.group)
		this.time = 0
		this.arrivalStarted = false
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
		this.debris.update(delta, {
			cinematic,
			active: cinematic || !this.level.completed,
		})
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.debris.dispose()
		this.group.removeFromParent()
		this.group.clear()
		for (const r of this.resources) r.dispose()
	}
}
