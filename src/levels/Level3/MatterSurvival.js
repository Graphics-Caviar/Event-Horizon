import * as THREE from 'three'
import { TerrainCrumble } from './TerrainCrumble.js'
import { installCollapseEffect } from './collapseEffect.js'

export const SURVIVAL_DEFAULTS = Object.freeze({
	countdown: 30,
	collapseSeconds: 90,
	maxFuel: 100,
	burnRate: 5,
	refill: 45,
	respawn: 12,
})

const BOMB_STATION_INTERVAL = 3

/** Collapse and fuel share the playable clock; cinematics never spend either. */
export class MatterSurvival {
	constructor(level, options = {}) {
		this.level = level
		this.config = { ...SURVIVAL_DEFAULTS, ...options }
		this.time = 0
		this.fuel = this.config.maxFuel
		this.start = level.landingSite.clone()
		this.end = level.portalSite.clone()
		this.direction = this.end
			.clone()
			.sub(this.start)
			.setY(0)
			.normalize()
		this.length = Math.max(
			1,
			this.end.clone().sub(this.start).setY(0).length()
		)
		this.edge = -Infinity
		this.sceneryScanTimer = 0
		this.group = new THREE.Group()
		this.group.name = 'nitrogen-refill-stations'
		this.resources = []
		this.pickups = []
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const padGeometry = own(new THREE.CylinderGeometry(6, 5, 2, 6))
		const canGeometry = own(
			new THREE.CylinderGeometry(0.65, 0.65, 2.4, 10)
		)
		const padMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x24243d,
				emissive: 0x15334a,
				emissiveIntensity: 0.7,
			})
		)
		const fuelMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x72ffda,
				emissive: 0x24bbae,
				emissiveIntensity: 1.4,
			})
		)
		const bombMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0xff3038,
				emissive: 0xb40818,
				emissiveIntensity: 1.6,
				metalness: 0.18,
				roughness: 0.32,
			})
		)
		const capGeometry = own(
			new THREE.CylinderGeometry(0.8, 0.8, 0.35, 12)
		)
		const ringGeometry = own(
			new THREE.TorusGeometry(1.6, 0.055, 6, 32)
		)
		const finGeometry = own(new THREE.BoxGeometry(0.18, 1.65, 0.4))
		const casing = own(
			new THREE.MeshStandardMaterial({
				color: 0x73899d,
				metalness: 0.85,
				roughness: 0.3,
			})
		)
		const haloMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0x68ffe7,
				transparent: true,
				opacity: 0.65,
				depthWrite: false,
			})
		)
		const bombHaloMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xff3545,
				transparent: true,
				opacity: 0.78,
				depthWrite: false,
			})
		)
		const count = Math.max(4, Math.ceil(this.length / 38))
		for (let i = 0; i <= count; i++) {
			const point = this.start
				.clone()
				.lerp(this.end, i / count)
			// Place the tile top on the same ground height used for walking;
			// raising it above terrain makes the pilot's feet appear buried.
			point.y = level.planet.heightAt(point.x, point.z)
			const type =
				i % BOMB_STATION_INTERVAL === 1
					? 'bomb'
					: 'nitrogen'
			const pad = new THREE.Mesh(padGeometry, padMaterial)
			pad.position.copy(point).y -= 1
			const can = new THREE.Group()
			can.name =
				type === 'bomb'
					? 'floating-red-bomb'
					: 'floating-nitrogen-cell'
			const core = new THREE.Mesh(
				canGeometry,
				type === 'bomb' ? bombMaterial : fuelMaterial
			)
			can.add(core)
			for (const sign of [-1, 1]) {
				const cap = new THREE.Mesh(capGeometry, casing)
				cap.position.y = sign * 1.35
				can.add(cap)
			}
			for (let j = 0; j < 3; j++) {
				const a = (j * Math.PI * 2) / 3
				const fin = new THREE.Mesh(finGeometry, casing)
				fin.position.set(
					Math.cos(a) * 0.85,
					0,
					Math.sin(a) * 0.85
				)
				fin.rotation.y = -a
				can.add(fin)
			}
			const halo = new THREE.Group()
			for (const angle of [0.55, -0.55]) {
				const ring = new THREE.Mesh(
					ringGeometry,
					type === 'bomb'
						? bombHaloMaterial
						: haloMaterial
				)
				ring.rotation.set(Math.PI / 2, angle, angle)
				halo.add(ring)
			}
			can.add(halo)
			can.position.copy(point).y += 4.5
			this.group.add(pad, can)
			this.pickups.push({
				point,
				index: i,
				type,
				can,
				halo,
				phase: i * 1.7,
				cooldown: 0,
			})
		}
		this.bombBlast = this._buildBombBlast(own)
		level.addObject(this.group)
		this._installTerrainEffect()
		this.crumble = new TerrainCrumble(this)
	}

	get remaining() {
		return Math.max(0, this.config.countdown - this.time)
	}
	isGone(x, z) {
		if (Math.hypot(x - this.end.x, z - this.end.z) < 28)
			return false
		return (
			(x - this.start.x) * this.direction.x +
				(z - this.start.z) * this.direction.z <
			this.edge + this.edgeOffset(x, z)
		)
	}
	edgeOffset(x, z) {
		return (
			Math.sin(
				Math.floor(x / 12) * 1.7 +
					Math.floor(z / 12) * 2.3
			) * 8
		)
	}
	surfaceHeightAt(x, z) {
		return this.isGone(x, z)
			? -Infinity
			: this.level.planet.heightAt(x, z)
	}
	supportHeightAt(x, z, feet) {
		let floor = this.surfaceHeightAt(x, z)
		for (const p of this.pickups) {
			if (
				Math.hypot(x - p.point.x, z - p.point.z) <
					5.6 &&
				feet >= p.point.y - 0.8
			)
				floor = Math.max(floor, p.point.y)
		}
		return floor
	}
	burn(delta, requested) {
		if (
			this.level.transitionHeld ||
			this.level.completed ||
			!Number.isFinite(delta) ||
			delta <= 0 ||
			!requested ||
			this.fuel <= 0
		)
			return false
		this.fuel = Math.max(
			0,
			this.fuel - this.config.burnRate * delta
		)
		return true
	}
	update(delta) {
		this._updateBombBlast(delta)
		if (
			this.level.transitionHeld ||
			this.level.completed ||
			!Number.isFinite(delta) ||
			delta <= 0
		)
			return
		this.time += delta
		this.edge =
			this.time < this.config.countdown
				? -Infinity
				: -35 +
					((this.time - this.config.countdown) /
						this.config.collapseSeconds) *
						(this.length + 70)
		this.uniform.value = Number.isFinite(this.edge)
			? this.edge
			: -100000
		this.crumble.update(delta)
		// GLB scenery arrives asynchronously. Discover it at a low cadence,
		// then avoid walking the full planet hierarchy and copying all collider
		// arrays on every gameplay frame (including every jetpack frame).
		this.sceneryScanTimer -= delta
		if (this.sceneryScanTimer <= 0) {
			this.sceneryScanTimer = 0.75
			this._scanScenery()
			for (const colliders of [
				this.level.planet.colliders,
				this.level.gameplayColliders,
			]) {
				if (!colliders) continue
				for (const c of colliders) {
					if (
						c.enabled !== false &&
						this.isGone(c.x, c.z)
					)
						c.enabled = false
				}
			}
		}
		this.tremorUniform.value =
			this.remaining > 0
				? Math.max(0, 1 - this.remaining / 5)
				: 0
		this.timeUniform.value = this.time
		const player = this.level.playerRoot.position
		const ahead =
			(player.x - this.start.x) * this.direction.x +
			(player.z - this.start.z) * this.direction.z -
			this.edge
		const warning =
			this.remaining > 0 && this.remaining < 5
				? 1 - this.remaining / 5
				: ahead >= 0 && ahead < 20
					? 1 - ahead / 20
					: 0
		if (warning > 0 && !this.level._airborne)
			this.level._requestShake?.(warning * 0.22)
		for (const p of this.pickups) {
			p.cooldown = Math.max(0, p.cooldown - delta)
			p.can.visible = p.cooldown <= 0
			p.can.rotation.y += delta
			p.can.position.y =
				p.point.y +
				4.5 +
				Math.sin(this.time * 1.7 + p.phase) * 0.8
			p.can.rotation.z =
				Math.sin(this.time * 1.1 + p.phase) * 0.14
			p.halo.rotation.y -= delta * 1.8
			if (
				p.type === 'bomb' &&
				p.can.visible &&
				player.distanceTo(p.can.position) < 5.5
			) {
				this._explodeBomb(p.can.position)
				this.level.playerHP = 0
				this.level._gameOver?.()
				break
			}
			if (
				p.type === 'nitrogen' &&
				p.cooldown <= 0 &&
				this.fuel < this.config.maxFuel &&
				player.distanceTo(p.can.position) < 5.5
			) {
				this.fuel = Math.min(
					this.config.maxFuel,
					this.fuel + this.config.refill
				)
				p.cooldown = this.config.respawn
				p.can.visible = false
				this.level._showMovementFeedback(
					`NITROGEN +${this.config.refill} / JETPACK REFILLED`,
					1.5
				)
			}
		}
	}
	_buildBombBlast(own) {
		const group = new THREE.Group()
		group.name = 'nitrogen-bomb-explosion'
		group.visible = false
		const sphere = own(new THREE.SphereGeometry(1, 16, 12))
		const flashMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xff632d,
				transparent: true,
				opacity: 0.88,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const coreMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xffefab,
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const flash = new THREE.Mesh(sphere, flashMaterial)
		const core = new THREE.Mesh(sphere, coreMaterial)
		const ringMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xffb34c,
				transparent: true,
				opacity: 0.9,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const ring = new THREE.Mesh(
			own(new THREE.TorusGeometry(1, 0.13, 8, 32)),
			ringMaterial
		)
		const light = new THREE.PointLight(0xff642b, 90, 48, 2)
		const debrisGeometry = own(
			new THREE.TetrahedronGeometry(0.32, 0)
		)
		const debrisMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xff8a46,
				transparent: true,
				opacity: 1,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const fragments = []
		for (let i = 0; i < 18; i++) {
			const y = (i % 5) / 2 - 1
			const angle = i * 2.39996
			const horizontal = Math.sqrt(1 - y * y)
			const velocity = new THREE.Vector3(
				Math.cos(angle) * horizontal,
				y,
				Math.sin(angle) * horizontal
			).multiplyScalar(10 + (i % 6) * 2.4)
			const mesh = new THREE.Mesh(
				debrisGeometry,
				debrisMaterial
			)
			mesh.rotation.set(i * 0.7, i * 1.1, i * 0.37)
			group.add(mesh)
			fragments.push({ mesh, velocity })
		}
		group.add(flash, core, ring, light)
		this.group.add(group)
		return {
			group,
			flash,
			core,
			ring,
			light,
			fragments,
			age: 0,
			active: false,
			duration: 0.85,
		}
	}
	_explodeBomb(position) {
		const blast = this.bombBlast
		if (blast.active) return
		blast.active = true
		blast.age = 0
		blast.group.visible = true
		blast.group.position.copy(position)
		this.level._requestShake?.(0.6)
		this.level.voidAudio?.play('shock', position, 0.8)
	}
	_updateBombBlast(delta) {
		const blast = this.bombBlast
		if (!blast?.active) return
		blast.age += Math.max(0, Math.min(delta, 0.05))
		const t = THREE.MathUtils.clamp(
			blast.age / blast.duration,
			0,
			1
		)
		const growth = 1 - (1 - t) ** 3
		blast.flash.scale.setScalar(0.4 + growth * 8.5)
		blast.core.scale.setScalar(0.2 + growth * 3.1)
		blast.ring.scale.setScalar(0.2 + growth * 7)
		blast.flash.material.opacity = 0.88 * (1 - t)
		blast.core.material.opacity = 0.95 * (1 - t)
		blast.ring.material.opacity = 0.9 * (1 - t)
		blast.light.intensity = 90 * (1 - t)
		for (const { mesh, velocity } of blast.fragments) {
			mesh.position.copy(velocity).multiplyScalar(blast.age)
			mesh.position.y -= 9 * blast.age * blast.age
			mesh.rotation.x += delta * 9
			mesh.rotation.z += delta * 7
			mesh.scale.setScalar(1 - t)
		}
		if (t >= 1) {
			blast.active = false
			blast.group.visible = false
		}
	}
	_installTerrainEffect() {
		this.uniform = { value: -100000 }
		this.tremorUniform = { value: 0 }
		this.timeUniform = { value: 0 }
		this.effects = new Map()
		this._applyEffect(this.level.planet.terrain.material)
	}
	_applyEffect(material) {
		if (
			!material ||
			this.effects.has(material) ||
			material.isShaderMaterial
		)
			return
		this.effects.set(
			material,
			installCollapseEffect(material, this)
		)
	}
	_scanScenery() {
		for (const root of [
			this.level.planet.root,
			this.level.stormLandscape?.root,
			this.level.monuments?._group,
			this.level.matterDimension?.group,
		]) {
			root?.traverse((node) => {
				if (
					!node.isMesh ||
					node === this.level.stormLandscape?.sky
				)
					return
				for (const material of Array.isArray(
					node.material
				)
					? node.material
					: [node.material])
					this._applyEffect(material)
			})
		}
	}
	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.crumble?.dispose()
		for (const restore of this.effects.values()) restore()
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}
