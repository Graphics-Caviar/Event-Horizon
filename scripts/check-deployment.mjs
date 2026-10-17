import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assetUrl } from '../src/core/assetUrl.js'
import { AssetManager } from '../src/core/AssetManager.js'
import { SHIPS } from '../src/systems/ShipManager.js'
import { CHARACTERS } from '../src/systems/CharacterManager.js'
import { ALIEN_MODELS } from '../src/levels/Level2/Alien.js'
import { VOID_ASSETS } from '../src/levels/Level3/voidAssets.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

globalThis.ProgressEvent ??= class {
	constructor(type, values) {
		Object.assign(this, { type }, values)
	}
}
const paths = [
	...Object.values(SHIPS).map((c) =>
		Array.isArray(c.model) ? c.model[0] : c.model
	),
	...Object.values(CHARACTERS).map((c) => c.model[0]),
	...Object.values(ALIEN_MODELS),
	...Object.values(VOID_ASSETS).map((asset) => asset.path),
	'/assets/models/rover/sci-fi-exploration-rover.glb',
	'/assets/models/asteroids/asteroid_01.glb',
]
const home = 'https://example.test/students/sgroup3898/index.html'
for (const path of paths) {
	const url = assetUrl(path)
	assert.ok(
		new URL(url, home).pathname.startsWith(
			'/students/sgroup3898/assets/'
		)
	)
	assert.ok(
		assetUrl(path, '/students/sgroup3898/').startsWith(
			'/students/sgroup3898/assets/'
		)
	)
	const file = await readFile(new URL(`../dist/${url}`, import.meta.url))
	assert.equal(file.readUInt32LE(0), 0x46546c67)
	assert.equal(file.readUInt32LE(8), file.length)
	const length = file.readUInt32LE(12)
	const gltf = JSON.parse(file.subarray(20, 20 + length))
	gltf.buffers[0].uri = `data:application/octet-stream;base64,${file.subarray(28 + length).toString('base64')}`
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
	let triangles = 0
	scene.traverse((mesh) => {
		if (!mesh.isMesh) return
		triangles += mesh.geometry.index.count / 3
		mesh.geometry.dispose()
		mesh.material.dispose()
	})
	assert.ok(file.length < 8 * 1024 * 1024)
	assert.ok(triangles <= (path.includes('/pilots/') ? 120000 : 80000))
	console.log(
		`${url}: valid GLB, ${triangles} triangles, ${(file.length / 1e6).toFixed(2)} MB`
	)
}
assert.equal(
	assetUrl('https://example.test/model.glb'),
	'https://example.test/model.glb'
)
// Aliases must share the same cache (hangar originals and gameplay copies).
const manager = new AssetManager()
const cached = { scene: new (await import('three')).Group() }
let requests = 0
manager.gltfLoader.loadAsync = async () => {
	requests++
	return cached
}
await manager.preloadModel('/assets/models/pilots/zara-voss.glb')
await manager.preloadModel('/assets/models/pilots/zara-voss-gameplay.glb')
assert.equal(requests, 1)
assert.ok(manager.getCachedModel('/assets/models/pilots/zara-voss.glb'))
console.log(
	'PASS: nested deployment paths, model budgets, GLTF parsing and cache aliases'
)
