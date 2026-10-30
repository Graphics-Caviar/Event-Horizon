import assert from 'node:assert/strict'
import * as THREE from 'three'
import { AlienPlanet } from '../src/levels/Level2/AlienPlanet.js'
import { Rover } from '../src/levels/Level2/Rover.js'
import { constrainTerrainCamera } from '../src/levels/Level2/TerrainCamera.js'

const level = {
	own: (x) => x,
	addObject: () => {},
	sceneManager: {},
	keys: new Set(),
	gameplayColliders: [],
}
const planet = Object.assign(Object.create(AlienPlanet.prototype), {
	level,
	center: new THREE.Vector3(60, -140, 45),
	size: 1100,
	baseY: -140,
	playableMargin: 34,
	clearZones: [{ x: 0, z: 0, radius: 46 }],
	colliders: [],
	root: new THREE.Group(),
})
level.planet = planet
planet._buildTerrain()
planet._buildHorizon()
const horizon = planet.root.children.at(-1)
const edge = horizon.geometry.attributes.position
for (let i = 0; i < 512 * 4; i++) {
	assert.ok(
		Math.abs(
			edge.getY(i) +
				planet.baseY -
				planet.heightAt(
					edge.getX(i) + planet.center.x,
					edge.getZ(i) + planet.center.z
				)
		) < 0.001,
		'horizon seam must match terrain'
	)
	assert.ok(
		horizon.geometry.attributes.normal.getY(i) > 0,
		'horizon must face upward'
	)
}

const rover = new Rover(level, {
	position: new THREE.Vector3(0, 0, 0),
	heading: 0,
})
await rover.ready
if (rover.physicsError) throw rover.physicsError
const advance = (seconds) => {
	for (let i = 0; i < seconds * 60; i++) rover.update(1 / 60)
}
advance(5)
const start = rover.group.position.clone()
const drop = rover.body.translation()
rover.body.setTranslation({ x: drop.x, y: drop.y + 15, z: drop.z }, true)
advance(0.5)
assert.ok(
	rover.body.linvel().y < -3,
	'airborne chassis must accelerate under gravity'
)
assert.ok(
	rover.body.translation().y > drop.y + 10,
	'airborne chassis must not snap to ground'
)
advance(5)
assert.ok(
	Math.abs(rover.group.position.y - start.y) < 1,
	'suspension must settle after landing'
)

rover.inputEnabled = true
level.keys.add('KeyW')
advance(3)
assert.ok(rover.group.position.z > start.z + 10, 'W must drive forwards')
level.keys.clear()
level.keys.add('KeyS')
advance(5)
assert.ok(rover.speed < -0.1, 'S must brake then reverse')
level.keys.clear()
level.keys.add('KeyW')
level.keys.add('KeyA')
const oldHeading = rover.heading
advance(3)
assert.ok(
	Math.abs(rover.heading - oldHeading) > 0.1,
	'steering must turn the dynamic body'
)
level.keys.clear()

// Restart a deterministic rough-terrain route to check all rendered tread vertices.
rover.dispose()
const driver = new Rover(level, {
	position: new THREE.Vector3(0, 0, 0),
	heading: 0,
})
await driver.ready
for (let i = 0; i < 300; i++) driver.update(1 / 60)
driver.inputEnabled = true
level.keys.add('KeyW')
let minClearance = Infinity
const vertex = new THREE.Vector3()
for (let i = 0; i < 1200; i++) {
	driver.update(1 / 60)
	driver.group.updateMatrixWorld(true)
	for (const wheel of driver.wheels) {
		const positions = wheel.mesh.geometry.attributes.position
		for (let v = 0; v < positions.count; v++) {
			vertex.fromBufferAttribute(positions, v).applyMatrix4(
				wheel.mesh.matrixWorld
			)
			minClearance = Math.min(
				minClearance,
				vertex.y - planet.heightAt(vertex.x, vertex.z)
			)
		}
	}
	assert.ok(
		Number.isFinite(driver.group.position.y),
		'simulation must remain finite'
	)
}
assert.ok(minClearance >= -0.01, `tread penetrated terrain: ${minClearance}`)
assert.ok(
	driver.group.position.distanceTo(start) > 100,
	'rough terrain route must actually travel'
)
driver.dispose()

// Walking/driving offsets, ridges, crater floors, edge clamps and post-lerp positions.
for (let i = 0; i < 1500; i++) {
	const x = planet.center.x + Math.sin(i * 13.17) * 500
	const z = planet.center.z + Math.cos(i * 8.23) * 500
	const target = new THREE.Vector3(
		x,
		planet.heightAt(x, z) + (i % 2 ? 1.8 : 3.5),
		z
	)
	const camera = target
		.clone()
		.add(new THREE.Vector3(Math.sin(i) * 26, -10, Math.cos(i) * 26))
	constrainTerrainCamera(camera, target, planet)
	assert.ok(
		planet.isInsideBounds(camera.x, camera.z, 1.99),
		'camera must remain inside terrain bounds'
	)
	assert.ok(
		camera.y >= planet.heightAt(camera.x, camera.z) + 1.19,
		'camera must clear ground'
	)
	for (let t = 0.02; t <= 1; t += 0.02) {
		const p = target.clone().lerp(camera, t)
		assert.ok(
			p.y >= planet.heightAt(p.x, p.z),
			'camera sightline must clear terrain'
		)
	}
}
// A focus below the surface must not catapult the camera into the sky, and a
// removed surface (Level 3 collapse) must leave the camera free to follow it.
const buriedTarget = new THREE.Vector3(0, planet.heightAt(0, 0) - 200, 0)
const buriedCamera = buriedTarget.clone().add(new THREE.Vector3(20, -10, 20))
constrainTerrainCamera(buriedCamera, buriedTarget, planet)
assert.ok(
	buriedCamera.y < planet.heightAt(0, 0) + 100,
	'buried focus must not launch the camera into the sky'
)
const voidTarget = new THREE.Vector3(0, -500, 0)
const voidCamera = voidTarget.clone().add(new THREE.Vector3(20, -10, 20))
constrainTerrainCamera(voidCamera, voidTarget, planet, () => -Infinity)
assert.ok(
	voidCamera.y < planet.heightAt(voidCamera.x, voidCamera.z),
	'removed surface must not constrain the camera'
)
// Disposing during asynchronous initialization must not create a leaked world.
const cancelled = new Rover(level, { position: new THREE.Vector3() })
cancelled.dispose()
await cancelled.ready
assert.equal(cancelled.world, null)
console.log(
	`PASS: gravity, landing, forward/reverse, steering, 20-second hill route (minimum tread clearance ${minClearance.toFixed(3)} m), 1,500 camera paths, horizon seams, disposal`
)
