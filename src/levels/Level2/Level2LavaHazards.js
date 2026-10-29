import * as THREE from 'three'

const AREA_LAYOUT = [
	{
		id: 'initial-approach',
		pools: [{ x: 180, z: 105, rx: 30, rz: 22, rotation: -0.2 }],
		rocks: [
			{ x: 142, z: 78, radius: 5, height: 12 },
			{ x: 214, z: 83, radius: 7, height: 17 },
		],
	},
	{
		id: 'rocky-passage',
		pools: [
			{ x: 355, z: 315, rx: 78, rz: 15, rotation: 0.62 },
			{ x: 420, z: 372, rx: 61, rz: 13, rotation: 0.62 },
		],
		rocks: [
			{ x: 300, z: 275, radius: 8, height: 21 },
			{ x: 384, z: 270, radius: 6, height: 14 },
			{ x: 455, z: 431, radius: 9, height: 24 },
		],
	},
	{
		id: 'volcanic-valley',
		pools: [
			{ x: 550, z: 605, rx: 116, rz: 72, rotation: -0.12 },
			{ x: 700, z: 650, rx: 72, rz: 34, rotation: 0.28 },
		],
		rocks: [
			{ x: 430, z: 628, radius: 10, height: 25 },
			{ x: 655, z: 719, radius: 7, height: 18 },
			{ x: 743, z: 613, radius: 9, height: 23 },
		],
	},
	{
		id: 'space-hub-approach',
		pools: [
			{ x: 875, z: 1118, rx: 72, rz: 34, rotation: -0.1 },
			{ x: 1115, z: 1080, rx: 68, rz: 35, rotation: 0.16 },
		],
		rocks: [
			{ x: 795, z: 1120, radius: 9, height: 22 },
			{ x: 1178, z: 1090, radius: 8, height: 20 },
		],
	},
]

const ellipseContains = (x, z, zone, margin = 0) => {
	const dx = x - zone.x
	const dz = z - zone.z
	const cos = Math.cos(zone.rotation)
	const sin = Math.sin(zone.rotation)
	const localX = dx * cos + dz * sin
	const localZ = -dx * sin + dz * cos
	const rx = zone.rx + margin
	const rz = zone.rz + margin
	return (localX / rx) ** 2 + (localZ / rz) ** 2 <= 1
}

/** Level 2's additional animated lava fields, separate from Level 3 terrain. */
export class Level2LavaHazards {
	constructor(level) {
		this.level = level
		this.planet = level.planet
		this.time = 0
		this.areas = AREA_LAYOUT.map((area) => ({
			id: area.id,
			pools: area.pools.map((pool) => ({
				...pool,
				x: level.landingSite.x + pool.x,
				z: level.landingSite.z + pool.z,
			})),
			rocks: area.rocks.map((rock) => ({
				...rock,
				x: level.landingSite.x + rock.x,
				z: level.landingSite.z + rock.z,
			})),
		}))
		// The older pools are mostly beside the road. Place three actual
		// crossings from the same route used by the rover guideline, so
		// changing the course cannot leave lava stranded on the sidelines.
		this.crossings = this._createRouteCrossings()
		this.zones = [
			...this.areas.flatMap((area) => area.pools),
			...this.crossings,
		]
		this.root = new THREE.Group()
		this.root.name = 'level2-volcanic-hazards'
		this.planet.root.add(this.root)
		this.colliders = []
		this.bubbles = []
		this.lights = []
		this._buildLavaSurface()
		this._buildVolcanicRocks()
		this._buildBubbles()
		this._buildEmbers()
	}


	_createRouteCrossings() {
		const points = this.level.roverApproach?.points
		if (!points || points.length < 8) return []
		return [
			{ from: 2, to: 3, fraction: 0.48, width: 70, depth: 15 },
			{ from: 4, to: 5, fraction: 0.58, width: 82, depth: 18 },
			{ from: 6, to: 7, fraction: 0.48, width: 76, depth: 17 },
		].map(({ from, to, fraction, width, depth }) => {
			const a = points[from], b = points[to]
			return {
				x: THREE.MathUtils.lerp(a.x, b.x, fraction),
				z: THREE.MathUtils.lerp(a.z, b.z, fraction),
				rx: width,
				rz: depth,
				// The long axis cuts across the road, not alongside it.
				rotation: Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2,
			}
		})
	}

	_buildLavaSurface() {
		const positions = []
		const uvs = []
		const indices = []
		const slices = 48
		for (const zone of this.zones) {
			const start = positions.length / 3
			const cos = Math.cos(zone.rotation)
			const sin = Math.sin(zone.rotation)
			const centerY =
				this.planet.heightAt(zone.x, zone.z) + 0.75
			positions.push(zone.x, centerY, zone.z)
			uvs.push(0.5, 0.5)
			for (let ring = 1; ring <= 4; ring++) {
				const radius = ring / 4
				for (let i = 0; i < slices; i++) {
					const angle = (i / slices) * Math.PI * 2
					const localX =
						Math.cos(angle) *
						zone.rx *
						radius
					const localZ =
						Math.sin(angle) *
						zone.rz *
						radius
					const x =
						zone.x +
						localX * cos -
						localZ * sin
					const z =
						zone.z +
						localX * sin +
						localZ * cos
					positions.push(
						x,
						this.planet.heightAt(x, z) +
							0.75,
						z
					)
					uvs.push(
						0.5 + (localX / zone.rx) * 0.5,
						0.5 + (localZ / zone.rz) * 0.5
					)
				}
			}
			for (let i = 0; i < slices; i++) {
				const next = (i + 1) % slices
				// In XZ space the increasing angles point normals DOWN;
				// reverse the winding so lava faces the camera above.
				indices.push(
					start,
					start + 1 + next,
					start + 1 + i
				)
			}
			for (let ring = 1; ring < 4; ring++) {
				const inner = start + 1 + (ring - 1) * slices
				const outer = inner + slices
				for (let i = 0; i < slices; i++) {
					const next = (i + 1) % slices
					indices.push(
						inner + i,
						outer + i,
						inner + next,
						inner + next,
						outer + i,
						outer + next
					)
				}
			}
		}
		const geometry = this.level.own(new THREE.BufferGeometry())
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(positions, 3)
		)
		geometry.setAttribute(
			'uv',
			new THREE.Float32BufferAttribute(uvs, 2)
		)
		geometry.setIndex(indices)
		geometry.computeVertexNormals()
		const material = this.level.own(
			new THREE.ShaderMaterial({
				fog: true,
				side: THREE.DoubleSide,
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
					}
				`,
				fragmentShader: `
					uniform float time;
					varying vec2 vUv;
					#include <fog_pars_fragment>
					float hash(vec2 p) {
						return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
					}
					float noise(vec2 p) {
						vec2 i = floor(p);
						vec2 f = fract(p);
						f = f * f * (3.0 - 2.0 * f);
						return mix(
							mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
							mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
							f.y
						);
					}
					void main() {
						vec2 flow = vUv * vec2(8.0, 5.0);
						flow.x += sin(flow.y * 1.6 + time * 0.5) * 0.24;
						flow.y -= time * 0.18;
						float crust = noise(flow) * 0.68 + noise(flow * 2.8) * 0.32;
						float seam = 1.0 - smoothstep(0.02, 0.12, abs(crust - 0.48));
						float edge = smoothstep(0.76, 1.0, length(vUv - 0.5) * 2.0);
						vec3 molten = mix(
							vec3(2.0, 0.16, 0.008),
							vec3(5.2, 1.45, 0.06),
							seam
						);
						vec3 color = mix(molten, vec3(0.055, 0.006, 0.002), edge * 0.9);
						gl_FragColor = vec4(color, 1.0);
						#include <tonemapping_fragment>
						#include <colorspace_fragment>
						#include <fog_fragment>
					}
				`,
			})
		)
		this.material = material
		const mesh = new THREE.Mesh(geometry, material)
		mesh.name = 'level2-animated-lava-fields'
		mesh.frustumCulled = false
		this.root.add(mesh)

		for (const zone of this.zones) {
			const light = new THREE.PointLight(
				0xff4b0b,
				48,
				100,
				1.7
			)
			light.position.set(
				zone.x,
				this.planet.heightAt(zone.x, zone.z) + 6,
				zone.z
			)
			this.root.add(light)
			this.lights.push(light)
		}
	}

	_buildVolcanicRocks() {
		const geometry = this.level.own(
			new THREE.IcosahedronGeometry(1, 0)
		)
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x321c1b,
				roughness: 0.96,
				metalness: 0.08,
			})
		)
		for (const area of this.areas) {
			for (const rock of area.rocks) {
				if (
					this.planet._drivingRouteDistance(
						rock.x,
						rock.z
					) < 30
				)
					continue
				const mesh = new THREE.Mesh(geometry, material)
				mesh.name = 'lava-vent-rock'
				mesh.scale.set(
					rock.radius,
					rock.height / 2,
					rock.radius * 0.84
				)
				mesh.rotation.set(
					0.08,
					Math.random() * Math.PI,
					0.12
				)
				mesh.position.set(
					rock.x,
					this.planet.heightAt(rock.x, rock.z) +
						rock.height / 2,
					rock.z
				)
				this.root.add(mesh)
				this.colliders.push(
					this.planet._registerCollider(
						mesh,
						rock.radius,
						'volcanic-rock'
					)
				)
			}
		}
	}

	_buildBubbles() {
		const geometry = this.level.own(
			new THREE.SphereGeometry(1, 8, 6)
		)
		const material = this.level.own(
			new THREE.MeshBasicMaterial({
				color: 0xff8024,
				toneMapped: false,
			})
		)
		for (const zone of this.zones) {
			for (let i = 0; i < 2; i++) {
				const angle = i * Math.PI + 0.7
				const x =
					zone.x + Math.cos(angle) * zone.rx * 0.3
				const z =
					zone.z + Math.sin(angle) * zone.rz * 0.3
				const bubble = new THREE.Mesh(
					geometry,
					material
				)
				bubble.position.set(
					x,
					this.planet.heightAt(x, z) + 0.65,
					z
				)
				bubble.userData.phase = i * 1.7 + zone.x * 0.01
				bubble.scale.set(1.4, 0.2, 1.1)
				this.root.add(bubble)
				this.bubbles.push(bubble)
			}
		}
	}

	_buildEmbers() {
		const count = 160
		const geometry = this.level.own(new THREE.BufferGeometry())
		this.emberPositions = new Float32Array(count * 3)
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this.emberPositions, 3)
		)
		const material = this.level.own(
			new THREE.PointsMaterial({
				color: 0xff6817,
				size: 2.2,
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
		)
		this.embers = new THREE.Points(geometry, material)
		this.embers.name = 'level2-lava-embers'
		this.embers.frustumCulled = false
		this.root.add(this.embers)
		this.update(0)
	}

	isLavaAt(x, z, margin = 0) {
		if (
			this.zones.some((zone) =>
				ellipseContains(x, z, zone, margin)
			)
		)
			return true
		const height = this.planet.heightAt(x, z)
		return Boolean(
			this.planet.lava?.touches?.({
				x,
				y: height,
				z,
			})
		)
	}

	touches(point) {
		if (this.planet.lava?.touches?.(point)) return true
		return this.zones.some(
			(zone) =>
				ellipseContains(point.x, point.z, zone) &&
				point.y <=
					this.planet.heightAt(point.x, point.z) +
						0.7
		)
	}

	update(delta) {
		this.time += delta
		this.material.uniforms.time.value = this.time
		for (let i = 0; i < this.emberPositions.length / 3; i++) {
			const zone = this.zones[i % this.zones.length]
			const age = (this.time * 0.16 + i * 0.618) % 1
			const angle = i * 2.399963229728653
			const spread = 0.2 + ((i * 17) % 71) / 100
			const x = zone.x + Math.cos(angle) * zone.rx * spread
			const z = zone.z + Math.sin(angle) * zone.rz * spread
			this.emberPositions[i * 3] = x
			this.emberPositions[i * 3 + 1] =
				this.planet.heightAt(x, z) + 0.5 + age * 12
			this.emberPositions[i * 3 + 2] = z
		}
		this.embers.geometry.attributes.position.needsUpdate = true
		this.lights.forEach((light, index) => {
			light.intensity =
				48 + Math.sin(this.time * 2.4 + index) * 10
		})
		for (const bubble of this.bubbles) {
			const pulse =
				0.75 +
				(Math.sin(
					this.time * 3 + bubble.userData.phase
				) +
					1) *
					0.42
			bubble.scale.y = pulse * 0.22
		}
	}

	dispose() {
		this.root.removeFromParent()
		const colliders = new Set(this.colliders)
		this.planet.colliders = this.planet.colliders.filter(
			(collider) => !colliders.has(collider)
		)
		this.colliders.length = 0
	}
}
