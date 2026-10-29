import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ASTEROID_MODELS } from '../src/levels/Level1/asteroidAssets.js'
import { VoidDimension } from '../src/levels/Level3/VoidDimension.js'
import {
	VoidSpaceBackdrop,
	VOID_ASTEROID_COUNT,
} from '../src/levels/Level3/VoidSpaceBackdrop.js'

const canvasContext = {
	clearRect() {},
	fillRect() {},
	fillText() {},
	createRadialGradient() {
		return { addColorStop() {} }
	},
}
globalThis.document = {
	createElement(tag) {
		return tag === 'canvas'
			? {
					width: 0,
					height: 0,
					getContext: () => canvasContext,
				}
			: { style: {}, remove() {} }
	},
	body: { appendChild() {} },
}
globalThis.window = {
	addEventListener() {},
	removeEventListener() {},
}
globalThis.setTimeout = (callback) => {
	callback()
	return 0
}

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
		jets: [{ visible: false, scale: { y: 1 } }],
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
		VOID_ASTEROID_COUNT,
		'void keeps the reduced asteroid count'
	)
	assert.equal(VOID_ASTEROID_COUNT, 10)
	assert.equal(
		dimension.gun.parent,
		pilotModel,
		'weapon is mounted on the pilot at its hand position'
	)
	assert.equal(
		dimension.weaponArm.parent,
		pilotModel,
		'separate suit arm connects the pilot shoulder to the weapon'
	)
	assert.ok(
		dimension.weaponArm.glove.position.distanceTo(
			dimension._gunHandPosition
		) < 0.001,
		'gloved hand wraps the weapon grip position'
	)
	const yawBeforeLook = dimension.cameraYaw
	dimension._onPointerDown({
		button: 2,
		clientX: 100,
		clientY: 100,
		preventDefault() {},
	})
	dimension._onPointerMove({
		clientX: 130,
		clientY: 80,
		preventDefault() {},
	})
	assert.notEqual(dimension.cameraYaw, yawBeforeLook)
	dimension._onPointerUp({ button: 2 })
	dimension._updateCamera()
	dimension._aimGunAtView()
	const aimTargetBeforeDrag = dimension.aimTarget.clone()
	const aimYaw = dimension.cameraYaw
	dimension._onPointerDown({
		button: 0,
		clientX: 100,
		clientY: 100,
		preventDefault() {},
	})
	dimension._onPointerMove({
		clientX: 150,
		clientY: 115,
		preventDefault() {},
	})
	assert.notEqual(dimension.cameraYaw, aimYaw)
	dimension._updateCamera()
	dimension._aimGunAtView()
	assert.ok(
		dimension.aimTarget.distanceTo(aimTargetBeforeDrag) > 1,
		'left-button drag changes the actual shooting direction'
	)
	dimension._onPointerUp({ button: 0 })
	const cameraDistance = dimension.cameraDistance
	dimension._onWheel({
		deltaY: 100,
		ctrlKey: false,
		preventDefault() {},
	})
	assert.ok(dimension.cameraDistance > cameraDistance)
	dimension._aimGunAtView()
	dimension.gun.updateWorldMatrix(true, false)
	const gunGripWorld = dimension._gunGripLocal
		.clone()
		.multiplyScalar(dimension.gun.scale.x)
		.applyQuaternion(dimension.gun.quaternion)
		.add(dimension.gun.position)
		.applyMatrix4(pilotModel.matrixWorld)
	const pilotHandWorld = dimension._gunHandPosition
		.clone()
		.applyMatrix4(pilotModel.matrixWorld)
	assert.ok(
		gunGripWorld.distanceTo(pilotHandWorld) < 0.001,
		'gun grip stays aligned with the pilot hand while aiming'
	)
	const expectedMuzzle = dimension._gunMuzzleLocal
		.clone()
		.applyMatrix4(dimension.gun.matrixWorld)
	dimension._tryShoot(pilot.position.clone())
	const firedBullet = dimension._bullets.at(-1)
	assert.ok(
		Math.abs(
			firedBullet.mesh.position.distanceTo(expectedMuzzle) -
				0.25
		) < 0.001,
		'gunfire starts in front of the pilot at the weapon muzzle'
	)
	assert.equal(dimension.spaceBackdrop.planets.length, 4)
	for (const planet of dimension.spaceBackdrop.planets)
		assert.ok(
			planet.position.distanceTo(pilot.position) < 1400,
			'planets are visible around the playable space'
		)
	assert.ok(
		dimension.boss.position.distanceTo(pilot.position) < 100,
		'the Void boss starts close enough to see and fight'
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
	assert.equal(
		level.jets[0].visible,
		true,
		'jetpack plumes show during flight'
	)
	level.keys.clear()
	level.velocity.set(0, 0, 0)
	const zBeforeForwardFlight = pilot.position.z
	level.keys.add('KeyW')
	dimension.update(1 / fps)
	assert.ok(
		pilot.position.z < zBeforeForwardFlight,
		'WASD moves the pilot in free flight without walking'
	)
	level.keys.clear()
	level.velocity.set(0, 0, 0)
	pilot.position.set(0, 8, 15)
	dimension.boss.receiveDamage(dimension.boss.maxHp)
	dimension.update(1 / fps)
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

const asteroidScene = new THREE.Group()
const asteroidBackdrop = new VoidSpaceBackdrop(
	{
		assetManager: {
			preloadModel: async () => {},
			getRawModel: () => null,
			loadModel: async () => {
				const model = new THREE.Group()
				model.add(
					new THREE.Mesh(
						new THREE.IcosahedronGeometry(
							1,
							1
						),
						new THREE.MeshStandardMaterial({
							color: 0x77736c,
						})
					)
				)
				return model
			},
		},
	},
	asteroidScene
)
await asteroidBackdrop.asteroidReady
assert.equal(ASTEROID_MODELS[0], '/assets/models/asteroids/asteroid_01.glb')
assert.equal(asteroidBackdrop.asteroids.length, VOID_ASTEROID_COUNT)
assert.ok(asteroidBackdrop.asteroidMeshes.length > 0)
assert.ok(
	asteroidBackdrop.asteroidMeshes.every(
		(mesh) => mesh.count === VOID_ASTEROID_COUNT
	),
	'Level 1 asteroid geometry is instanced for all void asteroids'
)
assert.equal(asteroidBackdrop.fallbackRocks.visible, false)
asteroidBackdrop.dispose()

console.log(
	'Void dimension: scene isolation, zero-gravity flight, gate completion and cleanup passed at 30/60/120 FPS.'
)
