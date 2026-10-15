import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Level3 } from '../src/levels/Level3/Level3.js'

// Exercise the real flight method without requiring WebGL or loading assets.
function fixture() {
	const pilot = Object.assign(Object.create(Level3.prototype), {
		keys: new Set(['Space']),
		playerRoot: new THREE.Group(),
		baseY: 0,
		velocity: new THREE.Vector3(),
		_verticalSpeed: 0,
		_camForward: new THREE.Vector3(),
		_camRight: new THREE.Vector3(),
		_inputScratch: new THREE.Vector3(),
		_feetScratch: new THREE.Vector3(),
		gameplayColliders: [],
		sceneManager: { camera: new THREE.PerspectiveCamera() },
		planet: {
			heightAt: () => 0,
			clampToBounds: (p) => {
				p.x = Math.max(-40, Math.min(40, p.x))
				p.z = Math.max(-40, Math.min(40, p.z))
			},
			resolveCircleCollisions: () => {},
		},
		pilotWalk: { footOffset: 0, update() {} },
		dust: {
			bursts: 0,
			spawnBurst() {
				this.bursts++
			},
		},
	})
	return pilot
}
for (const fps of [30, 60, 120]) {
	const pilot = fixture()
	for (let i = 0; i < fps * 2; i++) pilot._updatePlayerMovement(1 / fps)
	assert.ok(
		pilot.playerRoot.position.y > 24,
		'sustained thrust must lift the pilot'
	)
	pilot.keys.add('KeyW')
	for (let i = 0; i < fps * 20; i++) pilot._updatePlayerMovement(1 / fps)
	assert.ok(
		pilot.playerRoot.position.y <= 220,
		'flight ceiling must hold'
	)
	assert.equal(
		pilot.playerRoot.position.z,
		-40,
		'flight must obey map boundaries'
	)
	pilot.keys.clear()
	for (let i = 0; i < fps * 25 && pilot._airborne; i++)
		pilot._updatePlayerMovement(1 / fps)
	assert.equal(pilot._airborne, false, 'releasing thrust must land')
	assert.equal(pilot.playerRoot.position.y, 0, 'feet must meet terrain')
	assert.equal(
		pilot.dust.bursts,
		1,
		'landing must emit a single dust burst'
	)
}
const pilot = fixture()
pilot.playerRoot.position.y = 10
pilot.planet.heightAt = (x, z) => (z < -1 ? 50 : 0)
pilot.keys.add('KeyW')
for (let i = 0; i < 15; i++) pilot._updatePlayerMovement(1 / 60)
assert.ok(
	pilot.playerRoot.position.z >= -1,
	'flight must not pass through rising terrain'
)
console.log(
	'Level 3 flight: takeoff, steering, ceiling, bounds, landing dust and terrain collision passed.'
)

for (const fps of [30, 60, 120]) {
	const pose = fixture()
	pose.pilotModel = new THREE.Group()
	pose.jetpack = new THREE.Group()
	pose.pilotWalk.height = 3.2
	pose.playerRoot.position.y = 20
	pose.playerRoot.rotation.y = Math.PI
	pose._airborne = true
	pose._flightSpeed = 18
	pose._buildFlightPose()
	for (let i = 0; i < fps * 2; i++) pose._updateFlightPose(1 / fps)
	assert.ok(
		Math.abs(pose.flightPivot.rotation.x - Math.PI / 2) < 0.001,
		'cruising pilot should lie horizontally'
	)
	pose.playerRoot.updateMatrixWorld(true)
	const bodyAxis = new THREE.Vector3(0, 1, 0).transformDirection(
		pose.flightPivot.matrixWorld
	)
	assert.ok(
		bodyAxis.z < -0.99,
		'head should point along the flight heading'
	)
	assert.equal(
		pose.jetpack.parent,
		pose.pilotModel.parent,
		'jetpack must follow the body pose'
	)
	assert.equal(
		pose.playerRoot.rotation.x,
		0,
		'gameplay root must stay upright'
	)
	pose._flightSpeed = 0
	for (let i = 0; i < fps * 2; i++) pose._updateFlightPose(1 / fps)
	assert.ok(
		pose.flightPivot.rotation.x < 0.001,
		'hovering must return upright'
	)
	pose._flightSpeed = 18
	for (let i = 0; i < fps; i++) pose._updateFlightPose(1 / fps)
	pose.playerRoot.position.y = 0.2
	for (let i = 0; i < fps * 2; i++) pose._updateFlightPose(1 / fps)
	assert.ok(
		pose.flightPivot.rotation.x < 0.001,
		'approaching ground must restore landing pose'
	)
}
console.log(
	'Flight pose passed: horizontal cruise, heading, attached jetpack, hover and landing at 30/60/120 FPS.'
)
