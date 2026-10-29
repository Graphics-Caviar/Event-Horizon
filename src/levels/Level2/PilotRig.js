import * as THREE from 'three'

const { clamp, lerp, damp, smoothstep } = THREE.MathUtils
const TAU = Math.PI * 2

// Per-pilot calibration in height-normalised model space: feet at y = 0,
// crown at y = 1, +z forward, +x the pilot's left. Joint heights and gait
// numbers were tuned against the supplied meshes. `legZ` and `centerX`
// move every pivot onto the pilot's actual centreline.
export const PILOT_RIGS = {
	zara: {
		yaw: 0,
		stride: 0.14,
		sprint: 0.19,
		stance: 0.6,
		lift: 0.018,
		arm: 0.2,
		sway: 0.006,
		hip: 0.46,
		knee: 0.24,
		ankle: 0.04,
		legZ: 0,
		centerX: 0,
		cloth: false,
	},
	kai: {
		yaw: 1.05,
		stride: 0.12,
		sprint: 0.17,
		stance: 0.64,
		lift: 0.022,
		arm: 0.14,
		sway: 0.004,
		hip: 0.47,
		knee: 0.25,
		ankle: 0.07,
		legZ: 0.025,
		centerX: 0,
		cloth: false,
	},
	nyx: {
		yaw: 0,
		stride: 0.13,
		sprint: 0.18,
		stance: 0.6,
		lift: 0.016,
		arm: 0.12,
		sway: 0.003,
		hip: 0.47,
		knee: 0.25,
		ankle: 0.045,
		legZ: -0.08,
		centerX: -0.045,
		cloth: true,
	},
}

// Upper-body joints are shared by all three pilots.
const SPINE = 0.55
const CHEST = 0.66
const NECK = 0.84
const ELBOW = 0.595
const LEG_X = 0.07
// Arm/torso separation used when a mesh shows no clear gap (e.g. the
// box-built fallback pilot): armpit height and the slanted inner edge.
const DEFAULT_ARM = { pit: 0.66, ys: [0.44, 0.66], xs: [0.145, 0.09] }
// Running replaces the walk's double support with a short flight phase.
const RUN_STANCE = 0.42
const RUN_LIFT = 0.1

// Bone order is the skin index order.
const BONE_NAMES = [
	'root',
	'hips',
	'spine',
	'chest',
	'head',
	'cloak',
	'thigh_L',
	'shin_L',
	'foot_L',
	'thigh_R',
	'shin_R',
	'foot_R',
	'upperArm_L',
	'forearm_L',
	'upperArm_R',
	'forearm_R',
]
const B = Object.fromEntries(BONE_NAMES.map((name, i) => [name, i]))

// Orient the static asset before fitting it; each source uses a different yaw.
export function orientPilot(model, key) {
	const root = new THREE.Group()
	root.rotation.y = (PILOT_RIGS[key] || PILOT_RIGS.zara).yaw
	root.add(model)
	return root
}

// The pilots hang their arms in a slight A-pose, so the empty strip between
// arm and torso drifts outward towards the wrist and differs per pilot and
// per side. Find it band by band in a front projection of the normalised
// vertices (xyz triples). Returns [left, right] arm outlines.
export function measurePilotArms(points) {
	const BAND = 0.02
	const BIN = 0.005
	const Y0 = 0.4
	const X0 = 0.06
	const bands = 16
	const bins = 48
	const grid = [
		new Uint32Array(bands * bins),
		new Uint32Array(bands * bins),
	]
	for (let i = 0; i < points.length; i += 3) {
		const x = points[i]
		const b = Math.floor((points[i + 1] - Y0) / BAND)
		const c = Math.floor((Math.abs(x) - X0) / BIN)
		if (b >= 0 && b < bands && c >= 0 && c < bins)
			grid[x >= 0 ? 0 : 1][b * bins + c]++
	}
	return grid.map((cells) => {
		const ys = []
		const xs = []
		for (let b = 0; b < bands; b++) {
			const filled = (c) =>
				c < bins && cells[b * bins + c] > 0
			// Torso first, then the gap, then at least 1.5 cm of arm.
			let c = 0
			if (!filled(c)) continue
			while (filled(c)) c++
			const start = c
			while (c < bins && !filled(c)) c++
			if (c >= bins - 3 || !filled(c + 1) || !filled(c + 2))
				continue
			ys.push(Y0 + (b + 0.5) * BAND)
			xs.push(X0 + ((start + c) / 2) * BIN)
		}
		if (ys.length < 2) return DEFAULT_ARM
		return { pit: Math.min(ys[ys.length - 1], 0.72), ys, xs }
	})
}

// Inner arm edge at a height, interpolated between measured bands.
function armEdge(arm, y) {
	const { ys, xs } = arm
	if (y <= ys[0]) return xs[0]
	for (let i = 1; i < ys.length; i++)
		if (y <= ys[i])
			return lerp(
				xs[i - 1],
				xs[i],
				(y - ys[i - 1]) / (ys[i] - ys[i - 1])
			)
	return xs[xs.length - 1]
}

// Skin weights for one vertex in normalised space. Returns [bone, weight]
// pairs; the leg masks carry over from the old shader gait so limbs are
// separated from low-hanging hands, holsters and Nyx's cloak.
export function pilotVertexWeights(x, y, z, profile, arms) {
	const ax = Math.abs(x)
	const left = x >= 0
	const cloth = profile.cloth ? 1 : 0
	// Below the armpit the arm is cut off hard at the gap, down to just
	// under the hands, and any faces joining hand to hip are dropped (see
	// _dropArmBridges). Partial weights there would stretch into strands.
	// Above the armpit the shoulder blends smoothly into the chest.
	const side = arms[left ? 0 : 1]
	const edge = armEdge(side, y)
	const hanging = ax > edge && y > side.ys[0] - 0.08 ? 1 : 0
	const shoulder =
		smoothstep(ax, edge, edge + 0.05) *
		(1 - smoothstep(y, side.pit, 0.84))
	const arm = lerp(
		hanging,
		shoulder,
		smoothstep(y, side.pit - 0.02, side.pit)
	)
	const outerLeg =
		1 -
		smoothstep(
			ax,
			lerp(0.105, 0.17, cloth),
			lerp(0.155, 0.21, cloth)
		)
	let leg =
		(1 - smoothstep(y, 0.39, 0.49)) *
		lerp(1, outerLeg, smoothstep(y, 0.28, 0.38)) *
		smoothstep(ax, 0, 0.025)
	let fabric =
		cloth *
		Math.max(
			1 - smoothstep(z, -0.14, -0.1),
			smoothstep(ax, 0.17, 0.21),
			(1 - smoothstep(ax, 0.018, 0.04)) *
				smoothstep(y, 0.1, 0.18)
		)
	fabric *= 1 - smoothstep(y, 0.48, 0.62)
	leg *= (1 - fabric) * (1 - arm)
	const torso = Math.max(0, 1 - arm - leg)
	const out = []
	const push = (bone, w) => {
		if (w > 1e-4) out.push([bone, w])
	}
	if (leg > 0) {
		const knee =
			1 -
			smoothstep(y, profile.knee - 0.02, profile.knee + 0.02)
		const foot =
			1 -
			smoothstep(
				y,
				profile.ankle - 0.005,
				profile.ankle + 0.035
			)
		const s = left ? 0 : 3
		push(B.thigh_L + s, leg * (1 - knee))
		push(B.shin_L + s, leg * (knee - foot))
		push(B.foot_L + s, leg * foot)
	}
	if (arm > 0) {
		const fore = 1 - smoothstep(y, ELBOW - 0.03, ELBOW + 0.03)
		const s = left ? 0 : 2
		push(B.upperArm_L + s, arm * (1 - fore))
		push(B.forearm_L + s, arm * fore)
	}
	if (torso > 0) {
		const cloak = torso * fabric
		const body = torso - cloak
		const aboveHips = smoothstep(y, 0.48, 0.56)
		const aboveSpine = smoothstep(y, 0.6, 0.68)
		// Only the head turns with the neck, not the shoulder tops.
		const head =
			smoothstep(y, 0.81, 0.86) *
			(1 - smoothstep(ax, 0.08, 0.13))
		push(B.cloak, cloak)
		push(B.hips, body * (1 - aboveHips))
		push(B.spine, body * (aboveHips - aboveSpine))
		push(B.chest, body * (aboveSpine - head))
		push(B.head, body * head)
	}
	return out
}

// Gait state for one leg at a point in the cycle.
function legCycle(cycle, stance, stride) {
	const swing = clamp((cycle - stance) / (1 - stance), 0, 1)
	const ease = swing * swing * swing * (swing * (swing * 6 - 15) + 10)
	const planted = cycle < stance
	const z = planted
		? lerp(stride, -stride, cycle / stance)
		: lerp(-stride, stride, ease)
	return {
		swing,
		z,
		planted: planted ? Math.abs(z) : 0,
		clearance: Math.sin(swing * Math.PI) ** 2,
	}
}

// Two-bone IK in the sagittal plane. Rotations follow three's +x convention:
// a negative hip angle swings the foot forward; the knee bends positive.
function solveLeg(profile, pelvis, targetY, targetZ) {
	const upper = profile.hip - profile.knee
	const lower = profile.knee - profile.ankle
	const vertical = profile.hip + pelvis - targetY
	const reach = clamp(
		Math.hypot(vertical, targetZ),
		0.025,
		upper + lower - 1e-4
	)
	const hip =
		Math.atan2(-targetZ, vertical) -
		Math.acos(
			clamp(
				(upper * upper +
					reach * reach -
					lower * lower) /
					(2 * upper * reach),
				-1,
				1
			)
		)
	const knee = Math.acos(
		clamp(
			(reach * reach - upper * upper - lower * lower) /
				(2 * upper * lower),
			-1,
			1
		)
	)
	return { hip, knee }
}

// Replaces each pilot mesh with a skinned copy driven by a generated skeleton,
// then poses that skeleton procedurally for walking, running and jumping.
// Keeps the old PilotWalk surface (footOffset, height, phase, update) so the
// levels and cutscenes need no changes beyond passing the jump state.
export class PilotRig {
	constructor(level, model, character = 'zara', options = {}) {
		this.profile = PILOT_RIGS[character] || PILOT_RIGS.zara
		this.model = model
		// Measured ground speeds where the walk starts and finishes turning
		// into a run (Level 2 walks at 4 and sprints at 7).
		this.runFrom = options.runFrom ?? 4.6
		this.runTo = options.runTo ?? 6.6
		this.phase = 0
		this.amount = 0
		this.run = 0
		this.air = 0
		this.landing = 0
		this.stride = this.profile.stride
		this.stance = this.profile.stance
		this._wasAirborne = false
		this._lastVerticalSpeed = 0

		model.updateMatrixWorld(true)
		const bounds = new THREE.Box3().setFromObject(model)
		const size = bounds.getSize(new THREE.Vector3())
		this.footOffset = -bounds.min.y
		this.height = size.y
		this.strideLength =
			this.height * ((2 * this.stride) / this.stance)

		// Normalised space origin, expressed in the model's parent frame.
		const h = this.height
		const origin = new THREE.Vector3(
			bounds.min.x + size.x * 0.5 + this.profile.centerX * h,
			bounds.min.y,
			bounds.min.z + size.z * 0.5 + this.profile.legZ * h
		)
		const meshes = this._normalisedMeshes(model, origin)
		const all = new Float32Array(
			meshes.reduce((n, { points }) => n + points.length, 0)
		)
		let offset = 0
		for (const { points } of meshes) {
			all.set(points, offset)
			offset += points.length
		}
		this.arms = measurePilotArms(all)
		this._buildSkeleton(model, origin)
		this._skinMeshes(level, meshes)
	}

	// Every mesh vertex in normalised space. matrixWorld still equals the
	// parent-frame transform here: the model is not attached to the scene yet.
	_normalisedMeshes(model, origin) {
		const h = this.height
		const parentInverse = new THREE.Matrix4()
			.copy(model.matrixWorld)
			.invert()
			.premultiply(model.matrix)
		const toParent = new THREE.Matrix4()
		const point = new THREE.Vector3()
		const meshes = []
		model.traverse((mesh) => {
			if (!mesh.isMesh || mesh.isSkinnedMesh) return
			const position = mesh.geometry.attributes.position
			const points = new Float32Array(position.count * 3)
			toParent.multiplyMatrices(
				parentInverse,
				mesh.matrixWorld
			)
			for (let i = 0; i < position.count; i++) {
				point.fromBufferAttribute(position, i)
					.applyMatrix4(toParent)
					.sub(origin)
					.divideScalar(h)
					.toArray(points, i * 3)
			}
			meshes.push({ mesh, points })
		})
		return meshes
	}

	_buildSkeleton(model, origin) {
		const h = this.height
		const p = this.profile
		// Shoulders sit above the armpit, centred over the arm's inner edge.
		const shoulder = this.arms.map((arm) => ({
			x: armEdge(arm, arm.pit) + 0.035,
			y: clamp(arm.pit + 0.09, 0.72, 0.79),
		}))
		const elbowX = this.arms.map(
			(arm) => armEdge(arm, ELBOW) + 0.03
		)
		const bones = BONE_NAMES.map((name) => {
			const bone = new THREE.Bone()
			bone.name = `pilot_${name}`
			return bone
		})
		// Absolute rest positions in normalised space, then parented.
		const rest = {
			root: [0, 0, 0],
			hips: [0, p.hip, 0],
			spine: [0, SPINE, 0],
			chest: [0, CHEST, 0],
			head: [0, NECK, 0],
			cloak: [0, SPINE, -0.06],
			thigh_L: [LEG_X, p.hip, 0],
			shin_L: [LEG_X, p.knee, 0],
			foot_L: [LEG_X, p.ankle, 0],
			thigh_R: [-LEG_X, p.hip, 0],
			shin_R: [-LEG_X, p.knee, 0],
			foot_R: [-LEG_X, p.ankle, 0],
			upperArm_L: [shoulder[0].x, shoulder[0].y, 0],
			forearm_L: [elbowX[0], ELBOW, 0],
			upperArm_R: [-shoulder[1].x, shoulder[1].y, 0],
			forearm_R: [-elbowX[1], ELBOW, 0],
		}
		const parents = {
			hips: 'root',
			spine: 'hips',
			chest: 'spine',
			head: 'chest',
			cloak: 'hips',
			thigh_L: 'hips',
			shin_L: 'thigh_L',
			foot_L: 'shin_L',
			thigh_R: 'hips',
			shin_R: 'thigh_R',
			foot_R: 'shin_R',
			upperArm_L: 'chest',
			forearm_L: 'upperArm_L',
			upperArm_R: 'chest',
			forearm_R: 'upperArm_R',
		}
		for (const name of BONE_NAMES) {
			const bone = bones[B[name]]
			const [x, y, z] = rest[name]
			const parent = parents[name]
			if (parent) {
				const [px, py, pz] = rest[parent]
				bone.position.set(
					(x - px) * h,
					(y - py) * h,
					(z - pz) * h
				)
				bones[B[parent]].add(bone)
			}
		}
		// The bone root lives under the model but cancels its transform, so
		// bone coordinates are the same parent-frame units the gait uses.
		const frame = new THREE.Group()
		frame.name = 'pilot-skeleton'
		model.updateMatrix()
		model.matrix
			.clone()
			.invert()
			.decompose(
				frame.position,
				frame.quaternion,
				frame.scale
			)
		bones[B.root].position.copy(origin)
		frame.add(bones[B.root])
		model.add(frame)
		model.updateMatrixWorld(true)

		this.bones = Object.fromEntries(
			BONE_NAMES.map((name) => [name, bones[B[name]]])
		)
		this.rest = Object.fromEntries(
			BONE_NAMES.map((name) => [
				name,
				bones[B[name]].position.clone(),
			])
		)
		this.skeleton = new THREE.Skeleton(bones)
	}

	_skinMeshes(level, meshes) {
		for (const { mesh, points } of meshes) {
			// Cached GLTF geometry is shared across instances; skin a copy.
			const geometry = level.own(mesh.geometry.clone())
			const count = points.length / 3
			const indices = new Uint16Array(count * 4)
			const weights = new Float32Array(count * 4)
			const armWeight = new Float32Array(count)
			for (let i = 0; i < count; i++) {
				const influences = pilotVertexWeights(
					points[i * 3],
					points[i * 3 + 1],
					points[i * 3 + 2],
					this.profile,
					this.arms
				)
				if (influences.length > 4) {
					influences.sort((a, b) => b[1] - a[1])
					influences.length = 4
				}
				let total = 0
				for (const [, w] of influences) total += w
				if (total <= 0)
					influences.push([B.hips, (total = 1)])
				influences.forEach(([bone, w], k) => {
					indices[i * 4 + k] = bone
					weights[i * 4 + k] = w / total
					if (bone >= B.upperArm_L)
						armWeight[i] += w / total
				})
			}
			this._dropArmBridges(geometry, points, armWeight)
			geometry.setAttribute(
				'skinIndex',
				new THREE.Uint16BufferAttribute(indices, 4)
			)
			geometry.setAttribute(
				'skinWeight',
				new THREE.Float32BufferAttribute(weights, 4)
			)
			const skinned = new THREE.SkinnedMesh(
				geometry,
				mesh.material
			)
			skinned.name = mesh.name
			skinned.position.copy(mesh.position)
			skinned.quaternion.copy(mesh.quaternion)
			skinned.scale.copy(mesh.scale)
			skinned.castShadow = mesh.castShadow
			skinned.receiveShadow = mesh.receiveShadow
			// Posed limbs leave the rest bounds; skip culling as before.
			skinned.frustumCulled = false
			const parent = mesh.parent
			parent.add(skinned)
			parent.remove(mesh)
			skinned.updateMatrixWorld(true)
			skinned.bind(this.skeleton)
		}
	}

	// The scanned meshes fuse resting hands to the hips and holsters. Those
	// few faces are hidden at rest but would stretch into strands once the
	// arm moves, so remove faces that join an arm to the body well below
	// the armpit (where the shoulder blend does not reach).
	_dropArmBridges(geometry, points, armWeight) {
		const index = geometry.index
		if (!index) return
		const pit = Math.min(this.arms[0].pit, this.arms[1].pit) - 0.05
		const source = index.array
		const kept = new source.constructor(source.length)
		let length = 0
		for (let t = 0; t < source.length; t += 3) {
			const a = source[t]
			const b = source[t + 1]
			const c = source[t + 2]
			const span =
				Math.max(
					armWeight[a],
					armWeight[b],
					armWeight[c]
				) -
				Math.min(
					armWeight[a],
					armWeight[b],
					armWeight[c]
				)
			const low =
				Math.max(
					points[a * 3 + 1],
					points[b * 3 + 1],
					points[c * 3 + 1]
				) < pit
			if (span > 0.5 && low) continue
			kept[length++] = a
			kept[length++] = b
			kept[length++] = c
		}
		if (length < source.length)
			geometry.setIndex(
				new THREE.BufferAttribute(
					kept.slice(0, length),
					1
				)
			)
	}

	// `motion.airborne` and `motion.verticalSpeed` drive the jump pose;
	// callers without a jump simply leave them out.
	update(delta, distance, boarded, motion = {}) {
		const p = this.profile
		const airborne = !boarded && !!motion.airborne
		const moving = !boarded && !airborne && distance > 0.0001
		const speed = delta > 0 ? distance / delta : 0

		this.amount = boarded
			? 0
			: damp(this.amount, moving ? 1 : 0, 16, delta)
		if (!airborne)
			this.run = damp(
				this.run,
				moving
					? smoothstep(
							speed,
							this.runFrom,
							this.runTo
						)
					: 0,
				6,
				delta
			)
		this.air = boarded
			? 0
			: damp(this.air, airborne ? 1 : 0, 14, delta)
		// Touchdown: absorb the impact with a crouch sized by fall speed.
		if (this._wasAirborne && !airborne && !boarded)
			this.landing = Math.max(
				this.landing,
				clamp(-this._lastVerticalSpeed / 18, 0.25, 1)
			)
		this.landing = boarded ? 0 : damp(this.landing, 0, 6, delta)
		this._wasAirborne = airborne
		this._lastVerticalSpeed = motion.verticalSpeed ?? 0

		// Extend the stride and shorten ground contact when sprinting, then
		// advance the phase by measured travel so planted feet never skate.
		this.stride = damp(
			this.stride,
			lerp(p.stride, p.sprint, this.run),
			8,
			delta
		)
		this.stance = lerp(p.stance, RUN_STANCE, this.run)
		this.strideLength =
			this.height * ((2 * this.stride) / this.stance)
		if (moving) this.phase += (distance / this.strideLength) * TAU

		this._pose(motion.verticalSpeed ?? 0)
	}

	_pose(verticalSpeed) {
		const p = this.profile
		const h = this.height
		const bones = this.bones
		const rest = this.rest
		const amount = this.amount
		const run = this.run
		const air = this.air
		const stride = this.stride
		const stance = this.stance
		const lift = lerp(p.lift, RUN_LIFT, run)
		const cycle = this.phase / TAU
		const legLength = p.hip - p.ankle

		// Both legs share one pelvis height, dropping just enough to keep the
		// farther planted foot reachable during double support.
		const legs = [
			legCycle(((cycle % 1) + 1) % 1, stance, stride),
			legCycle((((cycle + 0.5) % 1) + 1) % 1, stance, stride),
		]
		const support = Math.max(legs[0].planted, legs[1].planted)
		const pelvis =
			Math.sqrt(legLength * legLength - support * support) -
			legLength
		// Landing crouch: bend both knees under a lowered pelvis.
		const crouchDrop = this.landing * 0.085
		const crouch = solveLeg(p, -crouchDrop, p.ankle, 0)
		const crouchHip = crouchDrop > 0 ? crouch.hip : 0
		const crouchKnee = crouchDrop > 0 ? crouch.knee : 0

		// Airborne: tuck on the way up, reach for the ground on the way down.
		const fall = smoothstep(-verticalSpeed, -2, 6)
		const airLegs = [
			{
				hip: lerp(-0.8, -0.3, fall),
				knee: lerp(1.25, 0.35, fall),
			},
			{
				hip: lerp(-0.35, -0.15, fall),
				knee: lerp(0.8, 0.25, fall),
			},
		]

		const sides = ['L', 'R']
		legs.forEach((leg, i) => {
			const side = sides[i]
			const solved = solveLeg(
				p,
				pelvis,
				p.ankle + leg.clearance * lift,
				leg.z
			)
			let hip = solved.hip * amount + crouchHip
			let knee = solved.knee * amount + crouchKnee
			const roll =
				0.14 *
				leg.clearance *
				Math.cos(leg.swing * Math.PI) *
				amount
			let foot = -hip - knee + roll
			hip = lerp(hip, airLegs[i].hip, air)
			knee = lerp(knee, airLegs[i].knee, air)
			foot = lerp(foot, -hip - knee + 0.35 * (1 - fall), air)
			bones[`thigh_${side}`].rotation.x = hip
			bones[`shin_${side}`].rotation.x = knee
			bones[`foot_${side}`].rotation.x = foot
		})

		// Weight shift over the supporting hip; the thighs lean back so the
		// planted feet stay put.
		const sway = Math.sin(this.phase) * p.sway * amount * (1 - air)
		const hipsY = (pelvis * amount - crouchDrop) * (1 - air)
		bones.hips.position.set(
			rest.hips.x + sway * h,
			rest.hips.y + hipsY * h,
			rest.hips.z
		)
		const swayLean = -sway / legLength
		bones.thigh_L.rotation.z = swayLean
		bones.thigh_R.rotation.z = swayLean

		// Torso: counter-twist against the hips, lean into a run, fold
		// slightly forward when crouching or tucked.
		const twist = Math.cos(this.phase) * 0.025 * amount * (1 - air)
		const lean =
			0.16 * run * amount + 0.25 * this.landing + 0.1 * air
		bones.spine.rotation.set(lean * 0.6, -twist, 0)
		bones.chest.rotation.set(lean * 0.4, -twist * 0.6, 0)
		bones.head.rotation.set(-lean * 0.7, twist * 1.2, 0)
		bones.cloak.rotation.x =
			(Math.sin(this.phase * 2) * 0.03 + 0.12 * run) *
				amount +
			0.25 * air * (1 - fall)

		// Arms swing against the same-side leg; running bends the elbows
		// and doubles the swing. In the air they rise forward, then spread.
		const armScale = p.arm * lerp(1, 2.6, run) * amount
		legs.forEach((leg, i) => {
			const side = sides[i]
			const sign = i === 0 ? 1 : -1
			const swing = (leg.z / stride) * armScale
			let shoulder = swing - 0.06 * run * amount
			let elbow = -(
				lerp(0.12, 1.45, run) * amount +
				Math.max(0, -swing) * 0.5
			)
			let spread = 0.03 * run * amount * sign
			shoulder = lerp(shoulder, lerp(-0.9, -0.25, fall), air)
			elbow = lerp(elbow, lerp(-0.6, -0.3, fall), air)
			spread = lerp(spread, lerp(0.15, 0.6, fall) * sign, air)
			const landingSpread = 0.25 * this.landing * sign
			bones[`upperArm_${side}`].rotation.set(
				shoulder - 0.2 * this.landing,
				0,
				spread + landingSpread
			)
			bones[`forearm_${side}`].rotation.x = elbow
		})
	}
}
