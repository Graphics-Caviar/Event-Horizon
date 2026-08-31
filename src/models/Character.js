import * as THREE from 'three'

/**
 * Character — reusable hierarchical humanoid base.
 *
 * Hierarchy:
 *
 *   root (world position + facing)
 *   ├── effects              (ability VFX — NOT under any limb, so a
 *   │                         swinging arm never drags a particle trail
 *   │                         around with it)
 *   └── hips                 (pelvis — root of the "spine")
 *       ├── torso
 *       │   ├── torsoMesh
 *       │   ├── head
 *       │   │   └── headMesh (+ subclass hair/helmet/mask via hook)
 *       │   ├── leftShoulder -> leftElbow -> leftWrist -> leftHand
 *       │   ├── rightShoulder -> rightElbow -> rightWrist -> rightHand
 *       │   └── backpack     (subclass attaches via hook)
 *       ├── equipment         (belt/pouches — subclass attaches via hook)
 *       ├── leftHip  -> leftKnee  -> leftAnkle  -> leftFoot
 *       └── rightHip -> rightKnee -> rightAnkle -> rightFoot
 *
 * Each joint is a THREE.Group, not a mesh — the mesh for that limb
 * segment is a *child* of the joint group. That's what lets us rotate
 * "leftKnee" and have the shin swing from the knee pivot instead of from
 * the shin's own centre, exactly like a real skeletal joint.
 *
 * Subclasses (Zara/Kai/Nyx) override `_createMaterials()` for their
 * colour palette, use the `_addHeadDetails/_addTorsoDetails/_addEquipment`
 * hooks to bolt on accessories, and override `playAbility()`.
 */
export class Character {
	constructor(scene) {
		this.root = new THREE.Group()
		this.effects = new THREE.Group()
		this.root.add(this.effects)

		this.materials = this._createMaterials()
		this._geometries = []
		this._effectParticles = []

		this._buildBody()

		this._time = 0
		this._locomotionPhase = 0
		this._state = 'idle' // 'idle' | 'walk' | 'run'
		this._speedFactor = 0 // smoothed 0 (idle) .. 1 (walk) .. 2 (run)
		this._jump = null

		if (scene) scene.add(this.root)
	}

	// Subclasses call Object.assign(base, {...}) on the result of
	// super._createMaterials() rather than rewriting the whole palette.
	_createMaterials() {
		return {
			skin: new THREE.MeshStandardMaterial({
				color: 0xd8b48f,
				roughness: 0.8,
			}),
			suit: new THREE.MeshStandardMaterial({
				color: 0x2b2f36,
				roughness: 0.7,
				metalness: 0.2,
			}),
			accent: new THREE.MeshStandardMaterial({
				color: 0x4de3ff,
				emissive: 0x1c6f80,
				roughness: 0.4,
			}),
			dark: new THREE.MeshStandardMaterial({
				color: 0x14161c,
				roughness: 0.9,
			}),
		}
	}

	_buildBody() {
		this.hips = new THREE.Group()
		this.hips.position.y = 1.0
		this.root.add(this.hips)

		this._buildTorsoAndHead()
		this._buildArm(-1)
		this._buildArm(1)
		this._buildLeg(-1)
		this._buildLeg(1)

		this.backpack = new THREE.Group()
		this.torso.add(this.backpack)

		this.equipment = new THREE.Group()
		this.hips.add(this.equipment)

		this._addHeadDetails(this.head)
		this._addTorsoDetails(this.torso)
		this._addEquipment(this.equipment, this.backpack)
	}

	_buildTorsoAndHead() {
		this.torso = new THREE.Group()
		this.torso.position.y = 0.05
		this.hips.add(this.torso)

		const torsoGeo = new THREE.CapsuleGeometry(0.26, 0.5, 4, 8)
		this._geometries.push(torsoGeo)
		this.torsoMesh = new THREE.Mesh(torsoGeo, this.materials.suit)
		this.torsoMesh.position.y = 0.35
		this.torsoMesh.castShadow = true
		this.torso.add(this.torsoMesh)

		this.head = new THREE.Group()
		this.head.position.y = 0.78
		this.torso.add(this.head)

		const headGeo = new THREE.SphereGeometry(0.16, 14, 14)
		this._geometries.push(headGeo)
		this.headMesh = new THREE.Mesh(headGeo, this.materials.skin)
		this.headMesh.castShadow = true
		this.head.add(this.headMesh)
	}

	_buildArm(side) {
		const shoulder = new THREE.Group()
		shoulder.position.set(side * 0.32, 0.62, 0)
		this.torso.add(shoulder)

		const upperGeo = new THREE.CapsuleGeometry(0.07, 0.28, 4, 6)
		this._geometries.push(upperGeo)
		const upperArm = new THREE.Mesh(upperGeo, this.materials.suit)
		upperArm.position.y = -0.18
		upperArm.castShadow = true
		shoulder.add(upperArm)

		const elbow = new THREE.Group()
		elbow.position.y = -0.32
		shoulder.add(elbow)

		const forearmGeo = new THREE.CapsuleGeometry(0.06, 0.26, 4, 6)
		this._geometries.push(forearmGeo)
		const forearm = new THREE.Mesh(forearmGeo, this.materials.suit)
		forearm.position.y = -0.16
		forearm.castShadow = true
		elbow.add(forearm)

		const wrist = new THREE.Group()
		wrist.position.y = -0.28
		elbow.add(wrist)

		const handGeo = new THREE.SphereGeometry(0.06, 8, 8)
		this._geometries.push(handGeo)
		const hand = new THREE.Mesh(handGeo, this.materials.skin)
		hand.position.y = -0.05
		wrist.add(hand)

		const key = side < 0 ? 'left' : 'right'
		this[`${key}Shoulder`] = shoulder
		this[`${key}Elbow`] = elbow
		this[`${key}Wrist`] = wrist
		this[`${key}Hand`] = hand
	}

	_buildLeg(side) {
		const hip = new THREE.Group()
		hip.position.set(side * 0.13, -0.05, 0)
		this.hips.add(hip)

		const thighGeo = new THREE.CapsuleGeometry(0.09, 0.32, 4, 6)
		this._geometries.push(thighGeo)
		const thigh = new THREE.Mesh(thighGeo, this.materials.suit)
		thigh.position.y = -0.2
		thigh.castShadow = true
		hip.add(thigh)

		const knee = new THREE.Group()
		knee.position.y = -0.36
		hip.add(knee)

		const shinGeo = new THREE.CapsuleGeometry(0.075, 0.3, 4, 6)
		this._geometries.push(shinGeo)
		const shin = new THREE.Mesh(shinGeo, this.materials.dark)
		shin.position.y = -0.18
		shin.castShadow = true
		knee.add(shin)

		const ankle = new THREE.Group()
		ankle.position.y = -0.34
		knee.add(ankle)

		const footGeo = new THREE.BoxGeometry(0.11, 0.06, 0.22)
		this._geometries.push(footGeo)
		const foot = new THREE.Mesh(footGeo, this.materials.dark)
		foot.position.set(0, -0.03, 0.05)
		ankle.add(foot)

		const key = side < 0 ? 'left' : 'right'
		this[`${key}Hip`] = hip
		this[`${key}Knee`] = knee
		this[`${key}Ankle`] = ankle
		this[`${key}Foot`] = foot
	}

	// ---- subclass hooks (no-ops by default) ----
	_addHeadDetails(_head) {}
	_addTorsoDetails(_torso) {}
	_addEquipment(_equipment, _backpack) {}

	// ---- animation state ----

	setState(state) {
		this._state = state // 'idle' | 'walk' | 'run'
	}

	playJump() {
		if (this._jump) return
		this._jump = { phase: 'crouch', t: 0 }
	}

	/** Subclasses override to spawn their unique ability VFX. */
	playAbility() {}

	/**
	 * Spawns one short-lived, self-fading billboard particle into
	 * `this.effects`. Geometry is created ONCE per class (cached as a
	 * static) and reused for every particle — only the (cheap) material
	 * and mesh instance are created per-call, and only when an ability
	 * actually fires, never inside the per-frame update loop.
	 */
	_spawnEffectParticle({
		position,
		velocity,
		life,
		material,
		scale = 1,
	}) {
		if (!Character._particleGeometry) {
			Character._particleGeometry = new THREE.PlaneGeometry(
				0.12,
				0.12
			)
		}
		material.userData.baseOpacity = material.opacity
		const mesh = new THREE.Mesh(
			Character._particleGeometry,
			material
		)
		mesh.position.copy(position)
		mesh.scale.setScalar(scale)
		this.effects.add(mesh)
		this._effectParticles.push({
			mesh,
			velocity,
			life,
			maxLife: life,
			material,
		})
	}

	/**
	 * @param delta seconds since last frame
	 * @param options.camera optional — if given, effect particles billboard to face it
	 */
	update(delta, options = {}) {
		const { camera = null } = options
		this._time += delta

		const targetSpeed =
			this._state === 'run'
				? 2
				: this._state === 'walk'
					? 1
					: 0
		this._speedFactor = THREE.MathUtils.lerp(
			this._speedFactor,
			targetSpeed,
			1 - Math.pow(0.001, delta)
		)

		if (this._speedFactor > 0.05) {
			this._locomotionPhase +=
				delta * (2 + this._speedFactor * 3)
			this._animateLocomotion(this._speedFactor)
		} else {
			this._animateIdle()
		}

		if (this._jump) this._animateJump(delta)

		this._updateEffectParticles(delta, camera)
	}

	_animateIdle() {
		const breathe = Math.sin(this._time * 1.4) * 0.015
		this.torso.position.y = 0.05 + breathe
		this.head.rotation.y = Math.sin(this._time * 0.35) * 0.08
	}

	_animateLocomotion(speedFactor) {
		const swing = 0.5 * speedFactor
		const phase = this._locomotionPhase

		// Opposite-phase arm/leg swing — left leg forward pairs with right
		// arm forward, the way a real gait works.
		this.leftShoulder.rotation.x = Math.sin(phase) * swing * 0.6
		this.rightShoulder.rotation.x = -Math.sin(phase) * swing * 0.6
		this.leftHip.rotation.x = -Math.sin(phase) * swing
		this.rightHip.rotation.x = Math.sin(phase) * swing

		// Rectified sine: knees only ever bend forward, never backward.
		this.leftKnee.rotation.x =
			Math.max(0, Math.sin(phase)) * 0.9 * speedFactor
		this.rightKnee.rotation.x =
			Math.max(0, -Math.sin(phase)) * 0.9 * speedFactor

		this.torso.rotation.x = THREE.MathUtils.lerp(
			0,
			0.18,
			Math.max(0, speedFactor - 1)
		)
	}

	_animateJump(delta) {
		const j = this._jump
		j.t += delta

		if (j.phase === 'crouch') {
			const p = Math.min(j.t / 0.15, 1)
			this.hips.scale.y = THREE.MathUtils.lerp(1, 0.85, p)
			this.leftKnee.rotation.x = THREE.MathUtils.lerp(
				0,
				0.6,
				p
			)
			this.rightKnee.rotation.x = THREE.MathUtils.lerp(
				0,
				0.6,
				p
			)
			if (p >= 1) {
				j.phase = 'rise'
				j.t = 0
			}
		} else if (j.phase === 'rise') {
			const p = Math.min(j.t / 0.25, 1)
			this.hips.scale.y = THREE.MathUtils.lerp(0.85, 1.15, p)
			this.leftKnee.rotation.x = THREE.MathUtils.lerp(
				0.6,
				0,
				p
			)
			this.rightKnee.rotation.x = THREE.MathUtils.lerp(
				0.6,
				0,
				p
			)
			this.leftShoulder.rotation.x = THREE.MathUtils.lerp(
				0,
				-0.6,
				p
			)
			this.rightShoulder.rotation.x = THREE.MathUtils.lerp(
				0,
				-0.6,
				p
			)
			if (p >= 1) {
				j.phase = 'settle'
				j.t = 0
			}
		} else if (j.phase === 'settle') {
			const p = Math.min(j.t / 0.2, 1)
			this.hips.scale.y = THREE.MathUtils.lerp(1.15, 1, p)
			this.leftShoulder.rotation.x = THREE.MathUtils.lerp(
				-0.6,
				0,
				p
			)
			this.rightShoulder.rotation.x = THREE.MathUtils.lerp(
				-0.6,
				0,
				p
			)
			if (p >= 1) this._jump = null
		}
	}

	_updateEffectParticles(delta, camera) {
		for (let i = this._effectParticles.length - 1; i >= 0; i--) {
			const p = this._effectParticles[i]
			p.mesh.position.addScaledVector(p.velocity, delta)
			if (camera) p.mesh.quaternion.copy(camera.quaternion) // billboard
			p.life -= delta
			p.material.opacity =
				Math.max(0, p.life / p.maxLife) *
				p.material.userData.baseOpacity
			if (p.life <= 0) {
				this.effects.remove(p.mesh)
				p.material.dispose()
				this._effectParticles.splice(i, 1)
			}
		}
	}

	dispose() {
		for (const geo of this._geometries) geo.dispose()
		for (const mat of Object.values(this.materials)) mat.dispose()
		for (const p of this._effectParticles) p.material.dispose()
		this._effectParticles.length = 0
		if (this.root.parent) this.root.parent.remove(this.root)
	}
}
