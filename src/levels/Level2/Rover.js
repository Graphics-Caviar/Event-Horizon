import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

const UP = new THREE.Vector3(0, 1, 0)
const WHEEL_RADIUS = 1.35
const COLLIDER_RADIUS = 6.8
const STEP = 1 / 120
const REST_LENGTH = 1.4
const GRAVITY = 9.81

// Authored rover GLB (static single mesh: ~1.5M tris, no wheel nodes).
const DEFAULT_MODEL = '/assets/models/rover/sci-fi-exploration-rover.glb'
const MODEL_FIT_LENGTH = 11 // matches the placeholder's footprint
const MODEL_GROUND_SINK = 0.45 // tyre contact at the clearance height
const MODEL_PIVOT_YAW = 0 // rotate if the GLB does not face +Z
// The authored GLB bakes its four wheels into the mesh (measured from the
// vertices: front pair at z 3.60, rear pair at z -3.35, tyre radii 1.87 /
// 2.13 and widths 1.76 / 1.84 in fitted group space, contact plane at
// y = -MODEL_GROUND_SINK). Static geometry cannot roll, so each baked wheel
// gets a slightly larger procedural cover that hides it and spins. `spin`
// and `steer` index the physics bogie wheels driving the cover (-1 = the
// rear pair does not steer).
const MODEL_WHEEL_STEER_GAIN = 0.6
const MODEL_WHEELS = [
	{ x: -3.68, z: 3.6, radius: 1.91, width: 1.82, spin: 4, steer: 4 },
	{ x: 3.68, z: 3.6, radius: 1.91, width: 1.82, spin: 5, steer: 5 },
	{ x: -3.76, z: -3.35, radius: 2.17, width: 1.9, spin: 0, steer: -1 },
	{ x: 3.76, z: -3.35, radius: 2.17, width: 1.9, spin: 1, steer: -1 },
]

// Drive tuning. Gravity storms scale these through level.hazards.
const ENGINE_FORCE = 2100
const REVERSE_FORCE = 1300
export const MAX_FORWARD_SPEED = 25
const MAX_REVERSE_SPEED = 10
// The pedal eases toward its target instead of switching, so pulling away
// and lifting off ramp through the frame instead of lurching.
const THROTTLE_DAMP = 6
// Front-wheel steering lock (rad) and how much of it is shed at top speed:
// full lock at full pace made the rover dart.
const STEER_ANGLE = 0.45
const STEER_HIGH_SPEED_TRIM = 0.25
// Wheel brake used to shed speed when a storm lowers the limit under a rover
// that is already going faster than the new limit.
const OVERSPEED_BRAKE = 2
// Slope pull is scaled by the storm's gravity multiplier, capped so the
// heaviest storms drag the rover down hills instead of launching it.
const MAX_SLOPE_GRAVITY = 4
// How far (m) to sample the terrain when measuring the slope under the chassis.
const SLOPE_SAMPLE = 3
let rapierReady

/** A dynamic chassis with six independent ray-cast suspension springs. */
export class Rover {
	constructor(
		level,
		{ position, heading = 0, model = DEFAULT_MODEL } = {}
	) {
		this.level = level
		this.planet = level.planet
		this.heading = heading
		this.speed = 0
		this.steer = 0
		this.throttle = 0
		this.inputEnabled = false
		this.blockedBySlope = false
		// Set every frame from level.hazards (1 = unaffected).
		this.speedFactor = 1
		this.gravityScale = 1
		this._slopeNormal = new THREE.Vector3()
		this.collider = null
		this.model = null
		this._seatHeight = 5
		this.accumulator = 0
		this._forward = new THREE.Vector3()
		this.group = new THREE.Group()
		this.group.name = 'exploration-rover'
		this.wheels = []
		// Procedural tyres covering the GLB's baked wheels once it loads.
		this.modelWheels = []
		// Placeholder chassis until (unless) the GLB arrives; the swap
		// replaces this whole group.
		this.chassisGroup = new THREE.Group()
		this.chassisGroup.name = 'rover-chassis'
		this.group.add(this.chassisGroup)
		this._buildChassis()
		this.group.position.copy(position)
		this.group.position.y =
			this.planet.heightAt(position.x, position.z) + 1
		this.group.rotation.y = heading
		level.addObject(this.group)
		if (model) this._loadModel(model)
		this.ready = (rapierReady ??= RAPIER.init())
			.then(() => {
				if (!this.disposed) this._initPhysics()
			})
			.catch((error) => {
				this.physicsError = error
				console.error(
					'[Level2] Rover physics failed to initialize',
					error
				)
			})
	}

	_initPhysics() {
		this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 })
		this.world.timestep = STEP
		// Copy the exact rendered triangles, including the carved crater/lava floors.
		const terrain = this.planet.terrain
		this.world.createCollider(
			RAPIER.ColliderDesc.trimesh(
				new Float32Array(
					terrain.geometry.attributes.position
						.array
				),
				new Uint32Array(terrain.geometry.index.array)
			)
				.setTranslation(
					terrain.position.x,
					terrain.position.y,
					terrain.position.z
				)
				.setFriction(0.9)
		)
		for (const obstacle of [
			...this.planet.colliders,
			...this.level.gameplayColliders,
		]) {
			if (
				obstacle.type === 'rover' ||
				obstacle.enabled === false
			)
				continue
			const box = obstacle.object
				? new THREE.Box3().setFromObject(
						obstacle.object
					)
				: null
			const bottom =
				this.planet.heightAt(obstacle.x, obstacle.z) - 1
			const top = Math.max(
				bottom + 2,
				box?.max.y ?? bottom + 4
			)
			this.world.createCollider(
				RAPIER.ColliderDesc.cylinder(
					(top - bottom) / 2,
					obstacle.radius
				)
					.setTranslation(
						obstacle.x,
						(top + bottom) / 2,
						obstacle.z
					)
					.setFriction(0.8)
			)
		}
		const bounds = this.planet.getPlayableBounds()
		for (const x of [bounds.minX, bounds.maxX]) {
			this.world.createCollider(
				RAPIER.ColliderDesc.cuboid(
					1,
					500,
					this.planet.size
				).setTranslation(
					x,
					this.planet.baseY,
					this.planet.center.z
				)
			)
		}
		for (const z of [bounds.minZ, bounds.maxZ]) {
			this.world.createCollider(
				RAPIER.ColliderDesc.cuboid(
					this.planet.size,
					500,
					1
				).setTranslation(
					this.planet.center.x,
					this.planet.baseY,
					z
				)
			)
		}
		// Body origin is the low centre of mass, 2.4 m above the visual group origin.
		const p = this.group.position
		this.body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(p.x, p.y + 2.4, p.z)
				.setRotation(this.group.quaternion)
				.setLinearDamping(0.12)
				.setAngularDamping(1.2)
				.setCcdEnabled(true)
		)
		this.world.createCollider(
			RAPIER.ColliderDesc.cuboid(3.75, 1.1, 5.5)
				.setMass(900)
				.setFriction(0.6)
				.setRestitution(0),
			this.body
		)
		this.vehicle = this.world.createVehicleController(this.body)
		this.vehicle.indexUpAxis = 1
		this.vehicle.setIndexForwardAxis = 2
		for (let i = 0; i < this.wheels.length; i++) {
			const wheel = this.wheels[i]
			this.vehicle.addWheel(
				{ x: wheel.x, y: 0, z: wheel.z },
				{ x: 0, y: -1, z: 0 },
				{ x: -1, y: 0, z: 0 },
				REST_LENGTH,
				WHEEL_RADIUS
			)
			this.vehicle.setWheelSuspensionStiffness(i, 32)
			this.vehicle.setWheelSuspensionCompression(i, 4.4)
			this.vehicle.setWheelSuspensionRelaxation(i, 5.2)
			this.vehicle.setWheelMaxSuspensionTravel(i, 0.9)
			this.vehicle.setWheelMaxSuspensionForce(i, 12000)
			this.vehicle.setWheelFrictionSlip(i, 2)
			this.vehicle.setWheelSideFrictionStiffness(i, 1)
		}
		// Populate scene queries before the first suspension ray casts.
		this.world.step()
		this._syncVisuals()
	}

	forwardVector(target = new THREE.Vector3()) {
		return target.set(
			Math.sin(this.heading),
			0,
			Math.cos(this.heading)
		)
	}

	getSeatPosition(target = new THREE.Vector3()) {
		// The physics chassis tilts with the terrain, so the seat rides
		// the rotated frame; _seatHeight rises once the tall authored GLB
		// replaces the placeholder roof.
		return target
			.set(0, this._seatHeight, 0.8)
			.applyQuaternion(this.group.quaternion)
			.add(this.group.position)
	}

	getExitPosition(target = new THREE.Vector3()) {
		return target
			.set(-Math.cos(this.heading), 0, Math.sin(this.heading))
			.multiplyScalar(COLLIDER_RADIUS + 2.4)
			.add(this.group.position)
	}

	update(delta) {
		if (!this.vehicle || this.disposed) return
		this._readHazards()
		this.accumulator += Math.min(Math.max(delta, 0), 0.1)
		while (this.accumulator >= STEP) {
			this._step()
			this.accumulator -= STEP
		}
		this._syncVisuals()
		if (this.collider) {
			this.collider.x = this.group.position.x
			this.collider.z = this.group.position.z
		}
	}

	/**
	 * Sample the active gravity storm (if any) at the rover. Done once per
	 * frame rather than per physics substep. A level without hazards leaves
	 * both values at 1.
	 */
	_readHazards() {
		const hazards = this.level.hazards
		if (!hazards) {
			this.speedFactor = 1
			this.gravityScale = 1
			return
		}
		const at = this.group.position
		this.speedFactor = hazards.speedFactorAt(at)
		// Reversed gravity just switches the slope pull off (as for the
		// on-foot pilot) instead of flinging the chassis upwards.
		this.gravityScale = THREE.MathUtils.clamp(
			hazards.gravityMultiplierAt(at),
			0.1,
			MAX_SLOPE_GRAVITY
		)
	}

	/**
	 * Rapier's world gravity already pulls the chassis down a slope at 1x.
	 * Add (or cancel) the difference so the slope-parallel pull equals
	 * gravityScale x normal. Only the along-slope part is touched, so
	 * suspension load and traction stay the same in every storm.
	 */
	_applySlopeGravity() {
		const delta = this.gravityScale - 1
		if (Math.abs(delta) < 1e-3) return
		let contact = 0
		for (let i = 0; i < this.wheels.length; i++)
			if (this.vehicle.wheelIsInContact(i)) contact++
		if (contact === 0) return
		const at = this.body.translation()
		const n = this.planet.normalAt(
			at.x,
			at.z,
			SLOPE_SAMPLE,
			this._slopeNormal
		)
		// Gravity's component along the ground is g * (ny*nx, ny*ny - 1, ny*nz):
		// it points down-slope, and is zero on flat ground.
		const k =
			GRAVITY *
			delta *
			(contact / this.wheels.length) *
			this.body.mass() *
			STEP
		this.body.applyImpulse(
			{
				x: k * n.y * n.x,
				y: k * (n.y * n.y - 1),
				z: k * n.y * n.z,
			},
			true
		)
	}

	_step() {
		const keys = this.level.keys
		const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
			this.body.rotation()
		)
		this.speed = forward.dot(this.body.linvel())
		const left = this.inputEnabled && keys.has('KeyA')
		const right = this.inputEnabled && keys.has('KeyD')
		this.steer = THREE.MathUtils.damp(
			this.steer,
			Number(left) - Number(right),
			20,
			STEP
		)
		const gas = this.inputEnabled && keys.has('KeyW')
		const reverse = this.inputEnabled && keys.has('KeyS')
		const braking =
			(reverse && this.speed > 0.5) ||
			(gas && this.speed < -0.5)
		// Heavy gravity lowers both the engine's push and the speed limit;
		// light gravity raises them (see Hazards.speedFactorAt).
		const maxForward = MAX_FORWARD_SPEED * this.speedFactor
		const maxReverse = MAX_REVERSE_SPEED * this.speedFactor
		const overspeed =
			this.speedFactor < 1 &&
			(this.speed > maxForward || this.speed < -maxReverse)
		// The pedal eases toward its target; while braking it returns to
		// neutral first, so switching between forward and reverse rolls
		// through standstill instead of slamming the drive force over.
		const throttleTarget = braking ? 0 : gas ? 1 : reverse ? -1 : 0
		this.throttle = THREE.MathUtils.damp(
			this.throttle,
			throttleTarget,
			THROTTLE_DAMP,
			STEP
		)
		let force = 0
		if (!braking) {
			if (this.throttle > 0 && this.speed < maxForward)
				force =
					ENGINE_FORCE *
					this.speedFactor *
					this.throttle
			else if (this.throttle < 0 && this.speed > -maxReverse)
				force =
					REVERSE_FORCE *
					this.speedFactor *
					this.throttle
		}
		// Steering lock tapers with pace, so the same input turns tightly
		// in a slow crawl and gently at full speed.
		const speedRatio = THREE.MathUtils.clamp(
			Math.abs(this.speed) / Math.max(1, maxForward),
			0,
			1
		)
		const steerAngle =
			this.steer *
			STEER_ANGLE *
			(1 - STEER_HIGH_SPEED_TRIM * speedRatio)
		if (gas || reverse || left || right) this.body.wakeUp()
		for (let i = 0; i < this.wheels.length; i++) {
			// A centre ray alone treats the tire as a point on inclined ground.
			// Project the cylinder's support radius onto the suspension direction.
			const wheel = this.wheels[i]
			const rotation = this.body.rotation()
			const up = UP.clone().applyQuaternion(rotation)
			const center = new THREE.Vector3(
				wheel.x,
				-REST_LENGTH,
				wheel.z
			)
				.applyQuaternion(rotation)
				.add(this.body.translation())
			const normal = this.planet.normalAt(
				center.x,
				center.z,
				0.5
			)
			const angle = wheel.z > 3 ? steerAngle : 0
			const axle = new THREE.Vector3(
				Math.cos(angle),
				0,
				-Math.sin(angle)
			).applyQuaternion(rotation)
			const axial = Math.abs(normal.dot(axle))
			const support =
				WHEEL_RADIUS *
					Math.sqrt(
						Math.max(0, 1 - axial * axial)
					) +
				0.5 * axial
			this.vehicle.setWheelRadius(
				i,
				THREE.MathUtils.clamp(
					support / Math.max(0.4, normal.dot(up)),
					WHEEL_RADIUS,
					3
				)
			)

			const isFront = wheel.z > 3
			const wheelForce = isFront ? force * 0.15 : force
			this.vehicle.setWheelEngineForce(i, wheelForce)

			this.vehicle.setWheelBrake(
				i,
				!this.inputEnabled
					? 180
					: braking
						? 100
						: overspeed
							? OVERSPEED_BRAKE
							: !gas && !reverse
								? 5
								: 0
			)
			this.vehicle.setWheelSteering(
				i,
				isFront ? steerAngle : 0
			)
		}
		this._applySlopeGravity()
		this.vehicle.updateVehicle(
			STEP,
			RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC
		)
		this.world.step()
	}

	_syncVisuals() {
		this.group.quaternion.copy(this.body.rotation())
		this.group.position.copy(this.body.translation())
		this.group.position.addScaledVector(
			UP.clone().applyQuaternion(this.group.quaternion),
			-2.4
		)
		const forward = this._forward
			.set(0, 0, 1)
			.applyQuaternion(this.group.quaternion)
		this.heading = Math.atan2(forward.x, forward.z)
		for (let i = 0; i < this.wheels.length; i++) {
			const wheel = this.wheels[i]
			wheel.pivot.position.y =
				2.4 -
				(this.vehicle.wheelSuspensionLength(i) ??
					REST_LENGTH)
			wheel.pivot.rotation.y =
				this.vehicle.wheelSteering(i) ?? 0
			wheel.mesh.rotation.set(0, 0, Math.PI / 2)
			wheel.mesh.rotateY(this.vehicle.wheelRotation(i) ?? 0)
			// At sharp triangle edges, account for the full tire width and tread,
			// not just the centre ray. Move only along the suspension's local axis.
			const up = UP.clone().applyQuaternion(
				this.group.quaternion
			)
			if (up.y > 0.3) {
				const vertex = new THREE.Vector3()
				const positions =
					wheel.mesh.geometry.attributes.position
				for (let pass = 0; pass < 4; pass++) {
					wheel.mesh.updateWorldMatrix(
						true,
						false
					)
					let lift = 0
					for (
						let v = 0;
						v < positions.count;
						v++
					) {
						vertex.fromBufferAttribute(
							positions,
							v
						).applyMatrix4(
							wheel.mesh.matrixWorld
						)
						lift = Math.max(
							lift,
							this.planet.heightAt(
								vertex.x,
								vertex.z
							) +
								0.03 -
								vertex.y
						)
					}
					if (lift < 0.001) break
					wheel.pivot.position.y += lift / up.y
				}
			}
		}
		for (const wheel of this.modelWheels) {
			if (wheel.steer >= 0)
				wheel.pivot.rotation.y =
					(this.vehicle.wheelSteering(
						wheel.steer
					) ?? 0) * MODEL_WHEEL_STEER_GAIN
			// Same roll convention as the placeholder wheels; scaling by the
			// radius ratio keeps the bigger cover's tread speed on the ground
			// speed the physics wheel integrates for its own radius.
			const roll =
				(this.vehicle.wheelRotation(wheel.spin) ?? 0) *
				(WHEEL_RADIUS / wheel.radius)
			wheel.spinner.rotation.set(0, 0, Math.PI / 2)
			wheel.spinner.rotateY(roll)
		}
	}

	dispose() {
		this.disposed = true
		this.world?.free()
		this.world = null
		this.vehicle = null
	}

	/**
	 * Prefer the authored GLB over the placeholder chassis when it loads.
	 * The model is one static mesh (no wheel nodes), so the placeholder body
	 * and tyres leave the scene with the old chassis group while the entries
	 * in this.wheels stay behind for suspension and steering math.
	 */
	async _loadModel(path) {
		try {
			const model =
				await this.level.assetManager.loadModel(path)
			if (!this.group.parent) return // level torn down mid-load
			this.level._fit(model, MODEL_FIT_LENGTH)
			model.updateMatrixWorld(true)
			const box = new THREE.Box3().setFromObject(model)
			const height = box.max.y - box.min.y
			// Sink the tyres slightly so ground contact reads at CLEARANCE.
			model.position.y += -box.min.y - MODEL_GROUND_SINK
			// Taller than the placeholder: lift the seat above its roof.
			this._seatHeight = Math.max(
				5,
				height - MODEL_GROUND_SINK + 0.5
			)
			const pivot = new THREE.Group()
			pivot.name = 'rover-chassis'
			pivot.rotation.y = MODEL_PIVOT_YAW
			pivot.add(model)
			this.chassisGroup.removeFromParent()
			this.chassisGroup = pivot
			this.group.add(pivot)
			this._buildModelWheels(pivot)
			this.model = model
		} catch (error) {
			console.warn(
				'[Rover] Model unavailable; keeping the placeholder:',
				error?.message
			)
		}
	}

	/**
	 * Procedural spinning tyres parked exactly on the GLB's baked wheels.
	 * Each cover is a rigid cylinder a few centimetres larger than the
	 * baked tyre, so it hides it completely; proud hub caps and tread lugs
	 * give the spin something to read against. The front pair yaws with the
	 * physics steering.
	 */
	_buildModelWheels(parent) {
		const level = this.level
		const rubber = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x14171a,
				roughness: 0.95,
			})
		)
		const steel = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x99a2aa,
				metalness: 0.75,
				roughness: 0.35,
			})
		)
		const lugMat = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x2b3137,
				roughness: 0.85,
			})
		)
		for (const spec of MODEL_WHEELS) {
			const pivot = new THREE.Group()
			pivot.position.set(
				spec.x,
				spec.radius - MODEL_GROUND_SINK,
				spec.z
			)
			const spinner = new THREE.Group()
			spinner.rotation.set(0, 0, Math.PI / 2)
			pivot.add(spinner)
			const tire = new THREE.Mesh(
				level.own(
					new THREE.CylinderGeometry(
						spec.radius,
						spec.radius,
						spec.width,
						40
					)
				),
				rubber
			)
			tire.castShadow = true
			spinner.add(tire)
			const hub = new THREE.Mesh(
				level.own(
					new THREE.CylinderGeometry(
						spec.radius * 0.55,
						spec.radius * 0.55,
						spec.width + 0.12,
						24
					)
				),
				steel
			)
			hub.castShadow = true
			spinner.add(hub)
			// Crossed spokes on both faces: high-contrast, so the roll reads.
			const barGeometry = level.own(
				new THREE.BoxGeometry(
					spec.radius * 1.02,
					0.09,
					0.22
				)
			)
			for (const face of [-1, 1])
				for (let i = 0; i < 2; i++) {
					const bar = new THREE.Mesh(
						barGeometry,
						lugMat
					)
					bar.position.y =
						face * (spec.width / 2 + 0.09)
					bar.rotation.y = i * (Math.PI / 2)
					spinner.add(bar)
				}
			// Tread lugs: bumps on the silhouette while the tyre rolls.
			const lugGeometry = level.own(
				new THREE.BoxGeometry(
					0.2,
					spec.width * 0.86,
					0.14
				)
			)
			for (let i = 0; i < 8; i++) {
				const angle = (i / 8) * Math.PI * 2
				const lug = new THREE.Mesh(lugGeometry, lugMat)
				lug.position.set(
					Math.cos(angle) * (spec.radius - 0.05),
					0,
					Math.sin(angle) * (spec.radius - 0.05)
				)
				lug.rotation.y = -angle
				spinner.add(lug)
			}
			parent.add(pivot)
			this.modelWheels.push({
				pivot,
				spinner,
				spin: spec.spin,
				steer: spec.steer,
				radius: spec.radius,
			})
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
		this.chassisGroup.add(body)

		const geometry = level.own(
			new THREE.CylinderGeometry(
				WHEEL_RADIUS,
				WHEEL_RADIUS,
				1,
				24
			)
		)
		const material = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x111316,
				roughness: 0.9,
			})
		)
		for (const z of [-3.8, 0, 3.8])
			for (const x of [-4.2, 4.2]) {
				const pivot = new THREE.Group()
				pivot.position.set(x, 1.35, z)
				const mesh = new THREE.Mesh(geometry, material)
				mesh.rotation.z = Math.PI / 2
				mesh.castShadow = true
				pivot.add(mesh)
				this.chassisGroup.add(pivot)
				this.wheels.push({ mesh, pivot, x, z })
			}
		const beacon = new THREE.PointLight(0x5ef2ff, 4, 65)
		beacon.position.set(0, 5, 0)
		this.group.add(beacon)
	}
}
