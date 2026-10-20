// Reports the raw authored size of each gameplay GLB (from POSITION
// accessor min/max) and the factor Level2._fit applies to reach the
// target size. Any absolute scale.set on a fitted model must multiply
// by this factor — assuming 1 clobbers the fit (shrinks or enlarges).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'public/assets/models'
const FIT_TARGETS = {
	'aliens/alien-predator.glb': 5.5,
	'aliens/armored-alien-brute.glb': 5.5,
	'aliens/alien-flying-predator.glb': 5.5,
	'rover/sci-fi-exploration-rover.glb': 11,
}

for (const [rel, target] of Object.entries(FIT_TARGETS)) {
	const buf = readFileSync(join(root, rel))
	if (buf.readUInt32LE(0) !== 0x46546c67) {
		console.log(`${rel}: not a GLB`)
		continue
	}
	const jsonLen = buf.readUInt32LE(12)
	const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
	const min = [Infinity, Infinity, Infinity]
	const max = [-Infinity, -Infinity, -Infinity]
	for (const mesh of gltf.meshes || [])
		for (const prim of mesh.primitives || []) {
			const acc = gltf.accessors[prim.attributes?.POSITION]
			if (!acc?.min || !acc?.max) continue
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], acc.min[i])
				max[i] = Math.max(max[i], acc.max[i])
			}
		}
	const longest = Math.max(...max.map((v, i) => v - min[i]))
	const factor = target / longest
	const note =
		factor > 1.05
			? '  <- upscaled; absolute scale.set would SHRINK it'
			: factor < 0.95
				? '  <- downscaled; absolute scale.set would ENLARGE it'
				: ''
	console.log(
		`${rel}: raw ${longest.toFixed(2)} units, _fit(${target}) scale ${factor.toFixed(4)}${note}`
	)
}
