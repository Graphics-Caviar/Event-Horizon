import * as THREE from 'three'

/**
 * Level 2 pilot motion layer.
 *
 * The pilot GLBs are static meshes — no skeleton, no clips — so "walking"
 * cannot come from authored animation. This layer synthesises the gait on
 * top of the locomotion state instead: a stride-locked bob and sway, a
 * forward lean that answers to measured acceleration, banking into turns,
 * terrain-following posture, idle breathing, a jump arc pose with landing
 * compression, and footfall events the level turns into dust.
 * It also grounds the mesh (feet on the terrain) and folds flat when the
 * pilot boards the rover.
 *
 * If a rigged GLB with idle/walk/run clips is ever dropped in, the layer
 * detects the clips and crossfades an AnimationMixer instead — the
 * procedural gait below only runs for unrigged models.
 *
 * The controlled group pivots at the pilot's feet, so every rotation (slope
 * tilt, lean, bank) reads correctly no matter how steep the ground is.
 */

const UP = new THREE.Vector3(0, 1, 0)

const STRIDE_HZ_PER_UNIT = 0.13 // stride cycles/s per unit/s of ground speed
const BOB_HEIGHT = 0.22
const SWAY_WIDTH = 0.075
const SWAY_ROLL = 0.055
const BASE_FORWARD_LEAN = 0.105
const ACCEL_LEAN = 0.0011
const MAX_LEAN = 0.16
const BANK_PER_TURN_RATE = 0.05
const MAX_BANK = 0.26
const SLOPE_TILT = 0.55 // fraction of the terrain tilt the posture adopts
const FEET_GAP = 0.04
const LANDING_CROUCH = 0.5 // body drop at full landing impact
const AIR_PITCH_PER_VSPEED = 0.012
const AIR_PITCH_MIN = -0.14
const AIR_PITCH_MAX = 0.22

export class PilotMotion {
	constructor(root, { baseOffset = 2.2, onFootfall = null } = {}) {
		this.root = root
		this.baseOffset = baseOffset
		this.onFootfall = onFootfall

		// Feet-level pivot: the root sits baseOffset above the ground, this
		// group is pushed back down so all offsets rotate about the contact
		// point instead of the pilot's waist.
		this.group = new THREE.Group()
		this.group.name = 'pilot-motion'
		this.group.position.y = -baseOffset
		root.add(this.group)

		this.model = null
		this.time = 0

		this._phase = 0
		this._speedRatio = 0
		this._accel = 0
		this._lean = 0
		this._bank = 0
		this._slideWeight = 0
		this._postureWeight = 0
		this._airWeight = 0
		this._crouch = 0
		this._prevStepIndex = -1
		this._mixer = null
		this._clips = null

		this._blendedNormal = new THREE.Vector3(0, 1, 0)
		this._localNormal = new THREE.Vector3(0, 1, 0)
		this._inverseYaw = new THREE.Quaternion()
		this._slopeQuat = new THREE.Quaternion()
		this._targetSlopeQuat = new THREE.Quaternion()
		this._leanQuat = new THREE.Quaternion()
		this._euler = new THREE.Euler()
	}

	/**
	 * Reparent the (already fitted) pilot mesh so its lowest vertex rests on
	 * the feet pivot instead of the bounding-box centre.
	 */
	setModel(model) {
		if (this.model === model) return
		this.model?.removeFromParent()
		this.model = model
		model.updateMatrixWorld(true)
		const box = new THREE.Box3().setFromObject(model)
		model.position.y += -box.min.y + FEET_GAP
		this.group.add(model)
		this._setupClips(model)
	}

	/**
	 * Rigged GLBs carry idle/walk/run clips; unrigged ones (the current
	 * pilots) carry none and fall through to the procedural gait.
	 */
	_setupClips(model) {
		this._mixer = null
		this._clips = null
		const clips = model.userData?.animations
		if (!Array.isArray(clips) || clips.length === 0) return
		const pick = (pattern) =>
			clips.find((clip) => pattern.test(clip.name))
		const idle = pick(/idle|stand/i)
		const walk = pick(/walk|move|locomot/i)
		const run = pick(/run|sprint|jog/i)
		if (!idle && !walk && !run) return
		this._mixer = new THREE.AnimationMixer(model)
		this._clips = {
			idle: idle ? this._mixer.clipAction(idle) : null,
			walk: walk ? this._mixer.clipAction(walk) : null,
			run: run ? this._mixer.clipAction(run) : null,
		}
		for (const action of Object.values(this._clips)) {
			if (!action) continue
			action.play()
			action.weight = 0
		}
	}

	/** Landing impact in 0..1: the body compresses, then recovers. */
	notifyLanding(impact) {
		this._crouch = Math.max(
			this._crouch,
			THREE.MathUtils.clamp(impact, 0, 1)
		)
	}

	/**
	 * @param {number} delta seconds
	 * @param {object} state
	 * @param {number} state.speed       ground speed (units/s)
	 * @param {number} state.maxSpeed    speed that maps to the full run gait
	 * @param {number} state.accel       signed acceleration (units/s²)
	 * @param {number} state.turnRate    signed heading rate (rad/s)
	 * @param {THREE.Vector3} state.normal terrain normal under the pilot
	 * @param {boolean} state.sliding    caught on a steep slope
	 * @param {boolean} state.seated     riding the rover
	 * @param {boolean} state.airborne   mid-jump
	 * @param {number} state.verticalSpeed units/s, positive upward
	 */
	update(delta, state) {
		this.time += delta
		const speed = Math.max(0, state.speed || 0)
		const maxSpeed = Math.max(1e-3, state.maxSpeed || 20)
		const seated = Boolean(state.seated)
		const sliding = !seated && Boolean(state.sliding)
		const airborne = !seated && Boolean(state.airborne)
		const verticalSpeed = seated ? 0 : state.verticalSpeed || 0

		// Damped inputs: the visible pose lags the raw state slightly, which
		// is what makes transitions read as weight instead of snapping.
		this._speedRatio = THREE.MathUtils.damp(
			this._speedRatio,
			seated ? 0 : Math.min(1, speed / maxSpeed),
			8,
			delta
		)
		this._accel = THREE.MathUtils.damp(
			this._accel,
			seated ? 0 : state.accel || 0,
			6,
			delta
		)
		this._slideWeight = THREE.MathUtils.damp(
			this._slideWeight,
			sliding ? 1 : 0,
			7,
			delta
		)
		this._postureWeight = THREE.MathUtils.damp(
			this._postureWeight,
			seated ? 0 : 1,
			6,
			delta
		)
		this._airWeight = THREE.MathUtils.damp(
			this._airWeight,
			airborne ? 1 : 0,
			9,
			delta
		)
		// Landing compression recovers toward zero every frame; not to be
		// confused with a jump *pose*, this is the squat after touchdown.
		this._crouch = THREE.MathUtils.damp(this._crouch, 0, 5.5, delta)

		// Stride phase advances with distance travelled, so footfalls stay
		// locked to ground speed: no skating while slowly accelerating and
		// no overdrive when the slope caps the speed. Frozen while airborne
		// so the feet stop "walking" mid-jump.
		if (!airborne) {
			this._phase =
				(this._phase +
					speed * STRIDE_HZ_PER_UNIT * delta) %
				1
		}
		// Footfall events fire exactly on the phase crossings, so the level
		// can kick dust at the foot plant.
		const stepIndex = Math.floor(this._phase * 2)
		if (
			stepIndex !== this._prevStepIndex &&
			speed > 1.5 &&
			!airborne &&
			this._postureWeight > 0.5 &&
			this.onFootfall
		) {
			this.onFootfall({ speed, ratio: this._speedRatio })
		}
		this._prevStepIndex = stepIndex

		const ratio = this._speedRatio
		const gait = ratio * (1 - this._airWeight)
		const stepAbs = Math.abs(Math.sin(this._phase * Math.PI * 2))
		const swayWave = Math.sin(this._phase * Math.PI * 2)

		// Gait: highest between footfalls (push-off), lowest at the plant.
		// Faded by `gait` so jumps and rover rides stop the feet stepping.
		let offsetX = swayWave * SWAY_WIDTH * gait
		let offsetY = BOB_HEIGHT * (stepAbs - 0.5) * gait

		// Idle life: light breathing and a slow weight shift when standing,
		// faded out while seated so the rover ride stays steady.
		const idle = (1 - Math.min(1, ratio * 6)) * this._postureWeight
		offsetY += Math.sin(this.time * 1.8) * 0.02 * idle
		offsetX += Math.sin(this.time * 0.85) * 0.01 * idle

		// Forward lean: running posture plus honest acceleration, with a
		// slight sit-back and wobble while sliding out of control.
		const leanTarget =
			gait * BASE_FORWARD_LEAN +
			THREE.MathUtils.clamp(
				this._accel * ACCEL_LEAN,
				-MAX_LEAN * 0.6,
				MAX_LEAN * 0.7
			) -
			this._slideWeight * 0.05
		this._lean = THREE.MathUtils.damp(
			this._lean,
			seated ? 0 : leanTarget,
			9,
			delta
		)

		// Bank into turns like a runner; harder turns bank harder.
		const bankTarget =
			THREE.MathUtils.clamp(
				(state.turnRate || 0) * BANK_PER_TURN_RATE,
				-MAX_BANK,
				MAX_BANK
			) * gait
		this._bank = THREE.MathUtils.damp(
			this._bank,
			seated ? 0 : bankTarget,
			7,
			delta
		)

		// Airborne pose: tip back slightly on the way up, nose over on the
		// way down, compress through the landing that follows.
		const airPitch =
			THREE.MathUtils.clamp(
				-verticalSpeed * AIR_PITCH_PER_VSPEED,
				AIR_PITCH_MIN,
				AIR_PITCH_MAX
			) * this._airWeight
		const pitch = THREE.MathUtils.clamp(
			this._lean +
				airPitch +
				this._crouch * 0.14 +
				Math.sin(this.time * 1.1) * 0.006 * idle,
			-MAX_LEAN,
			MAX_LEAN
		)
		const roll =
			this._bank -
			swayWave * SWAY_ROLL * gait +
			Math.sin(this.time * 9) * 0.04 * this._slideWeight
		offsetY -= this._crouch * LANDING_CROUCH

		// Posture follows the terrain, expressed in the root's (yawed)
		// frame so the tilt axis stays level whatever way the pilot faces.
		this._blendedNormal
			.copy(state.normal || UP)
			.lerp(UP, 1 - SLOPE_TILT * this._postureWeight)
			.normalize()
		this._inverseYaw.copy(this.root.quaternion).invert()
		this._localNormal
			.copy(this._blendedNormal)
			.applyQuaternion(this._inverseYaw)
		this._targetSlopeQuat.setFromUnitVectors(UP, this._localNormal)
		this._slopeQuat.slerp(
			this._targetSlopeQuat,
			1 - Math.exp(-6 * delta)
		)

		if (this._mixer) {
			// Rigged model: the clips carry the gait; this layer only
			// grounds the body and tilts the posture with the terrain.
			this._updateClips(delta)
			this.group.quaternion.copy(this._slopeQuat)
			this.group.position.set(0, -this.baseOffset, 0)
			return
		}

		this._leanQuat.setFromEuler(
			this._euler.set(pitch, 0, roll, 'XYZ')
		)
		this.group.quaternion
			.copy(this._slopeQuat)
			.multiply(this._leanQuat)
		this.group.position.set(offsetX, -this.baseOffset + offsetY, 0)
	}

	/** Blend idle/walk/run clips by speed for rigged models. */
	_updateClips(delta) {
		const clips = this._clips
		const ratio = this._speedRatio
		const moveBlend = Math.min(1, ratio / 0.5)
		const runBlend = THREE.MathUtils.clamp(
			(ratio - 0.55) / 0.45,
			0,
			1
		)
		const weights = {
			idle: 1 - moveBlend,
			walk: moveBlend * (1 - runBlend),
			run: moveBlend * runBlend,
		}
		// Fold missing slots into neighbours so a two-clip model still gets
		// full coverage (e.g. idle + walk crossfades straight to walk).
		if (!clips.run) {
			weights.walk += weights.run
			weights.run = 0
		}
		if (!clips.walk) {
			weights.idle += weights.walk
			weights.walk = 0
		}
		for (const key of ['idle', 'walk', 'run']) {
			const action = clips[key]
			if (action) action.weight = weights[key]
		}
		this._mixer.update(delta)
	}
}
