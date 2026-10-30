import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { MeshoptSimplifier } from 'meshoptimizer'
import { MeshoptDecoder } from 'meshoptimizer/decoder'

const sourcePath = new URL(
	'../public/assets/models/void/void-god-web.glb',
	import.meta.url
)
const outputPath = new URL(
	'../public/assets/models/void/void_god-web.glb',
	import.meta.url
)
const MAX_INDICES = 240000 // 80k triangles
const source = await readFile(sourcePath)
const jsonLength = source.readUInt32LE(12)
const gltf = JSON.parse(source.subarray(20, 20 + jsonLength))
const bin = source.subarray(28 + jsonLength)
const primitive = gltf.meshes[0].primitives[0]
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready])

const TYPES = {
	5120: Int8Array,
	5121: Uint8Array,
	5122: Int16Array,
	5123: Uint16Array,
	5125: Uint32Array,
	5126: Float32Array,
}
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

const decodeAccessor = (index, mode) => {
	const accessor = gltf.accessors[index]
	const view = gltf.bufferViews[accessor.bufferView]
	const ext = view.extensions?.EXT_meshopt_compression
	assert.ok(ext, `Accessor ${index} is not meshopt-compressed`)
	const Type = TYPES[accessor.componentType]
	const components = COMPONENTS[accessor.type]
	assert.ok(Type && components, `Accessor ${index} type is unsupported`)
	const size = components * Type.BYTES_PER_ELEMENT
	const target = new Uint8Array(accessor.count * size)
	const compressed = bin.subarray(
		ext.byteOffset,
		ext.byteOffset + ext.byteLength
	)
	MeshoptDecoder.decodeGltfBuffer(
		target,
		accessor.count,
		size,
		compressed,
		mode,
		ext.filter
	)
	return { accessor, values: new Type(target.buffer), components }
}

const positionsDecoded = decodeAccessor(
	primitive.attributes.POSITION,
	'ATTRIBUTES'
)
const uvDecoded = decodeAccessor(primitive.attributes.TEXCOORD_0, 'ATTRIBUTES')
const indexDecoded = decodeAccessor(primitive.indices, 'TRIANGLES')
const positions = Float32Array.from(positionsDecoded.values, (value) =>
	positionsDecoded.accessor.normalized ? value / 32767 : value
)
const uv = Float32Array.from(uvDecoded.values, (value) =>
	uvDecoded.accessor.normalized ? value / 65535 : value
)
const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
	indexDecoded.values,
	positions,
	3,
	uv,
	2,
	[1, 1],
	null,
	MAX_INDICES,
	0.008,
	['Permissive', 'RegularizeLight']
)
assert.ok(indices.length <= MAX_INDICES)
const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices)
const compact = (values, stride) => {
	const result = new Float32Array(vertexCount * stride)
	for (let i = 0; i < remap.length; i++) {
		if (remap[i] !== 0xffffffff)
			result.set(
				values.subarray(i * stride, (i + 1) * stride),
				remap[i] * stride
			)
	}
	return result
}
const packedPositions = compact(positions, 3)
const packedUv = compact(uv, 2)

const bufferViews = []
const chunks = []
let offset = 0
const appendView = (bytes) => {
	bufferViews.push({
		buffer: 0,
		byteOffset: offset,
		byteLength: bytes.length,
	})
	const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4)
	chunks.push(bytes, padding)
	offset += bytes.length + padding.length
	return bufferViews.length - 1
}
const positionView = appendView(
	Buffer.from(
		packedPositions.buffer,
		packedPositions.byteOffset,
		packedPositions.byteLength
	)
)
const uvView = appendView(
	Buffer.from(packedUv.buffer, packedUv.byteOffset, packedUv.byteLength)
)
const packedIndices = new Uint32Array(indices)
const indexView = appendView(
	Buffer.from(
		packedIndices.buffer,
		packedIndices.byteOffset,
		packedIndices.byteLength
	)
)
const imageViewMap = new Map()
for (const image of gltf.images ?? []) {
	if (imageViewMap.has(image.bufferView)) {
		image.bufferView = imageViewMap.get(image.bufferView)
		continue
	}
	const view = gltf.bufferViews[image.bufferView]
	const imageView = appendView(
		bin.subarray(
			view.byteOffset || 0,
			(view.byteOffset || 0) + view.byteLength
		)
	)
	imageViewMap.set(image.bufferView, imageView)
	image.bufferView = imageView
}

const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < packedPositions.length; i++) {
	const axis = i % 3
	min[axis] = Math.min(min[axis], packedPositions[i])
	max[axis] = Math.max(max[axis], packedPositions[i])
}
const outputGltf = {
	asset: {
		version: '2.0',
		generator: 'Event Horizon void-god optimizer',
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
		},
		{
			bufferView: uvView,
			componentType: 5126,
			count: vertexCount,
			type: 'VEC2',
		},
		{
			bufferView: indexView,
			componentType: 5125,
			count: indices.length,
			type: 'SCALAR',
		},
	],
	bufferViews,
	buffers: [{ byteLength: offset }],
}
if ((gltf.extensionsUsed ?? []).includes('EXT_texture_webp')) {
	outputGltf.extensionsUsed = ['EXT_texture_webp']
	outputGltf.extensionsRequired = ['EXT_texture_webp']
}
const text = Buffer.from(JSON.stringify(outputGltf))
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
const output = Buffer.concat([header, json, binHeader, ...chunks])
assert.equal(output.readUInt32LE(8), output.length)
assert.ok(output.length < 8 * 1024 * 1024)
await writeFile(outputPath, output)
console.log(
	`void_god: ${(source.length / 1e6).toFixed(2)} → ${(output.length / 1e6).toFixed(2)} MB; ${indexDecoded.values.length / 3} → ${indices.length / 3} triangles; error ${error.toFixed(5)}`
)
