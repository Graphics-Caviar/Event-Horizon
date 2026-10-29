import * as THREE from 'three'

/**
 * Procedural animation for the 29 Oct 2026 rigged pilot GLBs.
 * All three use a 66-joint humanoid skin and provide no embedded clips.
 * Work exclusively with cached rest-pose quaternions, never skin positions or
 * the model's transform (which gameplay/cutscenes already control).
 */
const NAMES = {
	pelvis: 'pelvis', chest: 'spine_03', spine: 'spine_01', neck: 'neck_01',
	head: 'head', leftArm: 'upperarm_l', rightArm: 'upperarm_r',
	leftElbow: 'lowerarm_l', rightElbow: 'lowerarm_r',
	leftThigh: 'thigh_l', rightThigh: 'thigh_r',
	leftCalf: 'calf_l', rightCalf: 'calf_r',
	leftFoot: 'foot_l', rightFoot: 'foot_r',
}
const AXES = {
	pitch: new THREE.Vector3(1, 0, 0),
	yaw: new THREE.Vector3(0, 1, 0),
	roll: new THREE.Vector3(0, 0, 1),
}
const _parent = new THREE.Quaternion()
const _root = new THREE.Quaternion()
const _delta = new THREE.Quaternion()
const _target = new THREE.Quaternion()
const TAU = Math.PI * 2

export class PilotRigAnimator {
	constructor(model) {
		this.model = model
		this.parts = new Map()
		this.time = 0
		this.phase = 0
		this.blend = 0
		this.speedBlend = 0
		this.motionLean = 0
		this.motionBank = 0
		this.state = 'IDLE'
		const available = new Map()
		let skinned = 0
		model.traverse((node) => {
			if (!node.isSkinnedMesh || !node.skeleton?.bones?.length) return
			skinned++
			for (const bone of node.skeleton.bones) available.set(bone.name, bone)
		})
		this.isRigged = skinned > 0 && ['leftThigh', 'rightThigh', 'leftCalf', 'rightCalf', 'chest']
			.every((part) => available.has(NAMES[part]))
		if (!this.isRigged) return

		model.updateMatrixWorld(true)
		model.getWorldQuaternion(_root)
		for (const [part, name] of Object.entries(NAMES)) {
			const bone = available.get(name)
			if (!bone || !bone.parent) continue
			bone.parent.getWorldQuaternion(_parent)
			const toParent = _parent.clone().invert().multiply(_root)
			const axes = {}
			for (const [axis, direction] of Object.entries(AXES)) {
				axes[axis] = direction.clone().applyQuaternion(toParent).normalize()
			}
			this.parts.set(part, { bone, bind: bone.quaternion.clone(), axes })
		}
	}

	_set(part, pitch = 0, yaw = 0, roll = 0, alpha = 1) {
		const data = this.parts.get(part)
		if (!data) return
		_target.identity()
		if (pitch) {
			_delta.setFromAxisAngle(data.axes.pitch, pitch)
			_target.multiply(_delta)
		}
		if (yaw) {
			_delta.setFromAxisAngle(data.axes.yaw, yaw)
			_target.multiply(_delta)
		}
		if (roll) {
			_delta.setFromAxisAngle(data.axes.roll, roll)
			_target.multiply(_delta)
		}
		_target.multiply(data.bind)
		data.bone.quaternion.slerp(_target, alpha)
	}

	/** distance is world units travelled this frame, speed is world units/sec. */
	update(delta, { distance = 0, speed = 0, boarded = false, airborne = false, falling = false, accel = 0, turnRate = 0 } = {}) {
		if (!this.isRigged) return
		const dt = THREE.MathUtils.clamp(delta || 0, 0, 0.1)
		this.time += dt
		if (!speed && dt > 0) speed = distance / dt
		const motion = !boarded && !airborne && !falling && speed > 0.12
		const desired = motion ? 1 : 0
		this.blend = THREE.MathUtils.damp(this.blend, desired, 11, dt)
		this.speedBlend = THREE.MathUtils.damp(this.speedBlend,
			THREE.MathUtils.clamp((speed - 2.6) / 3.3, 0, 1), 7, dt)
		// Small acceleration/steering reactions preserve the merged movement
		// feedback without rebuilding the skeleton of an already-rigged GLB.
		const active = boarded || airborne || falling ? 0 : 1
		this.motionLean = THREE.MathUtils.damp(this.motionLean,
			THREE.MathUtils.clamp(accel / 35, -1, 1) * 0.06 * active, 8, dt)
		this.motionBank = THREE.MathUtils.damp(this.motionBank,
			THREE.MathUtils.clamp(turnRate / 2.4, -1, 1) * 0.05 * active, 8, dt)
		const stride = THREE.MathUtils.lerp(1.5, 2.2, this.speedBlend)
		if (motion) this.phase += distance / stride * TAU
		this.state = falling ? 'FALL' : airborne ? 'AIRBORNE' : boarded ? 'SEATED' :
			this.blend < 0.08 ? 'IDLE' : this.speedBlend > 0.5 ? 'RUN' : 'WALK'

		const alpha = 1 - Math.exp(-13 * dt)
		const wave = Math.sin(this.phase)
		const opposite = Math.sin(this.phase + Math.PI)
		const riseL = Math.max(0, Math.cos(this.phase))
		const riseR = Math.max(0, -Math.cos(this.phase))
		const legSwing = THREE.MathUtils.lerp(0.36, 0.62, this.speedBlend) * this.blend
		const armSwing = THREE.MathUtils.lerp(0.25, 0.52, this.speedBlend) * this.blend
		const bounce = Math.sin(this.time * 1.6) * 0.013
		const kick = falling ? 0.16 : airborne ? 0.28 : 0
		this._set('leftThigh', wave * legSwing - kick, 0, 0, alpha)
		this._set('rightThigh', opposite * legSwing - kick, 0, 0, alpha)
		this._set('leftCalf', Math.max(0, -wave) * 0.72 * this.blend + riseL * 0.14 * this.blend + kick * 0.45, 0, 0, alpha)
		this._set('rightCalf', Math.max(0, wave) * 0.72 * this.blend + riseR * 0.14 * this.blend + kick * 0.45, 0, 0, alpha)
		this._set('leftFoot', -wave * legSwing * 0.38, 0, 0, alpha)
		this._set('rightFoot', -opposite * legSwing * 0.38, 0, 0, alpha)
		this._set('leftArm', -wave * armSwing + (falling ? -0.36 : 0), 0, -0.045, alpha)
		this._set('rightArm', -opposite * armSwing + (falling ? -0.36 : 0), 0, 0.045, alpha)
		this._set('leftElbow', -0.09 - 0.15 * this.blend, 0, 0, alpha)
		this._set('rightElbow', -0.09 - 0.15 * this.blend, 0, 0, alpha)
		this._set('pelvis', bounce + this.blend * Math.cos(this.phase * 2) * 0.008,
			this.blend * wave * 0.032, this.blend * Math.cos(this.phase) * 0.016, alpha)
		this._set('spine', -this.blend * this.speedBlend * 0.07 + this.motionLean, 0,
			Math.sin(this.time * 1.2) * 0.008 + this.motionBank, alpha)
		this._set('chest', -this.blend * this.speedBlend * 0.08 + this.motionLean * 0.5,
			-this.blend * wave * 0.035, Math.sin(this.time * 1.6) * 0.007 + this.motionBank * 0.6, alpha)
		this._set('neck', 0, 0, -Math.sin(this.time * 0.7) * 0.009, alpha)
		this._set('head', this.blend * this.speedBlend * 0.06,
			Math.sin(this.time * 0.6) * 0.022 * (1 - this.blend), 0, alpha)
	}

	dispose() {
		// The scene/AssetManager owns GLB GPU data; never dispose shared skins here.
		this.parts.clear()
	}
}
