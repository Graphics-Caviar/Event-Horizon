import * as THREE from 'three'

export const ALIEN_MODELS = {
	predator: '/assets/models/aliens/alien-predator.glb',
	flying: '/assets/models/aliens/alien-flying-predator.glb',
	brute: '/assets/models/aliens/armored-alien-brute.glb',
}

// Aliens farther than this from the player are hidden: only the nearby
// crowd costs draw calls, which keeps a large roster affordable.
const CULL_DISTANCE = 240

const UP = new THREE.Vector3(0, 1, 0)

const shortestAngle = (target, current) => {
	let diff = (target - current) % (Math.PI * 2)
	if (diff > Math.PI) diff -= Math.PI * 2
	if (diff < -Math.PI) diff += Math.PI * 2
	return diff
}

/**
 * Level 2 ambient alien life.
 *
 * All three alien GLBs are static single meshes (verified: no skins, no
 * animation clips), so there is no authored walk cycle to play. Ground
 * aliens wander between walkable points around a home spot, lurch-bob as
 * they walk, bank into turns and align to the terrain; the flying predator
 * orbits a landmark at altitude with a hover bob and banked turns. If a
 * rigged model with clips ever replaces these files this class can adopt a
 * mixer the same way PilotWalk does.
 *
 * Behaviour is deliberately non-combat: aliens stop and face the pilot
 * inside their notice range, then resume wandering once left alone.
 */
export class Alien {
	constructor(level, config = {}) {
		this.level = level
		this.path = config.path || ALIEN_MODELS.predator
		this.kind = config.kind || 'ground'
		this.fit = config.fit || 5.5
		this.home = (config.home || new THREE.Vector3()).clone()
		this.speed = config.speed || 4
		this.turnDamp = config.turnDamp || 3.2
		this.radius = config.radius || 2.2
		this.noticeRange = config.noticeRange || 22
		this.homeRadius = config.homeRadius || 70
		this.altitude = config.altitude || 30
		this.orbitRadius = config.orbitRadius || 50
		this.orbitSpeed = config.orbitSpeed || 0.12
		this.phase = Math.random() * Math.PI * 2

		this.group = new THREE.Group()
		this.group.name = 'level2-alien'
		this.group.position.copy(this.home)
		level.addObject(this.group)

		this.model = null
		this.heading = Math.random() * Math.PI * 2
		this.orbitAngle = Math.random() * Math.PI * 2
		this._mode = 'idle'
		this._timer = 1 + Math.random() * 3
		this._noticeTimer = 0
		this._target = this.home.clone()
		this._walkSpeed = 0
		this._bank = 0
		this._bob = Math.random() * Math.PI * 2
		this._baseY = 0
		this._quat = new THREE.Quaternion()
		this._targetQuat = new THREE.Quaternion()
		this._yawQuat = new THREE.Quaternion()
		this._euler = new THREE.Euler()
		this._normal = new THREE.Vector3(0, 1, 0)
		this._candidate = new THREE.Vector3()
		this.collider = null
		this._loaded = false
	}

	async load() {
		try {
			const model = await this.level.assetManager.loadModel(
				this.path
			)
			if (!this.group.parent) return // level torn down mid-load
			this.level._fit(model, this.fit)
			// Ground the feet: _fit centres the bounding box, so lift
			// min.y back to the root origin.
			model.updateMatrixWorld(true)
			const box = new THREE.Box3().setFromObject(model)
			model.position.y += -box.min.y
			this._baseY = model.position.y
			// A crowd of 1.5M-triangle bodies in the shadow pass is not
			// affordable, so no alien casts or receives shadows.
			model.traverse((child) => {
				if (child.isMesh) {
					child.castShadow = false
					child.receiveShadow = false
				}
			})
			this.group.add(model)
			this.model = model
			if (this.kind === 'ground') {
				this.collider =
					this.level._registerGameplayCollider(
						this.group.position.x,
						this.group.position.z,
						this.radius,
						'alien',
						this.group
					)
			}
			this._syncToTerrain(1)
			this._loaded = true
		} catch (error) {
			console.warn(
				'[Level2] Alien model unavailable:',
				error?.message
			)
		}
	}

	update(delta, playerPos) {
		if (!this._loaded || !this.group.parent) return
		// Distance culling: with ~1.5M triangles per body, far instances
		// are hidden outright instead of costing a draw every frame.
		const dx = playerPos.x - this.group.position.x
		const dz = playerPos.z - this.group.position.z
		if (dx * dx + dz * dz > CULL_DISTANCE * CULL_DISTANCE) {
			this.group.visible = false
			return
		}
		this.group.visible = true
		this._bob += delta
		if (this.kind === 'flyer') this._updateFlyer(delta)
		else this._updateGround(delta, playerPos)
	}

	_updateGround(delta, playerPos) {
		const planet = this.level.planet
		const pos = this.group.position
		const dx = playerPos.x - pos.x
		const dz = playerPos.z - pos.z
		const distance = Math.hypot(dx, dz)

		let desiredYaw = this.heading
		let moveSpeed = 0

		if (distance < this.noticeRange) {
			// Noticed the pilot: stop and stare.
			this._noticeTimer = 1.5
			this._mode = 'notice'
			desiredYaw = Math.atan2(dx, dz)
		} else {
			if (this._noticeTimer > 0) this._noticeTimer -= delta
			if (this._mode === 'notice' && this._noticeTimer <= 0) {
				this._mode = 'idle'
				this._timer = 1 + Math.random() * 2
			}
			if (this._mode === 'idle') {
				this._timer -= delta
				if (this._timer <= 0) {
					const target = this._pickWanderTarget()
					if (target) {
						this._target.copy(target)
						this._mode = 'walk'
						this._timer =
							8 + Math.random() * 8
					} else {
						this._timer =
							3 + Math.random() * 3
					}
				}
			} else if (this._mode === 'walk') {
				this._timer -= delta
				const tx = this._target.x - pos.x
				const tz = this._target.z - pos.z
				if (
					Math.hypot(tx, tz) < 2.5 ||
					this._timer <= 0
				) {
					this._mode = 'idle'
					this._timer = 2 + Math.random() * 4
				} else {
					desiredYaw = Math.atan2(tx, tz)
					moveSpeed = this.speed
				}
			}
		}

		// Ease speed and heading through the body.
		this._walkSpeed = THREE.MathUtils.damp(
			this._walkSpeed,
			moveSpeed,
			2.5,
			delta
		)
		const yawDiff = shortestAngle(desiredYaw, this.heading)
		const yawStep = yawDiff * (1 - Math.exp(-this.turnDamp * delta))
		this.heading += yawStep
		this._bank = THREE.MathUtils.damp(
			this._bank,
			THREE.MathUtils.clamp(
				(-yawStep / Math.max(delta, 1e-4)) * 0.04,
				-0.16,
				0.16
			),
			4,
			delta
		)

		if (this._walkSpeed > 0.05) {
			const step = this._walkSpeed * delta
			this._candidate.set(
				pos.x + Math.sin(this.heading) * step,
				0,
				pos.z + Math.cos(this.heading) * step
			)
			planet.clampToBounds(this._candidate, this.radius + 2)
			// Refuse steps that climb faster than a heavy alien can walk;
			// that keeps them out of the sharpest ridgelines.
			const currentH = planet.heightAt(pos.x, pos.z)
			const nextH = planet.heightAt(
				this._candidate.x,
				this._candidate.z
			)
			if (nextH - currentH < step * 0.55) {
				pos.x = this._candidate.x
				pos.z = this._candidate.z
			} else {
				this._mode = 'idle'
				this._timer = 2 + Math.random() * 3
			}
		}

		this._syncToTerrain(delta)

		if (this.model) {
			// Heavy lurch-bob while walking, near-still otherwise.
			const bobAmount = Math.min(
				1,
				this._walkSpeed / this.speed
			)
			this.model.position.y =
				this._baseY +
				Math.abs(Math.sin(this._bob * 2.4)) *
					0.16 *
					bobAmount
			this.model.rotation.z = this._bank
		}

		if (this.collider) {
			this.collider.x = pos.x
			this.collider.z = pos.z
		}
	}

	_updateFlyer(delta) {
		const planet = this.level.planet
		this.orbitAngle += this.orbitSpeed * delta
		const x =
			this.home.x +
			Math.cos(this.orbitAngle) * this.orbitRadius
		const z =
			this.home.z +
			Math.sin(this.orbitAngle) * this.orbitRadius
		const ground = planet.heightAt(x, z)
		const y =
			ground +
			this.altitude +
			Math.sin(this._bob * 0.7 + this.phase) * 2.2
		this.group.position.set(x, y, z)

		// Face along the tangent of the orbit.
		const dirSign = Math.sign(this.orbitSpeed) || 1
		const yaw = Math.atan2(
			-Math.sin(this.orbitAngle) * dirSign,
			Math.cos(this.orbitAngle) * dirSign
		)
		this.heading = yaw
		const pitch = Math.sin(this._bob * 0.9 + this.phase) * 0.06
		const roll = THREE.MathUtils.clamp(
			-this.orbitSpeed * 2.2,
			-0.35,
			0.35
		)
		this._yawQuat.setFromEuler(
			this._euler.set(pitch, yaw, roll, 'YXZ')
		)
		this.group.quaternion.slerp(
			this._yawQuat,
			1 - Math.exp(-3.5 * delta)
		)
	}

	_syncToTerrain(delta) {
		const planet = this.level.planet
		const pos = this.group.position
		pos.y = planet.heightAt(pos.x, pos.z)
		planet.normalAt(pos.x, pos.z, 2.4, this._normal)
		// Yaw first, then tilt the whole body onto the terrain normal.
		this._yawQuat.setFromEuler(
			this._euler.set(0, this.heading, 0, 'YXZ')
		)
		this._targetQuat.setFromUnitVectors(UP, this._normal)
		this._targetQuat.multiply(this._yawQuat)
		this.group.quaternion.slerp(
			this._targetQuat,
			1 - Math.exp(-4 * delta)
		)
	}

	_pickWanderTarget() {
		const planet = this.level.planet
		for (let i = 0; i < 10; i++) {
			const angle = Math.random() * Math.PI * 2
			const radius =
				this.homeRadius * (0.25 + Math.random() * 0.75)
			const x = this.home.x + Math.cos(angle) * radius
			const z = this.home.z + Math.sin(angle) * radius
			if (!planet.isInsideBounds(x, z, 12)) continue
			if (planet.slopeDegreesAt(x, z) > 20) continue
			if (!planet._isSpawnClear(x, z, this.radius)) continue
			return new THREE.Vector3(x, 0, z)
		}
		return null
	}
}
