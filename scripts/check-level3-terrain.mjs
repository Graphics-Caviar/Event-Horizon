import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
	CrystalPlanet,
	crystalTerrainHeight,
	CRYSTAL_MOUNTAINS,
} from '../src/levels/Level3/CrystalPlanet.js'
import { alienTerrainHeight } from '../src/levels/Level2/AlienPlanet.js'

const scene = new THREE.Scene()
const resources = new Set()
const level = {
	sceneManager: { scene },
	own: (resource) => {
		resources.add(resource)
		return resource
	},
	addObject: (object) => {
		scene.add(object)
		return object
	},
}
const clearZones = [
	{ x: 0, z: 0, radius: 28 },
	{ x: 120, z: 90, radius: 42 },
	{ x: 95, z: -55, radius: 46 },
	{ x: -150, z: 135, radius: 40 },
]
const planet = new CrystalPlanet(level, {
	center: new THREE.Vector3(60, -140, 45),
	baseY: -140,
	size: 1100,
	clearZones,
})
assert.equal(planet.terrain.name, 'level3-folded-mineral-valleys')
for (const peak of CRYSTAL_MOUNTAINS) {
	const summit = planet.heightAt(peak.x, peak.z)
	assert.ok(
		summit - planet.baseY > 115,
		'mountains must rise prominently above the basin'
	)
	assert.ok(
		summit > planet.heightAt(peak.x + peak.rx, peak.z) + 45,
		'mountains need real sloping foothills'
	)
}
assert.equal(
	planet.lava.mesh,
	undefined,
	'Level 3 must not contain the Level 2 lava stream'
)
let difference = 0
for (let x = -400; x <= 400; x += 80)
	for (let z = -400; z <= 400; z += 80) {
		difference += Math.abs(
			crystalTerrainHeight(x, z) - alienTerrainHeight(x, z)
		)
		assert.ok(Number.isFinite(planet.heightAt(x, z)))
	}
assert.ok(
	difference / 121 > 15,
	'Level 3 landforms must differ substantially from Level 2'
)
for (const destination of clearZones.slice(1))
	for (let i = 0; i <= 100; i++) {
		const x = (destination.x * i) / 100,
			z = (destination.z * i) / 100
		assert.ok(
			planet.slopeDegreesAt(x, z) < 17.5,
			'objective paths must stay walkable'
		)
		assert.equal(
			planet._isSpawnClear(x, z, 1),
			false,
			'scenery must leave objective paths clear'
		)
	}
const geometry = planet.terrain.geometry
const colors = geometry.attributes.color
let colourful = 0
for (let i = 0; i < colors.count; i += 100) {
	if (
		Math.max(colors.getX(i), colors.getY(i), colors.getZ(i)) -
			Math.min(
				colors.getX(i),
				colors.getY(i),
				colors.getZ(i)
			) >
		0.015
	)
		colourful++
}
assert.ok(colourful > 2000, 'ground must retain its natural material colours')
// Visible triangle samples are also the height source used by the rover collider.
const positions = geometry.attributes.position
for (let i = 1000; i < positions.count; i += 997) {
	const x = positions.getX(i) + planet.center.x,
		z = positions.getZ(i) + planet.center.z
	assert.ok(
		Math.abs(
			planet.heightAt(x, z) -
				(positions.getY(i) + planet.baseY)
		) < 0.001
	)
}
planet.dispose()
for (const resource of resources) resource.dispose()
console.log(
	'Level 3 terrain passed: distinct landforms, natural colours, objective paths and mesh/collision alignment.'
)
