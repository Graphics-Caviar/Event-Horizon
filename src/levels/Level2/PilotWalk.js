import * as THREE from 'three'

export const PILOT_GAITS = {
	zara: {
		yaw: 0,
		stride: 0.14,
		sprint: 0.18,
		stance: 0.6,
		lift: 0.018,
		arm: 0.2,
		sway: 0.006,
		joints: [0.46, 0.24, 0.04, 0],
		cloth: false,
	},
	kai: {
		yaw: 1.05,
		stride: 0.12,
		sprint: 0.16,
		stance: 0.64,
		lift: 0.022,
		arm: 0.14,
		sway: 0.004,
		joints: [0.47, 0.25, 0.07, 0.025],
		cloth: false,
	},
	nyx: {
		yaw: 0,
		stride: 0.13,
		sprint: 0.17,
		stance: 0.6,
		lift: 0.016,
		arm: 0.12,
		sway: 0.003,
		joints: [0.47, 0.25, 0.045, -0.08],
		centerX: -0.045,
		cloth: true,
	},
}

// Orient the static asset before fitting it; each source uses a different yaw.
export function orientPilot(model, key) {
	const root = new THREE.Group()
	root.rotation.y = (PILOT_GAITS[key] || PILOT_GAITS.zara).yaw
	root.add(model)
	return root
}

// The supplied pilots are static meshes. Animate them on the GPU rather than
// rewriting their million-vertex geometry every frame or changing cached assets.
export class PilotWalk {
	constructor(level, model, character = 'zara') {
		this.profile = PILOT_GAITS[character] || PILOT_GAITS.zara
		const profile = this.profile
		this.level = level
		this.model = model
		this.phase = 0
		this.amount = 0
		this.mode = 'walk'
		this.jumpElapsed = 0
		this.uniforms = {
			walkPhase: { value: 0 },
			walkAmount: { value: 0 },
			walkStride: { value: profile.stride },
			walkStance: { value: profile.stance },
			walkLift: { value: profile.lift },
			walkArm: { value: profile.arm },
			walkSway: { value: profile.sway },
			walkRunBlend: { value: 0 },
			walkJumpAmount: { value: 0 },
			walkJumpTime: { value: 0 },
			walkJoints: {
				value: new THREE.Vector4(...profile.joints),
			},
			walkCloth: { value: profile.cloth ? 1 : 0 },
			walkCenterX: { value: profile.centerX || 0 },
		}
		model.updateMatrixWorld(true)
		const bounds = new THREE.Box3().setFromObject(model)
		this.footOffset = -bounds.min.y
		this.height = bounds.getSize(new THREE.Vector3()).y
		this.strideLength =
			this.height * ((2 * profile.stride) / profile.stance)
		model.traverse((mesh) => {
			if (!mesh.isMesh) return
			// Express the model's common bounds in each mesh's coordinates, so
			// the procedural fallback and single-mesh pilots use the same gait.
			const inverse = mesh.matrixWorld.clone().invert()
			const localBounds = bounds
			const meshToWalk = mesh.matrixWorld.clone()
			const min = localBounds.min.clone()
			const size = localBounds.getSize(new THREE.Vector3())
			const adapt = (source) => {
				const material = level.own(source.clone())
				material.onBeforeCompile = (shader) => {
					Object.assign(
						shader.uniforms,
						this.uniforms,
						{
							walkMin: { value: min },
							walkToMesh: {
								value: inverse,
							},
							meshToWalk: {
								value: meshToWalk,
							},
							walkSize: {
								value: size,
							},
						}
					)
					shader.vertexShader =
						shader.vertexShader.replace(
							'#include <common>',
							`#include <common>
					uniform float walkPhase;
					uniform float walkAmount;
					uniform float walkStride;
 uniform float walkStance; uniform float walkLift; uniform float walkArm; uniform float walkSway; uniform float walkCloth; uniform float walkCenterX;
 uniform float walkRunBlend; uniform float walkJumpAmount; uniform float walkJumpTime;
 uniform vec4 walkJoints; uniform mat4 meshToWalk; uniform mat4 walkToMesh;
					uniform vec3 walkMin;
					uniform vec3 walkSize;
					mat2 gaitRotation(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
					vec3 gait(vec3 p) {
						float h = walkSize.y;
						float runBlend = walkRunBlend;
						float stride = walkStride;
						float stance = mix(walkStance, max(0.43, walkStance - 0.16), runBlend);
						float liftHeight = walkLift * mix(1.0, 3.6, runBlend);
						float armStrength = mix(walkArm, max(walkArm * 2.8, 0.48), runBlend);
						float swayStrength = walkSway * mix(1.0, 1.9, runBlend);
						vec3 q = ((meshToWalk * vec4(p, 1.0)).xyz - walkMin - vec3(walkSize.x * 0.5, 0.0, walkSize.z * 0.5)) / h;
						q.z -= walkJoints.w; q.x -= walkCenterX;
						float side = q.x < 0.0 ? 1.0 : -1.0;
						// A longer stance gives a brief double-support phase. The foot
						// tracks root travel while planted, then swings through softly.
						float cycle = fract(walkPhase / 6.2831853 + (side < 0.0 ? 0.5 : 0.0));
						float swing = clamp((cycle - stance) / (1.0 - stance), 0.0, 1.0);
						float swingEase = swing * swing * swing * (swing * (swing * 6.0 - 15.0) + 10.0);
						float strideZ = cycle < stance ? mix(stride, -stride, cycle / stance) : mix(-stride, stride, swingEase);
						float clearance = pow(sin(swing * 3.14159265), 2.0);
						float lift = clearance * liftHeight;
						// Both legs share one pelvis height. During double support,
						// accommodate the farther planted foot without a deep crouch.
						float otherCycle = fract(cycle + 0.5);
						float planted = cycle < stance ? abs(mix(stride, -stride, cycle / stance)) : 0.0;
						float otherPlanted = otherCycle < stance ? abs(mix(stride, -stride, otherCycle / stance)) : 0.0;
						float supportZ = max(planted, otherPlanted);
						float upper = walkJoints.x - walkJoints.y;
 float lower = walkJoints.y - walkJoints.z;
 float legLength = upper + lower;
 float pelvis = sqrt(legLength * legLength - supportZ * supportZ) - legLength - 0.0003;
						float targetZ = strideZ;
						float targetY = walkJoints.z + lift;
						float vertical = walkJoints.x + pelvis - targetY;
						float reach = clamp(length(vec2(vertical, targetZ)), 0.025, legLength - 0.0001);
						float hip = atan(-targetZ, vertical) - acos(clamp((upper * upper + reach * reach - lower * lower) / (2.0 * upper * reach), -1.0, 1.0));
						float knee = acos(clamp((reach * reach - upper * upper - lower * lower) / (2.0 * upper * lower), -1.0, 1.0));
						// Blend the solved joint angles back to the exact standing pose.
						hip *= walkAmount;
						knee *= walkAmount;
						// Restrict the leg weights to the thighs: low-hanging hands and
						// holster edges must not be treated as an extra leg. Fade the
						// centre seam to zero so adjacent triangles cannot split apart.
						float outerLeg = 1.0 - smoothstep(mix(0.105, 0.17, walkCloth), mix(0.155, 0.21, walkCloth), abs(q.x));
						float thighRegion = smoothstep(0.28, 0.38, q.y);
						float legMask = (1.0 - smoothstep(0.39, 0.49, q.y))
							* mix(1.0, outerLeg, thighRegion)
							* smoothstep(0.0, 0.025, abs(q.x));
						// Nyx's trailing cloak and central tabard are fabric, not limbs.
 float fabric = walkCloth * max(1.0 - smoothstep(-0.14, -0.10, q.z), max(smoothstep(0.17, 0.21, abs(q.x)), (1.0 - smoothstep(0.018, 0.04, abs(q.x))) * smoothstep(0.10, 0.18, q.y)));
 fabric *= 1.0 - smoothstep(0.48, 0.62, q.y);
 legMask *= 1.0 - fabric;
 vec3 rest = q;
						if (legMask > 0.0) {
							vec3 leg = q;
							float footRoll = 0.14 * clearance * cos(swing * 3.14159265) * walkAmount;
							float ankleWeight = 1.0 - smoothstep(walkJoints.z - 0.005, walkJoints.z + 0.035, q.y);
							leg.yz = mix(leg.yz, gaitRotation(-hip - knee + footRoll) * (leg.yz - vec2(walkJoints.z, 0.0)) + vec2(walkJoints.z, 0.0), ankleWeight);
							float kneeWeight = 1.0 - smoothstep(walkJoints.y - 0.02, walkJoints.y + 0.02, q.y);
							leg.yz = mix(leg.yz, gaitRotation(knee) * (leg.yz - vec2(walkJoints.y, 0.0)) + vec2(walkJoints.y, 0.0), kneeWeight);
							leg.yz = gaitRotation(hip) * (leg.yz - vec2(walkJoints.x, 0.0)) + vec2(walkJoints.x, 0.0);
							q = mix(q, leg, legMask);
						}
						{
							float arm = smoothstep(0.125, 0.19, abs(rest.x)) * smoothstep(0.34, 0.43, rest.y) * (1.0 - smoothstep(0.76, 0.87, rest.y));
							float armSwing = (strideZ / max(stride, 0.001)) * armStrength * walkAmount;
							q.yz = mix(q.yz, gaitRotation(armSwing) * (rest.yz - vec2(0.77, 0.0)) + vec2(0.77, 0.0), arm);
						}
						// Transfer weight over the supporting hip while shoulders counter-turn.
						// Fade this above the knees so planted feet remain in place.
						float torso = smoothstep(0.30, 0.58, rest.y);
						q.xz = gaitRotation(cos(walkPhase) * 0.025 * mix(1.0, 2.2, runBlend) * torso * walkAmount) * q.xz;
						q.x += sin(walkPhase) * swayStrength * smoothstep(0.22, 0.48, rest.y) * walkAmount;
						// Run posture: a clearer forward pitch and a small torso bounce.
						q.yz = gaitRotation(0.32 * runBlend * torso * walkAmount) * (q.yz - vec2(0.52, 0.0)) + vec2(0.52, 0.0);
						float runBounce = abs(sin(walkPhase)) * 0.026 * runBlend * walkAmount;
						q.y += runBounce * smoothstep(0.36, 0.62, rest.y);
						q.z += sin(walkPhase - rest.y * 5.0) * 0.012 * fabric * (1.0 - smoothstep(0.15, 0.55, rest.y)) * walkAmount;
 q.y += pelvis * walkAmount;
						// A short anticipation, knee tuck, and held airborne pose make
						// jumping read independently from either ground gait. The pose
						// stays held until Level2 switches back to walk() or run().
						float jumpT = clamp(walkJumpTime, 0.0, 1.0);
						float jumpAnticipation = 1.0 - smoothstep(0.0, 0.12, jumpT);
						float jumpTuck = smoothstep(0.08, 0.22, jumpT) * (1.0 - smoothstep(0.35, 0.52, jumpT));
						float jumpHang = smoothstep(0.18, 0.34, jumpT);
						float jumpKnee = jumpAnticipation * 0.12 + jumpTuck * 0.72 + jumpHang * 0.22;
						float jumpHip = jumpAnticipation * 0.08 - jumpTuck * 0.16 - jumpHang * 0.055;
						vec3 jumped = rest;
						vec3 jumpLeg = rest;
						float jumpKneeWeight = 1.0 - smoothstep(walkJoints.y - 0.02, walkJoints.y + 0.02, rest.y);
						jumpLeg.yz = mix(jumpLeg.yz, gaitRotation(jumpKnee) * (jumpLeg.yz - vec2(walkJoints.y, 0.0)) + vec2(walkJoints.y, 0.0), jumpKneeWeight);
						jumpLeg.yz = gaitRotation(jumpHip) * (jumpLeg.yz - vec2(walkJoints.x, 0.0)) + vec2(walkJoints.x, 0.0);
						jumped = mix(jumped, jumpLeg, legMask);
						float jumpArm = smoothstep(0.125, 0.19, abs(rest.x)) * smoothstep(0.34, 0.43, rest.y) * (1.0 - smoothstep(0.76, 0.87, rest.y));
						float armRaise = 0.52 * jumpHang + 0.22 * jumpTuck;
						vec2 raisedArm = gaitRotation(-side * armRaise) * (jumped.xy - vec2(side * 0.14, 0.77)) + vec2(side * 0.14, 0.77);
						jumped.xy = mix(jumped.xy, raisedArm, jumpArm);
						jumped.z -= jumpArm * (0.012 + 0.018 * jumpTuck);
						float jumpTorso = smoothstep(0.4, 0.62, rest.y);
						jumped.yz = gaitRotation(-0.045 * (jumpTuck + 0.2 * jumpHang) * jumpTorso) * (jumped.yz - vec2(0.52, 0.0)) + vec2(0.52, 0.0);
						jumped.y -= jumpAnticipation * 0.018 * (1.0 - smoothstep(0.56, 0.75, rest.y));
						q = mix(q, jumped, walkJumpAmount);
 q.z += walkJoints.w; q.x += walkCenterX;
						return (walkToMesh * vec4(q * h + walkMin + vec3(walkSize.x * 0.5, 0.0, walkSize.z * 0.5), 1.0)).xyz;
					}`
						)
					shader.vertexShader =
						shader.vertexShader.replace(
							'#include <begin_vertex>',
							'vec3 transformed = gait(position);'
						)
					// Transform the surface normal with the same local deformation.
					shader.vertexShader =
						shader.vertexShader.replace(
							'#include <beginnormal_vertex>',
							`
					vec3 n = normalize(normal);
					vec3 tangent = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
					vec3 bitangent = cross(n, tangent);
					float epsilon = walkSize.y * 0.001;
					vec3 origin = gait(position);
					vec3 objectNormal = normalize(cross(gait(position + tangent * epsilon) - origin, gait(position + bitangent * epsilon) - origin));
					#ifdef USE_TANGENT
					vec3 objectTangent = vec3(tangent.xyz);
					#endif`
						)
				}
				material.customProgramCacheKey = () =>
					'level2-pilot-animation-v8'
				return material
			}
			mesh.material = Array.isArray(mesh.material)
				? mesh.material.map(adapt)
				: adapt(mesh.material)
			// Static shadow geometry would otherwise show motionless legs.
			mesh.customDepthMaterial = adapt(
				new THREE.MeshDepthMaterial({
					depthPacking: THREE.RGBADepthPacking,
				})
			)
			mesh.geometry.computeBoundingSphere()
			mesh.frustumCulled = false
		})
	}

	walk() {
		this.mode = 'walk'
	}

	run() {
		this.mode = 'run'
	}

	jump() {
		// Level2 calls this while airborne. Do not restart the jump timeline
		// every frame; only the transition into jump begins a new animation.
		if (this.mode !== 'jump') {
			this.mode = 'jump'
			this.jumpElapsed = 0
		}
	}

	update(delta, distance, boarded) {
		if (boarded) {
			this.mode = 'walk'
			this.jumpElapsed = 0
		}
		const moving = !boarded && distance > 0.0001
		this.amount = boarded
			? 0
			: THREE.MathUtils.damp(
					this.amount,
					moving ? 1 : 0,
					16,
					delta
				)

		const running = !boarded && this.mode === 'run'
		const jumping = !boarded && this.mode === 'jump'
		this.uniforms.walkRunBlend.value = THREE.MathUtils.damp(
			this.uniforms.walkRunBlend.value,
			running ? 1 : 0,
			8,
			delta
		)
		this.uniforms.walkJumpAmount.value = THREE.MathUtils.damp(
			this.uniforms.walkJumpAmount.value,
			jumping ? 1 : 0,
			14,
			delta
		)
		if (jumping) this.jumpElapsed += delta
		this.uniforms.walkJumpTime.value = Math.min(this.jumpElapsed, 1.0)

		// Preserve the established walk stride response. Running explicitly
		// selects the sprint stride and gets its own shorter contact phase,
		// stronger arm pump, higher leg lift, and forward-leaning torso.
		const speed = delta > 0 ? distance / delta : 0
		const strideTarget = running
			? this.profile.sprint
			: THREE.MathUtils.lerp(
					this.profile.stride,
					this.profile.sprint,
					THREE.MathUtils.clamp((speed - 2.8) / 2.8, 0, 1)
				)
		this.uniforms.walkStride.value = THREE.MathUtils.damp(
			this.uniforms.walkStride.value,
			strideTarget,
			8,
			delta
		)
		const stance = THREE.MathUtils.lerp(
			this.profile.stance,
			Math.max(0.43, this.profile.stance - 0.16),
			this.uniforms.walkRunBlend.value
		)
		this.strideLength =
			this.height *
			((this.uniforms.walkStride.value * 2) / stance)
		// Match root travel to the stance-foot path to avoid skating.
		if (moving)
			this.phase +=
				(distance / this.strideLength) * Math.PI * 2
		this.uniforms.walkPhase.value = this.phase
		this.uniforms.walkAmount.value = this.amount
	}
}
