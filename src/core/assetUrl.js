// Keep all local model requests inside the deployed application folder.
// The originals remain available for editing; browsers use lighter copies.
export function assetUrl(path, base = import.meta.env?.BASE_URL || './') {
	if (!path.startsWith('/assets/')) return path
	let relative = path.slice(1)
	if (
		/^assets\/models\/(pilots|aliens)\/[^/]+-rigged\.glb$/.test(
			relative
		) &&
		!relative.endsWith('-web-rigged.glb')
	) {
		relative = relative.replace(/-rigged\.glb$/, '-web-rigged.glb')
	} else if (
		/^assets\/models\/void\/(rift-stalker|void-sentinel|void-entity|void-colossus)\.glb$/.test(
			relative
		)
	) {
		relative = relative.replace(/\.glb$/, '-web-rigged.glb')
	} else if (relative === 'assets/models/void/void-god-web.glb') {
		relative = 'assets/models/void/void_god-web.glb'
	} else if (
		/^assets\/models\/pilots\/[^/]+\.glb$/.test(relative) &&
		!relative.endsWith('-gameplay.glb') &&
		!relative.endsWith('-rigged.glb')
	) {
		relative = relative.replace(/\.glb$/, '-gameplay.glb')
	} else if (
		/^assets\/models\/(aliens|rover|spaceship|void)\/[^/]+\.glb$/.test(
			relative
		) &&
		!relative.endsWith('-web.glb') &&
		!relative.endsWith('-rigged.glb')
	) {
		relative = relative.replace(/\.glb$/, '-web.glb')
	}
	return `${base.endsWith('/') ? base : `${base}/`}${relative}`
}
