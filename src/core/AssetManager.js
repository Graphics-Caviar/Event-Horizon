import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// The public/assets folders mostly still contain placeholder .txt files, so
// most of this build is procedural THREE geometry/materials. This file
// centralises that so we don't duplicate geometry/material setup across
// levels. loadModel() below is the "once real assets land" helper the old
// TODO here asked for — public/assets/models/spaceship/spaceship.glb is the
// first real asset using it (see src/launchbay/LaunchBayScene.js).

export class AssetManager {
	constructor() {
		this._starfieldTexture = null
		this._gltfLoader = new GLTFLoader()
		this._modelCache = new Map() // path -> in-flight/resolved Promise<THREE.Object3D>
	}

	/**
	 * Loads a GLB/GLTF file and resolves with its scene root (an
	 * un-normalized THREE.Object3D — callers scale/ground it themselves,
	 * since assets aren't guaranteed to share a common export scale).
	 * Identical paths share one load/cache entry; callers that need an
	 * independent instance (e.g. to tint per-ship) should `.clone(true)`
	 * the result rather than mutate it directly.
	 * @param {string} path
	 * @returns {Promise<THREE.Object3D>}
	 */
	loadModel(path) {
		if (this._modelCache.has(path)) return this._modelCache.get(path)

		const promise = new Promise((resolve, reject) => {
			this._gltfLoader.load(
				path,
				(gltf) => resolve(gltf.scene),
				undefined,
				(err) => {
					this._modelCache.delete(path)
					reject(
						new Error(`Failed to load model "${path}": ${err?.message || err}`)
					)
				}
			)
		})

		this._modelCache.set(path, promise)
		return promise
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
}
