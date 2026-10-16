// Headless checks for the Level 3 void asset pipeline. Two parts:
//   A. every void GLB declares KHR_draco_mesh_compression — the data-driven
//      reason AssetManager must carry a DRACOLoader (decoding itself needs
//      DOM Workers, so it is verified in the browser, not here).
//   B. the -web.glb resolution path: loadVoidModel must skip decimation
//      for pre-optimized variants and share the cached geometry, while the
//      meshopt fallback (decimateModel → simplify → vertex re-pack) still
//      lands its ratio/alignment targets on a dense indexed geometry.
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
	VOID_ASSETS,
	decimateModel,
	loadVoidModel,
} from '../src/levels/Level3/voidAssets.js'

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

// ---- B. Decimation pipeline ----------------------------------------------
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

// B1: assetUrl maps every void path to a pre-optimized -web.glb variant,
// so loadVoidModel must leave the cached source untouched and hand out
// clones sharing that exact geometry — no runtime pass for these.
const model = await loadVoidModel(stubManager, key)
assert(model, 'loadVoidModel returned null')
if (model) {
	assert(
		countTris(model) === sourceTris,
		'-web resolution must skip runtime decimation'
	)
	assert(
		model.geometry === source.geometry,
		'clone does not share the cached source geometry'
	)
	const again = await loadVoidModel(stubManager, key)
	assert(
		again.geometry === model.geometry,
		'cached clone does not share the same geometry'
	)
	console.log(
		'B1: -web variants skip runtime decimation, clones share geometry'
	)
}

// B2: the fallback pass itself — dense original → ratio → re-pack.
const started = performance.now()
await decimateModel(source, def.simplify)
const elapsed = ((performance.now() - started) / 1000).toFixed(1)
const decTris = countTris(source)
const decVerts = source.geometry.attributes.position.count
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
const geometry = source.geometry
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
	`B2: ${sourceTris} → ${decTris} tris (${(ratio * 100).toFixed(0)}% of target ${(def.simplify * 100).toFixed(0)}%), verts ${sourceVerts} → ${decVerts}, ${elapsed}s`
)

console.log(
	failures === 0
		? 'VOID DECIMATE: all checks passed'
		: `VOID DECIMATE: ${failures} failure(s)`
)
process.exit(failures === 0 ? 0 : 1)
