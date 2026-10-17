import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'

const LOAD_STAGGER_MS = 420

/**
 * The six Level 3 environment GLBs, staged as a band of ancient ruins
 * along the portal approach: the colossus arena anchors the endgame, the
 * reactor and rift light it in violet/cyan, the collapsed bridge and the
 * doomed ship dress the route. Loads are staggered like Level2's alien
 * roster so the ~20 MB files never parse in the same frame; every
 * ground-anchored piece registers planet colliders so the pilot, rover
 * and enemies all respect it.
 */
export class VoidMonuments {
	constructor(level) {
		this.level = level
		this._group = level.addObject(new THREE.Group())
		this._group.name = 'void-monuments'
		this._timers = []
		this._rift = null
		this._ship = null
		this._reactorLight = null
		this._riftLight = null
		this._pulse = Math.random() * Math.PI * 2
		this.sites = this._chooseSites()

		const defs = [
			{
				key: 'ancientReactor',
				site: this.sites.reactor,
				fit: 26,
				yaw: 0,
				embed: 0.5,
				shadows: true,
				colliders: [{ radius: 8.5 }],
				light: {
					color: 0x54e8ff,
					intensity: 2.2,
					distance: 190,
				},
			},
			{
				key: 'gravRift',
				site: this.sites.rift,
				fit: 30,
				yaw: 0,
				embed: 1.2,
				shadows: true,
				colliders: [{ radius: 7.5 }],
				light: {
					color: 0xb26bff,
					intensity: 1.6,
					distance: 170,
				},
			},
			{
				key: 'brokenBridge',
				site: this.sites.bridge,
				fit: 62,
				yaw: this.sites.bridgeYaw,
				embed: 0.8,
				shadows: false,
				// Two discs along the long axis approximate the span.
				colliders: [
					{ radius: 9, along: 18 },
					{ radius: 9, along: -18 },
				],
			},
			{
				key: 'bossArena',
				site: this.sites.arena,
				fit: 96,
				yaw: this.sites.arenaYaw,
				embed: 2.2,
				shadows: false,
				colliders: [],
			},
			{
				key: 'anomalyShip',
				site: this.sites.ship,
				fit: 30,
				yaw: this.sites.shipYaw,
				hover: 20,
				shadows: false,
				colliders: [],
			},
		]
		defs.forEach((def, index) => {
			this._timers.push(
				setTimeout(
					() => this._load(def),
					500 + index * LOAD_STAGGER_MS
				)
			)
		})
	}

	/** Deterministic region choices; exact spots walk to walkable ground. */
	_chooseSites() {
		const level = this.level
		const midRoute = level.landingSite
			.clone()
			.lerp(level.portalSite, 0.55)
		const yaw = () => Math.random() * Math.PI * 2
		return {
			arena: level._findWalkableSite(
				level.portalSite
					.clone()
					.add(new THREE.Vector3(-150, 0, -130))
			),
			reactor: level._findWalkableSite(
				level.portalSite
					.clone()
					.add(new THREE.Vector3(-65, 0, -75))
			),
			rift: level._findWalkableSite(
				midRoute
					.clone()
					.add(new THREE.Vector3(55, 0, -80))
			),
			bridge: level._findWalkableSite(
				level.crashSite
					.clone()
					.add(new THREE.Vector3(120, 0, -70))
			),
			ship: level._findWalkableSite(
				level.crashSite
					.clone()
					.add(new THREE.Vector3(-80, 0, 140))
			),
			bridgeYaw: yaw(),
			arenaYaw: yaw(),
			shipYaw: yaw(),
		}
	}

	async _load(def) {
		const model = await loadVoidModel(
			this.level.assetManager,
			def.key
		)
		if (!model || !this._group.parent) return
		this.level._fit(model, def.fit)
		model.rotation.y = def.yaw
		model.updateMatrixWorld(true)
		const box = new THREE.Box3().setFromObject(model)
		const ground = this.level.planet.heightAt(
			def.site.x,
			def.site.z
		)
		model.position.set(
			def.site.x,
			def.hover
				? ground + def.hover
				: ground - box.min.y + (def.embed || 0),
			def.site.z
		)
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = !!def.shadows
				child.receiveShadow = false
			}
		})
		this._group.add(model)

		for (const collider of def.colliders) {
			if (collider.along) {
				// Local +X is the long axis; carry the disc along the yaw.
				const dirX = Math.cos(def.yaw)
				const dirZ = -Math.sin(def.yaw)
				this.level._registerGameplayCollider(
					def.site.x + dirX * collider.along,
					def.site.z + dirZ * collider.along,
					collider.radius,
					'monument',
					model
				)
			} else {
				this.level._registerGameplayCollider(
					def.site.x,
					def.site.z,
					collider.radius,
					'monument',
					model
				)
			}
		}

		if (def.light) {
			const light = new THREE.PointLight(
				def.light.color,
				def.light.intensity,
				def.light.distance,
				1.4
			)
			light.position.set(
				def.site.x,
				ground + def.fit * 0.55,
				def.site.z
			)
			this._group.add(light)
			if (def.key === 'ancientReactor')
				this._reactorLight = light
			if (def.key === 'gravRift') this._riftLight = light
		}
		if (def.key === 'gravRift') {
			this._rift = {
				model,
				position: model.position.clone(),
				baseRotation: model.rotation.y,
			}
		}
		if (def.key === 'anomalyShip') {
			this._ship = {
				model,
				baseY: model.position.y,
				baseRotation: model.rotation.y,
			}
		}
	}

	update(delta) {
		if (!this._group.parent) return
		this._pulse += delta
		if (this._reactorLight) {
			this._reactorLight.intensity =
				2 + Math.sin(this._pulse * 2.1) * 0.5
		}
		if (this._riftLight) {
			this._riftLight.intensity =
				1.5 + Math.sin(this._pulse * 3.3) * 0.4
		}
		if (this._rift) {
			this._rift.model.rotation.y =
				this._rift.baseRotation + this._pulse * 0.22
			this._applyRiftPull(delta)
		}
		if (this._ship) {
			this._ship.model.position.y =
				this._ship.baseY +
				Math.sin(this._pulse * 0.6) * 1.6
			this._ship.model.rotation.y =
				this._ship.baseRotation + this._pulse * 0.05
			this._ship.model.rotation.z =
				Math.sin(this._pulse * 0.4) * 0.06
		}
	}

	/**
	 * The rift drags the pilot gently toward it inside 60 m — readable,
	 * escapable, and it makes the anomaly a place rather than a prop.
	 */
	_applyRiftPull(delta) {
		const level = this.level
		if (level.completed || level.boarded) return
		const player = level.playerRoot.position
		const dx = this._rift.position.x - player.x
		const dz = this._rift.position.z - player.z
		const distance = Math.hypot(dx, dz)
		if (distance > 60 || distance < 6) return
		const strength = (1 - distance / 60) * 13
		player.x += (dx / distance) * strength * delta
		player.z += (dz / distance) * strength * delta
	}

	dispose() {
		for (const timer of this._timers) clearTimeout(timer)
		this._timers.length = 0
	}
}
