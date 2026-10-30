#!/usr/bin/env node
/**
 * Event Horizon | Batch GLB polygon reduction, safely staged.
 * Requires Node 20+ and glTF Transform CLI:
 *   npm install --global @gltf-transform/cli
 *   node tools/optimize-level3-glbs.mjs
 *
 * Writes optimized assets separately from originals. The Level 3 loader will
 * automatically use the optimized art when its corresponding GLB exists.
 * The optional --all-models flag also processes other GLBs into a separate
 * preview directory, preserving their skeletons and existing runtime paths.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = process.cwd()
const modelRoot = path.join(projectRoot, 'public/assets/models')
const visualDir = path.join(modelRoot, 'level3-visuals')
const visualOut = path.join(visualDir, 'optimized')
const extraOut = path.join(projectRoot, 'public/assets/models-optimized')


/**
 * Run the installed CLI's JavaScript entry directly through Node, not the
 * `gltf-transform.cmd` Windows shim. Recent Node versions cannot spawn .cmd
 * files without a shell, and using a shell would complicate quoting paths.
 * Look for a local install first, then common global npm locations.
 */
function findCliEntry() {
  const relativeCli = path.join('@gltf-transform', 'cli', 'bin', 'cli.js')
  const roots = [
    path.join(projectRoot, 'node_modules'),
    process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, 'node_modules'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'),
    process.env.HOME && path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
  ].filter(Boolean)

  // Ask npm for its global module root as a last resort. On Windows, npm is
  // a .cmd script, so invoke it through cmd.exe rather than spawnSync('npm.cmd').
  const npmRoot = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], { encoding: 'utf8' })
    : spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
  if (npmRoot.status === 0 && npmRoot.stdout?.trim()) {
    roots.push(npmRoot.stdout.trim())
  }

  for (const root of roots) {
    const candidate = path.resolve(root, relativeCli)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const cliEntry = findCliEntry()
if (!cliEntry) {
  console.error('Could not locate glTF Transform CLI.')
  console.error('Try: npm install --save-dev @gltf-transform/cli')
  console.error('Then rerun: node tools/optimize-level3-glbs.mjs')
  process.exit(1)
}
function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliEntry, ...args], options)
}

// These models currently contain ~1.5 million triangles each. Ratios are
// targets, not guarantees; weld + topology + error limit may restrict them.
const visuals = [
  ['storm-vortex.glb',            0.10, 0.008, 200000],
  ['matter-debris.glb',           0.08, 0.008, 180000],
  ['void-prison-bubble.glb',      0.04, 0.010, 100000],
  ['cyan-plasma-projectile.glb',  0.025, 0.012, 65000],
  ['void-gods-arena.glb',         0.15, 0.005, 300000],
]

function readGLB(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    if (fs.readSync(fd, head, 0, head.length, 0) !== head.length ||
      head.toString('ascii', 0, 4) !== 'glTF' || head.readUInt32LE(4) !== 2 ||
      head.toString('ascii', 16, 20) !== 'JSON') {
      throw new Error(`Invalid GLB v2: ${file}`)
    }
    const length = head.readUInt32LE(12)
    if (length <= 0 || length > 32 * 1024 * 1024) throw new Error('Invalid GLB JSON length')
    const jsonBuffer = Buffer.alloc(length)
    fs.readSync(fd, jsonBuffer, 0, length, 20)
    const json = JSON.parse(jsonBuffer.toString('utf8').trim())
    let triangles = 0
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue
        const index = json.accessors?.[prim.indices]
        const position = json.accessors?.[prim.attributes?.POSITION]
        triangles += Math.floor((index?.count ?? position?.count ?? 0) / 3)
      }
    }
    return {
      triangles,
      skins: (json.skins ?? []).map(skin => skin.joints?.length ?? 0),
      animations: json.animations?.length ?? 0,
      size: fs.statSync(file).size,
      extensions: json.extensionsUsed ?? [],
    }
  } finally { fs.closeSync(fd) }
}

function optimize(input, output, ratio, error, triangleBudget = Infinity) {
  if (!fs.existsSync(input)) {
    console.log(`SKIP (missing): ${path.relative(projectRoot, input)}`)
    return { status: 'missing' }
  }
  const before = readGLB(input)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const temporary = output + '.tmp.glb'
  const opts = [
    'optimize', input, temporary,
    '--compress', 'draco',
    '--flatten', 'false',
    '--join', 'false',
    '--instance', 'false',
    '--palette', 'false',
    '--simplify', 'true',
    '--simplify-ratio', String(ratio),
    '--simplify-error', String(error),
    '--texture-compress', 'false',
  ]
  console.log(`\nOptimizing: ${path.relative(projectRoot, input)}`)
  console.log(`  ${before.triangles.toLocaleString()} triangles, ${(before.size / 1e6).toFixed(2)} MB`)
  const result = runCli(opts, { stdio: 'inherit' })
  if (result.error || result.status !== 0 || !fs.existsSync(temporary)) {
    console.error(`FAILED (source untouched): ${input}`)
    fs.rmSync(temporary, { force: true })
    return { status: 'failed' }
  }
  let after
  try { after = readGLB(temporary) } catch (err) {
    console.error(`Invalid optimized GLB: ${err.message}`)
    fs.rmSync(temporary, { force: true })
    return { status: 'invalid' }
  }
  if (before.skins.join(',') !== after.skins.join(',') || before.animations !== after.animations) {
    console.error(`REJECTED — skin or animation structure changed: ${input}`)
    fs.rmSync(temporary, { force: true })
    return { status: 'invalid-rig' }
  }
  const reduction = before.triangles ? 1 - after.triangles / before.triangles : 0
  console.log(`  => ${after.triangles.toLocaleString()} triangles (${(100 * reduction).toFixed(1)}% fewer), ${(after.size / 1e6).toFixed(2)} MB`)
  if (after.triangles > triangleBudget || (before.triangles && reduction < 0.1)) {
    // Do not auto-enable a model that is still too expensive. Keep it under
    // needs-review instead of the loader's optimized/ directory.
    const review = output.replace(`${path.sep}optimized${path.sep}`, `${path.sep}needs-review${path.sep}`)
    fs.mkdirSync(path.dirname(review), { recursive: true })
    fs.rmSync(output, { force: true })
    fs.renameSync(temporary, review)
    console.warn(`  NOT ENABLED: polygon budget missed. Candidate: ${path.relative(projectRoot, review)}`)
    console.warn('  Inspect topology / try Blender voxel remesh + decimate if needed.')
    return { status: 'review', before, after, output: review }
  }
  fs.renameSync(temporary, output)
  return { status: 'done', before, after, output }
}

function listGLBs(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(ent => {
    if (ent.name === 'optimized') return []
    const p = path.join(root, ent.name)
    return ent.isDirectory() ? listGLBs(p) : ent.isFile() && ent.name.toLowerCase().endsWith('.glb') ? [p] : []
  })
}

const tool = runCli(['--version'], { encoding: 'utf8' })
if (tool.error || tool.status !== 0) {
  console.error(`Could not start glTF Transform at ${cliEntry}`)
  console.error(tool.error?.message || tool.stderr || `exit status ${tool.status}`)
  process.exit(1)
}
console.log(`glTF Transform: ${(tool.stdout || tool.stderr || '').trim()}`)
const results = []
for (const [name, ratio, error, budget] of visuals) {
  results.push(optimize(path.join(visualDir, name), path.join(visualOut, name), ratio, error, budget))
}
if (process.argv.includes('--all-models')) {
  console.log('\n--- Rigged and other game GLBs: preview outputs only ---')
  for (const file of listGLBs(modelRoot)) {
    if (file.startsWith(visualDir + path.sep)) continue
    // Preserve original rigged model bones and animation clips. Reduce less
    // aggressively than the static visual effects.
    const output = path.join(extraOut, path.relative(modelRoot, file))
    results.push(optimize(file, output, 0.30, 0.0025))
  }
}
const success = results.filter(r => r.status === 'done').length
const needsReview = results.filter(r => r.status === 'review').length
console.log(`\nFinished: ${success} optimized model(s), ${needsReview} need review, ${results.length - success - needsReview} missing/failed.`)
console.log(`Visuals: ${path.relative(projectRoot, visualOut)}`)
if (process.argv.includes('--all-models')) console.log(`Other GLBs: ${path.relative(projectRoot, extraOut)} (preview only — source asset paths unchanged)`)
if (!success) process.exitCode = 2
