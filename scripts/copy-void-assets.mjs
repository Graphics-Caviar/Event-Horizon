// One-off: copies the downloaded Level 3 'Void of Gods' GLBs into the
// project with clean kebab-case names (folder assets had spaces/parens).
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const src = 'c:/Users/mpilo/Downloads/graphics'
const dst = 'c:/Users/mpilo/Event-Horizon/public/assets/models/void'
mkdirSync(dst, { recursive: true })

const map = {
	'rift-stalker.glb': 'Rift Stalker.glb',
	'void-sentinel.glb': 'Void Sentinel.glb',
	'void-entity.glb': 'Cosmic Void Entity (1).glb',
	'void-colossus.glb': 'Void Colossus.glb',
	'boss-arena.glb': 'Void of Gods Boss Arena.glb',
	'broken-bridge.glb': 'Broken Alien Bridge.glb',
	'ancient-reactor.glb': 'Ancient Alien Energy Reactor.glb',
	'grav-rift.glb': 'Gravitational Rift.glb',
	'anomaly-ship.glb': 'Spaceship in Gravitational Anomaly.glb',
	'energy-blade.glb': 'Alien Energy Blade.glb',
	'energy-bolt.glb': 'Alien Energy Projectile.glb',
	'energy-bolt-heavy.glb': 'Alien Energy Projectile (1).glb',
}

for (const [name, from] of Object.entries(map)) {
	copyFileSync(join(src, from), join(dst, name))
	console.log(`copied  ${from}  ->  ${name}`)
}

console.log('--- void asset folder ---')
for (const f of readdirSync(dst)) {
	const mb = (statSync(join(dst, f)).size / 1048576).toFixed(1)
	console.log(`  ${f}  ${mb} MB`)
}
