import * as THREE from 'three'
import { TerrainCrumble } from './TerrainCrumble.js'
import { installCollapseEffect } from './collapseEffect.js'

export const SURVIVAL_DEFAULTS = Object.freeze({
	countdown: 120,
	collapseSeconds: 45,
	maxFuel: 100,
	burnRate: 5,
	refill: 45,
	respawn: 12,
	// The red cells are intentional instant-death decoys, spaced among refills.
	trapEvery: 6,
})

/** Collapse and fuel share the playable clock; cinematics never spend either. */
export class MatterSurvival {
	constructor(level, options = {}) {
		this.level = level
		this.config = { ...SURVIVAL_DEFAULTS, ...options }
		this.time = 0
		this.collapseAnnounced = false
		this.suctionWarned = false
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
		const trapMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0xff284f,
				emissive: 0xed0028,
				emissiveIntensity: 2.1,
			})
		)
		const trapPadMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x49202f,
				emissive: 0x5d0818,
				emissiveIntensity: 0.65,
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
		const trapHaloMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xff4265,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
			})
		)
		const count = Math.max(4, Math.ceil(this.length / 38))
		for (let i = 0; i <= count; i++) {
			// Keep the first and final stations safe. Red decoys appear
			// periodically along the route and are visible before collection.
			const trap =
				i > 0 &&
				i < count &&
				this.config.trapEvery > 0 &&
				(i - 3) % this.config.trapEvery === 0
			const point = this.start
				.clone()
				.lerp(this.end, i / count)
			point.y = level.planet.heightAt(point.x, point.z) + 0.4
			const pad = new THREE.Mesh(
				padGeometry,
				trap ? trapPadMaterial : padMaterial
			)
			pad.position.copy(point).y -= 1
			const can = new THREE.Group()
			can.name = 'floating-nitrogen-cell'
			const core = new THREE.Mesh(
				canGeometry,
				trap ? trapMaterial : fuelMaterial
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
					trap ? trapHaloMaterial : haloMaterial
				)
				ring.rotation.set(Math.PI / 2, angle, angle)
				halo.add(ring)
			}
			can.add(halo)
			can.position.copy(point).y += 4.5
			this.group.add(pad, can)
			this.pickups.push({
				trap,
				point,
				can,
				halo,
				phase: i * 1.7,
				cooldown: 0,
			})
		}
		level.addObject(this.group)
		this._installTerrainEffect()
		this.crumble = new TerrainCrumble(this)
	}

	/** Collapse accelerates slightly as the world breaks apart. */
	_collapseProgress() {
		const t = Math.max(
			0,
			(this.time - this.config.countdown) /
				this.config.collapseSeconds
		)
		return t * (0.8 + 0.2 * Math.min(t, 1))
	}

	/** World-space suction near the advancing collapse, for jetpack flight only. */
	getSuction(position) {
		if (
			!this.collapseAnnounced ||
			this.level.completed ||
			this.level.transitionHeld
		)
			return { backwards: 0, downwards: 0 }
		const ahead =
			(position.x - this.start.x) * this.direction.x +
			(position.z - this.start.z) * this.direction.z -
			this.edge
		const near = 1 - THREE.MathUtils.clamp((ahead - 18) / 135, 0, 1)
		const ramp = THREE.MathUtils.clamp(
			(this.time - this.config.countdown) / 12,
			0,
			1
		)
		return {
			backwards: ramp * (4 + 24 * near),
			downwards: ramp * (2.5 + 7 * near),
		}
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
	burn(delta, requested, boost = false) {
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
			this.fuel -
				this.config.burnRate * (boost ? 1.8 : 1) * delta
		)
		return true
	}
	update(delta) {
		if (
			this.level.transitionHeld ||
			this.level.completed ||
			!Number.isFinite(delta) ||
			delta <= 0
		)
			return
		this.time += delta
		if (
			!this.collapseAnnounced &&
			this.time >= this.config.countdown
		) {
			this.collapseAnnounced = true
			this.level._showMovementFeedback?.(
				'DIMENSION COLLAPSING — BOOST TO THE RIFT',
				4
			)
			this.level._requestShake?.(0.4)
		}
		if (
			this.collapseAnnounced &&
			!this.suctionWarned &&
			this.time >= this.config.countdown + 4
		) {
			this.suctionWarned = true
			this.level._showMovementFeedback?.(
				'VOID CURRENT ACTIVE — BOOST AGAINST THE PULL',
				3
			)
		}
		this.edge =
			this.time < this.config.countdown
				? -Infinity
				: -35 +
					this._collapseProgress() *
						(this.length + 70)
		this.uniform.value = Number.isFinite(this.edge)
			? this.edge
			: -100000
		this.crumble.update(delta)
		// GLB scenery can arrive asynchronously. Discover it periodically, then
		// avoid traversing the entire world and copying collider arrays every
		// frame, especially while the player is holding the jetpack control.
		this.sceneryScanTimer -= delta
		if (this.sceneryScanTimer <= 0) {
			this.sceneryScanTimer = 0.75
			this._scanScenery()
			for (const colliders of [
				this.level.planet.colliders,
				this.level.gameplayColliders,
			]) {
				if (!colliders) continue
				for (const collider of colliders) {
					if (
						collider.enabled !== false &&
						this.isGone(
							collider.x,
							collider.z
						)
					)
						collider.enabled = false
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
				p.cooldown <= 0 &&
				player.distanceTo(p.can.position) < 5.5 &&
				(p.trap || this.fuel < this.config.maxFuel)
			) {
				p.cooldown = p.trap
					? Infinity
					: this.config.respawn
				p.can.visible = false
				if (p.trap) {
					// Never gate lethal pickups on missing fuel; full tanks
					// must not make the red decoy safe.
					this.level.playerHP = 0
					this.level._updateLevelHUD?.()
					this.level._showMovementFeedback?.(
						'JETPACK OVERLOAD — FATAL SYSTEM FAILURE',
						2
					)
					this.level._gameOver('nitrogen-overload')
					return
				}
				this.fuel = Math.min(
					this.config.maxFuel,
					this.fuel + this.config.refill
				)
				this.level._showMovementFeedback(
					`NITROGEN +${this.config.refill} / JETPACK REFILLED`,
					1.5
				)
			}
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
