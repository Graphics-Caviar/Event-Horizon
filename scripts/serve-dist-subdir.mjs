// Serve the production build under a URL subdirectory, imitating how the
// department LAMP server publishes each group's game at
// https://<server>/<group-folder>/. Catches the classic deployment bug
// where an absolute path works at localhost but 404s in the subfolder.
//
// Usage:  node scripts/serve-dist-subdir.mjs [port] [prefix]
//   e.g.  node scripts/serve-dist-subdir.mjs 4174 /event-horizon
// Then open http://localhost:4174/event-horizon/ and play the build.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const port = Number(process.argv[2]) || 4174
const prefix = process.argv[3] || '/event-horizon'

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
}

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://localhost')
	// Apache-style: /prefix 301-redirects to /prefix/ so relative
	// asset URLs resolve against the directory, not the server root.
	if (url.pathname === prefix) {
		res.writeHead(301, { Location: prefix + '/' })
		res.end()
		return
	}
	if (!url.pathname.startsWith(prefix + '/')) {
		res.writeHead(404, { 'content-type': 'text/plain' })
		res.end(`This server only hosts the build under ${prefix}/`)
		return
	}

	let rel = decodeURIComponent(url.pathname.slice(prefix.length + 1))
	let file = resolve(join(root, rel))
	if (file !== root && !file.startsWith(root + sep)) {
		res.writeHead(403)
		res.end()
		return
	}
	if (rel === '' || rel === '.') file = join(root, 'index.html')

	try {
		const stats = await stat(file)
		if (stats.isDirectory()) file = join(file, 'index.html')
		const body = await readFile(file)
		res.writeHead(200, {
			'content-type':
				MIME[extname(file).toLowerCase()] ||
				'application/octet-stream',
			'content-length': body.length,
		})
		res.end(body)
	} catch {
		res.writeHead(404, { 'content-type': 'text/plain' })
		res.end(`not found: ${rel}`)
	}
}).listen(port, () => {
	console.log(`dist served at http://localhost:${port}${prefix}/`)
})
