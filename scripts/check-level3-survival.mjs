import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MatterSurvival } from '../src/levels/Level3/MatterSurvival.js'
import { MatterDebris } from '../src/levels/Level3/MatterDebris.js'
import { Level2 } from '../src/levels/Level2/Level2.js'
import { MatterDimension } from '../src/levels/Level3/MatterDimension.js'

function fixture() {
	const material = new THREE.MeshBasicMaterial()
	const level = {
		landingSite: new THREE.Vector3(),
		portalSite: new THREE.Vector3(0, 0, -400),
		playerRoot: new THREE.Group(),
		planet: { heightAt: () => 0, terrain: { material } },
		addObject() {},
		_showMovementFeedback() {},
		_requestShake(value) {
			this.shake = Math.max(this.shake ?? 0, value)
		},
	}
	level.survival = new MatterSurvival(level)
	return level
}
for (const fps of [30, 60, 120]) {
	const level = fixture(),
		s = level.survival
	level.transitionHeld = true
	for (let i = 0; i < fps * 40; i++) s.update(1 / fps)
	assert.equal(s.time, 0, 'arrival never spends countdown')
	level.transitionHeld = false
	for (let i = 0; i < fps * 29; i++) s.update(1 / fps)
	assert.ok(s.remaining > 0)
	assert.ok(
		level.shake > 0,
		'ground tremor warns before the countdown expires'
	)
	assert.ok(
		s.pickups[0].can.position.y > s.pickups[0].point.y + 3,
		'nitrogen visibly floats above its landing pad'
	)
	assert.equal(s.isGone(30, 0), false)
	for (let i = 0; i < fps * 31; i++) s.update(1 / fps)
	assert.equal(
		s.isGone(30, 0),
		true,
		'collapse removes terrain behind wave'
	)
	assert.equal(
		s.surfaceHeightAt(30, 0),
		-Infinity,
		'removed ground has no pilot support'
	)
	assert.equal(s.isGone(0, -400), false, 'exit stays accessible')
	const fallingIndex = s.crumble.slabs.findIndex(
		(slab) => slab.age > 0.1 && slab.age < 5
	)
	assert.ok(
		fallingIndex >= 0,
		'live collapse emits falling terrain slabs'
	)
	const falling = new THREE.Matrix4()
	s.crumble.mesh.getMatrixAt(fallingIndex, falling)
	assert.ok(
		falling.elements[13] < s.crumble.slabs[fallingIndex].origin.y,
		'detached slabs fall below their original terrain height'
	)
	assert.equal(
		s.crumble.slabs.length,
		192,
		'terrain crumble keeps a fixed resource budget'
	)
	const support = Object.assign(
		Object.create(MatterDimension.prototype),
		{ level, platforms: [] }
	)
	assert.equal(
		support.supportHeightAt(30, 0, 0),
		-Infinity,
		'actual dimension drops support for removed terrain'
	)
	const shader = {
		uniforms: {},
		vertexShader: THREE.ShaderLib.physical.vertexShader,
		fragmentShader: THREE.ShaderLib.physical.fragmentShader,
	}
	level.planet.terrain.material.onBeforeCompile(shader)
	assert.ok(shader.fragmentShader.includes('collapseDistance < 0.0'))
	assert.equal(shader.uniforms.collapseEdge, s.uniform)

	const pad = s.pickups[1]
	assert.equal(
		s.supportHeightAt(pad.point.x, pad.point.z, pad.point.y),
		pad.point.y
	)
	for (let i = 0; i < fps * 10; i++) s.burn(1 / fps, true)
	assert.ok(
		Math.abs(s.fuel - 50) < 1e-8,
		'fuel drain is frame independent'
	)
	level.playerRoot.position.copy(pad.can.position)
	s.update(1 / fps)
	assert.ok(s.fuel > 94)
	const fuel = s.fuel
	s.update(1 / fps)
	assert.equal(s.fuel, fuel, 'pickup cannot refill repeatedly')
	s.burn(100, true)
	assert.equal(s.fuel, 0)
	assert.equal(s.burn(1, true), false, 'empty pack cannot thrust')
	level.completed = true
	const time = s.time
	s.update(100)
	assert.equal(s.time, time, 'defeat freezes survival clock')
	s.dispose()
	s.dispose()
	const restart = fixture()
	assert.equal(restart.survival.fuel, 100)
	assert.equal(restart.survival.remaining, 30)
	restart.survival.dispose()
}

const pilot = Object.assign(Object.create(Level2.prototype), {
	playerHP: 100,
	maxPlayerHP: 100,
	roverHP: 200,
	maxRoverHP: 200,
	damageCooldown: 0,
	roverDamageCooldown: 0,
	boarded: true,
	_updateLevelHUD() {},
	_flashDamage() {},
	_requestShake() {},
	_showMovementFeedback() {},
	_gameOver() {
		this.completed = true
	},
})
pilot._applyAlienHit(20)
assert.equal(pilot.roverHP, 180)
assert.equal(pilot.playerHP, 100)
pilot._applyAlienHit(20)
assert.equal(pilot.roverHP, 180, 'rover has independent damage cooldown')
pilot.boarded = false
pilot._applyAlienHit(10)
assert.equal(pilot.playerHP, 90)
assert.equal(pilot.roverHP, 180)
pilot.damageCooldown = 0
pilot.roverDamageCooldown = 0
pilot._applyRoverHit(999)
assert.equal(pilot.roverHP, 0)
assert.equal(
	pilot.playerHP,
	90,
	'rover destruction does not erase pilot health'
)
assert.ok(pilot.completed, 'losing the required rover fails its mission')

function debrisFixture(crouching) {
	let hits = 0
	const level = {
		landingSite: new THREE.Vector3(),
		playerRoot: new THREE.Group(),
		planet: { heightAt: () => 0 },
		crouching,
		damageCooldown: 0,
		_applyAlienHit() {
			hits++
		},
	}
	return {
		level,
		debris: new MatterDebris(level, [], { fragments: 0 }),
		hits: () => hits,
	}
}
const aim = debrisFixture(false)
aim.level.playerRoot.position.set(10, 0, 20)
aim.debris.update(6)
const event = aim.debris.events.find((e) => e.active)
assert.ok(
	event.point.distanceTo(aim.level.playerRoot.position) < 0.001,
	'debris targets current pilot position'
)
aim.level.playerRoot.position.x += 20
assert.equal(event.point.x, 10, 'warning target never homes after lock')
aim.debris.update(6)
assert.equal(aim.hits(), 0, 'dodging the marked position avoids damage')
aim.debris.dispose()
for (const crouching of [true, false]) {
	const f = debrisFixture(crouching)
	f.debris.config.targetPlayer = false
	f.debris.trigger(new THREE.Vector3(0, 2, 0), {
		duckable: true,
		airborne: true,
	})
	f.debris.update(6)
	assert.equal(
		f.hits(),
		crouching ? 0 : 1,
		'ducking avoids small cyan fragments'
	)
	f.debris.dispose()
}
console.log(
	'Survival: separate health, collapse/support, stable pads, fuel, pickups, reset, targeting and ducking passed (30/60/120 FPS).'
)
