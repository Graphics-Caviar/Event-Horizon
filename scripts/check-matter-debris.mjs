import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MatterDebris } from '../src/levels/Level3/MatterDebris.js'
import { MatterDimension } from '../src/levels/Level3/MatterDimension.js'
import { Level3 } from '../src/levels/Level3/Level3.js'

function fixture(options) {
	let hits = 0,
		impacts = 0
	const point = new THREE.Vector3(100, 0, 0)
	const level = {
		landingSite: new THREE.Vector3(),
		playerRoot: { position: point.clone() },
		damageCooldown: 0,
		completed: false,
		_applyAlienHit() {
			hits++
			this.damageCooldown = 0.8
		},
		voidAudio: {
			play(name) {
				if (name === 'shock') impacts++
			},
		},
		dust: { spawnBurst() {} },
	}
	const debris = new MatterDebris(level, [], {
		targetPlayer: false,
		...options,
	})
	return {
		debris,
		level,
		point,
		hits: () => hits,
		impacts: () => impacts,
	}
}

for (const fps of [30, 60, 120]) {
	const f = fixture()
	f.debris.trigger(f.point)
	for (let i = 0; i < fps * 2.5; i++) f.debris.update(1 / fps)
	assert.equal(f.hits(), 0, 'warning gives time to move')
	assert.equal(f.debris.events[0].mesh.visible, false)
	for (let i = 0; i < fps * 5; i++) f.debris.update(1 / fps)
	assert.equal(f.hits(), 1, 'one impact damage only')
	assert.equal(f.impacts(), 1)
	assert.ok(
		f.debris.events.every((e) => !e.active),
		'pool recycled'
	)
	f.debris.dispose()
	f.debris.dispose()
}

const f = fixture({ poolSize: 2 })
assert.ok(f.debris.trigger(f.point, { cinematic: true }))
assert.ok(f.debris.trigger(f.point, { cinematic: true, major: true }))
assert.equal(f.debris.trigger(f.point), false, 'bounded allocation')
f.debris.update(6, { cinematic: true })
assert.equal(f.hits(), 0, 'cinematic never damages')
f.debris.update(2)
assert.equal(f.debris.fragments.count, 64)
f.debris.dispose()
assert.equal(f.debris.trigger(f.point), false)

const avoid = fixture()
avoid.debris.trigger(avoid.point)
avoid.level.playerRoot.position.x += 20
avoid.debris.update(6)
assert.equal(avoid.hits(), 0, 'walking away avoids damage')
avoid.debris.dispose()

const cooldown = fixture()
cooldown.level.damageCooldown = 0.4
cooldown.debris.trigger(cooldown.point)
cooldown.debris.update(6)
assert.equal(cooldown.hits(), 0, 'respects shared damage cooldown')
cooldown.debris.dispose()

const medium = fixture()
medium.level.planet = { heightAt: (x) => (x - 100) * 0.1 }
medium.debris.trigger(medium.point, { medium: true })
const warning = medium.debris.events[0].ring
warning.updateMatrixWorld(true)
const vertex = new THREE.Vector3()
for (let i = 0; i < warning.geometry.attributes.position.count; i++) {
	vertex.fromBufferAttribute(
		warning.geometry.attributes.position,
		i
	).applyMatrix4(warning.matrixWorld)
	assert.ok(
		Math.abs(
			vertex.y - medium.level.planet.heightAt(vertex.x) - 0.18
		) < 1e-5,
		'warning follows terrain'
	)
}
medium.debris.update(6)
assert.equal(medium.hits(), 0, 'medium environmental debris remains harmless')
medium.debris.dispose()

console.log(
	'Matter debris: warnings, damage, avoidance, cinematic safety, bounded pools, recycling and disposal passed at 30/60/120 FPS.'
)

const dimensionLevel = {
	landingSite: new THREE.Vector3(),
	portalSite: new THREE.Vector3(0, 0, -400),
	planet: { heightAt: () => 0 },
	monuments: { sites: { reactor: new THREE.Vector3(0, 0, -300) } },
	addObject: () => {},
	playerRoot: { position: new THREE.Vector3() },
}
const dimension = new MatterDimension(dimensionLevel)
for (const platform of dimension.platforms) {
	const p = platform.mesh.position
	assert.equal(
		dimension.supportHeightAt(p.x, p.z, p.y + 2),
		p.y + 1.5,
		'platform supports descending pilot'
	)
	assert.equal(
		dimension.supportHeightAt(p.x, p.z, 0),
		0,
		'ground route remains accessible underneath'
	)
}
dimension.beginArrival(new THREE.Vector3(0, 155, 410))
dimension.beginArrival(new THREE.Vector3(0, 155, 410))
assert.equal(
	dimension.debris.events.filter((e) => e.active).length,
	3,
	'arrival triggers once'
)
dimension.update(1, true)
assert.equal(
	dimension.supportHeightAt(900, 900, 100),
	0,
	'leaving platform returns terrain floor'
)
dimension.dispose()
dimension.dispose()
console.log(
	'Matter dimension: platform tops, ground clearance, once-only arrival and cleanup passed.'
)

for (const fps of [30, 60, 120]) {
	const pilot = Object.assign(Object.create(Level3.prototype), {
		keys: new Set(),
		playerRoot: new THREE.Group(),
		baseY: 0,
		velocity: new THREE.Vector3(),
		_verticalSpeed: -12,
		_airborne: true,
		_camForward: new THREE.Vector3(),
		_camRight: new THREE.Vector3(),
		_inputScratch: new THREE.Vector3(),
		_feetScratch: new THREE.Vector3(),
		gameplayColliders: [],
		sceneManager: { camera: new THREE.PerspectiveCamera() },
		planet: {
			heightAt: () => 0,
			clampToBounds() {},
			resolveCircleCollisions() {},
		},
		pilotWalk: { footOffset: 0, update() {} },
		dust: { spawnBurst() {} },
		matterDimension: {
			supportHeightAt(x, z, feet) {
				return Math.abs(x) < 9 &&
					Math.abs(z) < 11 &&
					feet >= 19.35
					? 20
					: 0
			},
		},
	})
	pilot.playerRoot.position.y = 25
	for (let i = 0; i < fps * 2 && pilot._airborne; i++)
		pilot._updatePlayerMovement(1 / fps)
	assert.equal(pilot._airborne, false, 'real flight method lands on slab')
	assert.equal(pilot.playerRoot.position.y, 20)
	pilot.playerRoot.position.x = 15
	pilot._airborne = true
	for (let i = 0; i < fps * 4 && pilot._airborne; i++)
		pilot._updatePlayerMovement(1 / fps)
	assert.equal(
		pilot.playerRoot.position.y,
		0,
		'departed slab returns to terrain'
	)
}
console.log(
	'Real Level 3 platform descent and terrain return passed at 30/60/120 FPS.'
)
