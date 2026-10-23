// Bundle the browser modules with the same static environment defines as Vite.
// esbuild already ships with Vite; this adds no dependency.
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const outfile = path.resolve('.tmp-cutscene-test/void-bundle.mjs')
await build({
	entryPoints: ['scripts/check-void-cutscene.mjs'],
	outfile,
	bundle: true,
	platform: 'node',
	format: 'esm',
	define: {
		'import.meta.env':
			'{"DEV":true,"BASE_URL":"/","MODE":"development","PROD":false}',
	},
	loader: { '.css': 'empty' },
	external: [
		'three',
		'@dimforge/rapier3d-compat',
		'meshoptimizer',
		'firebase',
		'firebase/*',
	],
	logLevel: 'warning',
})
await import(pathToFileURL(outfile).href)
