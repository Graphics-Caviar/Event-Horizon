import assert from 'node:assert/strict'
import * as THREE from 'three'
import { VoidMonuments } from '../src/levels/Level3/VoidMonuments.js'

const scene = new THREE.Scene()
const gate = new THREE.Group()
const oldVisual = new THREE.Group()
gate.add(oldVisual)
const portal = { group: gate, _arrivalT: 0, suckLevel: 0 }
const model = new THREE.Mesh(
	new THREE.BoxGeometry(2, 4, 1),
	new THREE.MeshBasicMaterial()
)
let missing = false
const level = {
	portal,
	portalSite: new THREE.Vector3(40, 0, 50),
	landingSite: new THREE.Vector3(),
	crashSite: new THREE.Vector3(),
	assetManager: {
		preloadModel: async () => {},
		loadModel: async () => (missing ? null : model),
	},
	planet: { heightAt: () => 10 },
	addObject: (node) => {
		scene.add(node)
		return node
	},
	_findWalkableSite: (p) => p,
	_fit: (node, fit) => node.scale.setScalar(fit / 4),
	_registerGameplayCollider: () => {
		throw new Error('Portal must remain passable')
	},
}
const monuments = new VoidMonuments(level)
monuments.dispose() // cancel staggered loads; invoke the portal load deterministically
assert.deepEqual(monuments.sites.rift, level.portalSite)
const def = {
	key: 'gravRift',
	site: monuments.sites.rift,
	fit: 30,
	yaw: 0,
	embed: 0.15,
	portal: true,
	colliders: [],
	light: { color: 0xb26bff, intensity: 1.6, distance: 170 },
}
missing = true
await monuments._load(def)
assert.equal(oldVisual.visible, true, 'missing model retains original portal')
missing = false
await monuments._load(def)
assert.equal(oldVisual.visible, false, 'rift replaces original portal art')
assert.equal(portal.riftModel, model)
assert.equal(model.position.x, level.portalSite.x)
assert.equal(model.position.z, level.portalSite.z)
assert.ok(Math.abs(new THREE.Box3().setFromObject(model).min.y - 10.15) < 0.001)
monuments._applyRiftPull = () => {
	throw new Error('Exit must not apply the anomaly hazard pull')
}
const yaw = model.rotation.y
monuments.update(1)
assert.equal(model.rotation.y, yaw)
const idleLight = monuments._riftLight.intensity
portal._arrivalT = 1.5
monuments.update(0)
assert.ok(
	monuments._riftLight.intensity > idleLight + 10,
	'arrival lights the new portal'
)
monuments._group.removeFromParent()
portal.riftModel = null
await monuments._load(def)
assert.equal(
	portal.riftModel,
	null,
	'late load cannot attach after level disposal'
)
model.geometry.dispose()
model.material.dispose()
console.log(
	'Rift portal checks passed: replacement, fallback, placement, passable entrance, arrival and late-load cleanup.'
)
