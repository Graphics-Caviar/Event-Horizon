import * as THREE from 'three'

/**
 * Bone names below were inspected in the three user-supplied rigged GLBs
 * (29 Oct 2026). This controller never assumes that an unrigged fallback
 * has working limbs. All offsets are relative to the imported bind pose.
 *
 * Local axes are derived from the actual parent bind transforms so bone
 * rotations remain anatomically consistent across differently oriented rigs.
 */
const PROFILES = {
	runner: {
		root: 'pelvis',
		spine: 'spine_03',
		head: 'head',
		leftArm: 'upperarm_l',
		rightArm: 'upperarm_r',
		leftElbow: 'lowerarm_l',
		rightElbow: 'lowerarm_r',
		leftLeg: 'thigh_l',
		rightLeg: 'thigh_r',
		leftKnee: 'calf_l',
		rightKnee: 'calf_r',
		leftFoot: 'foot_l',
		rightFoot: 'foot_r',
	},
	launcher: {
		root: 'pelvis',
		spine: 'spine_03',
		head: 'head',
		leftArm: 'upperarm_l',
		rightArm: 'upperarm_r',
		leftElbow: 'lowerarm_l',
		rightElbow: 'lowerarm_r',
		leftLeg: 'thigh_l',
		rightLeg: 'thigh_r',
		leftKnee: 'calf_l',
		rightKnee: 'calf_r',
		leftFoot: 'foot_l',
		rightFoot: 'foot_r',
	},
	flyer: {
		root: 'hips',
		spine: 'spine_2',
		head: 'head',
		leftWing: 'wing_1_L',
		rightWing: 'wing_1_R',
		leftWingTip: 'wing_3_L',
		rightWingTip: 'wing_3_R',
		leftWingOuter: 'wing_4_L',
		rightWingOuter: 'wing_4_R',
		leftLeg: 'UpperLeg_L',
		rightLeg: 'UpperLeg_R',
		leftKnee: 'LowerLeg_L',
		rightKnee: 'LowerLeg_R',
		tail: 'tail_1',
		tailTip: 'tail_2',
		jaw: 'mouth_lower',
	},
}

const AXES = {
	pitch: new THREE.Vector3(1, 0, 0),
	yaw: new THREE.Vector3(0, 1, 0),
	roll: new THREE.Vector3(0, 0, 1),
}
const _parentQuat = new THREE.Quaternion()
const _rootQuat = new THREE.Quaternion()
const _offsetQuat = new THREE.Quaternion()
const _targetQuat = new THREE.Quaternion()
const PI2 = Math.PI * 2

export class AlienAnimationController {
	constructor(model, type) {
		this.model = model
		this.type = type
		this.profile = PROFILES[type] || PROFILES.runner
		this.bones = new Map()
		this.pose = new Map()
		this.time = Math.random() * 5
		this.gait = Math.random() * PI2
		this.wingPhase = Math.random() * PI2
		this.state = 'IDLE'
		this.mixer = null
		this.action = null

		// Use actual skinned meshes, not merely bone-like object names.
		const skins = []
		model.traverse((node) => {
			if (node.isSkinnedMesh && node.skeleton?.bones?.length)
				skins.push(node)
		})
		this.isRigged = skins.length > 0
		if (!this.isRigged) return

		const available = new Map()
		for (const skin of skins) {
			for (const bone of skin.skeleton.bones)
				available.set(bone.name, bone)
		}
		model.updateMatrixWorld(true)
		model.getWorldQuaternion(_rootQuat)
		for (const [part, name] of Object.entries(this.profile)) {
			const bone = available.get(name)
			if (!bone) continue
			bone.parent.getWorldQuaternion(_parentQuat)
			const axisQuaternion = _parentQuat
				.clone()
				.invert()
				.multiply(_rootQuat)
			const axes = {}
			for (const [key, direction] of Object.entries(AXES)) {
				axes[key] = direction
					.clone()
					.applyQuaternion(axisQuaternion)
					.normalize()
			}
			this.bones.set(part, bone)
			this.pose.set(part, {
				bind: bone.quaternion.clone(),
				axes,
			})
		}
		// A rig is usable only if the essential bones exist for its anatomy.
		this.isRigged =
			this.type === 'flyer'
				? this.bones.has('leftWing') &&
					this.bones.has('rightWing')
				: this.bones.has('leftLeg') &&
					this.bones.has('rightLeg') &&
					this.bones.has('spine')
		if (!this.isRigged) {
			this.bones.clear()
			this.pose.clear()
			return
		}

		// AnimationMixer is appropriate only when an embedded clip exists.
		// The supplied GLBs have none, so they use procedural poses exclusively.
		const clips = model.userData.animations || []
		if (clips.length) {
			this.mixer = new THREE.AnimationMixer(model)
			this.action = this.mixer.clipAction(clips[0])
			this.action.play()
		}
	}

	/** Apply axis rotations in the imported bone's PARENT bind coordinate system. */
	_set(part, pitch = 0, yaw = 0, roll = 0, blend = 1) {
		const bone = this.bones.get(part)
		if (!bone) return
		const bind = this.pose.get(part)
		_targetQuat.identity()
		if (pitch) {
			_offsetQuat.setFromAxisAngle(bind.axes.pitch, pitch)
			_targetQuat.multiply(_offsetQuat)
		}
		if (yaw) {
			_offsetQuat.setFromAxisAngle(bind.axes.yaw, yaw)
			_targetQuat.multiply(_offsetQuat)
		}
		if (roll) {
			_offsetQuat.setFromAxisAngle(bind.axes.roll, roll)
			_targetQuat.multiply(_offsetQuat)
		}
		_targetQuat.multiply(bind.bind)
		bone.quaternion.slerp(_targetQuat, blend)
	}

	update(delta, options = {}) {
		if (!this.isRigged) return
		const dt = Math.max(0, Math.min(delta, 0.1))
		this.time += dt
		const {
			speed = 0,
			baseSpeed = 6,
			attackPhase = '',
			attackProgress = 0,
			hit = false,
			dead = false,
			bank = 0,
		} = options
		const locomotion = THREE.MathUtils.clamp(
			speed / Math.max(1, baseSpeed),
			0,
			1.75
		)
		const moving = speed > 0.3
		const attacking = Boolean(attackPhase)
		this.state = dead
			? 'DEATH'
			: hit
				? 'HIT'
				: attacking
					? 'ATTACK'
					: moving
						? locomotion > 1.15
							? 'RUN'
							: 'WALK'
						: 'IDLE'
		if (this.type === 'flyer' && !dead && !hit && !attacking)
			this.state = 'FLY'

		const stride = this.type === 'launcher' ? 3.5 : 2.7
		// Cap gait frequency at high pursuit speeds to avoid frantic leg cycling.
		if (moving)
			this.gait +=
				Math.min(
					speed / stride,
					this.type === 'launcher' ? 2.7 : 4.2
				) *
				PI2 *
				dt
		const wave = Math.sin(this.gait)
		const liftL = Math.max(0, Math.cos(this.gait))
		const liftR = Math.max(0, -Math.cos(this.gait))
		const idle = Math.sin(
			this.time * (this.type === 'launcher' ? 1.2 : 2.1)
		)
		const blend = 1 - Math.exp(-12 * dt)

		if (this.mixer) {
			// Never write procedural offsets onto bones simultaneously driven by a clip.
			this.mixer.update(dt)
			return
		}

		if (this.type === 'flyer') {
			const dive = attackPhase === 'swoop'
			const frequency = dive
				? 1.5
				: attackPhase === 'climb'
					? 4.8
					: 3.6
			this.wingPhase += dt * PI2 * frequency
			const flutter = Math.sin(this.wingPhase)
			const spread = dive ? 0.18 : 0.55
			const flap = flutter * spread
			const fold = dive ? 0.4 : 0
			this._set('leftWing', 0.05, 0, flap - fold, blend)
			this._set('rightWing', 0.05, 0, -flap + fold, blend)
			this._set(
				'leftWingTip',
				0,
				0,
				-flap * 0.45 + fold * 0.45,
				blend
			)
			this._set(
				'rightWingTip',
				0,
				0,
				flap * 0.45 - fold * 0.45,
				blend
			)
			this._set(
				'leftWingOuter',
				0,
				0,
				-flutter * spread * 0.22,
				blend
			)
			this._set(
				'rightWingOuter',
				0,
				0,
				flutter * spread * 0.22,
				blend
			)
			this._set(
				'spine',
				dive ? -0.14 : 0.025 * idle,
				0,
				bank * 0.15,
				blend
			)
			this._set(
				'head',
				dive ? 0.13 : Math.sin(this.time * 1.5) * 0.04,
				0,
				0,
				blend
			)
			this._set(
				'jaw',
				dive ? 0.19 : 0.025 * Math.sin(this.time * 2.4),
				0,
				0,
				blend
			)
			this._set('leftLeg', dive ? -0.18 : 0.14, 0, 0, blend)
			this._set('rightLeg', dive ? -0.18 : 0.14, 0, 0, blend)
			this._set('leftKnee', dive ? 0.28 : 0.12, 0, 0, blend)
			this._set('rightKnee', dive ? 0.28 : 0.12, 0, 0, blend)
			this._set(
				'tail',
				0.09 * Math.sin(this.time * 2.0),
				0.1 * Math.sin(this.time),
				0,
				blend
			)
			this._set(
				'tailTip',
				0.13 * Math.sin(this.time * 2.0 - 0.6),
				0,
				0,
				blend
			)
			if (dead) {
				for (const p of this.bones.keys())
					this._set(p, 0, 0, 0, blend)
				this._set('leftWing', 0, 0, -0.4, blend)
				this._set('rightWing', 0, 0, 0.4, blend)
			}
			return
		}

		const brute = this.type === 'launcher'
		const gaitAmp = (brute ? 0.32 : 0.5) * Math.min(1.1, locomotion)
		let armL = -wave * gaitAmp * 0.62
		let armR = wave * gaitAmp * 0.62
		let legL = wave * gaitAmp
		let legR = -wave * gaitAmp
		let elbowL = 0.12 + liftL * gaitAmp * 0.25
		let elbowR = 0.12 + liftR * gaitAmp * 0.25
		let spine =
			(brute ? 0.013 : 0.025) * idle +
			locomotion * (brute ? 0.07 : 0.12)
		let bodyYaw =
			Math.sin(this.gait) * 0.04 * Math.min(1, locomotion)
		let head = -spine * 0.35 + Math.sin(this.time * 1.7) * 0.023
		let kneeL = liftL * gaitAmp * 0.7
		let kneeR = liftR * gaitAmp * 0.7

		// Windup -> contact -> follow-through -> return, no accumulated rotations.
		if (attacking) {
			const progress = THREE.MathUtils.clamp(
				attackProgress,
				0,
				1
			)
			const intensity =
				attackPhase === 'windup'
					? progress * 0.55
					: attackPhase === 'lunge'
						? Math.sin(progress * Math.PI)
						: (1 - progress) * 0.25
			armL = -0.35 - intensity * (brute ? 0.9 : 0.65)
			armR = -0.3 - intensity * (brute ? 1.1 : 1.25)
			elbowL = 0.25 + intensity * 0.35
			elbowR = 0.35 + intensity * 0.45
			spine =
				(attackPhase === 'windup' ? -0.22 : 0.2) +
				intensity * 0.16
			bodyYaw = intensity * (brute ? 0.2 : 0.28)
			head = -spine * 0.25
		}
		if (hit) {
			spine = -0.25
			armL = 0.25
			armR = 0.25
			legL *= 0.2
			legR *= 0.2
		}
		if (dead) {
			spine = -0.4
			bodyYaw = 0.12
			armL = -0.28
			armR = 0.15
			legL = -0.15
			legR = 0.26
			elbowL = elbowR = 0.2
			kneeL = kneeR = 0.18
		}

		this._set('root', 0, bodyYaw * 0.35, bank * 0.18, blend)
		this._set('spine', spine, bodyYaw, bank * 0.2, blend)
		this._set(
			'head',
			head,
			Math.sin(this.time * 0.8) * 0.035,
			0,
			blend
		)
		this._set('leftArm', armL, 0, -0.04, blend)
		this._set('rightArm', armR, 0, 0.04, blend)
		this._set('leftElbow', elbowL, 0, 0, blend)
		this._set('rightElbow', elbowR, 0, 0, blend)
		this._set('leftLeg', legL, 0, -0.018, blend)
		this._set('rightLeg', legR, 0, 0.018, blend)
		this._set('leftKnee', kneeL, 0, 0, blend)
		this._set('rightKnee', kneeR, 0, 0, blend)
		this._set('leftFoot', -kneeL * 0.35, 0, 0, blend)
		this._set('rightFoot', -kneeR * 0.35, 0, 0, blend)
	}

	dispose() {
		if (this.mixer) {
			this.mixer.stopAllAction()
			this.mixer.uncacheRoot(this.model)
		}
		this.bones.clear()
		this.pose.clear()
	}
}
