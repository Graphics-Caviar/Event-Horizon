import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { MeshoptSimplifier } from 'meshoptimizer'

// Keep skin and bone weights while reducing skinned meshes to a browser-sized
// triangle budget. Original GLBs remain untouched.
const ERROR = 0.003
const ASSETS = [
	...['zara-voss', 'kai-ryder', 'nyx'].map((name) => ({
		folder: 'pilots',
		name,
		targetIndices: 180000,
	})),
	...[
		'alien-predator',
		'alien-flying-predator',
		'armored-alien-brute',
	].map((name) => ({
		folder: 'aliens',
		name,
		targetIndices: 120000,
	})),
]

const TYPES = {
	5121: Uint8Array,
	5122: Int16Array,
	5123: Uint16Array,
	5125: Uint32Array,
	5126: Float32Array,
}
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

await MeshoptSimplifier.ready

for (const { folder, name, targetIndices } of ASSETS) {
	const base = new URL(
		`../public/assets/models/${folder}/`,
		import.meta.url
	)
	const input = await readFile(new URL(`${name}-rigged.glb`, base))
	const jsonLength = input.readUInt32LE(12)
	const gltf = JSON.parse(input.subarray(20, 20 + jsonLength))
	const bin = input.subarray(28 + jsonLength)
	assert.equal(gltf.meshes.length, 1)
	assert.equal(gltf.meshes[0].primitives.length, 1)
	assert.ok(gltf.skins?.length, `${name}: skin is missing`)
	const primitive = gltf.meshes[0].primitives[0]
	for (const semantic of [
		'POSITION',
		'TEXCOORD_0',
		'JOINTS_0',
		'WEIGHTS_0',
	])
		assert.ok(
			primitive.attributes[semantic] !== undefined,
			`${name}: ${semantic} is missing`
		)

	const readAccessor = (accessorIndex) => {
		const accessor = gltf.accessors[accessorIndex]
		const view = gltf.bufferViews[accessor.bufferView]
		const Type = TYPES[accessor.componentType]
		const stride = COMPONENTS[accessor.type]
		assert.ok(Type && stride, `${name}: unsupported accessor`)
		assert.ok(
			!accessor.sparse,
			`${name}: sparse accessors are unsupported`
		)
		const bytesPerElement = Type.BYTES_PER_ELEMENT
		const byteStride = view.byteStride || stride * bytesPerElement
		assert.equal(byteStride, stride * bytesPerElement)
		const start =
			(view.byteOffset || 0) + (accessor.byteOffset || 0)
		const values = new Type(
			bin.buffer,
			bin.byteOffset + start,
			accessor.count * stride
		)
		return { accessor, values, stride, Type }
	}

	const attributes = Object.entries(primitive.attributes).map(
		([semantic, index]) => [semantic, index, readAccessor(index)]
	)
	const position = attributes.find(
		([semantic]) => semantic === 'POSITION'
	)[2]
	const uv = attributes.find(([semantic]) => semantic === 'TEXCOORD_0')[2]
	const indexInfo = readAccessor(primitive.indices)
	const sourceIndices = indexInfo.values
	const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
		sourceIndices,
		position.values,
		position.stride,
		uv.values,
		uv.stride,
		[1, 1],
		null,
		targetIndices,
		ERROR,
		['Permissive', 'RegularizeLight']
	)
	assert.ok(indices.length <= targetIndices)
	const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices)
	const compact = ({ values, stride, Type }) => {
		const result = new Type(vertexCount * stride)
		for (let i = 0; i < remap.length; i++) {
			if (remap[i] !== 0xffffffff) {
				result.set(
					values.subarray(
						i * stride,
						(i + 1) * stride
					),
					remap[i] * stride
				)
			}
		}
		return result
	}

	const replacements = new Map()
	for (const [, accessorIndex, source] of attributes) {
		const data = compact(source)
		const accessor = gltf.accessors[accessorIndex]
		accessor.count = vertexCount
		accessor.byteOffset = 0
		if (
			accessor.type === 'VEC3' &&
			accessor.componentType === 5126
		) {
			accessor.min = [Infinity, Infinity, Infinity]
			accessor.max = [-Infinity, -Infinity, -Infinity]
			for (let i = 0; i < data.length; i++) {
				const axis = i % 3
				accessor.min[axis] = Math.min(
					accessor.min[axis],
					data[i]
				)
				accessor.max[axis] = Math.max(
					accessor.max[axis],
					data[i]
				)
			}
		}
		replacements.set(
			accessor.bufferView,
			Buffer.from(
				data.buffer,
				data.byteOffset,
				data.byteLength
			)
		)
	}
	const packedIndices = new Uint32Array(indices)
	indexInfo.accessor.count = packedIndices.length
	indexInfo.accessor.byteOffset = 0
	let minIndex = Infinity
	let maxIndex = -Infinity
	for (const index of packedIndices) {
		minIndex = Math.min(minIndex, index)
		maxIndex = Math.max(maxIndex, index)
	}
	indexInfo.accessor.min = [minIndex]
	indexInfo.accessor.max = [maxIndex]
	replacements.set(
		indexInfo.accessor.bufferView,
		Buffer.from(
			packedIndices.buffer,
			packedIndices.byteOffset,
			packedIndices.byteLength
		)
	)

	let offset = 0
	const chunks = gltf.bufferViews.flatMap((view, index) => {
		const bytes =
			replacements.get(index) ||
			bin.subarray(
				view.byteOffset || 0,
				(view.byteOffset || 0) + view.byteLength
			)
		view.byteOffset = offset
		view.byteLength = bytes.length
		const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4)
		offset += bytes.length + padding.length
		return [bytes, padding]
	})
	gltf.buffers[0].byteLength = offset
	const text = Buffer.from(JSON.stringify(gltf))
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
	assert.ok(indices.length <= targetIndices)
	await writeFile(new URL(`${name}-web-rigged.glb`, base), output)
	console.log(
		`${name}: ${(input.length / 1e6).toFixed(2)} → ${(output.length / 1e6).toFixed(2)} MB; ${sourceIndices.length / 3} → ${indices.length / 3} triangles; error ${error.toFixed(5)}`
	)
}
