import * as THREE from 'three'
import { ASTEROID_MODELS } from '../Level1/asteroidAssets.js'
import { loadVoidModel } from './voidAssets.js'

export const VOID_ASTEROID_COUNT = 10

const planetFragment = `
varying vec3 surface, worldNormal;
uniform vec3 lowColor, highColor;
uniform float gas, cloudiness;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise(vec3 p) {
 vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main() {
 vec3 p=normalize(surface);
 float n=noise(p*5.0)*0.6+noise(p*13.0)*0.28+noise(p*37.0)*0.12;
 float bands=0.5+0.5*sin(p.y*48.0+n*8.0);
 float pattern=mix(smoothstep(0.40,0.62,n),bands,gas);
 vec3 color=mix(lowColor,highColor,mix(pattern,0.25+pattern*0.5,gas));
 float cloud=smoothstep(0.60,0.76,noise(p*8.0+vec3(17.0))+noise(p*23.0)*0.17);
 color=mix(color,vec3(0.83,0.9,1.0),cloud*cloudiness);
 float day=smoothstep(-0.18,0.8,dot(normalize(worldNormal),normalize(vec3(-0.8,0.5,1.0))));
 gl_FragColor=vec4(color*(0.025+day*0.975),1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`

/** Distant celestial bodies and a cached Level 3 ship; no gameplay colliders. */
export class VoidSpaceBackdrop {
	constructor(level, parent) {
		this.level = level
		this.resources = []
		this.group = new THREE.Group()
		this.group.name = 'void-outer-space'
		parent.add(this.group)
		this.shards = []
		this.asteroids = []
		this.asteroidParts = []
		this.asteroidMeshes = []
		this._lastUpdateTime = 0
		this._asteroidBase = new THREE.Matrix4()
		this._asteroidPartMatrix = new THREE.Matrix4()
		this._asteroidPosition = new THREE.Vector3()
		this._asteroidQuaternion = new THREE.Quaternion()
		this._asteroidScale = new THREE.Vector3()
		this.fallbackRocks = new THREE.Group()
		this.fallbackRocks.name = 'void-asteroid-fallback'
		this.group.add(this.fallbackRocks)
		this._buildFallbackAsteroids()
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const sphere = own(new THREE.SphereGeometry(1, 64, 32))
		this.planets = []
		const definitions = [
			{
				position: [-650, 245, -960],
				radius: 138,
				low: 0x103968,
				high: 0x5f9176,
				gas: 0,
			},
			{
				position: [610, 320, -1140],
				radius: 178,
				low: 0x72513f,
				high: 0xdbc49b,
				gas: 1,
			},
			{
				position: [760, -360, -740],
				radius: 105,
				low: 0x643525,
				high: 0xb86d48,
				gas: 0,
			},
			{
				position: [-680, -390, -1040],
				radius: 126,
				low: 0x254b69,
				high: 0x9fc9d9,
				gas: 0.75,
			},
		]
		for (const [i, def] of definitions.entries()) {
			const material = own(
				new THREE.ShaderMaterial({
					uniforms: {
						lowColor: {
							value: new THREE.Color(
								def.low
							),
						},
						highColor: {
							value: new THREE.Color(
								def.high
							),
						},
						gas: { value: def.gas },
						cloudiness: {
							value:
								i === 0
									? 0.65
									: i ===
										  3
										? 0.15
										: 0,
						},
					},
					vertexShader:
						'varying vec3 surface, worldNormal; void main() { surface=position; worldNormal=mat3(modelMatrix)*normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
					fragmentShader: planetFragment,
				})
			)
			const planet = new THREE.Mesh(sphere, material)
			planet.name = `distant-planet-${i + 1}`
			planet.position.fromArray(def.position)
			planet.scale.setScalar(def.radius)
			this.group.add(planet)
			this.planets.push(planet)
		}
		// Broad, translucent gas clouds add depth and color to the starfield.
		const nebulaSize = 256
		const nebulaClouds = [
			{ x: 0.29, y: 0.39, r: 0.26, color: [95, 45, 190] },
			{ x: 0.59, y: 0.36, r: 0.32, color: [28, 92, 190] },
			{ x: 0.47, y: 0.65, r: 0.29, color: [190, 45, 120] },
			{ x: 0.74, y: 0.66, r: 0.23, color: [55, 150, 190] },
		]
		const nebulaPixels = new Uint8Array(nebulaSize * nebulaSize * 4)
		for (let y = 0; y < nebulaSize; y++) {
			for (let x = 0; x < nebulaSize; x++) {
				let amount = 0
				const color = [0, 0, 0]
				for (const cloud of nebulaClouds) {
					const dx = x / nebulaSize - cloud.x
					const dy = y / nebulaSize - cloud.y
					const weight = Math.exp(
						-(
							(dx * dx + dy * dy) /
							(cloud.r *
								cloud.r *
								0.3)
						)
					)
					amount += weight
					for (
						let channel = 0;
						channel < 3;
						channel++
					)
						color[channel] +=
							cloud.color[channel] *
							weight
				}
				const index = (y * nebulaSize + x) * 4
				for (let channel = 0; channel < 3; channel++)
					nebulaPixels[index + channel] = amount
						? Math.round(
								color[channel] /
									amount
							)
						: 0
				nebulaPixels[index + 3] = Math.min(
					100,
					amount * 46
				)
			}
		}
		const nebulaTexture = own(
			new THREE.DataTexture(
				nebulaPixels,
				nebulaSize,
				nebulaSize,
				THREE.RGBAFormat
			)
		)
		nebulaTexture.needsUpdate = true
		nebulaTexture.colorSpace = THREE.SRGBColorSpace
		const nebulaMaterial = own(
			new THREE.SpriteMaterial({
				map: nebulaTexture,
				transparent: true,
				opacity: 0.78,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
			})
		)
		for (const [i, position] of [
			[-260, 110, -1480],
			[390, -100, -1680],
		].entries()) {
			const nebula = new THREE.Sprite(nebulaMaterial)
			nebula.name = `space-nebula-${i + 1}`
			nebula.position.set(...position)
			nebula.scale.set(760, 480, 1)
			this.group.add(nebula)
		}
		// A recognisable foil bus, twin solar arrays, antenna and navigation light.
		this.satellite = new THREE.Group()
		this.satellite.name = 'orbiting-satellite'
		const gold = own(
			new THREE.MeshStandardMaterial({
				color: 0xb89446,
				metalness: 0.75,
				roughness: 0.4,
			})
		)
		const blue = own(
			new THREE.MeshStandardMaterial({
				color: 0x173e79,
				emissive: 0x102552,
				emissiveIntensity: 0.6,
				metalness: 0.65,
				roughness: 0.3,
			})
		)
		const silver = own(
			new THREE.MeshStandardMaterial({
				color: 0xbfcbd5,
				metalness: 0.7,
				roughness: 0.35,
			})
		)
		const body = new THREE.Mesh(
			own(new THREE.BoxGeometry(16, 15, 16)),
			gold
		)
		this.satellite.add(body)
		const cell = own(new THREE.BoxGeometry(7, 18, 0.7))
		for (const side of [-1, 1]) {
			for (let i = 0; i < 4; i++) {
				const panel = new THREE.Mesh(cell, blue)
				panel.position.x = side * (14 + i * 7.5)
				this.satellite.add(panel)
			}
		}
		const dish = new THREE.Mesh(
			own(
				new THREE.SphereGeometry(
					9,
					20,
					12,
					0,
					Math.PI * 2,
					0,
					0.65
				)
			),
			silver
		)
		dish.position.y = 10
		this.satellite.add(dish)
		const antenna = new THREE.Mesh(
			own(new THREE.CylinderGeometry(0.4, 0.4, 23, 6)),
			silver
		)
		antenna.position.y = 17
		this.satellite.add(antenna)
		this.group.add(this.satellite)
		this.update(0)
		this.asteroidReady = this._loadLevelOneAsteroids()
		this.shipReady = level.assetManager
			? this._loadShip()
			: Promise.resolve()
	}
	_buildFallbackAsteroids() {
		const geometry = new THREE.IcosahedronGeometry(1, 0)
		const material = new THREE.MeshStandardMaterial({
			color: 0x403c48,
			flatShading: true,
			metalness: 0.42,
			roughness: 0.72,
			emissive: 0x160e2d,
		})
		this.resources.push(geometry, material)
		for (let i = 0; i < VOID_ASTEROID_COUNT; i++) {
			const a = i * 2.39996
			const radius = 55 + (i % 9) * 16
			const mesh = new THREE.Mesh(geometry, material)
			mesh.position.set(
				Math.cos(a) * radius,
				Math.sin(a) * radius,
				100 -
					(i /
						Math.max(
							1,
							VOID_ASTEROID_COUNT - 1
						)) *
						658
			)
			mesh.scale.set(6 + (i % 13), 12 + (i % 23), 5 + (i % 7))
			mesh.rotation.set(i, i * 0.7, i * 0.3)
			this.fallbackRocks.add(mesh)
			this.shards.push(mesh)
		}
	}
	async _loadLevelOneAsteroids() {
		if (!this.level.assetManager) return false
		try {
			const model =
				await this.level.assetManager.loadModel(
					ASTEROID_MODELS
				)
			if (this.disposed || !model) return false
			model.updateMatrixWorld(true)
			const bounds = new THREE.Box3().setFromObject(model)
			const center = bounds.getCenter(new THREE.Vector3())
			const radius = bounds.getBoundingSphere(
				new THREE.Sphere()
			).radius
			const scale = 14 / Math.max(radius, 0.001)
			const normalize = new THREE.Matrix4()
				.makeScale(scale, scale, scale)
				.multiply(
					new THREE.Matrix4().makeTranslation(
						-center.x,
						-center.y,
						-center.z
					)
				)
			model.traverse((node) => {
				if (!node.isMesh) return
				this.asteroidParts.push({
					geometry: node.geometry,
					material: node.material,
					transform: normalize
						.clone()
						.multiply(node.matrixWorld),
				})
			})
			if (!this.asteroidParts.length) return false
			for (let i = 0; i < VOID_ASTEROID_COUNT; i++) {
				const a = i * 2.39996
				const radius = 55 + (i % 9) * 16
				this.asteroids.push({
					position: new THREE.Vector3(
						Math.cos(a) * radius,
						Math.sin(a) * radius,
						100 -
							(i /
								Math.max(
									1,
									VOID_ASTEROID_COUNT -
										1
								)) *
								658
					),
					rotation: new THREE.Euler(
						i,
						i * 0.7,
						i * 0.3
					),
					spin: 0.035 + (i % 7) * 0.009,
					scale: 1.25 + (i % 7) * 0.2,
				})
			}
			const base = new THREE.Matrix4()
			const partMatrix = new THREE.Matrix4()
			const position = new THREE.Vector3()
			const quaternion = new THREE.Quaternion()
			const size = new THREE.Vector3()
			for (const part of this.asteroidParts) {
				const instanced = new THREE.InstancedMesh(
					part.geometry,
					part.material,
					this.asteroids.length
				)
				instanced.name = 'level1-asteroid-instances'
				instanced.frustumCulled = false
				instanced.castShadow = true
				instanced.receiveShadow = true
				for (
					let i = 0;
					i < this.asteroids.length;
					i++
				) {
					const rock = this.asteroids[i]
					position.copy(rock.position)
					quaternion.setFromEuler(rock.rotation)
					size.setScalar(rock.scale)
					base.compose(position, quaternion, size)
					partMatrix
						.copy(base)
						.multiply(part.transform)
					instanced.setMatrixAt(i, partMatrix)
				}
				instanced.instanceMatrix.needsUpdate = true
				this.group.add(instanced)
				this.asteroidMeshes.push(instanced)
			}
			this.fallbackRocks.visible = false
			return true
		} catch (error) {
			console.warn(
				'[Level3] Level 1 asteroid model unavailable in void:',
				error?.message
			)
			return false
		}
	}
	async _loadShip() {
		const ship = await loadVoidModel(
			this.level.assetManager,
			'anomalyShip'
		)
		if (!ship || this.disposed) return
		const bounds = new THREE.Box3().setFromObject(ship)
		const size = bounds.getSize(new THREE.Vector3())
		if (size.y > size.x && size.y > size.z) {
			ship.rotation.z = -Math.PI / 2
			ship.updateMatrixWorld(true)
			bounds.setFromObject(ship)
			bounds.getSize(size)
		}
		const scale = 52 / Math.max(size.x, size.y, size.z, 0.001)
		ship.scale.multiplyScalar(scale)
		ship.position.sub(
			bounds
				.getCenter(new THREE.Vector3())
				.multiplyScalar(scale)
		)
		this.ship = new THREE.Group()
		this.ship.name = 'void-level3-anomaly-ship'
		this.ship.add(ship)
		this.ship.position.set(-65, 28, -110)
		this.ship.rotation.set(0.12, 0.7, -0.14)
		this.group.add(this.ship)
		// Source buffers belong to AssetManager and must survive a level restart.
	}
	update(time) {
		const delta = Math.max(0, time - this._lastUpdateTime)
		this._lastUpdateTime = time
		if (this.asteroidMeshes.length) {
			for (let i = 0; i < this.asteroids.length; i++) {
				const rock = this.asteroids[i]
				rock.rotation.x += rock.spin * delta * 0.6
				rock.rotation.z += rock.spin * delta * 0.35
				this._asteroidPosition.copy(rock.position)
				this._asteroidQuaternion.setFromEuler(
					rock.rotation
				)
				this._asteroidScale.setScalar(rock.scale)
				this._asteroidBase.compose(
					this._asteroidPosition,
					this._asteroidQuaternion,
					this._asteroidScale
				)
				for (
					let p = 0;
					p < this.asteroidParts.length;
					p++
				) {
					this._asteroidPartMatrix
						.copy(this._asteroidBase)
						.multiply(
							this.asteroidParts[p]
								.transform
						)
					this.asteroidMeshes[p].setMatrixAt(
						i,
						this._asteroidPartMatrix
					)
				}
			}
			for (const mesh of this.asteroidMeshes)
				mesh.instanceMatrix.needsUpdate = true
		} else {
			for (const shard of this.shards) {
				shard.rotation.x += delta * 0.06
				shard.rotation.z += delta * 0.035
			}
		}
		const angle = time * 0.045
		this.satellite.position
			.copy(this.planets[2].position)
			.add(
				new THREE.Vector3(
					Math.cos(angle) * 145,
					Math.sin(angle) * 55,
					Math.sin(angle) * 145
				)
			)
		this.satellite.rotation.set(0.2, -angle, -0.2)
		for (const planet of this.planets)
			planet.rotation.y = time * 0.008
		if (this.ship) {
			this.ship.position.y = 28 + Math.sin(time * 0.18) * 2
			this.ship.rotation.z =
				-0.14 + Math.sin(time * 0.12) * 0.035
		}
	}
	dispose() {
		this.disposed = true
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}
