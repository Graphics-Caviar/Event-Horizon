import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'

const SWING_WINDUP = 0.16
const SWING_STRIKE = 0.14
const SWING_RECOVER = 0.3
const SWING_COOLDOWN = 0.72
const BLADE_REACH = 5.4
// cos threshold against the pilot's facing: a generous frontal arc.
const BLADE_ARC = 0.34
// Held scale relative to the pickup's 2.8 m display fit.
const HELD_SCALE = 1.6 / 2.8

const REST_POSE = { x: 0.35, z: -0.25 }

/**
 * The pilot's only weapon on foot: an ancient energy blade. The GLB
 * floats as a pickup near the landing site (glow sprite + light so the
 * site reads from a distance), snaps to the pilot's side on approach,
 * and swings on F through windup → strike → follow-through, with damage
 * landing only inside the strike window's frontal arc. Rover ramming
 * remains the heavy-damage option (Level2's existing path).
 */
export class EnergyBlade {
	constructor(level) {
		this.level = level
		this.equipped = false
		this._swingT = -1
		this._struck = false
		this._cooldown = 0
		this._spin = Math.random() * Math.PI * 2
		this._model = null

		const site = level._findWalkableSite(
			level.landingSite
				.clone()
				.add(new THREE.Vector3(26, 0, -20))
		)
		this._baseY = level.planet.heightAt(site.x, site.z) + 1.6
		this._pickup = level.addObject(new THREE.Group())
		this._pickup.name = 'void-blade-pickup'
		this._pickup.position.set(site.x, this._baseY, site.z)
		this._buildBeacon()
		this._load()
	}

	async _load() {
		const model = await loadVoidModel(
			this.level.assetManager,
			'energyBlade'
		)
		if (!model || !this._pickup.parent) return
		this.level._fit(model, 2.8)
		this._model = model
		this._pickup.add(model)
	}

	_buildBeacon() {
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 64
		const ctx = canvas.getContext('2d')
		const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
		gradient.addColorStop(0, 'rgba(255,255,255,1)')
		gradient.addColorStop(0.35, 'rgba(255,255,255,.5)')
		gradient.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 64, 64)
		const material = this.level.own(
			new THREE.SpriteMaterial({
				map: new THREE.CanvasTexture(canvas),
				color: 0x6ef2ff,
				transparent: true,
				opacity: 0.8,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const sprite = new THREE.Sprite(material)
		sprite.scale.setScalar(6)
		this._pickup.add(sprite)
		const light = new THREE.PointLight(0x54e8ff, 1.2, 60, 1.4)
		this._pickup.add(light)
	}

	trySwing() {
		const level = this.level
		if (
			!this.equipped ||
			this._swingT >= 0 ||
			this._cooldown > 0 ||
			level.completed ||
			level.boarded
		) {
			return
		}
		this._swingT = 0
		this._struck = false
		this._cooldown = SWING_COOLDOWN
		level.voidAudio?.play('swing', level.playerRoot.position, 1)
	}

	update(delta) {
		const level = this.level
		if (!this._model) return
		if (!this.equipped) {
			this._spin += delta * 1.4
			this._pickup.rotation.y = this._spin
			this._pickup.position.y =
				this._baseY + Math.sin(this._spin * 0.8) * 0.35
			if (
				this._pickup.position.distanceTo(
					level.playerRoot.position
				) < 3.2
			) {
				this._equip()
			}
			return
		}
		this._cooldown = Math.max(0, this._cooldown - delta)
		// Stowed while driving.
		this._model.visible = !level.boarded
		if (this._swingT < 0) return
		this._swingT += delta
		const t = this._swingT
		if (t < SWING_WINDUP) {
			// Draw back over the shoulder.
			const k = t / SWING_WINDUP
			this._model.rotation.set(
				REST_POSE.x - 0.9 * k,
				0,
				REST_POSE.z - 0.5 * k
			)
		} else if (t < SWING_WINDUP + SWING_STRIKE) {
			// Committed sweep across the body; damage lands mid-swing.
			const k = (t - SWING_WINDUP) / SWING_STRIKE
			this._model.rotation.set(
				-0.55 + 1.1 * k,
				0,
				-0.75 + 1.9 * k
			)
			if (!this._struck && k >= 0.4) {
				this._struck = true
				this._strike()
			}
		} else if (t < SWING_WINDUP + SWING_STRIKE + SWING_RECOVER) {
			// Follow-through eases back to the carry pose.
			const k =
				(t - SWING_WINDUP - SWING_STRIKE) /
				SWING_RECOVER
			this._model.rotation.set(
				0.55 - 0.2 * k,
				0,
				1.15 - 1.4 * k
			)
		} else {
			this._swingT = -1
			this._model.rotation.set(REST_POSE.x, 0, REST_POSE.z)
		}
	}

	_equip() {
		const level = this.level
		this.equipped = true
		this._pickup.visible = false
		const height = level.pilotWalk?.height ?? 3
		this._model.position.set(0.62, height * 0.42, 0.18)
		this._model.rotation.set(REST_POSE.x, 0, REST_POSE.z)
		this._model.scale.multiplyScalar(HELD_SCALE)
		level.playerRoot.add(this._model)
		level.audio?.playCollect()
		level._showMovementFeedback?.(
			'ANCIENT BLADE ACQUIRED — F TO SWING'
		)
	}

	_strike() {
		const level = this.level
		const player = level.playerRoot
		const yaw = player.rotation.y
		const fx = Math.sin(yaw)
		const fz = Math.cos(yaw)
		let hits = 0
		for (const enemy of level.aliens) {
			if (enemy.smashed || !enemy.position || !enemy.damage) {
				continue
			}
			const dx = enemy.position.x - player.position.x
			const dz = enemy.position.z - player.position.z
			const distance = Math.hypot(dx, dz)
			if (
				distance >
				BLADE_REACH + (enemy.radius || 2) * 0.6
			) {
				continue
			}
			if (
				distance > 0.5 &&
				(dx * fx + dz * fz) / distance < BLADE_ARC
			) {
				continue
			}
			// Flyers only expose themselves on their low dives.
			if (
				enemy.kind === 'flyer' &&
				enemy.position.y - player.position.y > 5
			) {
				continue
			}
			enemy.damage(1)
			hits += 1
		}
		if (hits > 0) {
			level._requestShake?.(0.18)
			level.dust?.spawnBurst(
				{
					x: player.position.x + fx * 3,
					y: player.position.y - 0.5,
					z: player.position.z + fz * 3,
				},
				{
					count: 10,
					strength: 1.8,
					spread: 1.6,
					size: 1,
					upBias: 0.5,
				}
			)
		}
	}

	dispose() {
		this._model?.removeFromParent()
	}
}
