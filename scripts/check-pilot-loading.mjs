import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AssetManager } from '../src/core/AssetManager.js'
import { Level2 } from '../src/levels/Level2/Level2.js'
import { CHARACTERS } from '../src/systems/CharacterManager.js'

const assets = new AssetManager()
const source = new THREE.Group()
source.add(
	new THREE.Mesh(
		new THREE.BoxGeometry(),
		new THREE.MeshStandardMaterial()
	)
)
let requests = 0
let finish
assets.gltfLoader.loadAsync = () => {
	requests++
	return new Promise((resolve) => {
		finish = () => resolve({ scene: source })
	})
}
const preloading = assets.preloadModel('/pilot.glb')
const loading = assets.loadModel('/pilot.glb')
assert.equal(requests, 1, 'concurrent preload and load share a request')
assert.equal(assets.getCachedModel('/pilot.glb'), null)
finish()
await preloading
const first = await loading
const second = assets.getCachedModel('/pilot.glb')
assert.notEqual(first, second)
assert.equal(first.children[0].geometry, second.children[0].geometry)
assert.ok(second.children[0].userData.__assetManagerShared)
first.position.x = 100
assert.equal(second.position.x, 0)
assert.equal(requests, 1)

let attempts = 0
assets.gltfLoader.loadAsync = async () => {
	if (++attempts === 1) throw new Error('temporary failure')
	return { scene: source }
}
await assert.rejects(assets.preloadModel('/retry.glb'))
await assets.preloadModel('/retry.glb')
assert.ok(assets.getCachedModel('/retry.glb'))

let resolvePilot
const level = Object.assign(Object.create(Level2.prototype), {
	state: { selectedCharacter: 'zara' },
	playerRoot: new THREE.Group(),
	assetManager: {
		loadModel: () =>
			new Promise((resolve) => {
				resolvePilot = resolve
			}),
	},
	_installPilot() {
		assert.fail('disposed level must not install a late pilot')
	},
})
const late = level._loadPilot()
resolvePilot(source)
await late

// Exercise real generated geometry through the production GLTF parser. Image
// decoding is browser-only; retain the embedded bytes but omit texture bindings.
globalThis.ProgressEvent ??= class ProgressEvent {
	constructor(type, values) {
		Object.assign(this, { type }, values)
	}
}
for (const config of Object.values(CHARACTERS)) {
	const file = await readFile(
		new URL(`../public${config.gameplayModel}`, import.meta.url)
	)
	const jsonLength = file.readUInt32LE(12)
	const gltf = JSON.parse(file.subarray(20, 20 + jsonLength))
	assert.equal(file.readUInt32LE(8), file.length)
	gltf.buffers[0].uri = `data:application/octet-stream;base64,${file.subarray(28 + jsonLength).toString('base64')}`
	delete gltf.images
	delete gltf.textures
	delete gltf.materials
	for (const mesh of gltf.meshes)
		for (const primitive of mesh.primitives)
			delete primitive.material
	const { scene } = await new GLTFLoader().parseAsync(
		JSON.stringify(gltf),
		''
	)
	const resources = new Set()
	const pilotLevel = Object.assign(Object.create(Level2.prototype), {
		playerRoot: new THREE.Group(),
		planet: { heightAt: () => 0 },
		resources,
	})
	pilotLevel._installPilot(scene, config.key)
	assert.ok(Number.isFinite(pilotLevel.pilotWalk.footOffset))
	pilotLevel.pilotWalk.update(1 / 60, 0.05, false)
	assert.ok(
		new THREE.Box3()
			.setFromObject(scene)
			.getSize(new THREE.Vector3()).y > 2
	)
	scene.traverse((mesh) => {
		if (!mesh.isMesh) return
		assert.ok(mesh.geometry.index.count <= 360000)
		mesh.geometry.dispose()
	})
	for (const resource of resources) resource.dispose()
	console.log(`${config.key}: optimized GLB parses, fits and animates`)
}
console.log(
	'Pilot loading: deduplication, synchronous cache, instance isolation, retry and disposed-level checks passed.'
)
