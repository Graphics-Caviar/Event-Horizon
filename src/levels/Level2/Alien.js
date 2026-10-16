import * as THREE from 'three'

export const ALIEN_MODELS = {
	predator: '/assets/models/aliens/alien-predator.glb',
	flying: '/assets/models/aliens/alien-flying-predator.glb',
	brute: '/assets/models/aliens/armored-alien-brute.glb',
}

export const ALIENS = {
	0: {
		name: 'runner',
		model: [
			'/assets/models/aliens/alien-predator.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/alien-predator.glb',
		],
		stats: {
			speed: 6,
			hp: 5,
		},
	},
	1: {
		name: 'launcher',
		model: [
			'/assets/models/aliens/armored-alien-brute.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/armored-alien-brute.glb',
		],
		stats: {
			speed: 5,
			hp: 5,
		},
	},
	2: {
		name: 'flyer',
		model: [
			'/assets/models/aliens/alien-flying-predator.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/alien-flying-predator.glb',
		],
		stats: {
			speed: 25,
			hp: 5,
		},
	},
}

// Aliens farther than this from the player are hidden: only the nearby
// crowd costs draw calls, which keeps a large roster affordable.
const CULL_DISTANCE = 240
const COMBAT_ENTER_DISTANCE = 35
const COMBAT_EXIT_DISTANCE = 50
// A rover impact above this speed hurts the alien instead of the crew.
const RAM_SPEED_MIN = 6
// A predator or brute goes down after two solid rams (stats.hp / damage).
const RAM_DAMAGE = 3
// Flying strike: the low talon pass clips anything inside this envelope.
const STRIKE_RADIUS = 3.8
// Whole-body wing-beat rhythm; the GLBs have no rigs, so the rock sells it.
const WING_BEAT_HZ = 2.1
const UP = new THREE.Vector3(0, 1, 0)

const shortestAngle = (target, current) => {
	let diff = (target - current) % (Math.PI * 2)
	if (diff > Math.PI) diff -= Math.PI * 2
	if (diff < -Math.PI) diff += Math.PI * 2
	return diff
}

/**
 * Level 2 alien life.
 *
 * All three alien GLBs are static single meshes (verified: no skins, no
 * animation clips), so every motion is procedural. Ambience: ground aliens
 * wander between walkable points around a home spot, lurch-bob as they
 * walk, bank into turns and align to the terrain; the flying predator
 * cruises a landmark orbit with a hover bob and banked turns.
 *
 * Combat: ground predators chase, coil back, then pounce with a locked
 * heading and body pitch; brutes do the same slower and heavier, slamming
 * dust on every charge. Flyers circle out at wing-beat altitude and swoop
 * in a low talon pass that rakes whoever is underneath. Every alien has
 * HP: ramming one with the rover at speed pops a damage bar above it and,
 * after a couple of solid hits, flattens it into a smashed wreck.
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
		// _fit scales the loaded GLB to gameplay size; every later
		// scale.set must build on this factor, never assume 1.
		this._fitScale = 1
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
		this.alienGroup = this.group
		this.position = this.group.position

		this.target = this.level.playerRoot
		this.planet = this.level.planet
		this.assetManager = this.level.assetManager

		this.combatMode = false

		this.type =
			this.kind === 'flyer'
				? ALIENS[2]
				: this.path === ALIEN_MODELS.brute
					? ALIENS[1]
					: ALIENS[0]

		// Combat state (driven by _updateGroundCombat / _updateFlyerCombat).
		this.hp = this.type.stats.hp
		this.maxHp = this.type.stats.hp
		this.smashed = false
		// Set during a flyer's talon pass; Level2 consumes it for damage.
		this.pendingStrike = false
		this._combatState = this.kind === 'flyer' ? 'circle' : 'chase'
		this._stateTimer = 0
		this._circleDir = 1
		this._lungeSpeed = 0
		this._pitch = 0
		this._ramCooldown = 0
		this._hitWobble = 0
		this._smashT = -1
		this._flyFall = 0
		this._wingPhase = Math.random() * Math.PI * 2
		this._knock = new THREE.Vector3()
		this._swoopFrom = new THREE.Vector3()
		this._swoopApex = new THREE.Vector3()
		this._swoopExit = new THREE.Vector3()
		this._swoopT = 0
		this._swoopDuration = 1.7
		this._swoopHit = false
		this._footPuff = 0
		// Flyers cruise on wing power above the terrain, not on the pilot's head.
		this._cruiseAlt = 13 + Math.random() * 5
		this.diveTimer = 3 + Math.random() * 3

		this.collisionCooldown = 0
		this.stopTimer = 0

		// Damage bar over the head; built with the model, shown on first hit.
		this._hpCanvas = null
		this._hpTexture = null
		this._hpMaterial = null
		this._hpSprite = null
		this._hpBarTimer = 0
	}

	async load() {
		try {
			const model = await this.level.assetManager.loadModel(
				this.path
			)
			if (!this.group.parent) return // level torn down mid-load
			this.level._fit(model, this.fit)
			this._fitScale = model.scale.x
			// Ground the feet: _fit centres the bounding box, so lift
			// min.y back to the root origin.
			model.updateMatrixWorld(true)
			const box = new THREE.Box3().setFromObject(model)
			model.position.y += -box.min.y
			this._baseY = model.position.y
			this._buildHpBar(box)
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

		// A smashed wreck only plays out its flatten (or crash) animation.
		if (this.smashed) {
			this._updateSmashed(delta)
			this._updateHpBar(delta)
			return
		}

		const dx = playerPos.x - this.position.x
		const dz = playerPos.z - this.position.z
		const distance = Math.hypot(dx, dz)

		if (!this.combatMode && distance < COMBAT_ENTER_DISTANCE) {
			this.combatMode = true
			if (this.collider) {
				this.collider.enabled = false
			}
			this._walkSpeed = 0
			this._pitch = 0
			if (this.kind === 'flyer') {
				this._combatState = 'circle'
				// Start circling from wherever the pilot met us.
				this.orbitAngle = Math.atan2(
					this.position.z - playerPos.z,
					this.position.x - playerPos.x
				)
				this.diveTimer = 1.5 + Math.random() * 2.5
			} else {
				this._combatState = 'chase'
			}
		}

		if (this.combatMode && distance > COMBAT_EXIT_DISTANCE) {
			this.combatMode = false
			if (this.collider) {
				this.collider.enabled = true
			}
			this._walkSpeed = 0
			this._knock.set(0, 0, 0)
			this._pitch = 0
			if (this.model) this.model.rotation.x = 0
			this._mode = 'idle'
			this._timer = 1
			this._combatState =
				this.kind === 'flyer' ? 'circle' : 'chase'
		}

		this._ramCooldown = Math.max(0, this._ramCooldown - delta)
		this.collisionCooldown = Math.max(
			0,
			this.collisionCooldown - delta
		)
		this._updateHpBar(delta)

		if (!this.combatMode && distance > CULL_DISTANCE) {
			this.group.visible = false
			return
		}

		this.group.visible = true

		if (this.combatMode) {
			if (this.kind === 'flyer') {
				this._updateFlyerCombat(delta)
			} else {
				this._updateGroundCombat(delta)
			}
			return
		}

		this._bob += delta

		if (this.kind === 'flyer') {
			this._updateFlyer(delta)
		} else {
			this._updateGround(delta, playerPos)
		}
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

	/**
	 * Ground combat: chase, coil back, pounce, recover, circle. All motion
	 * eases through heading/speed like the ambient walk, so the body reads
	 * as a heavy animal committing to an attack, not a gliding hitbox.
	 */
	_updateGroundCombat(delta) {
		const planet = this.level.planet
		const pos = this.position
		const target = this.target.position
		const brute = this.type.name === 'launcher'
		const dx = target.x - pos.x
		const dz = target.z - pos.z
		const dist = Math.hypot(dx, dz)
		const desiredYaw = Math.atan2(dx, dz)
		const strikeRange = brute ? 8 : 4.8

		let speedTarget = 0
		let pitchTarget = 0
		let headingTarget = desiredYaw
		let turnDamp = this.turnDamp * 1.5
		let lockHeading = false

		if (this.stopTimer > 0) {
			// Staggered by a bite or a ram: stumble, then recommit.
			this.stopTimer = Math.max(0, this.stopTimer - delta)
			this._combatState = 'recover'
			this._stateTimer = Math.max(this._stateTimer, 0.3)
		}

		this._stateTimer -= delta
		switch (this._combatState) {
			case 'chase': {
				speedTarget =
					this.type.stats.speed *
					(brute ? 1.05 : 1.55)
				if (dist < strikeRange) {
					this._combatState = 'windup'
					this._stateTimer = brute ? 0.62 : 0.32
					speedTarget = 0
				}
				break
			}
			case 'windup': {
				// Coil back before the pounce, eyes locked on the pilot.
				pitchTarget = brute ? -0.4 : -0.3
				turnDamp = this.turnDamp * 3
				if (this._stateTimer <= 0) {
					this._combatState = 'lunge'
					this._lungeSpeed =
						this.type.stats.speed *
						(brute ? 2.1 : 3.1)
					this._stateTimer = brute ? 0.5 : 0.34
				}
				break
			}
			case 'lunge': {
				// Committed leap: heading locks, speed bleeds off.
				lockHeading = true
				const duration = brute ? 0.5 : 0.34
				speedTarget =
					this._lungeSpeed *
					Math.max(
						0.25,
						this._stateTimer / duration
					)
				pitchTarget = brute ? 0.5 : 0.42
				if (this._stateTimer <= 0) {
					this._combatState = 'recover'
					this._stateTimer = brute ? 1.05 : 0.55
					if (brute) this._bruteSlam()
				}
				break
			}
			case 'circle': {
				// Predators don't stand still: strafe around the pilot.
				headingTarget =
					desiredYaw +
					(Math.PI / 2.6) * this._circleDir
				speedTarget = this.type.stats.speed * 0.5
				turnDamp = this.turnDamp * 2
				if (
					this._stateTimer <= 0 ||
					dist > strikeRange * 2.4
				) {
					this._combatState =
						dist < strikeRange
							? 'windup'
							: 'chase'
					this._stateTimer = 0
				}
				break
			}
			default: {
				// 'recover': shake the hit off, then pick the next move.
				pitchTarget =
					Math.sin(performance.now() * 0.02) *
					0.05
				if (this._stateTimer <= 0) {
					if (dist < strikeRange * 1.5) {
						this._combatState = 'circle'
						this._stateTimer =
							0.6 +
							Math.random() * 1.1
						this._circleDir =
							Math.random() < 0.5
								? -1
								: 1
					} else {
						this._combatState = 'chase'
					}
				}
			}
		}

		// Ease speed and heading through the body, just faster than ambient.
		this._walkSpeed = THREE.MathUtils.damp(
			this._walkSpeed,
			speedTarget,
			6,
			delta
		)
		const yawDiff = shortestAngle(headingTarget, this.heading)
		const yawStep =
			yawDiff *
			(1 -
				Math.exp(
					-(lockHeading
						? this.turnDamp * 0.5
						: turnDamp) * delta
				))
		this.heading += yawStep
		this._bank = THREE.MathUtils.damp(
			this._bank,
			THREE.MathUtils.clamp(
				(-yawStep / Math.max(delta, 1e-4)) * 0.05,
				-0.22,
				0.22
			),
			5,
			delta
		)

		// Ram knockback decays separately from the walk.
		this._knock.multiplyScalar(Math.exp(-4.5 * delta))

		if (this._walkSpeed > 0.05 || this._knock.lengthSq() > 0.01) {
			const step = this._walkSpeed * delta
			this._candidate.set(
				pos.x +
					Math.sin(this.heading) * step +
					this._knock.x * delta,
				0,
				pos.z +
					Math.cos(this.heading) * step +
					this._knock.z * delta
			)
			planet.clampToBounds(this._candidate, this.radius + 2)
			// Refuse steps that climb faster than the animal can drive in;
			// knockback slides along whatever ground it meets.
			const currentH = planet.heightAt(pos.x, pos.z)
			const nextH = planet.heightAt(
				this._candidate.x,
				this._candidate.z
			)
			const climb =
				Math.max(step, this._knock.length() * delta) *
				0.9
			if (nextH - currentH < climb) {
				pos.x = this._candidate.x
				pos.z = this._candidate.z
			}
		}

		// Don't clip through the rover or landmarks while attacking.
		planet.resolveCircleCollisions(
			this.position,
			this.radius,
			planet.level.gameplayColliders
		)

		// A charging brute kicks up dust under each heavy footfall.
		if (brute && this._combatState === 'lunge') {
			this._footPuff -= delta
			if (this._footPuff <= 0) {
				this._footPuff = 0.16
				this.level.dust?.spawnFoot(
					{
						x: pos.x,
						y: planet.heightAt(
							pos.x,
							pos.z
						),
						z: pos.z,
					},
					{ ratio: 1 }
				)
			}
		}

		this._syncToTerrain(delta)

		// Body language: gallop bob, coil/pounce pitch, bank, hit shudder.
		this._pitch = THREE.MathUtils.damp(
			this._pitch,
			pitchTarget,
			10,
			delta
		)
		if (this.model) {
			const bobAmount = Math.min(
				1,
				this._walkSpeed / (this.type.stats.speed * 1.4)
			)
			this._bob += delta * (2.2 + bobAmount * 3.4)
			this.model.position.y =
				this._baseY +
				Math.abs(Math.sin(this._bob)) * 0.22 * bobAmount
			this.model.rotation.x = this._pitch
			this.model.rotation.z = this._bank
			const shudder =
				Math.sin(this._hitWobble * 28) *
				0.07 *
				this._hitWobble
			const s = this._fitScale
			this.model.scale.set(
				s * (1 - shudder * 0.5),
				s * (1 + shudder),
				s * (1 - shudder * 0.5)
			)
		}
		this._hitWobble = Math.max(0, this._hitWobble - delta * 2.2)

		if (this.collider) {
			this.collider.x = pos.x
			this.collider.z = pos.z
		}
	}

	/**
	 * Flyer combat: circle out at wing-beat altitude, then swoop in a low
	 * talon pass. The dive is a two-phase arc (accelerating descent, flared
	 * climb-out) over a point just above the pilot; during the low pass the
	 * feet can rake once, which Level2 turns into damage + knockback.
	 */
	_updateFlyerCombat(delta) {
		const planet = this.level.planet
		const target = this.target.position
		this._bob += delta
		this.diveTimer -= delta

		let yawTarget = this.heading
		let bankTarget = 0

		if (this._combatState === 'circle') {
			this.orbitAngle += this.orbitSpeed * delta
			const radius = 15
			const x = target.x + Math.cos(this.orbitAngle) * radius
			const z = target.z + Math.sin(this.orbitAngle) * radius
			this._candidate.set(
				x,
				planet.heightAt(x, z) +
					this._cruiseAlt +
					Math.sin(this._bob * 0.7 + this.phase) *
						1.6,
				z
			)
			this.position.lerp(
				this._candidate,
				1 - Math.exp(-2.5 * delta)
			)
			// Face along the tangent of the orbit.
			const dirSign = Math.sign(this.orbitSpeed) || 1
			yawTarget = Math.atan2(
				-Math.sin(this.orbitAngle) * dirSign,
				Math.cos(this.orbitAngle) * dirSign
			)
			bankTarget = THREE.MathUtils.clamp(
				-this.orbitSpeed * 2.2,
				-0.35,
				0.35
			)
			if (this.diveTimer <= 0) this._startSwoop(target)
		} else if (this._combatState === 'swoop') {
			this._swoopT += delta
			const t = Math.min(
				1,
				this._swoopT / this._swoopDuration
			)
			if (t < 0.6) {
				// Accelerating descent onto the pilot.
				const k = t / 0.6
				this.position.lerpVectors(
					this._swoopFrom,
					this._swoopApex,
					k * k
				)
				yawTarget = Math.atan2(
					target.x - this.position.x,
					target.z - this.position.z
				)
				this._pitch = THREE.MathUtils.damp(
					this._pitch,
					-0.5,
					6,
					delta
				)
			} else {
				// Flare out and climb away on the far side.
				const k = (t - 0.6) / 0.4
				this.position.lerpVectors(
					this._swoopApex,
					this._swoopExit,
					1 - (1 - k) * (1 - k)
				)
				yawTarget = Math.atan2(
					this._swoopExit.x - this.position.x,
					this._swoopExit.z - this.position.z
				)
				this._pitch = THREE.MathUtils.damp(
					this._pitch,
					0.5,
					5,
					delta
				)
			}
			// Talon rake window: the low pass over the pilot.
			if (!this._swoopHit && t > 0.4 && t < 0.68) {
				const dxy = Math.hypot(
					this.position.x - target.x,
					this.position.z - target.z
				)
				const dy = Math.abs(
					this.position.y - (target.y + 1)
				)
				if (dxy < STRIKE_RADIUS && dy < 3.4) {
					this._swoopHit = true
					this.pendingStrike = true
				}
			}
			if (t >= 1) {
				this._combatState = 'climb'
				this._stateTimer = 1.1
			}
		} else {
			// 'climb': beat hard for altitude, then start a fresh circle.
			this._pitch = THREE.MathUtils.damp(
				this._pitch,
				0.12,
				4,
				delta
			)
			this.position.y = THREE.MathUtils.damp(
				this.position.y,
				planet.heightAt(
					this.position.x,
					this.position.z
				) + this._cruiseAlt,
				2.2,
				delta
			)
			if (this._stateTimer <= 0) {
				this._combatState = 'circle'
				this.diveTimer = 4 + Math.random() * 4
			}
		}

		planet.clampToBounds(this.position, 6)

		const yawDiff = shortestAngle(yawTarget, this.heading)
		const yawStep = yawDiff * (1 - Math.exp(-6 * delta))
		this.heading += yawStep
		this._bank = THREE.MathUtils.damp(
			this._bank,
			bankTarget +
				THREE.MathUtils.clamp(
					(-yawStep / Math.max(delta, 1e-4)) *
						0.06,
					-0.5,
					0.5
				),
			5,
			delta
		)

		// Wing beats: strong in cruise/climb, wings tucked in the dive.
		const beatRate =
			this._combatState === 'swoop'
				? 0.25
				: this._combatState === 'climb'
					? 1.6
					: 1
		this._wingPhase += delta * Math.PI * 2 * WING_BEAT_HZ * beatRate
		const beatAmp = this._combatState === 'swoop' ? 0.04 : 0.3
		this._yawQuat.setFromEuler(
			this._euler.set(0, this.heading, this._bank, 'YXZ')
		)
		this.group.quaternion.slerp(
			this._yawQuat,
			1 - Math.exp(-5 * delta)
		)
		if (this.model) {
			this.model.position.y =
				this._baseY +
				Math.sin(this._wingPhase) * beatAmp
			this.model.rotation.x =
				this._pitch +
				Math.sin(this._wingPhase + 1.1) *
					0.05 *
					beatRate
			this.model.rotation.z =
				Math.sin(this._wingPhase) * 0.1 * beatRate
		}
	}

	_startSwoop(target) {
		this._combatState = 'swoop'
		this._swoopT = 0
		this._swoopHit = false
		this._swoopFrom.copy(this.position)
		// The pass rakes a point just over the pilot's head.
		this._swoopApex.set(
			target.x,
			this.planet.heightAt(target.x, target.z) + 2.1,
			target.z
		)
		// Climb out on the far side; a random lateral keeps repeat
		// strikes from tracing the same line.
		const away = this._candidate.copy(this.position).sub(target)
		away.y = 0
		if (away.lengthSq() < 0.01) away.set(1, 0, 0)
		away.normalize()
		const jitter = (Math.random() - 0.5) * 1.4
		const ax = away.x * Math.cos(jitter) - away.z * Math.sin(jitter)
		const az = away.x * Math.sin(jitter) + away.z * Math.cos(jitter)
		this._swoopExit.set(
			target.x + ax * 22,
			this.planet.heightAt(
				target.x + ax * 22,
				target.z + az * 22
			) + this._cruiseAlt,
			target.z + az * 22
		)
	}

	/** A brute's charge ends in a ground slam: dust ring and a thud. */
	_bruteSlam() {
		const ground = this.planet.heightAt(
			this.position.x,
			this.position.z
		)
		this.level.dust?.spawnBurst(
			{
				x: this.position.x,
				y: ground,
				z: this.position.z,
			},
			{
				count: 12,
				strength: 2.1,
				spread: 3.2,
				size: 1.1,
				upBias: 0.55,
			}
		)
		this.level.audio?.playImpact()
		this.level._requestShake?.(0.35)
	}

	/** Damage bar sprite parked just over the model's head. */
	_buildHpBar(box) {
		const height = box.max.y - box.min.y
		const canvas = document.createElement('canvas')
		canvas.width = 96
		canvas.height = 14
		this._hpCanvas = canvas
		this._hpTexture = this.level.own(
			new THREE.CanvasTexture(canvas)
		)
		this._hpMaterial = this.level.own(
			new THREE.SpriteMaterial({
				map: this._hpTexture,
				transparent: true,
				opacity: 0,
				depthWrite: false,
			})
		)
		this._hpSprite = new THREE.Sprite(this._hpMaterial)
		this._hpSprite.scale.set(4.4, 0.64, 1)
		this._hpSprite.position.y = height + 1.5
		this._hpSprite.visible = false
		this._hpSprite.renderOrder = 7
		this.group.add(this._hpSprite)
		this._drawHpBar()
	}

	_drawHpBar() {
		if (!this._hpCanvas) return
		const ctx = this._hpCanvas.getContext('2d')
		ctx.clearRect(0, 0, 96, 14)
		ctx.fillStyle = 'rgba(4, 10, 14, 0.78)'
		ctx.fillRect(0, 0, 96, 14)
		const ratio = this.maxHp ? this.hp / this.maxHp : 0
		ctx.fillStyle =
			ratio > 0.5
				? '#5cffb1'
				: ratio > 0.25
					? '#ffb347'
					: '#ff5268'
		ctx.fillRect(2, 2, Math.max(0, 92 * ratio), 10)
		this._hpTexture.needsUpdate = true
	}

	_updateHpBar(delta) {
		if (!this._hpSprite) return
		if (this._hpBarTimer > 0) this._hpBarTimer -= delta
		const shown =
			!this.smashed &&
			this.hp < this.maxHp &&
			this._hpBarTimer > 0
		this._hpMaterial.opacity = THREE.MathUtils.damp(
			this._hpMaterial.opacity,
			shown ? 0.95 : 0,
			6,
			delta
		)
		this._hpSprite.visible = this._hpMaterial.opacity > 0.02
	}

	/** Rover rams and talon strikes land here; the bar pops on first hit. */
	damage(amount) {
		if (this.smashed) return
		this.hp = Math.max(0, this.hp - amount)
		this._drawHpBar()
		this._hpBarTimer = 4
		if (this.hp <= 0) {
			this._smash()
		} else {
			this._hitWobble = 1
		}
	}

	_smash() {
		this.smashed = true
		this.hp = 0
		this._smashT = 0
		this._knock.set(0, 0, 0)
		this._walkSpeed = 0
		this.pendingStrike = false
		if (this.collider) this.collider.enabled = false
		if (this.kind !== 'flyer') {
			// Flattened where it stands; the wreck stays on the field.
			this.level.dust?.spawnBurst(
				{
					x: this.position.x,
					y: this.planet.heightAt(
						this.position.x,
						this.position.z
					),
					z: this.position.z,
				},
				{
					count: 16,
					strength: 2.6,
					spread: 2.8,
					size: 1.3,
					upBias: 0.7,
				}
			)
			this.level.audio?.playImpact()
			this.level._requestShake?.(0.55)
		}
	}

	_updateSmashed(delta) {
		if (this.kind === 'flyer' && this._flyFall < 1) {
			// Tumble out of the sky, then flatten where we land.
			this._flyFall = Math.min(1, this._flyFall + delta * 0.9)
			this.position.y -= (14 + 26 * this._flyFall) * delta
			this.group.rotation.z += delta * 7
			const ground =
				this.planet.heightAt(
					this.position.x,
					this.position.z
				) + 0.4
			if (this.position.y <= ground) {
				this.position.y = ground
				this._flyFall = 1
				this.level.dust?.spawnBurst(
					{
						x: this.position.x,
						y: this.planet.heightAt(
							this.position.x,
							this.position.z
						),
						z: this.position.z,
					},
					{
						count: 14,
						strength: 2.4,
						spread: 3,
						size: 1.2,
						upBias: 0.65,
					}
				)
				this.level.audio?.playImpact()
				this.level._requestShake?.(0.4)
			}
			return
		}

		// Squash: a quick pop up, then flatten into a pancake that stays.
		if (this._smashT >= 0 && this._smashT < 1) {
			this._smashT = Math.min(1, this._smashT + delta / 0.34)
			const t = this._smashT
			const pop =
				Math.sin(Math.min(1, t * 2.4) * Math.PI) * 0.9
			const flatten = THREE.MathUtils.smoothstep(t, 0.15, 1)
			const s = this._fitScale
			this.model?.scale.set(
				s * (1 + 0.42 * flatten),
				s * (1 + 0.25 * pop - 0.9 * flatten),
				s * (1 + 0.3 * flatten)
			)
			if (this.model) {
				this.model.position.y = this._baseY + pop * 0.6
				this.model.rotation.x = 0
				this.model.rotation.z = 0
			}
		}
	}

	/**
	 * 'ram'  — the rover drove into us at speed: we take the damage.
	 * 'bite' — slow contact: we snap at the crew (Level2 drains hull HP).
	 * null   — nothing this frame. Flyers never bite; they rake in swoops.
	 */
	checkRoverCollision(rover, roverRadius = 8) {
		if (this.smashed) return null
		const dx = this.position.x - rover.group.position.x
		const dz = this.position.z - rover.group.position.z
		const dy = this.position.y - rover.group.position.y

		const enemyRadius = this.type.name === 'runner' ? 1.5 : 2
		const dist = Math.hypot(dx, dz)
		const hit =
			dist <= enemyRadius + roverRadius &&
			Math.abs(dy) <= enemyRadius + 1
		if (!hit) return null

		if (Math.abs(rover.speed ?? 0) >= RAM_SPEED_MIN) {
			if (this._ramCooldown > 0) return null
			this._ramCooldown = 0.45
			// Shoved aside by the impact.
			if (dist > 0.001) {
				this._knock
					.set(dx / dist, 0, dz / dist)
					.multiplyScalar(11)
			}
			if (this.kind !== 'flyer') {
				this.stopTimer = Math.max(this.stopTimer, 0.9)
				this._combatState = 'recover'
				this._stateTimer = 1.2
			} else {
				// Knocked up out of the flight path a little.
				this.position.y += 1.2
			}
			this.damage(RAM_DAMAGE)
			return 'ram'
		}

		if (this.collisionCooldown > 0 || this.kind === 'flyer') {
			return null
		}
		// Bumping a standing predator just earns a snap.
		this.stopTimer = 1.1
		this.collisionCooldown = 2.4
		this._combatState = 'recover'
		this._stateTimer = 1.1
		return 'bite'
	}

	checkPlayerCollision(player, playerRadius = 0.9) {
		// Flyers only hurt through their talon pass (see pendingStrike).
		if (this.smashed || this.kind === 'flyer') return false
		const dx = this.position.x - player.position.x
		const dz = this.position.z - player.position.z
		const dy = this.position.y - player.position.y

		const enemyRadius = this.type.name === 'runner' ? 1.5 : 2
		const hit =
			Math.hypot(dx, dz) <= enemyRadius + playerRadius &&
			Math.abs(dy) <= enemyRadius + playerRadius &&
			this.collisionCooldown <= 0
		if (hit) {
			// Landed the bite: brief recoil before circling back in.
			this.stopTimer = 1.1
			this.collisionCooldown = 2.4
			this._combatState = 'recover'
			this._stateTimer = 1.1
		}
		return hit
	}
}
