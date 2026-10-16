import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { MeshoptSimplifier } from 'meshoptimizer'

// Offline-only: preserve source assets and embedded textures.
// UV-aware simplification; retain UV seams, materials and model coordinates.
await MeshoptSimplifier.ready
for (const name of [
	'aliens/alien-predator',
	'aliens/alien-flying-predator',
	'aliens/armored-alien-brute',
	'rover/sci-fi-exploration-rover',
	'spaceship/spaceship',
	'spaceship/starfighter',
	'spaceship/aegis',
]) {
	const base = new URL('../public/assets/models/', import.meta.url)
	const input = await readFile(new URL(`${name}.glb`, base))
	const jsonLength = input.readUInt32LE(12)
	const gltf = JSON.parse(input.subarray(20, 20 + jsonLength))
	const bin = input.subarray(28 + jsonLength)
	assert.equal(gltf.meshes.length, 1)
	assert.equal(gltf.meshes[0].primitives.length, 1)
	const primitive = gltf.meshes[0].primitives[0]
	assert.deepEqual(Object.keys(primitive.attributes).sort(), [
		'POSITION',
		'TEXCOORD_0',
	])
	const read = (index, Type, stride) => {
		const accessor = gltf.accessors[index]
		const view = gltf.bufferViews[accessor.bufferView]
		assert.ok(!view.byteStride && !accessor.sparse)
		const offset =
			bin.byteOffset +
			(view.byteOffset || 0) +
			(accessor.byteOffset || 0)
		return new Type(bin.buffer, offset, accessor.count * stride)
	}
	const positions = read(primitive.attributes.POSITION, Float32Array, 3)
	const uv = read(primitive.attributes.TEXCOORD_0, Float32Array, 2)
	const originalIndices = read(primitive.indices, Uint32Array, 1)
	const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
		originalIndices,
		positions,
		3,
		uv,
		2,
		[1, 1],
		null,
		name.startsWith('aliens/') ? 60000 : 240000,
		0.008,
		['Permissive', 'RegularizeLight']
	)
	const [remap, count] = MeshoptSimplifier.compactMesh(indices)
	const compact = (source, stride) => {
		const result = new Float32Array(count * stride)
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
	const replacements = new Map()
	for (const [index, data, stride] of [
		[primitive.attributes.POSITION, compact(positions, 3), 3],
		[primitive.attributes.TEXCOORD_0, compact(uv, 2), 2],
		[primitive.indices, indices, 1],
	]) {
		const accessor = gltf.accessors[index]
		accessor.count = data.length / stride
		accessor.byteOffset = 0
		if (accessor.min || accessor.max) {
			accessor.min = Array(stride).fill(Infinity)
			accessor.max = Array(stride).fill(-Infinity)
			for (let i = 0; i < data.length; i++) {
				accessor.min[i % stride] = Math.min(
					accessor.min[i % stride],
					data[i]
				)
				accessor.max[i % stride] = Math.max(
					accessor.max[i % stride],
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
	let offset = 0
	const chunks = gltf.bufferViews.flatMap((view, i) => {
		const bytes =
			replacements.get(i) ||
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
	assert.ok(indices.length < originalIndices.length / 2)
	assert.ok(output.length < input.length / 2)
	for (const index of indices) assert.ok(index < count)
	await writeFile(new URL(`${name}-web.glb`, base), output)
	console.log(
		`${name}: ${(input.length / 1e6).toFixed(2)} → ${(output.length / 1e6).toFixed(2)} MB; ${originalIndices.length / 3} → ${indices.length / 3} triangles; error ${error.toFixed(5)}`
	)
}
