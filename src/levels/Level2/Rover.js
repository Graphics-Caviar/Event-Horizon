import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)

const COLLIDER_RADIUS = 6.8
const WHEEL_RADIUS = 1.35
const CLEARANCE = 0.5

const MAX_FORWARD_SPEED = 18
const MAX_REVERSE_SPEED = 6
const ACCELERATION = 14
const REVERSE_ACCELERATION = ACCELERATION * 0.6
const BRAKE_DECELERATION = 30
const COAST_DRAG = 1.2
const TURN_RATE = 1.5
const STEER_SMOOTHING = 8
const WHEEL_STEER_ANGLE = 0.45

const SLOPE_ACCELERATION = 22
const MAX_DRIVE_SLOPE = 22
const LOOKAHEAD = 2.5
const MOMENTUM_ESCAPE_SPEED = 8
const MAX_STEP = 0.8

/**
 * Player-drivable exploration rover. Kinematic, like the on-foot pilot:
 * elevation comes from the terrain height function, movement is validated
 * against slope, bounds and XZ colliders, and there is no physics world.
 * The Rapier vehicle controller this file started as needed collider
 * ground the procedural planet does not provide.
 */
export class Rover {
	constructor(level, { position, heading = 0 } = {}) {
		this.level = level
		this.planet = level.planet

		this.heading = heading
		this.speed = 0
		this.steer = 0
		this.inputEnabled = false
		this.blockedBySlope = false
		this.collider = null

		this._forward = new THREE.Vector3()
		this._normal = new THREE.Vector3()
		this._quatAlign = new THREE.Quaternion()
		this._quatYaw = new THREE.Quaternion()

		this.group = new THREE.Group()
		this.group.name = 'exploration-rover'
		this.wheels = []
		this._buildChassis()
		this.group.position.copy(position)
		this._syncToTerrain()
		level.addObject(this.group)
	}

	forwardVector(target = new THREE.Vector3()) {
		return target.set(
			Math.sin(this.heading),
			0,
			Math.cos(this.heading)
		)
	}

	getSeatPosition(target = new THREE.Vector3()) {
		target.copy(this.group.position)
		target.y += 5
		return target.addScaledVector(
			this.forwardVector(this._forward),
			0.8
		)
	}

	getExitPosition(target = new THREE.Vector3()) {
		const right = target
			.set(-Math.cos(this.heading), 0, Math.sin(this.heading))
			.multiplyScalar(COLLIDER_RADIUS + 2.4)
		return right.add(this.group.position)
	}

	update(delta) {
		if (this.inputEnabled) {
			this._updateDriving(delta)
		} else {
			// Parking brake: hold completely — no slope creep while parked.
			this.steer = THREE.MathUtils.damp(
				this.steer,
				0,
				STEER_SMOOTHING,
				delta
			)
			this.speed = 0
		}

		if (this.inputEnabled) this._applySlope(delta)
		this._move(delta)
		this._syncToTerrain()
		this._animateWheels(delta)

		if (this.collider) {
			this.collider.x = this.group.position.x
			this.collider.z = this.group.position.z
		}
	}

	_updateDriving(delta) {
		const keys = this.level.keys
		const steerTarget =
			(keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0)
		this.steer = THREE.MathUtils.damp(
			this.steer,
			steerTarget,
			STEER_SMOOTHING,
			delta
		)

		// Reversing flips the steering, like a real car.
		if (Math.abs(this.speed) > 0.15) {
			const direction = this.speed > 0 ? 1 : -1
			this.heading +=
				this.steer * TURN_RATE * direction * delta
		}

		if (keys.has('KeyW')) {
			this.speed += ACCELERATION * delta
		} else if (keys.has('KeyS')) {
			if (this.speed > 0.5)
				this.speed -= BRAKE_DECELERATION * delta
			else this.speed -= REVERSE_ACCELERATION * delta
		} else {
			this.speed = THREE.MathUtils.damp(
				this.speed,
				0,
				COAST_DRAG,
				delta
			)
		}
	}

	_applySlope(delta) {
		// Sample the grade in the direction of travel: positive = uphill.
		const sign = this.speed < -0.15 ? -1 : 1
		const forward = this.forwardVector(this._forward)
		const p = this.group.position
		const aheadX = p.x + forward.x * LOOKAHEAD * sign
		const aheadZ = p.z + forward.z * LOOKAHEAD * sign
		const grade =
			(this.planet.heightAt(aheadX, aheadZ) -
				this.planet.heightAt(p.x, p.z)) /
			LOOKAHEAD

		this.speed -= grade * SLOPE_ACCELERATION * delta
		this.speed = THREE.MathUtils.clamp(
			this.speed,
			-MAX_REVERSE_SPEED,
			MAX_FORWARD_SPEED
		)

		this.blockedBySlope = false
		if (this.speed <= 0.25) return
		const uphillDegrees = THREE.MathUtils.radToDeg(
			Math.atan(Math.max(0, grade))
		)
		// A running start carries through short steep patches; crawling
		// uphill into a wall does not.
		if (
			uphillDegrees > MAX_DRIVE_SLOPE &&
			this.speed < MOMENTUM_ESCAPE_SPEED
		) {
			this.speed = 0
			this.blockedBySlope = true
		}
	}

	_move(delta) {
		const distance = this.speed * delta
		if (Math.abs(distance) < 1e-4) return

		// The rover must not collide with its own footprint collider.
		if (this.collider) this.collider.enabled = false

		const forward = this.forwardVector(this._forward)
		const sign = Math.sign(distance)
		let remaining = Math.abs(distance)
		while (remaining > 1e-6) {
			const step = Math.min(remaining, MAX_STEP)
			const candidate = this.group.position.clone()
			candidate.x += forward.x * step * sign
			candidate.z += forward.z * step * sign
			this.planet.clampToBounds(candidate, COLLIDER_RADIUS)
			this.planet.resolveCircleCollisions(
				candidate,
				COLLIDER_RADIUS,
				this.level.gameplayColliders
			)

			const moved = Math.hypot(
				candidate.x - this.group.position.x,
				candidate.z - this.group.position.z
			)
			this.group.position.x = candidate.x
			this.group.position.z = candidate.z
			remaining -= step
			if (moved < step * 0.6) {
				this.speed = 0
				break
			}
		}

		if (this.collider) this.collider.enabled = true
	}

	_syncToTerrain() {
		const p = this.group.position
		p.y = this.planet.heightAt(p.x, p.z) + CLEARANCE
		this.planet.normalAt(p.x, p.z, 1.6, this._normal)
		this._quatAlign.setFromUnitVectors(UP, this._normal)
		this._quatYaw.setFromAxisAngle(UP, this.heading)
		this.group.quaternion
			.copy(this._quatAlign)
			.multiply(this._quatYaw)
	}

	_animateWheels(delta) {
		const spin = (this.speed * delta) / WHEEL_RADIUS
		for (const wheel of this.wheels) {
			wheel.mesh.rotateY(spin)
			if (wheel.steerPivot) {
				wheel.steerPivot.rotation.y =
					this.steer * WHEEL_STEER_ANGLE
			}
		}
	}

	_buildChassis() {
		const level = this.level
		const body = new THREE.Mesh(
			level.own(new THREE.BoxGeometry(7.5, 2.2, 11)),
			level.own(
				new THREE.MeshStandardMaterial({
					color: 0x263943,
					metalness: 0.65,
					roughness: 0.4,
				})
			)
		)
		body.position.y = 2.4
		body.castShadow = body.receiveShadow = true
		this.group.add(body)

		const wheelGeometry = level.own(
			new THREE.CylinderGeometry(
				WHEEL_RADIUS,
				WHEEL_RADIUS,
				1,
				14
			)
		)
		const wheelMaterial = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x111316,
				roughness: 0.9,
			})
		)
		for (const z of [-3.8, 0, 3.8]) {
			for (const x of [-4.2, 4.2]) {
				const mesh = new THREE.Mesh(
					wheelGeometry,
					wheelMaterial
				)
				mesh.rotation.z = Math.PI / 2
				mesh.castShadow = true
				if (z > 3) {
					const steerPivot = new THREE.Group()
					steerPivot.position.set(x, 1.25, z)
					steerPivot.add(mesh)
					this.group.add(steerPivot)
					this.wheels.push({ mesh, steerPivot })
				} else {
					mesh.position.set(x, 1.25, z)
					this.group.add(mesh)
					this.wheels.push({
						mesh,
						steerPivot: null,
					})
				}
			}
		}

		const beacon = new THREE.PointLight(0x5ef2ff, 4, 65)
		beacon.position.set(0, 5, 0)
		this.group.add(beacon)
	}
}
