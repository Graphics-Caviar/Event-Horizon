import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Level3 } from '../src/levels/Level3/Level3.js'
function slope(angle) {
	const k = Math.tan((angle * Math.PI) / 180)
	return Object.assign(Object.create(Level3.prototype), {
		playerRoot: new THREE.Group(),
		velocity: new THREE.Vector3(),
		_slideDir: new THREE.Vector3(),
		gameplayColliders: [],
		hazards: { gravityMultiplierAt: () => 1 },
		planet: {
			heightAt: (x) => k * x,
			slopeDegreesAt: () => angle,
			normalAt: () => new THREE.Vector3(-k, 1, 0).normalize(),
			clampToBounds() {},
			resolveCircleCollisions() {},
		},
		_showMovementFeedback() {},
	})
}
const hill = slope(45)
assert.equal(
	hill._applySlopeSlide(1 / 60),
	0,
	'boots must hold on a walkable 45 degree hill'
)
hill._movePlayerDirection(new THREE.Vector3(1, 0, 0), 1)
assert.ok(
	Math.abs(hill.playerRoot.position.x - Math.SQRT1_2) < 0.01,
	'speed follows surface distance'
)
const cliff = slope(70)
assert.equal(
	cliff._validateMovementCandidate(
		new THREE.Vector3(),
		new THREE.Vector3(1, 0, 0)
	).ok,
	false
)
const slides = [30, 60, 120].map((fps) => {
	const pilot = slope(65)
	for (let i = 0; i < fps; i++) pilot._applySlopeSlide(1 / fps)
	return pilot.playerRoot.position.x
})
assert.ok(
	slides.every((x) => x < 0),
	'unwalkable slopes accelerate downhill'
)
assert.ok(
	Math.max(...slides) - Math.min(...slides) < 0.08,
	'slide distance is frame rate independent'
)
const ledge = slope(0)
ledge._walkingTerrainStep = true
ledge.playerRoot.position.y = 5
ledge._syncPlayerToTerrain()
assert.equal(
	ledge.playerRoot.position.y,
	5,
	'leaving ground must not teleport feet down'
)
assert.equal(ledge._airborne, true)
console.log('Level 3 slopes, friction, surface speed and ledge checks passed')

ledge._walkingTerrainStep = false
ledge._syncPlayerToTerrain()
assert.equal(
	ledge.playerRoot.position.y,
	0,
	'spawn and rover exit still align to terrain'
)

for (const fps of [30, 60, 120]) {
	const pilot = slope(0)
	Object.assign(pilot, {
		keys: new Set(),
		baseY: 0,
		_airborne: true,
		_verticalSpeed: 0,
		_camForward: new THREE.Vector3(),
		_camRight: new THREE.Vector3(),
		_inputScratch: new THREE.Vector3(),
		_feetScratch: new THREE.Vector3(),
		sceneManager: { camera: new THREE.PerspectiveCamera() },
		dust: { spawnBurst() {} },
		pilotWalk: { footOffset: 0, update() {} },
	})
	pilot.playerRoot.position.y = 50
	pilot.velocity.x = 10
	for (let i = 0; i < fps; i++) pilot._updatePlayerMovement(1 / fps)
	assert.ok(
		Math.abs(pilot.playerRoot.position.y - 35) < 0.001,
		'free fall follows gravity over one second'
	)
	assert.ok(Math.abs(pilot._verticalSpeed + 30) < 0.001)
	assert.ok(
		pilot.velocity.x > 8,
		'airborne momentum survives releasing movement keys'
	)
	pilot._verticalSpeed = 10
	const y = pilot.playerRoot.position.y
	pilot._updatePlayerMovement(1 / fps)
	assert.ok(
		pilot.playerRoot.position.y > y,
		'releasing thrust preserves upward momentum'
	)
}
console.log('Ballistic gravity and airborne momentum passed at 30/60/120 FPS')
