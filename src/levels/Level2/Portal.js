import * as THREE from 'three'

/**
 * Level 2 escape portal — the mission's win condition.
 *
 * A stargate-style ring standing on the terrain, built entirely from
 * procedural geometry (the project ships no portal asset): a faceted
 * metal torus with emissive glow, an additive halo, a slowly swirling
 * vortex disc, orbiting stud lights, a tall beacon beam that marks it
 * from across the planet, a ground ring and a point light.
 *
 * Level 2 watches the player's distance to the gate; playArrival()
 * fires the burst when the player steps through it.
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
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	float angle = atan(p.y, p.x);
	// Two counter-rotating bands drift around the disc; the arrival
	// burst spins them up and brightens everything.
	float spin = uTime * (1.5 + uBurst * 5.0);
	float swirl = sin(angle * 3.0 + spin - r * 9.0);
	float ribbons = sin(angle * 5.0 - spin * 0.6 + r * 14.0);
	float pattern = swirl * 0.5 + ribbons * 0.5;
	float glow = smoothstep(1.0, 0.1, r);
	float rim = smoothstep(0.6, 1.0, r);
	vec3 deep = vec3(0.05, 0.34, 0.6);
	vec3 bright = vec3(0.72, 0.97, 1.0);
	vec3 color = mix(deep, bright, clamp(pattern * 0.5 + 0.5, 0.0, 1.0));
	float alpha = glow * (0.2 + 0.28 * pattern) + rim * 0.25 + uBurst * 0.5;
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
		const burst = THREE.MathUtils.clamp(this._arrivalT / 1.5, 0, 1)

		this.vortexUniforms.uTime.value = this.time
		this.vortexUniforms.uBurst.value = burst
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
	}

	/** Fires the celebration burst when the player steps through. */
	playArrival() {
		this._arrivalT = 1.5
	}
}
