import * as THREE from 'three'

/**
 * Level 2 escape portal — the mission's win condition.
 *
 * A wormhole gate standing on the terrain, built entirely from procedural
 * geometry (the project ships no portal asset): a faceted metal torus with
 * emissive glow, an additive halo, a vortex disc whose bands stream inward
 * around a dark throat, motes spiraling into the hole, orbiting stud
 * lights, a tall beacon beam that marks it from across the planet, a
 * ground ring and a point light.
 *
 * Level 2 watches the player's distance to the gate and pulls anything
 * nearby in: suckLevel (0..1, set every frame while the suction is
 * active) spins the vortex up and brightens the infall; playArrival()
 * fires the burst when the player finally steps through.
 */

const RING_RADIUS = 8
const RING_TUBE = 0.85
const RING_SINK = 0.5 // how far the torus sinks into the ground
const BEAM_HEIGHT = 240

const COLOR_GLOW = 0x2fd7ff
const COLOR_CORE = 0xbdf6ff

const VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
uniform float uTime;
uniform float uBurst;
uniform float uSuck;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	float angle = atan(p.y, p.x);
	// Wormhole throat: bands stream inward while counter-rotating spiral
	// arms shear them; the suction spins and brightens everything up.
	float spin = uTime * (1.2 + uBurst * 4.0 + uSuck * 2.5);
	float flow = fract(r * 3.0 - uTime * (0.9 + uSuck * 1.4 + uBurst * 2.0));
	float band = smoothstep(0.0, 0.45, flow) * smoothstep(1.0, 0.55, flow);
	float arms = sin(angle * 3.0 + spin + r * 7.0) * 0.5 + 0.5;
	float arms2 = sin(angle * 5.0 - spin * 0.7 - r * 11.0) * 0.5 + 0.5;
	float m = band * (0.45 + 0.55 * arms) + arms2 * 0.25;
	vec3 deep = vec3(0.02, 0.05, 0.16);
	vec3 mid = vec3(0.10, 0.45, 0.85);
	vec3 hot = vec3(0.75, 0.96, 1.0);
	vec3 color = mix(deep, mid, smoothstep(0.0, 0.6, r));
	color = mix(color, hot, clamp(m, 0.0, 1.0) * smoothstep(0.15, 0.75, r));
	// Violet accretion shading toward the rim.
	color += vec3(0.25, 0.10, 0.45) * smoothstep(0.55, 1.0, r) * 0.5;
	// The throat itself stays dark: with additive blending that reads as
	// a hole punched through space, not a glowing disc.
	float throat = 1.0 - smoothstep(0.10, 0.30, r);
	color *= 1.0 - throat * 0.85;
	float glow = smoothstep(1.0, 0.1, r);
	float rim = smoothstep(0.6, 1.0, r);
	float alpha =
		glow * (0.5 + 0.34 * m) + rim * 0.25 + uBurst * 0.5 + uSuck * 0.15;
	gl_FragColor = vec4(color * (1.0 + uBurst * 1.5), alpha);
}
`

export class Portal {
	/**
	 * @param {object} level
	 * @param {object} options
	 * @param {THREE.Vector3} options.position ground position (y ignored)
	 * @param {THREE.Vector3} [options.faceTowards] point the gate faces
	 */
	constructor(level, { position, faceTowards } = {}) {
		this.level = level
		this.time = 0
		this._arrivalT = 0
		// 0..1, driven by Level2 while its suction field is pulling things in.
		this.suckLevel = 0

		this.group = new THREE.Group()
		this.group.name = 'escape-portal'
		this.group.position.set(
			position.x,
			level.planet.heightAt(position.x, position.z),
			position.z
		)
		if (faceTowards) {
			this.group.rotation.y = Math.atan2(
				faceTowards.x - position.x,
				faceTowards.z - position.z
			)
		}
		level.addObject(this.group)

		const centerY = RING_RADIUS + RING_TUBE - RING_SINK

		// --- Faceted structural ring -----------------------------------
		this.structureMaterial = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x10262e,
				metalness: 0.75,
				roughness: 0.32,
				emissive: COLOR_GLOW,
				emissiveIntensity: 0.4,
				flatShading: true,
			})
		)
		const structure = new THREE.Mesh(
			level.own(
				new THREE.TorusGeometry(
					RING_RADIUS,
					RING_TUBE,
					12,
					36
				)
			),
			this.structureMaterial
		)
		structure.position.y = centerY
		structure.castShadow = true
		this.group.add(structure)

		// --- Additive halo hugging the same torus ----------------------
		this.haloMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: COLOR_GLOW,
				transparent: true,
				opacity: 0.3,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const halo = new THREE.Mesh(
			level.own(
				new THREE.TorusGeometry(
					RING_RADIUS,
					RING_TUBE * 1.8,
					10,
					40
				)
			),
			this.haloMaterial
		)
		halo.position.y = centerY
		halo.renderOrder = 4
		this.group.add(halo)

		// --- Vortex disc ------------------------------------------------
		this.vortexUniforms = {
			uTime: { value: 0 },
			uBurst: { value: 0 },
			uSuck: { value: 0 },
		}
		const vortex = new THREE.Mesh(
			level.own(
				new THREE.CircleGeometry(
					RING_RADIUS - RING_TUBE * 0.4,
					48
				)
			),
			level.own(
				new THREE.ShaderMaterial({
					uniforms: this.vortexUniforms,
					vertexShader: VERTEX,
					fragmentShader: FRAGMENT,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					side: THREE.DoubleSide,
				})
			)
		)
		vortex.position.y = centerY
		vortex.renderOrder = 5
		this.group.add(vortex)

		// --- Dark throat -------------------------------------------------
		// A near-black disc just behind the vortex; against the additive
		// swirl it reads as an actual hole punched through space.
		this.throatMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: 0x010409,
				transparent: true,
				opacity: 0.92,
			})
		)
		const throat = new THREE.Mesh(
			level.own(
				new THREE.CircleGeometry(
					RING_RADIUS - RING_TUBE * 0.4,
					48
				)
			),
			this.throatMaterial
		)
		throat.position.set(0, centerY, -0.06)
		throat.renderOrder = 3
		this.group.add(throat)

		// --- Infall streaks -----------------------------------------------
		// Motes spiraling from the rim into the throat; they sell the
		// suction far better than the disc alone.
		const STREAK_COUNT = 90
		this._streakCount = STREAK_COUNT
		this._streakRadius = new Float32Array(STREAK_COUNT)
		this._streakAngle = new Float32Array(STREAK_COUNT)
		this._streakSpeed = new Float32Array(STREAK_COUNT)
		this._streakPositions = new Float32Array(STREAK_COUNT * 3)
		for (let i = 0; i < STREAK_COUNT; i++) {
			this._streakAngle[i] = Math.random() * Math.PI * 2
			this._streakRadius[i] =
				RING_RADIUS * (0.3 + Math.random() * 0.85)
			this._streakSpeed[i] = 1.6 + Math.random() * 2.4
		}
		this.streakGeometry = level.own(new THREE.BufferGeometry())
		this.streakGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this._streakPositions, 3)
		)
		this.streakMaterial = level.own(
			new THREE.PointsMaterial({
				color: COLOR_CORE,
				size: 0.42,
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.85,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this.streaks = new THREE.Points(
			this.streakGeometry,
			this.streakMaterial
		)
		this.streaks.position.set(0, centerY, 0.35)
		this.streaks.renderOrder = 6
		this.streaks.frustumCulled = false
		this.group.add(this.streaks)

		// --- Stud lights slowly orbiting the ring -----------------------
		this.detail = new THREE.Group()
		this.detail.position.y = centerY
		const studGeometry = level.own(
			new THREE.BoxGeometry(0.7, 0.7, 1.4)
		)
		this.studMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: COLOR_CORE,
				transparent: true,
				opacity: 0.85,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		for (let i = 0; i < 8; i++) {
			const angle = (i / 8) * Math.PI * 2
			const stud = new THREE.Mesh(
				studGeometry,
				this.studMaterial
			)
			stud.position.set(
				Math.cos(angle) * RING_RADIUS,
				Math.sin(angle) * RING_RADIUS,
				0
			)
			stud.rotation.z = angle
			stud.renderOrder = 6
			this.detail.add(stud)
		}
		this.group.add(this.detail)

		// --- Beacon beam ------------------------------------------------
		this.beamMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: COLOR_GLOW,
				transparent: true,
				opacity: 0.15,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				depthWrite: false,
			})
		)
		const beam = new THREE.Mesh(
			level.own(
				new THREE.CylinderGeometry(
					1.4,
					3.0,
					BEAM_HEIGHT,
					16,
					1,
					true
				)
			),
			this.beamMaterial
		)
		beam.position.y = BEAM_HEIGHT / 2
		beam.renderOrder = 4
		this.group.add(beam)

		// --- Ground ring -------------------------------------------------
		this.groundRingMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: COLOR_GLOW,
				transparent: true,
				opacity: 0.4,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				depthWrite: false,
			})
		)
		this.groundRing = new THREE.Mesh(
			level.own(
				new THREE.RingGeometry(
					RING_RADIUS + 1.6,
					RING_RADIUS + 3.2,
					56
				)
			),
			this.groundRingMaterial
		)
		this.groundRing.rotation.x = -Math.PI / 2
		this.groundRing.position.y = 0.4
		this.groundRing.renderOrder = 4
		this.group.add(this.groundRing)

		this.light = new THREE.PointLight(COLOR_GLOW, 4, 110, 2)
		this.light.position.y = 12
		this.group.add(this.light)
	}

	update(delta) {
		this.time += delta
		if (this._arrivalT > 0) {
			this._arrivalT = Math.max(0, this._arrivalT - delta)
		}
		// Decays so the swirl winds down gracefully if suction stops.
		this.suckLevel = Math.max(0, this.suckLevel - delta * 2)
		const burst = THREE.MathUtils.clamp(this._arrivalT / 1.5, 0, 1)
		const suck = THREE.MathUtils.clamp(this.suckLevel, 0, 1)

		this.vortexUniforms.uTime.value = this.time
		this.vortexUniforms.uBurst.value = burst
		this.vortexUniforms.uSuck.value = suck
		this.detail.rotation.z += delta * (0.25 + burst * 2.0)
		this.structureMaterial.emissiveIntensity =
			0.4 + Math.sin(this.time * 2.2) * 0.1 + burst * 1.2
		this.haloMaterial.opacity =
			0.28 + Math.sin(this.time * 2.2) * 0.07 + burst * 0.35
		this.beamMaterial.opacity =
			0.14 + Math.sin(this.time * 1.6) * 0.04 + burst * 0.3
		this.groundRingMaterial.opacity =
			0.34 + Math.sin(this.time * 2.4) * 0.08 + burst * 0.4
		this.groundRing.scale.setScalar(
			1 + Math.sin(this.time * 2.0) * 0.04 + burst * 0.2
		)
		this.light.intensity =
			3.6 + Math.sin(this.time * 1.8) * 0.7 + burst * 16
		this.throatMaterial.opacity =
			0.86 + Math.sin(this.time * 1.4) * 0.05 - suck * 0.1

		// Motes spiral inward and respawn at the rim.
		const streakSpin = 1.4 + burst * 5 + suck * 3
		for (let i = 0; i < this._streakCount; i++) {
			this._streakRadius[i] -=
				this._streakSpeed[i] * delta * (1 + suck * 2.2)
			if (this._streakRadius[i] < 0.4) {
				this._streakRadius[i] =
					RING_RADIUS *
					(0.85 + Math.random() * 0.3)
				this._streakAngle[i] =
					Math.random() * Math.PI * 2
			}
			this._streakAngle[i] +=
				(streakSpin * delta) /
				Math.max(0.5, this._streakRadius[i])
			const p = i * 3
			this._streakPositions[p] =
				Math.cos(this._streakAngle[i]) *
				this._streakRadius[i]
			this._streakPositions[p + 1] =
				Math.sin(this._streakAngle[i]) *
				this._streakRadius[i]
			this._streakPositions[p + 2] = (i % 5) * 0.04
		}
		this.streakGeometry.attributes.position.needsUpdate = true
		this.streakMaterial.opacity =
			0.65 +
			Math.sin(this.time * 2.1) * 0.1 +
			burst * 0.3 +
			suck * 0.25
	}

	/** Fires the celebration burst when the player steps through. */
	playArrival() {
		this._arrivalT = 1.5
	}
}
