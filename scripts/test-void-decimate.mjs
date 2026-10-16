// Headless checks for the Level 3 void asset pipeline. Two parts:
//   A. every void GLB declares KHR_draco_mesh_compression — the data-driven
//      reason AssetManager must carry a DRACOLoader (decoding itself needs
//      DOM Workers, so it is verified in the browser, not here).
//   B. the void-only decimation/compaction stage (loadVoidModel → meshopt
//      simplify → vertex re-pack → clone) runs on a dense indexed geometry
//      and lands its ratio/alignment targets.
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { VOID_ASSETS, loadVoidModel } from '../src/levels/Level3/voidAssets.js'

let failures = 0
const assert = (condition, message) => {
	if (!condition) {
		console.error('FAIL:', message)
		failures += 1
	}
}

// ---- A. Draco compression markers ---------------------------------------
for (const [key, def] of Object.entries(VOID_ASSETS)) {
	const buffer = readFileSync(`public/${def.path}`)
	assert(
		buffer.readUInt32LE(0) === 0x46546c67,
		`${key}: not a GLB container`
	)
	const jsonLength = buffer.readUInt32LE(12)
	const json = JSON.parse(
		buffer.slice(20, 20 + jsonLength).toString('utf8')
	)
	assert(
		(json.extensionsUsed ?? []).includes(
			'KHR_draco_mesh_compression'
		),
		`${key}: expected KHR_draco_mesh_compression, found [${(json.extensionsUsed ?? []).join(', ')}]`
	)
}
console.log('A: all void GLBs declare KHR_draco_mesh_compression')

// ---- B. Decimation + compaction through the real loadVoidModel -----------
const buildDenseRoot = () => {
	// SphereGeometry is indexed — the shape of the audited void meshes
	// (single mesh, indexed, ~1.5M tris at generation quality).
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 512, 256))
	mesh.geometry.computeVertexNormals()
	const uv = new Float32Array(mesh.geometry.attributes.position.count * 2)
	mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
	return mesh
}

const countTris = (root) => {
	let tris = 0
	root.traverse((child) => {
		if (!child.isMesh || !child.geometry) return
		const geometry = child.geometry
		tris += geometry.index
			? geometry.index.count / 3
			: (geometry.attributes.position?.count ?? 0) / 3
	})
	return Math.round(tris)
}

const key = 'riftStalker'
const def = VOID_ASSETS[key]
const source = buildDenseRoot()
const sourceTris = countTris(source)
const sourceVerts = source.geometry.attributes.position.count

const stubManager = {
	preloadModel: async () => {},
	getRawModel: () => ({ scene: source }),
	loadModel: async () => source.clone(true), // clones share geometry
}
const started = performance.now()
const model = await loadVoidModel(stubManager, key)
const elapsed = ((performance.now() - started) / 1000).toFixed(1)
assert(model, 'loadVoidModel returned null')
if (model) {
	const decTris = countTris(model)
	const decVerts = model.geometry.attributes.position.count
	const ratio = decTris / sourceTris
	assert(
		decTris > 0 && decTris <= sourceTris,
		`decimated tri count ${decTris} out of range`
	)
	assert(
		ratio <= def.simplify * 1.5 + 0.02,
		`ratio ${(ratio * 100).toFixed(0)}% misses target ${(def.simplify * 100).toFixed(0)}%`
	)
	assert(
		decVerts < sourceVerts,
		`compaction left vertices untouched (${decVerts} vs ${sourceVerts})`
	)
	const geometry = model.geometry
	const index = geometry.index.array
	assert(index.length % 3 === 0, 'index not triangle-aligned')
	let max = 0
	for (let i = 0; i < index.length; i++) {
		if (index[i] > max) max = index[i]
	}
	assert(
		max < geometry.attributes.position.count,
		`index vertex ${max} beyond ${geometry.attributes.position.count}`
	)
	for (const attribute of Object.values(geometry.attributes)) {
		assert(
			attribute.count === geometry.attributes.position.count,
			`attribute "${attribute.name}" misaligned (${attribute.count} vs ${geometry.attributes.position.count})`
		)
	}
	geometry.computeBoundingBox()
	const box = geometry.boundingBox
	assert(
		box.min.y >= -1.01 && box.max.y <= 1.01 && box.min.x >= -1.01,
		`decimated bbox drifted: ${JSON.stringify(box)}`
	)
	console.log(
		`B: ${sourceTris} → ${decTris} tris (${(ratio * 100).toFixed(0)}% of target ${(def.simplify * 100).toFixed(0)}%), verts ${sourceVerts} → ${decVerts}, ${elapsed}s`
	)
	// A second load must reuse the prepped geometry without re-decimating.
	const again = await loadVoidModel(stubManager, key)
	assert(
		again.geometry === model.geometry,
		'cached clone does not share the decimated geometry'
	)
	console.log('B: cached clone shares the decimated geometry')
}

console.log(
	failures === 0
		? 'VOID DECIMATE: all checks passed'
		: `VOID DECIMATE: ${failures} failure(s)`
)
process.exit(failures === 0 ? 0 : 1)
