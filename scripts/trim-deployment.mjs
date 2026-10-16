import { readdir, access, unlink } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { assetUrl } from '../src/core/assetUrl.js'

// Remove only superseded model copies from the generated build.
// Original source models under public/ are never modified or deleted.
const root = resolve('dist')
for (const file of await readdir('public/assets/models', { recursive: true })) {
	if (!file.endsWith('.glb')) continue
	const path = `assets/models/${file.replaceAll('\\', '/')}`
	const optimized = assetUrl(`/${path}`).replace(/^\.\//, '')
	if (optimized === path) continue
	await access(resolve(root, optimized))
	const target = resolve(root, path)
	if (
		relative(root, target).startsWith('..') ||
		!target.startsWith(root + sep)
	)
		throw new Error('Invalid build target')
	await unlink(target).catch((error) => {
		if (error.code !== 'ENOENT') throw error
	})
}
console.log(
	'Deployment contains browser model copies; originals preserved in public/.'
)
