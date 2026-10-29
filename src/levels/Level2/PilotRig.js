import * as THREE from 'three'

const { clamp, lerp, damp, smoothstep, smootherstep } = THREE.MathUtils
const TAU = Math.PI * 2
const fract = (x) => x - Math.floor(x)

// Per-pilot calibration in height-normalised model space: feet at y = 0,
// crown at y = 1, +z forward, +x the pilot's left. Joint heights were tuned
// against the supplied meshes; `legZ` and `centerX` move every pivot onto
// the pilot's actual centreline. `stride`/`sprint` are half the planted
// foot's travel per step while walking/running. `posture` straightens a
// modelled back-arched stance once the pilot moves.
export const PILOT_RIGS = {
	zara: {
		yaw: 0,
		stride: 0.18,
		sprint: 0.24,
		stance: 0.6,
		lift: 0.03,
		arm: 0.3,
		sway: 0.008,
		posture: 0.14,
		hip: 0.46,
		knee: 0.24,
		ankle: 0.04,
		legZ: 0,
		centerX: 0,
		cloth: false,
	},
	kai: {
		yaw: 1.05,
		stride: 0.16,
		sprint: 0.22,
		stance: 0.62,
		lift: 0.032,
		arm: 0.24,
		sway: 0.006,
		posture: -0.06,
		hip: 0.47,
		knee: 0.25,
		ankle: 0.07,
		legZ: 0.025,
		centerX: 0,
		cloth: false,
	},
	nyx: {
		yaw: 0,
		stride: 0.17,
		sprint: 0.22,
		stance: 0.6,
		lift: 0.028,
		arm: 0.24,
		sway: 0.006,
		posture: 0.04,
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
const RUN_STANCE = 0.38
// Peak ankle height of the running heel kick.
const RUN_LIFT = 0.13
// Half the distance between the feet while walking and running; feet land
// close to the midline instead of in the model's wide standing pose.
const TRACK_WALK = 0.055
const TRACK_RUN = 0.04
// Ball of the foot ahead of, and heel behind, the ankle: the pivots for
// toe-off and heel strike.
const TOE = 0.06
const HEEL = 0.025

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
const SIDES = ['L', 'R']

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
		const arm = ys.length < 2 ? DEFAULT_ARM : { ys, xs }
		const top = arm.ys.length - 1
		return {
			...arm,
			pit: Math.min(arm.ys[top], 0.72),
			// How far the hanging arm angles away from the body.
			slant: clamp(
				Math.atan2(
					arm.xs[0] - arm.xs[top],
					arm.ys[top] - arm.ys[0]
				),
				0,
				0.35
			),
		}
	})
}

// Most pilots stand with their feet apart, some with one leg splayed. Find
// each leg's upper thigh and ankle so the skeleton follows the actual limb
// and the gait can bring the feet back under the body.
export function measurePilotLegs(points, profile) {
	const median = (values) => {
		values.sort((a, b) => a - b)
		return values[values.length >> 1]
	}
	const band = (lo, hi, sign) => {
		const xs = []
		const zs = []
		for (let i = 0; i < points.length; i += 3) {
			const y = points[i + 1]
			const outward = points[i] * sign
			if (
				y < lo ||
				y >= hi ||
				outward < 0.015 ||
				outward > 0.22
			)
				continue
			xs.push(points[i])
			zs.push(points[i + 2])
		}
		return xs.length > 40 ? { x: median(xs), z: median(zs) } : null
	}
	return [1, -1].map((sign) => {
		const thigh = band(profile.hip - 0.12, profile.hip - 0.08, sign)
		const ankle = band(
			profile.ankle - 0.02,
			profile.ankle + 0.02,
			sign
		)
		return {
			hipX: thigh?.x ?? sign * LEG_X,
			hipZ: thigh?.z ?? 0,
			footX: ankle?.x ?? sign * LEG_X,
			footZ: ankle?.z ?? 0,
		}
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

// Ankle offset when the foot pitches about the ball (heel up, pitch > 0)
// or the heel (toes up, pitch < 0), so the contact point stays put.
function footPivot(pitch, ankle) {
	if (pitch >= 0)
		return {
			y:
				ankle * (Math.cos(pitch) - 1) +
				TOE * Math.sin(pitch),
			z:
				ankle * Math.sin(pitch) +
				TOE * (1 - Math.cos(pitch)),
		}
	return {
		y: ankle * (Math.cos(pitch) - 1) - HEEL * Math.sin(pitch),
		z: ankle * Math.sin(pitch) + HEEL * (Math.cos(pitch) - 1),
	}
}

// Where one foot is at a point in the cycle, relative to the body: its
// ankle offset (y, z) and pitch. The planted foot tracks the ground from
// heel strike to toe-off; the swing foot clears the ground and reaches
// forward. Running lands on the forefoot, kicks the heel up behind and
// then drives the knee through.
function footPlan(cycle, stance, stride, lift, run, ankle) {
	const ahead = stride * (1 - 0.15 * run)
	const behind = stride * (1 + 0.15 * run)
	const strike = -0.22 * (1 - 0.8 * run)
	const pushOff = lerp(0.5, 0.8, run)
	if (cycle < stance) {
		const u = cycle / stance
		const pitch =
			strike * (1 - smoothstep(u, 0, 0.2)) +
			pushOff * smoothstep(u, lerp(0.62, 0.45, run), 1)
		const pivot = footPivot(pitch, ankle)
		return {
			contact: true,
			u,
			z: lerp(ahead, -behind, u) + pivot.z,
			y: pivot.y,
			pitch,
		}
	}
	const s = (cycle - stance) / (1 - stance)
	// Carry the toe-off and heel-strike poses across the swing.
	const leave = 1 - smootherstep(s, 0, 0.35)
	const arrive = smoothstep(s, 0.75, 1)
	const off = footPivot(pushOff, ankle)
	const on = footPivot(strike, ankle)
	const walkZ = lerp(-behind, ahead, smootherstep(s, 0, 1))
	const walkY = lift * Math.sin(Math.PI * s) ** 2
	const runZ = lerp(-behind, ahead, smootherstep(s, 0.12, 1))
	const runY = RUN_LIFT * Math.sin(Math.PI * s ** 0.6) ** 1.5
	return {
		contact: false,
		u: 0,
		z: lerp(walkZ, runZ, run) + off.z * leave + on.z * arrive,
		y: lerp(walkY, runY, run) + off.y * leave + on.y * arrive,
		pitch:
			pushOff * leave +
			strike * arrive -
			lerp(0.15, 0.05, run) * Math.sin(Math.PI * s),
	}
}

const _target = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _hinge = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _side = new THREE.Vector3()
const _basis = new THREE.Matrix4()
const _hipsInverse = new THREE.Quaternion()
const _aim = new THREE.Quaternion()
const _foot = new THREE.Quaternion()
const _euler = new THREE.Euler()

// Replaces each pilot mesh with a skinned copy driven by a generated skeleton,
// then poses that skeleton procedurally for walking, running and jumping.
// Keeps the old PilotWalk surface (footOffset, height, phase, update) so the
// levels and cutscenes need no changes beyond passing the motion state.
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
		this.speed = 0
		this.lean = 0
		this.bank = 0
		this.time = 0
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
		this.legs = measurePilotLegs(all, this.profile)
		this._buildSkeleton(model, origin)
		this._skinMeshes(level, meshes)
		this._pose(0)
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
		// Each leg is a straight hip-ankle line through the measured limb.
		const legPoints = this.legs.map((leg) => {
			const t = (p.hip - p.knee) / (p.hip - p.ankle)
			return {
				hip: [leg.hipX, p.hip, leg.hipZ],
				knee: [
					lerp(leg.hipX, leg.footX, t),
					p.knee,
					lerp(leg.hipZ, leg.footZ, t),
				],
				ankle: [leg.footX, p.ankle, leg.footZ],
			}
		})
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
			thigh_L: legPoints[0].hip,
			shin_L: legPoints[0].knee,
			foot_L: legPoints[0].ankle,
			thigh_R: legPoints[1].hip,
			shin_R: legPoints[1].knee,
			foot_R: legPoints[1].ankle,
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
		// Rest frame of each leg for the IK: direction down the leg and the
		// knee hinge (the model's x axis, square to the leg).
		this.legs.forEach((leg, i) => {
			const side = SIDES[i]
			const knee = this.rest[`shin_${side}`]
			const ankle = this.rest[`foot_${side}`]
			leg.upper = knee.length()
			leg.lower = ankle.length()
			leg.length = (leg.upper + leg.lower) / h
			leg.down = knee.clone().normalize()
			leg.hinge = new THREE.Vector3(1, 0, 0)
				.addScaledVector(leg.down, -leg.down.x)
				.normalize()
			leg.restBasis =
				new THREE.Quaternion().setFromRotationMatrix(
					_basis.makeBasis(
						leg.hinge,
						leg.down,
						_side.crossVectors(
							leg.hinge,
							leg.down
						)
					)
				)
		})
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

	// `motion` carries what the level knows about the body's movement:
	// `airborne`/`verticalSpeed` for jumps, `accel` (ground speed change,
	// units/s²) to lean into speeding up, and `turnRate` (rad/s, positive
	// turning left) to bank into turns. All are optional.
	update(delta, distance, boarded, motion = {}) {
		const p = this.profile
		const airborne = !boarded && !!motion.airborne
		const moving = !boarded && !airborne && distance > 0.0001
		const speed = delta > 0 ? distance / delta : 0
		this.time += delta

		this.amount = boarded
			? 0
			: damp(this.amount, moving ? 1 : 0, 12, delta)
		this.speed = damp(this.speed, moving ? speed : 0, 10, delta)
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
				5,
				delta
			)
		this.air = boarded
			? 0
			: damp(this.air, airborne ? 1 : 0, 14, delta)
		const grounded = !boarded && !airborne
		this.lean = damp(
			this.lean,
			grounded
				? clamp((motion.accel ?? 0) * 0.006, -0.1, 0.16)
				: 0,
			6,
			delta
		)
		this.bank = damp(
			this.bank,
			grounded
				? clamp(
						-(motion.turnRate ?? 0) *
							this.speed *
							0.012,
						-0.14,
						0.14
					)
				: 0,
			6,
			delta
		)
		// Touchdown: absorb the impact with a crouch sized by fall speed.
		if (this._wasAirborne && !airborne && !boarded)
			this.landing = Math.max(
				this.landing,
				clamp(-this._lastVerticalSpeed / 18, 0.25, 1)
			)
		this.landing = boarded ? 0 : damp(this.landing, 0, 6, delta)
		this._wasAirborne = airborne
		this._lastVerticalSpeed = motion.verticalSpeed ?? 0

		// Lengthen the stride and shorten ground contact when sprinting, then
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
		const landing = this.landing
		const gait = amount * (1 - air)
		const stance = this.stance
		const cycle = this.phase / TAU
		const fall = smoothstep(-verticalSpeed, -2, 6)

		// Foot targets relative to the body, blended from the standing pose
		// into the gait and the airborne tuck.
		const track = lerp(TRACK_WALK, TRACK_RUN, run)
		const plans = [fract(cycle), fract(cycle + 0.5)].map((c) =>
			footPlan(c, stance, this.stride, p.lift, run, p.ankle)
		)
		const feet = plans.map((plan, i) => {
			const leg = this.legs[i]
			const sign = i === 0 ? 1 : -1
			// Rising: one knee tucks higher; falling: both reach down.
			const airY = lerp(i === 0 ? 0.2 : 0.13, 0.04, fall)
			const airZ = lerp(i === 0 ? 0.06 : -0.05, 0.03, fall)
			return {
				x: lerp(
					lerp(leg.footX, sign * track, amount),
					sign * 0.06,
					air
				),
				y: p.ankle + lerp(plan.y * amount, airY, air),
				z: lerp(
					lerp(leg.footZ, plan.z, amount),
					airZ,
					air
				),
				pitch: lerp(
					plan.pitch * amount,
					lerp(0.45, 0.05, fall),
					air
				),
			}
		})

		// Pelvis height: walking keeps it as high as the planted feet allow
		// (lowest in double support) with slightly soft knees; running sinks
		// through each contact and floats in the flight phase.
		const half = fract(cycle * 2) * 0.5
		const runPelvis =
			half < stance
				? -0.015 -
					0.022 *
						Math.sin(
							(Math.PI * half) /
								stance
						)
				: -0.015 +
					0.012 *
						Math.sin(
							(Math.PI *
								(half -
									stance)) /
								Math.max(
									0.5 -
										stance,
									1e-3
								)
						)
		let reachable = Infinity
		plans.forEach((plan, i) => {
			if (!plan.contact) return
			const leg = this.legs[i]
			const foot = feet[i]
			const lateral = foot.x - leg.hipX
			const forward = foot.z - leg.hipZ
			const room = Math.sqrt(
				Math.max(
					0,
					leg.length * leg.length -
						lateral * lateral -
						forward * forward
				)
			)
			reachable = Math.min(reachable, foot.y + room - p.hip)
		})
		const pelvis =
			Math.min(lerp(-0.012, runPelvis, run), reachable) *
				gait -
			landing * 0.085

		// Pelvis: list over the stance leg, rotate with the forward leg,
		// tilt forward into a run and bank into turns.
		const list = Math.sin(TAU * (cycle - stance / 2 + 0.25))
		const swing = Math.cos(TAU * cycle)
		const pelvisYaw = -swing * lerp(0.07, 0.09, run) * gait
		const pelvisList = list * lerp(0.045, 0.02, run) * gait
		const pelvisPitch =
			0.13 * run * gait +
			0.4 * this.lean +
			0.08 * air +
			0.15 * landing
		bones.hips.position.set(
			rest.hips.x +
				(list * p.sway * (1 - run) * gait -
					this.bank * 0.4) *
					h,
			rest.hips.y + pelvis * h,
			rest.hips.z
		)
		bones.hips.rotation.set(
			pelvisPitch,
			pelvisYaw,
			pelvisList + this.bank
		)

		// Legs: two-bone IK from each hip to its foot target, knees aimed
		// along the direction of travel.
		_hipsInverse.copy(bones.hips.quaternion).invert()
		feet.forEach((foot, i) => {
			this._solveLeg(
				i,
				_target
					.set(foot.x * h, foot.y * h, foot.z * h)
					.sub(bones.hips.position)
					.applyQuaternion(_hipsInverse),
				foot.pitch
			)
		})

		// Torso: shoulders counter-rotate against the pelvis, lean into a
		// run and acceleration, and stay level over the pelvis list. The
		// head keeps looking ahead.
		const shoulderTurn = swing * lerp(0.06, 0.14, run) * gait
		const twist = shoulderTurn - pelvisYaw
		const spinePitch =
			0.6 * p.posture * amount +
			0.16 * run * gait +
			0.35 * this.lean +
			0.25 * landing +
			0.06 * air
		const chestPitch =
			0.4 * p.posture * amount +
			0.1 * run * gait +
			0.25 * this.lean +
			Math.sin(this.time * 1.7) * 0.012 * (1 - gait)
		bones.spine.rotation.set(
			spinePitch,
			twist * 0.5,
			-pelvisList * 0.6
		)
		bones.chest.rotation.set(
			chestPitch,
			twist * 0.5,
			-pelvisList * 0.3
		)
		bones.head.rotation.set(
			-(pelvisPitch + spinePitch + chestPitch) * 0.55,
			-shoulderTurn * 0.9,
			-this.bank * 0.5
		)
		bones.cloak.rotation.x =
			(Math.sin(this.phase * 2) * 0.03 + 0.18 * run) * gait +
			0.25 * air * (1 - fall)

		// Arms: relax the modelled A-pose (closer in, slightly forward, soft
		// elbows), swing against the same-side leg while walking and pump
		// with bent elbows while running. In the air they rise forward,
		// then spread for the landing.
		const armSwing = Math.cos(TAU * (cycle - 0.04))
		this.arms.forEach((arm, i) => {
			const side = SIDES[i]
			const sign = i === 0 ? 1 : -1
			const back = i === 0 ? armSwing : -armSwing
			const ahead = Math.max(0, -back)
			let shoulder = lerp(
				back * p.arm,
				-0.12 + back * 0.65,
				run
			)
			let elbow = lerp(
				-0.3 * ahead,
				-1.15 - 0.4 * ahead + 0.2 * Math.max(0, back),
				run
			)
			shoulder = -0.06 + shoulder * gait
			elbow = -0.28 + elbow * gait
			let spread =
				-sign * (arm.slant * 0.45 + 0.08 * run * gait)
			let inward =
				-sign * (arm.slant * 0.35 + 0.15 * run * gait)
			shoulder = lerp(shoulder, lerp(-0.9, -0.25, fall), air)
			elbow = lerp(elbow, lerp(-0.6, -0.3, fall), air)
			spread = lerp(spread, sign * lerp(0.15, 0.6, fall), air)
			inward *= 1 - air
			bones[`upperArm_${side}`].rotation.set(
				shoulder - 0.2 * landing,
				0,
				spread + 0.25 * landing * sign
			)
			bones[`forearm_${side}`].rotation.set(elbow, 0, inward)
		})
	}

	// Aim the thigh and bend the knee so the ankle lands on `target` (in
	// the hips frame); then set the foot to `pitch` against the ground.
	_solveLeg(i, target, pitch) {
		const leg = this.legs[i]
		const side = SIDES[i]
		const thigh = this.bones[`thigh_${side}`]
		const shin = this.bones[`shin_${side}`]
		const foot = this.bones[`foot_${side}`]
		const { upper, lower } = leg
		_dir.copy(target).sub(thigh.position)
		const distance = Math.max(_dir.length(), 1e-6)
		_dir.divideScalar(distance)
		const reach = clamp(
			distance,
			Math.abs(upper - lower) + 1e-4,
			upper + lower - 1e-4
		)
		const knee = Math.acos(
			clamp(
				(reach * reach -
					upper * upper -
					lower * lower) /
					(2 * upper * lower),
				-1,
				1
			)
		)
		const swing = Math.acos(
			clamp(
				(upper * upper +
					reach * reach -
					lower * lower) /
					(2 * upper * reach),
				-1,
				1
			)
		)
		// The knee bends in the plane of the leg and the travel direction.
		_pole.set(0, 0, 1).applyQuaternion(_hipsInverse)
		_hinge.crossVectors(_dir, _pole)
		if (_hinge.lengthSq() < 1e-8) _hinge.set(-1, 0, 0)
		_hinge.normalize()
		_dir.applyAxisAngle(_hinge, swing)
		_hinge.negate()
			.addScaledVector(_dir, -_hinge.dot(_dir))
			.normalize()
		_aim.setFromRotationMatrix(
			_basis.makeBasis(
				_hinge,
				_dir,
				_side.crossVectors(_hinge, _dir)
			)
		)
		thigh.quaternion
			.copy(_aim)
			.multiply(_foot.copy(leg.restBasis).invert())
		shin.quaternion.setFromAxisAngle(leg.hinge, knee)
		// Foot: level with the ground plus pitch, whatever the leg does.
		_foot.copy(thigh.quaternion)
			.multiply(shin.quaternion)
			.premultiply(this.bones.hips.quaternion)
			.invert()
		foot.quaternion
			.setFromEuler(_euler.set(pitch, 0, 0))
			.premultiply(_foot)
	}
}
