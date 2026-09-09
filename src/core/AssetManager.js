import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// The public/assets folders only contain placeholder .txt files right now
// (no models/textures have been added to the repo yet), so everything in
// this build is procedural THREE geometry/materials. This file centralises
// that so we don't duplicate geometry/material setup across levels, and
// so swapping in real GLTF models later only means editing this file.
//
// TODO (once real assets land in public/assets/...): add a loadModel(path)
// helper here using THREE.GLTFLoader and have Spaceship/Rover/Character
// prefer a loaded model over the procedural fallback.

export class AssetManager {
	constructor() {
		this._starfieldTexture = null
		this.gltfLoader = new GLTFLoader()
		this._modelCache = new Map()
	}

	async loadModel(pathOrPaths) {
		const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths]
		let lastError = null

		for (const path of paths) {
			try {
				if (!this._modelCache.has(path)) {
					this._modelCache.set(
						path,
						this.gltfLoader.loadAsync(path).then((gltf) => gltf.scene)
					)
				}
				const source = await this._modelCache.get(path)
				return source.clone(true)
			} catch (error) {
				lastError = error
				this._modelCache.delete(path)
				console.warn(`Model load failed from ${path}; trying fallback if available.`)
			}
		}

		throw lastError || new Error('No model path supplied')
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
