import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CRYSTAL_MOUNTAINS } from './CrystalPlanet.js'

// Procedural storm ceiling: overlapping cloud banks with a silver-lit opening.
// Direction-space sampling keeps the sky stable while walking or flying.
const cloudFragment = `
uniform float time;
varying vec3 direction;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise3(vec3 p) {
 vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) {
 float sum=0.0, amplitude=0.55;
 for(int i=0;i<5;i++) { sum+=noise3(p)*amplitude; p=p*2.03+vec3(5.7,1.2,3.4); amplitude*=0.48; }
 return sum;
}
void main() {
 vec3 d=normalize(direction);
 float swirl=0.3*sin(d.y*5.0+time*0.012);
 vec3 p=vec3(d.x*cos(swirl)-d.z*sin(swirl),d.y,d.x*sin(swirl)+d.z*cos(swirl))*5.5+vec3(time*0.006,0.0,time*0.003);
 float bank=fbm(p+fbm(p*0.65)*2.2);
 float detail=fbm(p*3.0+vec3(0,time*0.008,0));
 float cloud=smoothstep(0.29,0.69,bank*0.82+detail*0.18);
 float opening=pow(max(0.0,dot(d,normalize(vec3(-0.65,0.55,-0.4)))),5.0);
 float rim=pow(max(0.0,1.0-abs(bank-0.47)*9.0),3.0)*opening;
 vec3 sky=mix(vec3(0.008,0.014,0.03),vec3(0.23,0.30,0.43),opening);
 vec3 clouds=mix(vec3(0.24,0.29,0.38),vec3(0.012,0.019,0.035),cloud);
 vec3 color=mix(sky,clouds,0.82)+rim*vec3(0.48,0.55,0.72);
 float moonAngle=length(d-normalize(vec3(-0.65,0.55,-0.4)));
 float moon=1.0-smoothstep(0.023,0.03,moonAngle);
 float halo=exp(-moonAngle*18.0);
 color+=(moon*2.8+halo*0.22)*(1.0-cloud*0.8)*vec3(0.76,0.85,1.0);
 float horizon=1.0-smoothstep(-0.10,0.24,d.y);
 color=mix(color,vec3(0.09,0.12,0.18),horizon*0.6);
 gl_FragColor=vec4(color,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`

export class StormLandscape {
	constructor(level) {
		this.level = level
		this.planet = level.planet
		this.time = 0
		this.seed = 713
		this.root = level.addObject(new THREE.Group())
		this.root.name = 'level3-storm-landscape'
		this._buildSky()
		this._buildSpires()
		this._buildCrystalsAndTrees()
		this._batchProps()
		this._buildMist()
		this._buildMoonShafts()
		this._buildCrystalLighting()
		this._buildReflections()
	}

	random() {
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
		return this.seed / 4294967296
	}

	_buildSky() {
		// Remove the orange gradient dome, keeping the original terrain intact.
		this.planet.root.traverse((node) => {
			if (
				node.isMesh &&
				node.material?.side === THREE.BackSide
			)
				node.visible = false
		})
		this.cloudMaterial = this.level.own(
			new THREE.ShaderMaterial({
				uniforms: { time: { value: 0 } },
				side: THREE.BackSide,
				depthWrite: false,
				vertexShader:
					'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
				fragmentShader: cloudFragment,
			})
		)
		this.sky = new THREE.Mesh(
			this.level.own(new THREE.SphereGeometry(2200, 32, 20)),
			this.cloudMaterial
		)
		this.sky.renderOrder = -2
		this.sky.frustumCulled = false
		this.root.add(this.sky)
	}

	_buildSpires() {
		const material = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x232936,
				roughness: 1,
				metalness: 0,
				flatShading: true,
			})
		)
		// The ring sits beyond the playable boundary, so the new silhouette cannot
		// obstruct the rover route or introduce invisible terrain collisions.
		for (let i = 0; i < 42; i++) {
			const angle = (i / 42) * Math.PI * 2
			const radius = 690 + this.random() * 180
			const height = 160 + this.random() * 290
			const width = 22 + this.random() * 42
			const geometry = this.level.own(
				new THREE.ConeGeometry(width, height, 7, 7)
			)
			const positions = geometry.attributes.position
			for (let j = 0; j < positions.count; j++) {
				const y = positions.getY(j)
				const bend = y / height + 0.5
				const ridge =
					1 +
					Math.sin(
						y * 0.19 +
							positions.getX(j) * 0.1
					) *
						0.18
				positions.setXYZ(
					j,
					positions.getX(j) * ridge +
						bend * bend * width * 0.35,
					y,
					positions.getZ(j) * ridge
				)
			}
			geometry.computeVertexNormals()
			const spire = new THREE.Mesh(geometry, material)
			spire.position.set(
				this.planet.center.x + Math.cos(angle) * radius,
				this.planet.baseY + height * 0.5 - 18,
				this.planet.center.z + Math.sin(angle) * radius
			)
			spire.rotation.y = this.random() * 6.28
			this.root.add(spire)
		}
	}

	_buildCrystalsAndTrees() {
		const crystal = this.level.own(
			new THREE.MeshPhysicalMaterial({
				color: 0xa85ee9,
				emissive: 0x8b21e8,
				emissiveIntensity: 1.8,
				metalness: 0.1,
				roughness: 0.12,
				transmission: 0.28,
				thickness: 1.2,
				ior: 1.5,
				clearcoat: 1,
				clearcoatRoughness: 0.06,
				flatShading: true,
			})
		)
		// A hexagonal shaft with a pointed cap, rather than a round cone.
		const crystalGeometry = this.level.own(
			new THREE.CylinderGeometry(0.65, 1, 1, 6, 1)
		)
		const tipGeometry = this.level.own(
			new THREE.ConeGeometry(0.65, 0.6, 6)
		)
		const bark = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x42233b,
				roughness: 0.95,
			})
		)
		const canopy = this.level.own(
			new THREE.MeshStandardMaterial({
				color: 0x8c234e,
				roughness: 0.9,
				flatShading: true,
			})
		)
		const branchGeometry = this.level.own(
			new THREE.TubeGeometry(
				new THREE.CatmullRomCurve3([
					new THREE.Vector3(0, -0.5, 0),
					new THREE.Vector3(0.65, -0.2, 0.35),
					new THREE.Vector3(-0.45, 0.15, -0.2),
					new THREE.Vector3(0.4, 0.5, 0),
				]),
				18,
				0.17,
				5,
				false
			)
		)
		const crownGeometry = this.level.own(
			new THREE.IcosahedronGeometry(1, 1)
		)
		for (let i = 0; i < 210; i++) {
			const x =
				this.planet.center.x +
				(this.random() - 0.5) * 940
			const z =
				this.planet.center.z +
				(this.random() - 0.5) * 940
			if (
				!this.planet._isSpawnClear(x, z, 7) ||
				this.planet.slopeDegreesAt(x, z) > 32
			)
				continue
			const group = new THREE.Group()
			group.position.set(x, this.planet.heightAt(x, z), z)
			this.root.add(group)
			const tree = i % 8 === 0
			group.name = tree
				? 'withered-alien-tree'
				: 'amethyst-cluster'
			if (tree) {
				const h = 9 + this.random() * 7
				for (let b = 0; b < 5; b++) {
					const angle = b * 2.4
					const branch = new THREE.Mesh(
						branchGeometry,
						bark
					)
					branch.position.set(
						Math.sin(angle) * 1.4,
						h * 0.5,
						Math.cos(angle) * 1.4
					)
					branch.scale.set(0.7, h, 0.7)
					branch.rotation.z =
						Math.sin(angle) * 0.25
					branch.rotation.x =
						Math.cos(angle) * 0.25
					group.add(branch)
					const crown = new THREE.Mesh(
						crownGeometry,
						canopy
					)
					crown.position.set(
						Math.sin(angle) * 3.2,
						h - this.random(),
						Math.cos(angle) * 3.2
					)
					crown.scale.set(3.2, 0.85, 2.5)
					group.add(crown)
					// Narrow swept leaves break up the crown into an alien silhouette.
					for (let leaf = 0; leaf < 4; leaf++) {
						const blade = new THREE.Mesh(
							crownGeometry,
							canopy
						)
						blade.position.copy(
							crown.position
						)
						blade.rotation.set(
							0.55,
							leaf * 1.57 + angle,
							0.65
						)
						blade.scale.set(0.3, 2.3, 0.65)
						group.add(blade)
					}
				}
			} else {
				for (let c = 0; c < 5; c++) {
					const h = 1.3 + this.random() * 4.4
					const shard = new THREE.Group()
					shard.position.set(
						(this.random() - 0.5) * 4,
						0,
						(this.random() - 0.5) * 4
					)
					shard.rotation.set(
						(this.random() - 0.5) * 0.6,
						this.random() * 6.28,
						(this.random() - 0.5) * 0.6
					)
					const shaft = new THREE.Mesh(
						crystalGeometry,
						crystal
					)
					shaft.position.y = h * 0.5
					shaft.scale.set(h * 0.22, h, h * 0.22)
					const tip = new THREE.Mesh(
						tipGeometry,
						crystal
					)
					tip.position.y = h * 1.3
					tip.scale.copy(shaft.scale)
					shard.add(shaft, tip)
					group.add(shard)
				}
			}
			this.planet._registerCollider(
				group,
				tree ? 5 : 4,
				tree ? 'tree' : 'crystal'
			)
		}
	}

	_batchProps() {
		// Preserve collider groups but draw repeated shards and branches in batches.
		const batches = new Map()
		this.root.updateMatrixWorld(true)
		this.root.traverse((node) => {
			if (
				![
					'amethyst-cluster',
					'withered-alien-tree',
				].includes(node.name)
			)
				return
			node.traverse((mesh) => {
				if (!mesh.isMesh) return
				if (!batches.has(mesh.geometry))
					batches.set(mesh.geometry, [])
				batches.get(mesh.geometry).push(mesh)
			})
		})
		for (const [geometry, meshes] of batches) {
			const batch = new THREE.InstancedMesh(
				geometry,
				meshes[0].material,
				meshes.length
			)
			meshes.forEach((mesh, i) => {
				batch.setMatrixAt(i, mesh.matrixWorld)
				mesh.removeFromParent()
			})
			batch.instanceMatrix.needsUpdate = true
			batch.computeBoundingSphere()
			this.root.add(batch)
		}
	}

	_buildMist() {
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 128
		const context = canvas.getContext('2d')
		const gradient = context.createRadialGradient(
			64,
			64,
			0,
			64,
			64,
			64
		)
		gradient.addColorStop(0, 'rgba(175,180,205,0.3)')
		gradient.addColorStop(0.45, 'rgba(150,155,180,0.12)')
		gradient.addColorStop(1, 'rgba(150,155,180,0)')
		context.fillStyle = gradient
		context.fillRect(0, 0, 128, 128)
		const texture = this.level.own(new THREE.CanvasTexture(canvas))
		const material = this.level.own(
			new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				opacity: 0.18,
				depthWrite: false,
				color: 0xb0aecb,
			})
		)
		this.mist = []
		for (let i = 0; i < 22; i++) {
			const sprite = new THREE.Sprite(material)
			const x =
				this.planet.center.x +
				(this.random() - 0.5) * 1000
			const z =
				this.planet.center.z +
				(this.random() - 0.5) * 1000
			sprite.position.set(
				x,
				this.planet.heightAt(x, z) + 7,
				z
			)
			sprite.scale.set(
				65 + this.random() * 70,
				14 + this.random() * 12,
				1
			)
			sprite.userData.originX = x
			this.root.add(sprite)
			this.mist.push(sprite)
		}
		const mountainMist = this.level.own(material.clone())
		mountainMist.opacity = 0.6
		for (const peak of CRYSTAL_MOUNTAINS) {
			for (let i = 0; i < 3; i++) {
				const sprite = new THREE.Sprite(mountainMist)
				const x = peak.x + (i - 1) * 45
				const z = peak.z + 35
				sprite.position.set(
					x,
					this.planet.heightAt(x, z) + 12 + i * 9,
					z
				)
				sprite.scale.set(160, 30, 1)
				sprite.userData.originX = x
				this.root.add(sprite)
				this.mist.push(sprite)
			}
		}
	}

	_buildMoonShafts() {
		const geometry = this.level.own(
			new THREE.CylinderGeometry(10, 32, 220, 24, 1, true)
		)
		const material = this.level.own(
			new THREE.ShaderMaterial({
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				vertexShader:
					'varying vec2 beamUV; void main(){beamUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
				fragmentShader: `varying vec2 beamUV;
			void main(){float fade=sin(beamUV.y*3.14159); float bands=0.6+0.4*sin(beamUV.x*18.85);
			gl_FragColor=vec4(0.48,0.62,0.9,fade*bands*0.022);
			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			}`,
			})
		)
		for (const [x, z] of [
			[-80, -120],
			[175, -150],
			[-230, 180],
		]) {
			const shaft = new THREE.Mesh(geometry, material)
			shaft.name = 'moonlight-through-clouds'
			shaft.position.set(
				x,
				this.planet.heightAt(x, z) + 110,
				z
			)
			shaft.rotation.z = 0.65
			shaft.rotation.x = -0.4
			this.root.add(shaft)
		}
	}

	_surfacePatch(x, z, radius, flatten = 1) {
		const geometry = new THREE.CircleGeometry(radius, 24)
		geometry.rotateX(-Math.PI / 2)
		const positions = geometry.attributes.position
		for (let i = 0; i < positions.count; i++) {
			const px = x + positions.getX(i)
			const pz = z + positions.getZ(i) * flatten
			positions.setXYZ(
				i,
				px,
				this.planet.heightAt(px, pz) + 0.045,
				pz
			)
		}
		geometry.computeVertexNormals()
		return geometry
	}

	_buildCrystalLighting() {
		this.crystalSites = this.root.children
			.filter((node) => node.name === 'amethyst-cluster')
			.map((node) => node.position.clone())
		const patches = this.crystalSites.map((site) =>
			this._surfacePatch(site.x, site.z, 9)
		)
		if (patches.length) {
			const geometry = this.level.own(
				mergeGeometries(patches)
			)
			patches.forEach((patch) => patch.dispose())
			const material = this.level.own(
				new THREE.ShaderMaterial({
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					fog: true,
					uniforms: THREE.UniformsUtils.merge([
						THREE.UniformsLib.fog,
					]),
					vertexShader: `varying vec2 glowUV;
				#include <fog_pars_vertex>
				void main(){glowUV=uv; vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
				gl_Position=projectionMatrix*mvPosition;
				#include <fog_vertex>
				}`,
					fragmentShader: `varying vec2 glowUV;
				#include <fog_pars_fragment>
				void main(){ float glow=pow(max(0.0,1.0-length(glowUV-0.5)*2.0),2.4);
				gl_FragColor=vec4(0.42,0.025,0.85,glow*0.48);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
				#include <fog_fragment>
				}`,
				})
			)
			const spill = new THREE.Mesh(geometry, material)
			spill.name = 'amethyst-ground-light'
			this.root.add(spill)
		}
		// A fixed pool lights the closest clusters without adding a light per crystal.
		this.crystalLights = Array.from({ length: 6 }, () => {
			const light = new THREE.PointLight(0xb957ff, 90, 28, 2)
			light.visible = false
			this.root.add(light)
			return light
		})
		this.lightTimer = 0
	}

	_buildReflections() {
		const renderer = this.level.sceneManager.renderer
		if (!renderer) return
		const scene = this.level.sceneManager.scene
		this.previousEnvironment = scene.environment
		// Capture the storm sky once for the reflective crystal facets.
		const reflectionScene = new THREE.Scene()
		const sky = new THREE.Mesh(
			this.sky.geometry,
			this.cloudMaterial
		)
		reflectionScene.add(sky)
		const cube = new THREE.WebGLCubeRenderTarget(128, {
			type: THREE.HalfFloatType,
		})
		const camera = new THREE.CubeCamera(1, 3000, cube)
		const pmrem = new THREE.PMREMGenerator(renderer)
		try {
			camera.update(renderer, reflectionScene)
			this.environmentTarget = this.level.own(
				pmrem.fromCubemap(cube.texture)
			)
			scene.environment = this.environmentTarget.texture
		} finally {
			cube.dispose()
			pmrem.dispose()
		}
	}

	dispose() {
		const scene = this.level.sceneManager.scene
		if (
			this.environmentTarget &&
			scene.environment === this.environmentTarget.texture
		) {
			scene.environment = this.previousEnvironment
		}
	}

	update(delta) {
		this.time += Math.min(delta, 0.05)
		this.cloudMaterial.uniforms.time.value = this.time
		this.sky.position.copy(this.level.sceneManager.camera.position)
		this.lightTimer -= delta
		if (this.lightTimer <= 0) {
			this.lightTimer = 0.2
			const focus = this.level.playerRoot.position
			const sites = [...this.crystalSites].sort(
				(a, b) =>
					a.distanceToSquared(focus) -
					b.distanceToSquared(focus)
			)
			this.crystalLights.forEach((light, i) => {
				light.visible = Boolean(
					sites[i] &&
					sites[i].distanceToSquared(focus) <
						180 * 180
				)
				if (sites[i])
					light.position
						.copy(sites[i])
						.add(
							new THREE.Vector3(
								0,
								2.5,
								0
							)
						)
			})
		}
		this.mist.forEach((sprite, i) => {
			sprite.position.x =
				sprite.userData.originX +
				Math.sin(this.time * 0.035 + i) * 12
		})
	}
}
