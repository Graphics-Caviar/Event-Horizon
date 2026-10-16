// Post-build sanity check: the LAMP server publishes the game in a
// subdirectory, so the built bundle must contain no absolute /assets/
// URLs. Run after `npm run build`:
//   node scripts/check-relative-paths.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist', import.meta.url).pathname.replace(
	/^\/([A-Za-z]:)/,
	'$1'
)

const results = []
let failed = false

function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			walk(full)
		} else if (/\.(js|css|html)$/.test(entry)) {
			check(full)
		}
	}
}

function check(file) {
	const text = readFileSync(file, 'utf8')
	const bad = [...text.matchAll(/[\"'`](\/assets\/[^\"'`]+)/g)].map(
		(m) => m[1]
	)
	if (bad.length > 0) {
		failed = true
		results.push(`FAIL ${file} -> ${bad.join(', ')}`)
	} else {
		results.push(`ok   ${file}`)
	}
}

walk(dist)
console.log(results.join('\n'))

// Count relative model refs across every bundle (names are content-hashed,
// so never hardcode one).
let relCount = 0
for (const entry of readdirSync(join(dist, 'assets'))) {
	if (/^index-.*\.js$/.test(entry)) {
		const text = readFileSync(join(dist, 'assets', entry), 'utf8')
		relCount += (text.match(/assets\/models\//g) || []).length
	}
}
console.log(`\nrelative 'assets/models/' refs in bundles: ${relCount}`)
process.exit(failed ? 1 : 0)
