import * as THREE from 'three'

/** Small skeletal pose layer for the three supplied, clip-free Void GLBs.
 * Uses bone names from the actual exports and never accumulates rotations.
 * All clones keep independent skeletons through AssetManager's SkeletonUtils.
 */
export class VoidRigAnimator {
	constructor(model, species = 'sentinel') {
		this.species = species
		this.time = 0
		this.phase = 0
		this.parts = new Map()
		this.target = new THREE.Quaternion()
		this.offset = new THREE.Quaternion()
		this.x = new THREE.Vector3(1, 0, 0)
		this.y = new THREE.Vector3(0, 1, 0)
		this.z = new THREE.Vector3(0, 0, 1)
		model.traverse((node) => {
			if (!node.isSkinnedMesh) return
			for (const bone of node.skeleton?.bones || []) {
				if (!this.parts.has(bone.name)) this.parts.set(bone.name, {
					bone,
					rest: bone.quaternion.clone(),
				})
			}
		})
		this.isRigged = this.parts.size > 0
	}

	pose(name, x = 0, y = 0, z = 0, alpha = 1) {
		const part = this.parts.get(name)
		if (!part) return
		this.target.copy(part.rest)
		if (x) this.target.multiply(this.offset.setFromAxisAngle(this.x, x))
		if (y) this.target.multiply(this.offset.setFromAxisAngle(this.y, y))
		if (z) this.target.multiply(this.offset.setFromAxisAngle(this.z, z))
		part.bone.quaternion.slerp(this.target, alpha)
	}

	update(delta, { state = 'idle', speed = 0, airborne = false } = {}) {
		if (!this.isRigged) return
		const dt = THREE.MathUtils.clamp(delta, 0, 0.06)
		this.time += dt
		const moving = speed > 0.5
		this.phase += dt * (1.3 + speed * 0.9)
		const cycle = Math.sin(this.phase)
		const attack = ['prepare', 'strike', 'charge', 'dive'].includes(state)
		const stagger = state === 'stagger'
		const dead = state === 'dead'
		const alpha = 1 - Math.exp(-10 * dt)
		const breath = Math.sin(this.time * 1.7) * 0.025
		if (this.species === 'entity') {
			this.pose('spine_1', breath + (attack ? -0.1 : 0), 0, cycle * 0.035, alpha)
			this.pose('spine_2', breath, Math.sin(this.time) * 0.05, 0, alpha)
			this.pose('head', -breath, Math.sin(this.time * 0.6) * 0.08, 0, alpha)
			this.pose('jaw', attack ? 0.25 : 0.03, 0, 0, alpha)
			for (const side of ['l', 'r']) {
				const sign = side === 'l' ? 1 : -1
				this.pose(`arm_1_${side}`, attack ? -0.4 : cycle * 0.12, 0, sign * (0.10 + breath), alpha)
				this.pose(`arm_2_${side}`, attack ? -0.25 : 0.04, 0, 0, alpha)
			}
			for (const [index, suffix] of ['f', 'b', 'l', 'r'].entries()) {
				this.pose(`skirt_1_${suffix}`, Math.sin(this.time * 1.5 + index) * 0.1, 0, 0, alpha)
				this.pose(`skirt_2_${suffix}`, Math.sin(this.time * 1.5 + index - 0.7) * 0.13, 0, 0, alpha)
			}
			for (let i = 1; i <= 3; i++) this.pose(`tail_${i}`, 0, Math.sin(this.time * 1.8 - i * 0.45) * 0.09, 0, alpha)
			return
		}
		const heavy = this.species === 'colossus'
		const gait = moving && !airborne && !dead ? (heavy ? 0.20 : 0.30) : 0
		const strike = attack ? (heavy ? 0.5 : 0.65) : 0
		const react = stagger ? 0.15 : 0
		this.pose('pelvis', breath, 0, cycle * gait * 0.1, alpha)
		this.pose('spine_01', breath + react, 0, cycle * gait * 0.07, alpha)
		this.pose('spine_03', -strike * 0.3 - react, 0, cycle * gait * 0.06, alpha)
		this.pose('head', -breath, Math.sin(this.time * 0.7) * 0.03, 0, alpha)
		for (const side of ['l', 'r']) {
			const sign = side === 'l' ? 1 : -1
			this.pose(`thigh_${side}`, cycle * sign * gait, 0, 0, alpha)
			this.pose(`calf_${side}`, Math.max(0, -cycle * sign) * gait * 0.65, 0, 0, alpha)
			this.pose(`upperarm_${side}`, -cycle * sign * gait * 0.8 - strike, 0, sign * 0.045, alpha)
			this.pose(`lowerarm_${side}`, attack ? -0.35 : -0.12, 0, 0, alpha)
		}
	}

	dispose() { this.parts.clear() }
}
