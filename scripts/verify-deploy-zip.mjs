// Verify the LAMP deployment archive: index.html at the top level,
// forward-slash entries (Linux-safe), and report size.
//   node scripts/verify-deploy-zip.mjs [path-to-zip]
import { statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const zip =
	process.argv[2] ??
	new URL(
		'../event-horizon-lamp-deploy.zip',
		import.meta.url
	).pathname.replace(/^\/([A-Za-z]:)/, '$1')

if (!existsSync(zip)) {
	console.error(`zip not found: ${zip}`)
	process.exit(1)
}

const listing = execFileSync('tar', ['-tvf', zip], {
	encoding: 'utf8',
})
const lines = listing.trim().split('\n')
const entries = lines.map((l) => l.trim().split(/\s+/).slice(-1)[0])

console.log(`archive: ${zip}`)
console.log(`entries: ${lines.length}`)
console.log(`size: ${(statSync(zip).size / 1048576).toFixed(1)} MB`)
console.log(
	`index.html at top level: ${entries.includes('index.html')}`
)
console.log(`forward slashes only: ${entries.every((e) => !e.includes('\\'))}`)
console.log(`model files: ${entries.filter((e) => e.endsWith('.glb')).length}`)
console.log('\nfirst entries:')
console.log(lines.slice(0, 8).join('\n'))
