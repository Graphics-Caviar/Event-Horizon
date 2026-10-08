import * as THREE from 'three'

const START = -270
const END = 220
// Uneven meanders: broad loops interrupted by tighter changes of direction.
const BENDS = [-112, -172, -88, -138, -66, -153, -98]

function channelCenter(t) {
	const progress = t * (BENDS.length - 1)
	const i = Math.min(BENDS.length - 2, Math.floor(progress))
	const u = progress - i
	const a = BENDS[Math.max(0, i - 1)],
		b = BENDS[i]
	const c = BENDS[i + 1],
		d = BENDS[Math.min(BENDS.length - 1, i + 2)]
	// Catmull-Rom interpolation preserves a continuous bank through each bend.
	return (
		0.5 *
		(2 * b +
			(-a + c) * u +
			(2 * a - 5 * b + 4 * c - d) * u * u +
			(-a + 3 * b - 3 * c + d) * u * u * u)
	)
}

/** Shared channel profile: downhill from the northern vent to the basin. */
export function lavaChannelAt(z, baseY = -140) {
	const t = THREE.MathUtils.clamp((z - START) / (END - START), 0, 1)
	const taper = Math.min(
		THREE.MathUtils.smoothstep(t, 0, 0.045),
		1 - THREE.MathUtils.smoothstep(t, 0.95, 1)
	)
	return {
		active: z > START && z < END,
		x: channelCenter(t) + Math.sin(z / 13) * 2.2,
		y: baseY + 18 - t * 18,
		halfWidth:
			(8 +
				Math.sin(z / 29) * 2.8 +
				Math.sin(z / 11 + 0.8) * 1.2) *
			taper,
		taper,
	}
}

export function carveLavaChannel(x, z, height, baseY) {
	const channel = lavaChannelAt(z, baseY)
	if (!channel.active) return height
	const distance = Math.abs(x - channel.x)
	// A shallow bed opens onto a broad, nearly level lava plain.
	// The shore sits only 20 cm above the molten surface, without levees.
	const bank = THREE.MathUtils.smoothstep(
		distance,
		channel.halfWidth + 0.5,
		channel.halfWidth + 4
	)
	const bed = channel.y - 0.9 + bank * 1.1 + (1 - channel.taper) * 1.6
	const blend =
		1 -
		THREE.MathUtils.smoothstep(
			distance,
			channel.halfWidth + 30,
			channel.halfWidth + 80
		)
	return THREE.MathUtils.lerp(height, bed, blend)
}

/** Animated molten crust, bank glow and rising embers; no external assets. */
export class LavaStream {
	constructor(planet) {
		this.time = 0
		this.planet = planet
		const { level } = planet
		const positions = [],
			uvs = [],
			indices = []
		const segments = 320
		for (let i = 0; i <= segments; i++) {
			const z = THREE.MathUtils.lerp(
				START + 3,
				END - 3,
				i / segments
			)
			const channel = lavaChannelAt(z, planet.baseY)
			for (const side of [-1, 1]) {
				positions.push(
					channel.x + channel.halfWidth * side,
					channel.y,
					z
				)
				uvs.push((side + 1) / 2, (z - START) / 18)
			}
			if (i < segments) {
				const a = i * 2
				indices.push(
					a,
					a + 2,
					a + 1,
					a + 1,
					a + 2,
					a + 3
				)
			}
			// Keep the current on-foot controller on solid banks.
			if (i % 4 === 0 && channel.halfWidth > 1)
				planet.colliders.push({
					x: channel.x,
					z,
					radius: channel.halfWidth + 1.5,
					type: 'lava',
					enabled: true,
				})
		}
		const geometry = level.own(new THREE.BufferGeometry())
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(positions, 3)
		)
		geometry.setAttribute(
			'uv',
			new THREE.Float32BufferAttribute(uvs, 2)
		)
		geometry.setIndex(indices)
		geometry.computeBoundingSphere()
		this.material = level.own(
			new THREE.ShaderMaterial({
				fog: true,
				uniforms: THREE.UniformsUtils.merge([
					THREE.UniformsLib.fog,
					{ time: { value: 0 } },
				]),
				vertexShader: `
				varying vec2 vUv;
				#include <fog_pars_vertex>
				void main() {
					vUv = uv;
					vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
					gl_Position = projectionMatrix * mvPosition;
					#include <fog_vertex>
				}`,
				fragmentShader: `
				uniform float time;
				varying vec2 vUv;
				#include <fog_pars_fragment>
				float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
				float noise(vec2 p) {
					vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
					return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
				}
				void main() {
					vec2 flow = vec2(vUv.x * 7.0, vUv.y - time * 0.24);
					flow.x += sin(flow.y * 1.8 + time * 0.25) * 0.35;
					float n = noise(flow * 2.0) * 0.65 + noise(flow * 5.0) * 0.35;
					float seams = 1.0 - smoothstep(0.025, 0.14, abs(n - 0.5));
					float crust = smoothstep(0.53, 0.7, n);
					float banks = smoothstep(0.28, 0.5, abs(vUv.x - 0.5));
					vec3 molten = mix(vec3(1.8,0.12,0.006),vec3(5.0,1.5,0.09),seams);
					vec3 color = mix(molten,vec3(0.07,0.009,0.003),max(crust * 0.9,banks * 0.96));
					gl_FragColor = vec4(color,1.0);
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <fog_fragment>
				}`,
			})
		)
		this.mesh = new THREE.Mesh(geometry, this.material)
		this.mesh.name = 'flowing-lava-stream'
		planet.root.add(this.mesh)
		this.lights = []
		for (const z of [-180, -30, 115]) {
			const c = lavaChannelAt(z, planet.baseY)
			const light = new THREE.PointLight(
				0xff4b08,
				100,
				48,
				1.5
			)
			light.position.set(c.x, c.y + 4, z)
			planet.root.add(light)
			this.lights.push(light)
		}
		const emberGeometry = level.own(new THREE.BufferGeometry())
		this.emberPositions = new Float32Array(96 * 3)
		emberGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this.emberPositions, 3)
		)
		const emberMaterial = level.own(
			new THREE.ShaderMaterial({
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				vertexShader: `void main() {
				vec4 p = modelViewMatrix * vec4(position,1.0);
				gl_Position = projectionMatrix * p;
				gl_PointSize = clamp(160.0 / max(1.0,-p.z), 1.0, 7.0);
			}`,
				fragmentShader: `void main() {
				float d = length(gl_PointCoord - 0.5);
				gl_FragColor = vec4(1.0,0.24,0.015,(1.0-smoothstep(0.05,0.5,d))*0.8);
			}`,
			})
		)
		this.embers = new THREE.Points(emberGeometry, emberMaterial)
		this.embers.name = 'lava-embers'
		// A fixed bound contains every particle throughout its rise.
		emberGeometry.boundingSphere = new THREE.Sphere(
			new THREE.Vector3(-120, planet.baseY + 18, -25),
			290
		)
		planet.root.add(this.embers)
		this.update(0)
	}

	update(delta) {
		this.time += delta
		this.material.uniforms.time.value = this.time
		for (let i = 0; i < 96; i++) {
			const age = (this.time * 0.12 + i * 0.61803398875) % 1
			const z =
				START + 25 + ((i * 73.17) % (END - START - 50))
			const c = lavaChannelAt(z, this.planet.baseY)
			this.emberPositions[i * 3] =
				c.x +
				Math.sin(i * 2.3) * c.halfWidth * 0.7 +
				age * 4
			this.emberPositions[i * 3 + 1] = c.y + 0.3 + age * 11
			this.emberPositions[i * 3 + 2] = z + age * 3
		}
		this.embers.geometry.attributes.position.needsUpdate = true
		this.lights.forEach((light, i) => {
			light.intensity =
				100 + Math.sin(this.time * 2.4 + i) * 12
		})
	}
}
