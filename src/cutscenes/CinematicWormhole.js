import * as THREE from 'three'

const RADIUS = 34
const MOTE_COUNT = 96
const TAU = Math.PI * 2

const VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float radius = length(p);
	float angle = atan(p.y, p.x);
	// The distorted accretion bands stream toward the dark throat, rather
	// than filling the opening with an opaque white flash.
	float distortion = sin(angle * 3.0 + uTime * 0.37) * 0.018
		+ sin(angle * 7.0 - uTime * 0.23 + radius * 12.0) * 0.009;
	float r = radius + distortion * smoothstep(0.25, 0.85, radius);
	float spin = uTime * (0.32 + uIntensity * 0.42);
	float spiral = pow(max(0.0, sin(angle * 3.0 + r * 16.0 + spin)), 5.0);
	float counterSpiral = pow(max(0.0, sin(angle * 5.0 - r * 22.0 - spin * 0.6)), 9.0);
	float flow = pow(max(0.0, sin(r * 38.0 + uTime * (1.8 + uIntensity * 2.0))), 8.0);
	float accretion = smoothstep(0.34, 0.78, r) * (1.0 - smoothstep(0.9, 1.0, r));
	float rim = exp(-pow((r - 0.94) * 34.0, 2.0));
	vec3 violet = vec3(0.28, 0.075, 0.72);
	vec3 blue = vec3(0.08, 0.53, 0.95);
	vec3 color = vec3(0.001, 0.002, 0.008);
	float hue = 0.5 + 0.5 * sin(angle * 2.0 + r * 9.0 - uTime * 0.12);
	vec3 stream = mix(violet, blue, hue);
	color += stream * accretion * (0.11 + spiral * 0.55 + counterSpiral * 0.2 + flow * 0.14);
	color += mix(blue, vec3(0.62, 0.78, 1.0), uIntensity * 0.45) * rim * 1.4;
	color *= 1.0 + uIntensity * 0.65;
	// Opaque depth is intentional: the ship remains visible on the near
	// side, then disappears naturally when it passes through the plane.
	gl_FragColor = vec4(color, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`

/** A self-contained space aperture. Its local entry axis is -Z, with the
 * camera and approaching ship on the +Z side. The host owns its transform;
 * this class owns only the procedural resources created below.
 */
export class CinematicWormhole {
	constructor() {
		this.radius = RADIUS
		this.group = new THREE.Group()
		this.group.name = 'cinematic-wormhole'
		this.time = 0
		this.intensity = 0
		this._disposed = false
		this._owned = new Set()
		this.uniforms = {
			uTime: { value: 0 },
			uIntensity: { value: 0 },
		}

		const apertureMaterial = this._own(
			new THREE.ShaderMaterial({
				uniforms: this.uniforms,
				vertexShader: VERTEX,
				fragmentShader: FRAGMENT,
				side: THREE.DoubleSide,
				depthWrite: true,
				depthTest: true,
			})
		)
		this.aperture = new THREE.Mesh(
			this._own(new THREE.CircleGeometry(RADIUS, 96)),
			apertureMaterial
		)
		this.aperture.name = 'wormhole-throat'
		this.group.add(this.aperture)

		this.rimMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x101025,
				metalness: 0.65,
				roughness: 0.28,
				emissive: 0x5144cc,
				emissiveIntensity: 0.85,
				fog: false,
			})
		)
		const rim = new THREE.Mesh(
			this._own(new THREE.TorusGeometry(RADIUS, 1.0, 10, 96)),
			this.rimMaterial
		)
		rim.name = 'wormhole-accretion-rim'
		this.group.add(rim)

		this.haloMaterial = this._own(
			new THREE.MeshBasicMaterial({
				color: 0x555cff,
				transparent: true,
				opacity: 0.16,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
				fog: false,
			})
		)
		const halo = new THREE.Mesh(
			this._own(new THREE.TorusGeometry(RADIUS, 2.3, 10, 96)),
			this.haloMaterial
		)
		halo.name = 'wormhole-halo'
		this.group.add(halo)

		this._motePositions = new Float32Array(MOTE_COUNT * 3)
		const colors = new Float32Array(MOTE_COUNT * 3)
		for (let i = 0; i < MOTE_COUNT; i++) {
			colors[i * 3] = i % 3 === 0 ? 0.52 : 0.18
			colors[i * 3 + 1] = i % 3 === 0 ? 0.35 : 0.68
			colors[i * 3 + 2] = 1
		}
		this.moteGeometry = this._own(new THREE.BufferGeometry())
		this.moteGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(
				this._motePositions,
				3
			).setUsage(THREE.DynamicDrawUsage)
		)
		this.moteGeometry.setAttribute(
			'color',
			new THREE.BufferAttribute(colors, 3)
		)
		this.moteMaterial = this._own(
			new THREE.PointsMaterial({
				vertexColors: true,
				size: 0.32,
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.6,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
				fog: false,
			})
		)
		const motes = new THREE.Points(
			this.moteGeometry,
			this.moteMaterial
		)
		motes.name = 'wormhole-infall-motes'
		motes.frustumCulled = false
		this.group.add(motes)

		this.light = new THREE.PointLight(0x6974ff, 8, RADIUS * 5, 2)
		this.light.position.z = 5
		this.group.add(this.light)
		this.update(0)
	}

	_own(resource) {
		this._owned.add(resource)
		return resource
	}

	setIntensity(value) {
		if (this._disposed) return
		this.intensity = Number.isFinite(value)
			? THREE.MathUtils.clamp(value, 0, 1)
			: 0
		this.uniforms.uIntensity.value = this.intensity
		this.rimMaterial.emissiveIntensity = 0.85 + this.intensity * 1.1
		this.haloMaterial.opacity = 0.16 + this.intensity * 0.16
		this.moteMaterial.opacity = 0.6 + this.intensity * 0.2
		this.light.intensity = 8 + this.intensity * 10
	}

	update(delta) {
		if (this._disposed) return
		const dt = Number.isFinite(delta)
			? Math.max(0, Math.min(delta, 0.25))
			: 0
		this.time = (this.time + dt) % 3600
		this.uniforms.uTime.value = this.time
		for (let i = 0; i < MOTE_COUNT; i++) {
			const phase =
				(i * 0.61803398875 + this.time * 0.075) % 1
			const radius = RADIUS * (1.15 - phase * 0.66)
			const angle =
				i * 2.39996323 + this.time * 0.22 + phase * TAU
			this._motePositions[i * 3] = Math.cos(angle) * radius
			this._motePositions[i * 3 + 1] =
				Math.sin(angle) * radius
			this._motePositions[i * 3 + 2] = 0.6 + (1 - phase) * 3.8
		}
		this.moteGeometry.attributes.position.needsUpdate = true
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		this.group.removeFromParent()
		this.group.clear()
		for (const resource of this._owned) resource.dispose()
		this._owned.clear()
	}
}
