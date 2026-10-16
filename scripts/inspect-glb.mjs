// Full GLB header inspector: reports geometry, rigs, animation clips,
// materials and textures from the JSON chunk without parsing buffers.
// Usage: node scripts/inspect-glb.mjs [dirOrFile ...]
// Defaults to the downloaded Level 3 asset folder when no arg is given.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const collect = (targets, found = []) => {
	for (const t of targets) {
		if (statSync(t).isDirectory())
			collect(
				readdirSync(t).map((n) => join(t, n)),
				found
			)
		else if (/\.glb$/i.test(t)) found.push(t)
	}
	return found
}

const targets = process.argv.slice(2)
const files = collect(
	targets.length
		? targets
		: ['c:/Users/mpilo/Downloads/graphics']
)

for (const file of files) {
	const buf = readFileSync(file)
	const name = file.split(/[\\/]/).pop()
	if (buf.readUInt32LE(0) !== 0x46546c67) {
		console.log(`\n=== ${name}: NOT A GLB ===`)
		continue
	}
	const jsonLen = buf.readUInt32LE(12)
	const g = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
	const mb = (buf.length / 1048576).toFixed(1)

	// Geometry: triangle count and raw bounding box from POSITION accessors.
	let prims = 0
	let tris = 0
	let verts = 0
	const min = [Infinity, Infinity, Infinity]
	const max = [-Infinity, -Infinity, -Infinity]
	let uvSets = 0
	let hasVertexColors = false
	for (const mesh of g.meshes ?? [])
		for (const prim of mesh.primitives ?? []) {
			prims++
			const idx = g.accessors[prim.indices ?? -1]
			if (idx) tris += idx.count / 3
			const pos = g.accessors[prim.attributes?.POSITION ?? -1]
			if (pos) {
				verts += pos.count
				for (let i = 0; i < 3; i++) {
					min[i] = Math.min(min[i], pos.min[i])
					max[i] = Math.max(max[i], pos.max[i])
				}
			}
			uvSets = Math.max(
				uvSets,
				prim.attributes?.TEXCOORD_0 !== undefined
					? 1
					: 0
			)
			hasVertexColors ||= prim.attributes?.COLOR_0 !== undefined
		}
	const dims = max.map((v, i) => v - min[i])

	console.log(`\n=== ${name}  (${mb} MB) ===`)
	console.log(
		`meshes ${g.meshes?.length ?? 0}, prims ${prims}, tris ${Math.round(tris).toLocaleString()}, verts ${verts.toLocaleString()}`
	)
	console.log(
		`raw bbox min [${min.map((v) => v.toFixed(2)).join(', ')}] max [${max
			.map((v) => v.toFixed(2))
			.join(', ')}] size [${dims
			.map((v) => v.toFixed(2))
			.join(', ')}]`
	)
	console.log(
		`skins ${(g.skins ?? []).length}, nodes ${g.nodes?.length ?? 0}, uvSets ${uvSets}, vertexColors ${hasVertexColors}`
	)
	const clips = g.animations ?? []
	console.log(
		`animations ${clips.length}${
			clips.length
				? ': ' +
					clips
						.map(
							(a) =>
								`"${a.name || '(unnamed)'}" (${a.channels.length}ch)`
						)
						.join(', ')
				: ''
		}`
	)
	console.log(
		`materials ${(g.materials ?? []).length}, textures ${
			(g.textures ?? []).length
		}, images ${(g.images ?? []).length}, extensions ${Object.keys(
			g.extensionsUsed ?? {}
		).join(', ') || 'none'}`
	)
	// Node names are the bone/parts map — needed for procedural bone work.
	const names = (g.nodes ?? [])
		.map((n) => n.name)
		.filter(Boolean)
	console.log(
		`node names: ${
			names.length
				? names.slice(0, 24).join(', ') +
					(names.length > 24 ? ` … (+${names.length - 24} more)` : '')
				: '(none)'
		}`
	)
}
