/**
 * Surgical hotfix for Event Horizon's Level 3 Matter -> Void portal.
 * Run once from project root: node tools/fix-matter-portal.mjs
 * Keeps teammate changes by modifying ONLY _checkPortalArrival and an exact HUD string.
 */
import fs from 'node:fs'
import path from 'node:path'

const target = path.resolve(process.cwd(), 'src/levels/Level3/Level3.js')
if (!fs.existsSync(target)) {
  console.error('Missing src/levels/Level3/Level3.js — run from the Event-Horizon project root.')
  process.exit(1)
}
const original = fs.readFileSync(target, 'utf8')
const signature = /(?:^|\n)[ \t]*_checkPortalArrival\s*\(\s*\)\s*\{/g
const matches = [...original.matchAll(signature)]
if (matches.length !== 1) {
  console.error(`Expected exactly one _checkPortalArrival() method, found ${matches.length}. File unchanged.`)
  process.exit(1)
}
const match = matches[0]
const nameAt = match.index + (match[0].startsWith('\n') ? 1 : 0)
const openAt = original.indexOf('{', nameAt)
// Balanced method braces, skipping quoted strings and comments.
let depth = 0, endAt = -1, quote = null, lineComment = false, blockComment = false
for (let i = openAt; i < original.length; i++) {
  const c = original[i], next = original[i + 1]
  if (lineComment) { if (c === '\n') lineComment = false; continue }
  if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++ } continue }
  if (quote) {
    if (c === '\\') { i++; continue }
    if (c === quote) quote = null
    continue
  }
  if (c === '/' && next === '/') { lineComment = true; i++; continue }
  if (c === '/' && next === '*') { blockComment = true; i++; continue }
  if (c === "'" || c === '"' || c === '`') { quote = c; continue }
  if (c === '{') depth++
  if (c === '}' && --depth === 0) { endAt = i + 1; break }
}
if (endAt < 0) { console.error('Could not locate end of method. File unchanged.'); process.exit(1) }
const previous = original.slice(nameAt, endAt)
if (previous.includes('Level 3 is a jetpack stage: allow entry from the air.')) {
  console.log('Portal fix already applied; no files changed.')
  process.exit(0)
}
if (!previous.includes('portal') || !previous.includes('_checkPortalArrival')) {
  console.error('Current method differs from expected portal logic. File unchanged.')
  process.exit(1)
}
const eol = original.includes('\r\n') ? '\r\n' : '\n'
const patchedMethod = [
  '\t_checkPortalArrival() {',
  '\t\t// Level 3 is a jetpack stage: allow entry from the air.',
  '\t\t// Avoid a soft-lock when the final alien encounter cannot finish.',
  '\t\tif (this.completed || this.transitionHeld || this.voidDimension) return',
  '\t\tconst pilot = this.playerRoot?.position',
  '\t\tconst gate = this.portal?.group?.position || this.portalSite',
  '\t\tif (!pilot || !gate) return',
  '\t\tconst flatDistance = Math.hypot(pilot.x - gate.x, pilot.z - gate.z)',
  '\t\tconst heightDistance = Math.abs(pilot.y - (gate.y + 8))',
  '\t\t// Reach the visible Grav Rift, on foot or using the jetpack.',
  '\t\tif (flatDistance > 24 || heightDistance > 60) return',
  '\t\tthis.portal?.playArrival?.()',
  "\t\tthis._showMovementFeedback?.('ENTERING THE VOID DIMENSION', 2)",
  '\t\tthis._completeMission()',
  '\t}',
].join(eol)
let result = original.slice(0, nameAt) + patchedMethod + original.slice(endAt)
const oldText = 'Defeat the final encounter to enter the Grav Rift.'
const newText = 'Reach the glowing Grav Rift to enter the Void Dimension. Avoid or fight the aliens along the way.'
if (result.includes(oldText)) result = result.replace(oldText, newText)
else console.warn('HUD objective wording changed in recent merges; leaving it intact.')
if (result === original) { console.log('No changes needed.'); process.exit(0) }
const backup = target + '.pre-portal-fix.bak'
fs.writeFileSync(backup, original)
fs.writeFileSync(target, result)
console.log('Portal fixed:', path.relative(process.cwd(), target))
console.log('Backup:', path.relative(process.cwd(), backup))
console.log('Run: npm run build (or npm run dev), then test Matter -> Void portal.')
