import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve('dist')
const prefix = '/students/sgroup3898/'
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.glb': 'model/gltf-binary',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.wasm': 'application/wasm',
}
createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(
			new URL(request.url, 'http://localhost').pathname
		)
		if (!pathname.startsWith(prefix))
			throw new Error('Outside deployment folder')
		const file = resolve(
			root,
			pathname.slice(prefix.length) || 'index.html'
		)
		if (!file.startsWith(root + sep))
			throw new Error('Outside build')
		const bytes = await readFile(file)
		response.writeHead(200, {
			'Content-Type':
				types[extname(file)] ||
				'application/octet-stream',
		})
		response.end(bytes)
	} catch {
		console.error('404', request.url)
		response.writeHead(404).end('Not found')
	}
}).listen(4173, '127.0.0.1', () =>
	console.log(`Preview: http://localhost:4173${prefix}index.html`)
)
