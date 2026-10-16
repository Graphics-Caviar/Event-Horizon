// Headless logic probe for the Level 3 void systems. No DOM, no GL:
// stubs the level surface and drives VoidEnemy's state machine directly.
// Covers: manifest paths on disk + in dist, detect→chase→prepare→strike
// sequencing, exactly-one strike per attack, cooldown gating + decay
// (the Alien.js frozen-timer regression), stagger/death, the flyer
// orbit/charge loop with hover altitude, and the boss's three hp phases.
import * as THREE from 'three'
import { existsSync } from 'node:fs'
import { assetUrl } from '../src/core/assetUrl.js'
import { VoidEnemy } from '../src/levels/Level3/VoidEnemy.js'
import { VoidColossus } from '../src/levels/Level3/VoidColossus.js'
import { VOID_ASSETS } from '../src/levels/Level3/voidAssets.js'

let failures = 0
const fail = (message) => {
	console.error('FAIL:', message)
	failures += 1
}
const assert = (condition, message) => {
	if (!condition) fail(message)
}

// 1. Every manifest entry resolves on disk and shipped into dist/.
// Paths use the repo's absolute '/assets/...' convention; dist ships the
// assetUrl-chosen browser copy (original until a -web.glb variant exists).
for (const [key, def] of Object.entries(VOID_ASSETS)) {
	assert(
		existsSync(`public/${def.path}`),
		`missing GLB for ${key}: public/${def.path}`
	)
	const shipped = assetUrl(def.path).replace(/^\.\//, '')
	assert(
		existsSync(`dist/${shipped}`),
		`GLB not in dist for ${key}: dist/${shipped}`
	)
}

// 2. Stub level surface — just the fields VoidEnemy touches. addObject
// parents into a real scene so the `!group.parent` update guard passes.
const scene = new THREE.Scene()
const level = {
	planet: {
		heightAt: () => 0,
		resolveCircleCollisions: () => {},
		clampToBounds: () => {},
		isInsideBounds: () => true,
		slopeDegreesAt: () => 0,
	},
	gameplayColliders: [],
	damageCooldown: 0,
	playerRoot: new THREE.Object3D(),
	addObject: (object) => {
		scene.add(object)
		return object
	},
	own: (resource) => resource,
	assetManager: {
		preloadModel: async () => {},
		getRawModel: () => null,
		loadModel: async () =>
			new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
	},
	_fit: () => {},
	_registerGameplayCollider: () => ({}),
	_requestShake: () => {},
	_voidKills: 0,
	voidAudio: {
		play: () => {},
		startLoop: () => {},
		moveLoop: () => {},
		setLoopLevel: () => {},
		stopLoop: () => {},
	},
	dust: {
		spawnBurst: () => {},
		spawnFoot: () => {},
	},
}

const makeEnemy = (styleName, home) => {
	// The boss is a subclass: it owns the phase state machine.
	const enemy =
		styleName === 'colossus'
			? new VoidColossus(level, { home })
			: new VoidEnemy(level, styleName, { home })
	// Skip the DOM-backed load() (glow/hp-bar canvases); install a
	// stand-in model so the body-pose path runs for real.
	enemy._loaded = true
	enemy.group.visible = true
	enemy._model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
	enemy._fitScale = 1
	enemy._baseY = 0
	return enemy
}

const dt = 1 / 60
const ticks = (enemy, seconds) => {
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		enemy.update(dt, level.playerRoot.position)
	}
}

// 3. Ground state machine: detect → chase → prepare → strike → recover.
// repositionTime is zeroed so post-attack behaviour stays deterministic.
const stalker = makeEnemy('stalker', new THREE.Vector3(50, 0, 0))
stalker.style.repositionTime = 0
level.playerRoot.position.set(48, 0, 0)
let sawDetect = false
let sawPrepare = false
let sawRecover = false
for (let i = 0; i < 60 * 4; i++) {
	stalker.update(dt, level.playerRoot.position)
	if (stalker.state === 'detect') sawDetect = true
	if (stalker.state === 'prepare') sawPrepare = true
	if (stalker.state === 'recover') {
		sawRecover = true
		break
	}
}
assert(sawDetect, 'stalker never entered detect')
assert(sawPrepare, 'stalker never reached prepare at melee range')
assert(sawRecover, 'stalker never recovered after the strike')

// 4. Exactly one strike per attack, and the attack armed the
// between-attack cooldown (set when recover begins).
let strikes = 0
for (let i = 0; i < Math.round(0.8 / dt); i++) {
	stalker.update(dt, level.playerRoot.position)
	if (stalker.pendingStrike) {
		strikes += 1
		stalker.pendingStrike = false
	}
}
assert(strikes === 1, `expected exactly 1 strike per attack, got ${strikes}`)
assert(stalker._cooldown > 0, 'attack did not arm the between-attack cooldown')

// 5. The armed cooldown GATES the next attack — the frozen-timer
// regression: with the pilot still in melee range, prepare must never
// re-enter while the cooldown is up, and every gate timer decays.
let gated = false
let frames = 0
while (stalker._cooldown > 0 && frames < 60 * 10) {
	stalker.update(dt, level.playerRoot.position)
	if (stalker._cooldown > 0 && stalker.state === 'prepare') {
		gated = true
	}
	stalker.pendingStrike = false
	frames += 1
}
assert(frames > 0, 'cooldown was never armed')
assert(!gated, 'enemy re-attacked while its cooldown was armed')
assert(stalker._cooldown <= 0, `cooldown froze after ${frames} frames`)

// ...and the gate releases: with the cooldown just cleared the second
// attack begins immediately and lands exactly once.
let released = false
strikes = 0
for (let i = 0; i < Math.round(1.2 / dt); i++) {
	stalker.update(dt, level.playerRoot.position)
	if (stalker.state === 'prepare') released = true
	if (stalker.pendingStrike) {
		strikes += 1
		stalker.pendingStrike = false
	}
	if (strikes === 1) break
}
assert(released, 'attack never resumed after the cooldown cleared')
assert(strikes === 1, 'second attack did not strike exactly once')

// Ram/contact gate timers also decay — the frozen-timer probe.
stalker._ramCooldown = 2.4
stalker._contactCooldown = 2.4
frames = 0
while (
	(stalker._ramCooldown > 0 || stalker._contactCooldown > 0) &&
	frames < 60 * 10
) {
	stalker.update(dt, level.playerRoot.position)
	frames += 1
}
assert(
	stalker._ramCooldown <= 0 && stalker._contactCooldown <= 0,
	`gate timers froze after ${frames} frames`
)

// 6. Damage: stagger on the first hit, death on the last, kill counted.
stalker.damage(1)
assert(stalker.state === 'stagger', 'blade hit did not stagger')
stalker.damage(1)
assert(stalker.smashed, 'stalker did not die at 0 hp')
assert(level._voidKills === 1, 'kill was not counted')
ticks(stalker, 2) // death animation runs clean

// 7. Flyer: detect → orbit → telegraphed charge cycle.
const flyer = makeEnemy('entity', new THREE.Vector3(0, 24, 60))
level.playerRoot.position.set(0, 0, 30)
let sawOrbit = false
let sawCharge = false
for (let i = 0; i < 60 * 12; i++) {
	flyer.update(dt, level.playerRoot.position)
	if (flyer.state === 'orbit') sawOrbit = true
	if (flyer.state === 'charge') sawCharge = true
}
assert(sawOrbit, 'entity never orbited')
assert(sawCharge, 'entity never charged a volley')
// Flyers hover: terrain-sync must hold them at altitude, not sink them.
assert(flyer.position.y > 15, `flyer sank to y=${flyer.position.y.toFixed(1)}`)

// 8. Boss: three phases over its hp bar (cross each boundary exactly).
const colossus = makeEnemy('colossus', new THREE.Vector3(0, 0, -80))
level.playerRoot.position.set(0, 0, -60)
colossus.damage(1)
assert(colossus._phase === 1, 'boss phase shifted too early')
colossus.hp = Math.floor(colossus.maxHp * 0.67) + 1
colossus.damage(1)
assert(colossus._phase === 2, 'boss did not enter phase 2')
colossus.hp = Math.floor(colossus.maxHp * 0.34) + 1
colossus.damage(1)
assert(colossus._phase === 3, 'boss did not enter phase 3')
assert(
	colossus.style.chaseSpeed > colossus._baseChase,
	'phase 3 did not enrage speed'
)

console.log(
	failures === 0
		? 'VOID PROBE: all checks passed'
		: `VOID PROBE: ${failures} failure(s)`
)
process.exit(failures === 0 ? 0 : 1)
