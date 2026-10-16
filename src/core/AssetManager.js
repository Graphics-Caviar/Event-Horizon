import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Cache parsed assets across the hangar, cinematic and gameplay scenes.

export class AssetManager {
	constructor() {
		this._starfieldTexture = null
		this.gltfLoader = new GLTFLoader()
		// The Level 3 void GLBs are Draco-compressed. The decoder ships
		// locally (unlike the launch bay's CDN copy) so level assets stay
		// offline-capable; it only activates for meshes that use it.
		this.dracoLoader = new DRACOLoader()
		this.dracoLoader.setDecoderPath('assets/draco/')
		this.gltfLoader.setDRACOLoader(this.dracoLoader)
		this._modelCache = new Map()
		this._readyModels = new Map()
	}

	_cloneModel(gltf) {
		// SkeletonUtils.clone rebinds skinned meshes (bone remapping) which
		// a plain .clone() cannot; unrigged meshes clone identically.
		const clone = skeletonClone(gltf.scene)
		// Clips stay reachable from the instance so characters can drive
		// an AnimationMixer when a model actually ships animations.
		clone.userData.animations = gltf.animations || []
		// GLTF clones intentionally share geometry/material/texture resources
		// with the cached source. Mark every node so clearScene() can detach
		// the instance without disposing cache-owned GPU resources.
		clone.traverse((node) => {
			node.userData.__assetManagerShared = true
		})
		return clone
	}

	getCachedModel(pathOrPaths) {
		const paths = Array.isArray(pathOrPaths)
			? pathOrPaths
			: [pathOrPaths]
		for (const path of paths) {
			const gltf = this._readyModels.get(path)
			if (gltf) return this._cloneModel(gltf)
		}
		return null
	}

	/**
	 * The cached source gltf itself — not a clone — for one-time resource
	 * prep (e.g. Level 3's meshopt decimation) before instances are made.
	 */
	getRawModel(pathOrPaths) {
		const paths = Array.isArray(pathOrPaths)
			? pathOrPaths
			: [pathOrPaths]
		for (const path of paths) {
			const gltf = this._readyModels.get(path)
			if (gltf) return gltf
		}
		return null
	}

	async preloadModel(pathOrPaths) {
		const paths = Array.isArray(pathOrPaths)
			? pathOrPaths
			: [pathOrPaths]
		let lastError = null

		for (const path of paths) {
			try {
				if (!this._modelCache.has(path)) {
					this._modelCache.set(
						path,
						this.gltfLoader
							.loadAsync(path)
							.then((gltf) => {
								// The full parse (scene + clips) is what
								// gets cached; instances are cloned off
								// it on demand.
								this._readyModels.set(
									path,
									gltf
								)
								return gltf
							})
					)
				}
				await this._modelCache.get(path)
				return
			} catch (error) {
				lastError = error
				this._modelCache.delete(path)
				console.warn(
					`Model load failed from ${path}; trying fallback if available.`
				)
			}
		}

		throw lastError || new Error('No model path supplied')
	}

	async loadModel(pathOrPaths) {
		const cached = this.getCachedModel(pathOrPaths)
		if (cached) return cached
		await this.preloadModel(pathOrPaths)
		return this.getCachedModel(pathOrPaths)
	}

	createAsteroidGeometry(seed = Math.random()) {
		const geo = new THREE.IcosahedronGeometry(1, 0)
		// Deform vertices a little so asteroids don't look like uniform gems.
		const pos = geo.attributes.position
		for (let i = 0; i < pos.count; i++) {
			const n =
				(Math.sin(seed * 999 + i * 12.9898) *
					43758.5453) %
				1
			const scale = 0.75 + Math.abs(n) * 0.5
			pos.setXYZ(
				i,
				pos.getX(i) * scale,
				pos.getY(i) * scale,
				pos.getZ(i) * scale
			)
		}
		geo.computeVertexNormals()
		return geo
	}

	createAsteroidMaterial() {
		return new THREE.MeshStandardMaterial({
			color: 0x6b6459,
			roughness: 0.95,
			metalness: 0.05,
			flatShading: true,
		})
	}

	createGlowMaterial(color) {
		return new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.9,
		})
	}

	createStarfield(count = 4000, radius = 1800) {
		const positions = new Float32Array(count * 3)
		for (let i = 0; i < count; i++) {
			// Uniform-ish distribution on a big sphere shell around the scene.
			const r = radius * (0.6 + Math.random() * 0.4)
			const theta = Math.random() * Math.PI * 2
			const phi = Math.acos(2 * Math.random() - 1)
			positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
			positions[i * 3 + 1] =
				r * Math.sin(phi) * Math.sin(theta)
			positions[i * 3 + 2] = r * Math.cos(phi)
		}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)
		const mat = new THREE.PointsMaterial({
			color: 0xffffff,
			size: 1.6,
			sizeAttenuation: true,
		})
		return new THREE.Points(geo, mat)
	}
	createNitrogenGeometry(radius = 1, height = 2, segments = 32, hollow) {
		let geo = 1
		if (hollow) {
			geo = new THREE.CylinderGeometry(
				radius,
				radius,
				height,
				segments,
				1,
				true
			)
		} else {
			geo = new THREE.CylinderGeometry(
				radius,
				radius,
				height,
				segments
			)
		}

		geo.computeVertexNormals()

		return geo
	}

	createNitrogenMaterial(color) {
		return new THREE.MeshStandardMaterial({
			color: color,
			roughness: 0.35,
			metalness: 0.7,
		})
	}

	createNitrogenMiddleMaterial(color) {
		return new THREE.MeshStandardMaterial({
			color: color,
			roughness: 0.35,
			metalness: 0.7,
			transparent: true,
			opacity: 0.3,
			side: THREE.DoubleSide,
			depthWrite: false,
		})
	}

	createNitrogenLiquidMaterial(color) {
		return new THREE.MeshStandardMaterial({
			color: color,
			transparent: true,
			opacity: 0.9,
			emissive: color,
			emissiveIntensity: 3,
		})
	}
}
