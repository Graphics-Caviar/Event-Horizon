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
				if (!this.parts.has(bone.name))
					this.parts.set(bone.name, {
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
		if (x)
			this.target.multiply(
				this.offset.setFromAxisAngle(this.x, x)
			)
		if (y)
			this.target.multiply(
				this.offset.setFromAxisAngle(this.y, y)
			)
		if (z)
			this.target.multiply(
				this.offset.setFromAxisAngle(this.z, z)
			)
		part.bone.quaternion.slerp(this.target, alpha)
	}

	update(delta, { state = 'idle', speed = 0, airborne = false } = {}) {
		if (!this.isRigged) return
		const dt = THREE.MathUtils.clamp(delta, 0, 0.06)
		this.time += dt
		const moving = speed > 0.5
		this.phase += dt * (1.3 + speed * 0.9)
		const cycle = Math.sin(this.phase)
		const attack = ['prepare', 'strike', 'charge', 'dive'].includes(
			state
		)
		const stagger = state === 'stagger'
		const dead = state === 'dead'
		const alpha = 1 - Math.exp(-10 * dt)
		const breath = Math.sin(this.time * 1.7) * 0.025
		if (this.species === 'entity') {
			this.pose(
				'spine_1',
				breath + (attack ? -0.1 : 0),
				0,
				cycle * 0.035,
				alpha
			)
			this.pose(
				'spine_2',
				breath,
				Math.sin(this.time) * 0.05,
				0,
				alpha
			)
			this.pose(
				'head',
				-breath,
				Math.sin(this.time * 0.6) * 0.08,
				0,
				alpha
			)
			this.pose('jaw', attack ? 0.25 : 0.03, 0, 0, alpha)
			for (const side of ['l', 'r']) {
				const sign = side === 'l' ? 1 : -1
				this.pose(
					`arm_1_${side}`,
					attack ? -0.4 : cycle * 0.12,
					0,
					sign * (0.1 + breath),
					alpha
				)
				this.pose(
					`arm_2_${side}`,
					attack ? -0.25 : 0.04,
					0,
					0,
					alpha
				)
			}
			for (const [index, suffix] of [
				'f',
				'b',
				'l',
				'r',
			].entries()) {
				this.pose(
					`skirt_1_${suffix}`,
					Math.sin(this.time * 1.5 + index) * 0.1,
					0,
					0,
					alpha
				)
				this.pose(
					`skirt_2_${suffix}`,
					Math.sin(
						this.time * 1.5 + index - 0.7
					) * 0.13,
					0,
					0,
					alpha
				)
			}
			for (let i = 1; i <= 3; i++)
				this.pose(
					`tail_${i}`,
					0,
					Math.sin(this.time * 1.8 - i * 0.45) *
						0.09,
					0,
					alpha
				)
			return
		}
		// Galactus uses the model's real 66-bone humanoid skeleton. The
		// entire pose is blended back to bind rotations each frame, so
		// repeated windups never twist limbs cumulatively.
		if (this.species === 'galactus') {
			const winding = ['windup', 'prepare', 'charge'].includes(state)
			const striking = state === 'strike'
			const hit = state === 'stagger'
			const strength = winding ? 0.55 : striking ? 0.85 : 0
			this.pose('pelvis', breath * 0.6, 0, Math.sin(this.time) * 0.025, alpha)
			this.pose('spine_01', -strength * 0.11 + (hit ? 0.12 : 0), 0, 0, alpha)
			this.pose('spine_03', -strength * 0.22, Math.sin(this.time * 0.8) * 0.04, 0, alpha)
			this.pose('head', strength * 0.14 - breath, Math.sin(this.time * 0.55) * 0.05, 0, alpha)
			for (const side of ['l', 'r']) {
				const sign = side === 'l' ? 1 : -1
				this.pose(`upperarm_${side}`, -strength * 0.9 + breath, 0, sign * (0.11 + strength * 0.22), alpha)
				this.pose(`lowerarm_${side}`, -0.14 - strength * 0.42, 0, 0, alpha)
				this.pose(`thigh_${side}`, Math.sin(this.time * 1.2 + (sign > 0 ? 0 : Math.PI)) * 0.045, 0, 0, alpha)
				this.pose(`calf_${side}`, -0.08, 0, 0, alpha)
			}
			return
		}
		const heavy = this.species === 'colossus'
		const gait =
			moving && !airborne && !dead ? (heavy ? 0.2 : 0.3) : 0
		const strike = attack ? (heavy ? 0.5 : 0.65) : 0
		const react = stagger ? 0.15 : 0
		this.pose('pelvis', breath, 0, cycle * gait * 0.1, alpha)
		this.pose(
			'spine_01',
			breath + react,
			0,
			cycle * gait * 0.07,
			alpha
		)
		this.pose(
			'spine_03',
			-strike * 0.3 - react,
			0,
			cycle * gait * 0.06,
			alpha
		)
		this.pose(
			'head',
			-breath,
			Math.sin(this.time * 0.7) * 0.03,
			0,
			alpha
		)
		for (const side of ['l', 'r']) {
			const sign = side === 'l' ? 1 : -1
			this.pose(
				`thigh_${side}`,
				cycle * sign * gait,
				0,
				0,
				alpha
			)
			this.pose(
				`calf_${side}`,
				Math.max(0, -cycle * sign) * gait * 0.65,
				0,
				0,
				alpha
			)
			this.pose(
				`upperarm_${side}`,
				-cycle * sign * gait * 0.8 - strike,
				0,
				sign * 0.045,
				alpha
			)
			this.pose(
				`lowerarm_${side}`,
				attack ? -0.35 : -0.12,
				0,
				0,
				alpha
			)
		}
	}

	dispose() {
		this.parts.clear()
	}
}
