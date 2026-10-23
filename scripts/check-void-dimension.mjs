import assert from 'node:assert/strict'
import * as THREE from 'three'
import { VoidDimension } from '../src/levels/Level3/VoidDimension.js'

for (const fps of [30, 60, 120]) {
	const scene = new THREE.Scene(),
		matter = new THREE.Group(),
		pilot = new THREE.Group()
	scene.add(matter, pilot)
	const pilotModel = new THREE.Mesh(
		new THREE.BoxGeometry(1, 3, 1),
		new THREE.MeshStandardMaterial()
	)
	pilot.add(pilotModel)
	pilotModel.visible = false
	const fog = new THREE.Fog(0x123456, 1, 100)
	scene.fog = fog
	let exits = 0
	const level = {
		sceneManager: { scene, camera: new THREE.PerspectiveCamera() },
		playerRoot: pilot,
		pilotModel,
		firstPerson: true,
		velocity: new THREE.Vector3(),
		keys: new Set(),
		elapsedPlayTime: 0,
		levelHudEl: { firstElementChild: {} },
		survivalHudEl: {},
		enemyStatusEl: {},
		objectiveEl: {},
		_completeMission() {
			exits++
			this.completed = true
		},
	}
	const dimension = new VoidDimension(level)
	assert.equal(
		dimension.shards.length,
		95,
		'existing floating rocks remain'
	)
	assert.equal(dimension.spaceBackdrop.planets.length, 4)
	for (const planet of dimension.spaceBackdrop.planets)
		assert.ok(
			planet.position.length() > 2000,
			'planets stay far beyond the playable space'
		)
	assert.equal(scene.fog, null, 'space has no terrestrial haze')
	const satellitePosition =
		dimension.spaceBackdrop.satellite.position.clone()
	dimension.spaceBackdrop.update(10)
	assert.ok(
		satellitePosition.distanceTo(
			dimension.spaceBackdrop.satellite.position
		) > 20,
		'satellite travels in orbit'
	)
	assert.equal(
		matter.visible,
		false,
		'old planet is absent from the void'
	)
	assert.equal(pilot.visible, true, 'pilot survives the transition')
	assert.equal(
		pilotModel.visible,
		true,
		'first-person hiding is cleared on entry'
	)
	assert.equal(
		level.firstPerson,
		false,
		'void uses its third-person camera'
	)
	// The inherited update can still run on the transition frame.
	pilotModel.visible = false
	dimension.update(1 / fps)
	assert.equal(
		pilotModel.visible,
		true,
		'void keeps the model visible on subsequent frames'
	)
	scene.updateMatrixWorld(true)
	level.sceneManager.camera.updateMatrixWorld(true)
	const screenPoint = new THREE.Vector3(0, 1.5, 0)
	pilot.localToWorld(screenPoint)
	screenPoint.project(level.sceneManager.camera)
	assert.ok(
		Math.abs(screenPoint.x) < 0.8 &&
			Math.abs(screenPoint.y) < 0.8 &&
			Math.abs(screenPoint.z) < 1,
		'pilot is inside the chase camera frame'
	)
	assert.equal(scene.environment, null, 'old sky reflections are removed')
	assert.notEqual(scene.fog, fog)
	assert.equal(exits, 0, 'entering the dimension does not end the level')
	level.keys.add('Space')
	for (let i = 0; i < fps; i++) dimension.update(1 / fps)
	assert.ok(
		pilot.position.y > 20,
		'void allows vertical flight without a terrain floor'
	)
	level.keys.clear()
	level.velocity.set(0, 0, 0)
	pilot.position.set(0, 8, 15)
	level.keys.add('KeyW')
	for (let i = 0; i < fps * 20; i++) dimension.update(1 / fps)
	assert.equal(exits, 1, 'flying through the final gate completes once')
	dimension.dispose()
	assert.equal(matter.visible, true)
	assert.equal(scene.fog, fog)
	assert.equal(
		level.sceneManager.camera.far,
		2000,
		'camera clipping is restored'
	)
	assert.equal(dimension.group.parent, null)
	pilotModel.geometry.dispose()
	pilotModel.material.dispose()
}
console.log(
	'Void dimension: scene isolation, zero-gravity flight, gate completion and cleanup passed at 30/60/120 FPS.'
)
