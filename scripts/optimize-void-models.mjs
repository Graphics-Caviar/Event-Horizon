import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import draco3d from 'draco3d'
import { MeshoptSimplifier } from 'meshoptimizer'
import { VOID_ASSETS } from '../src/levels/Level3/voidAssets.js'

// Offline-only: decode the Draco-compressed Level 3 void GLBs and emit raw
// `-web.glb` browser copies — the same contract optimize-web-models.mjs
// established for aliens/rover/spaceships, extended to meshes that ship as
// a Draco stream. The draco3d Node build exposes the webidl wrapper API
// (not the heap pointers three's DRACOLoader binds in the browser):
// GetAttributeFloatForAllPoints for attributes, per-face GetFaceFromMesh
// for indices. Output keeps only POSITION + TEXCOORD_0 — GLTFLoader
// flat-shades meshes without normals — and preserves the embedded WebP
// textures and material verbatim, so assetUrl can serve these variants
// while voidAssets.js skips its runtime decimation pass for them.
const LIGHT_TARGET = 60000 // indices — projectiles share the aliens' tier
const HEAVY_TARGET = 240000 // indices — enemies, boss and monuments (80k tris)
const LIGHT_KEYS = new Set(['energyBolt', 'energyBoltHeavy'])

const decoderModule = await draco3d.createDecoderModule({})
const decoder = new decoderModule.Decoder()

const decodeDracoMesh = (gltf, bin) => {
	const extension =
		gltf.meshes[0].primitives[0].extensions
			?.KHR_draco_mesh_compression
	assert.ok(extension, 'primitive is not Draco-compressed')
	const view = gltf.bufferViews[extension.bufferView]
	const stream = new Int8Array(
		bin.buffer,
		bin.byteOffset + (view.byteOffset || 0),
		view.byteLength
	)
	const buffer = new decoderModule.DecoderBuffer()
	buffer.Init(stream, stream.length)
	assert.equal(
		decoder.GetEncodedGeometryType(buffer),
		decoderModule.TRIANGULAR_MESH
	)
	const mesh = new decoderModule.Mesh()
	decoder.DecodeBufferToMesh(buffer, mesh)
	decoderModule.destroy(buffer)
	assert.ok(mesh.num_faces() > 0, 'Draco decode produced no faces')
	return mesh
}

const extractIndices = (mesh) => {
	const indices = new Uint32Array(mesh.num_faces() * 3)
	const face = new decoderModule.DracoInt32Array()
	for (let i = 0; i < mesh.num_faces(); i++) {
		decoder.GetFaceFromMesh(mesh, i, face)
		const at = i * 3
		indices[at] = face.GetValue(0)
		indices[at + 1] = face.GetValue(1)
		indices[at + 2] = face.GetValue(2)
	}
	decoderModule.destroy(face)
	return indices
}

const extractAttribute = (mesh, semantic, stride) => {
	const id = decoder.GetAttributeId(mesh, decoderModule[semantic])
	assert.ok(id >= 0, `${semantic} attribute missing`)
	const wrapper = new decoderModule.DracoFloat32Array()
	decoder.GetAttributeFloatForAllPoints(
		mesh,
		decoder.GetAttribute(mesh, id),
		wrapper
	)
	const total = mesh.num_points() * stride
	assert.equal(wrapper.size(), total, `${semantic} size mismatch`)
	const values = new Float32Array(total)
	for (let i = 0; i < total; i++) {
		values[i] = wrapper.GetValue(i)
	}
	decoderModule.destroy(wrapper)
	return values
}

await MeshoptSimplifier.ready
for (const [key, def] of Object.entries(VOID_ASSETS)) {
	const base = new URL('../public/', import.meta.url)
	const input = await readFile(new URL(`.${def.path}`, base))
	const jsonLength = input.readUInt32LE(12)
	const gltf = JSON.parse(input.subarray(20, 20 + jsonLength))
	const bin = input.subarray(28 + jsonLength)
	assert.equal(gltf.meshes.length, 1)
	assert.equal(gltf.meshes[0].primitives.length, 1)
	const primitive = gltf.meshes[0].primitives[0]
	assert.ok(primitive.attributes.POSITION !== undefined)
	assert.ok(primitive.attributes.TEXCOORD_0 !== undefined)
	assert.ok(
		(gltf.images ?? []).every(
			(image) => image.bufferView !== undefined
		),
		'expected every image embedded as a bufferView'
	)

	const mesh = decodeDracoMesh(gltf, bin)
	const originalIndices = extractIndices(mesh)
	const positions = extractAttribute(mesh, 'POSITION', 3)
	const uv = extractAttribute(mesh, 'TEX_COORD', 2)
	decoderModule.destroy(mesh)
	const targetCount = LIGHT_KEYS.has(key) ? LIGHT_TARGET : HEAVY_TARGET
	const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
		originalIndices,
		positions,
		3,
		uv,
		2,
		[1, 1],
		null,
		targetCount,
		0.008,
		['Permissive', 'RegularizeLight']
	)
	assert.ok(
		indices.length <= targetCount,
		`${key}: simplifier stopped at ${indices.length / 3} tris (error ${error.toFixed(4)}) before the ${targetCount / 3}-tri budget`
	)
	const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices)
	const compact = (source, stride) => {
		const result = new Float32Array(vertexCount * stride)
		for (let i = 0; i < remap.length; i++) {
			if (remap[i] !== 0xffffffff) {
				result.set(
					source.subarray(
						i * stride,
						(i + 1) * stride
					),
					remap[i] * stride
				)
			}
		}
		return result
	}
	const packedPositions = compact(positions, 3)
	const packedUv = compact(uv, 2)
	const min = [Infinity, Infinity, Infinity]
	const max = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < packedPositions.length; i++) {
		const axis = i % 3
		min[axis] = Math.min(min[axis], packedPositions[i])
		max[axis] = Math.max(max[axis], packedPositions[i])
	}

	// Fresh container: geometry accessors become plain buffer views, the
	// Draco stream is dropped, and the material/texture chain is carried
	// over with the image bufferViews remapped onto the new layout.
	const bufferViews = []
	const chunks = []
	let offset = 0
	const appendView = (bytes) => {
		// bytes.byteLength, not bytes.length: geometry sources are typed
		// arrays where .length counts elements (4x too small for float/uint32
		// views) while image sources are Buffers where both agree.
		bufferViews.push({
			buffer: 0,
			byteOffset: offset,
			byteLength: bytes.byteLength,
		})
		const padding = Buffer.alloc((4 - (bytes.byteLength % 4)) % 4)
		chunks.push(
			Buffer.from(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength
			),
			padding
		)
		offset += bytes.byteLength + padding.length
		return bufferViews.length - 1
	}
	const positionView = appendView(packedPositions)
	const uvView = appendView(packedUv)
	const indexView = appendView(indices)
	const imageViewMap = new Map()
	for (const image of gltf.images ?? []) {
		if (!imageViewMap.has(image.bufferView)) {
			const view = gltf.bufferViews[image.bufferView]
			imageViewMap.set(
				image.bufferView,
				appendView(
					bin.subarray(
						view.byteOffset || 0,
						(view.byteOffset || 0) +
							view.byteLength
					)
				)
			)
		}
		image.bufferView = imageViewMap.get(image.bufferView)
	}

	const output = {
		asset: {
			version: gltf.asset?.version || '2.0',
			generator: 'Event Horizon offline void optimizer (draco3d decode + meshopt simplify)',
		},
		scene: gltf.scene ?? 0,
		scenes: gltf.scenes,
		nodes: gltf.nodes,
		meshes: [
			{
				name: gltf.meshes[0].name,
				primitives: [
					{
						attributes: {
							POSITION: positionView,
							TEXCOORD_0: uvView,
						},
						indices: indexView,
						material: primitive.material,
					},
				],
			},
		],
		materials: gltf.materials,
		textures: gltf.textures,
		images: gltf.images,
		samplers: gltf.samplers,
		accessors: [
			{
				bufferView: positionView,
				componentType: 5126,
				count: vertexCount,
				type: 'VEC3',
				min,
				max,
				byteOffset: 0,
			},
			{
				bufferView: uvView,
				componentType: 5126,
				count: vertexCount,
				type: 'VEC2',
				byteOffset: 0,
			},
			{
				bufferView: indexView,
				componentType: 5125,
				count: indices.length,
				type: 'SCALAR',
				byteOffset: 0,
			},
		],
		bufferViews,
		buffers: [{ byteLength: offset }],
	}
	if ((gltf.extensionsUsed ?? []).includes('EXT_texture_webp')) {
		output.extensionsUsed = ['EXT_texture_webp']
		output.extensionsRequired = ['EXT_texture_webp']
	}

	const text = Buffer.from(JSON.stringify(output))
	const json = Buffer.concat([
		text,
		Buffer.alloc((4 - (text.length % 4)) % 4, 0x20),
	])
	const header = Buffer.alloc(20)
	header.writeUInt32LE(0x46546c67, 0)
	header.writeUInt32LE(2, 4)
	header.writeUInt32LE(28 + json.length + offset, 8)
	header.writeUInt32LE(json.length, 12)
	header.writeUInt32LE(0x4e4f534a, 16)
	const binHeader = Buffer.alloc(8)
	binHeader.writeUInt32LE(offset, 0)
	binHeader.writeUInt32LE(0x004e4942, 4)
	const file = Buffer.concat([header, json, binHeader, ...chunks])
	assert.equal(
		file.readUInt32LE(8),
		file.length,
		'GLB header length mismatch'
	)
	assert.equal(
		offset,
		file.length - 28 - json.length,
		'BIN chunk size mismatch'
	)
	assert.ok(indices.length < originalIndices.length / 2)
	assert.ok(file.length < input.length / 2)
	for (const index of indices) assert.ok(index < vertexCount)
	await writeFile(
		new URL(`.${def.path.replace(/\.glb$/, '-web.glb')}`, base),
		file
	)
	console.log(
		`${key}: ${(input.length / 1e6).toFixed(2)} → ${(file.length / 1e6).toFixed(2)} MB; ${originalIndices.length / 3} → ${indices.length / 3} triangles; error ${error.toFixed(5)}`
	)
}
decoderModule.destroy(decoder)
