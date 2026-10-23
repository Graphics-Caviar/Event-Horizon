import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CinematicMissileSalvo } from '../src/cutscenes/CinematicMissileSalvo.js'

const snapshots = []
for (const fps of [30, 60, 120]) {
	const impact = new THREE.Vector3(10, 2, 20)
	const salvo = new CinematicMissileSalvo({
		impact,
		heightAt: (x, z) => x * 0.03 + z * 0.01,
	})
	assert.equal(salvo.missiles.length, 3)
	assert.ok(salvo.missiles.every((e) => !e.strike.group.visible))
	for (let i = 0; i < fps * 2; i++) salvo.update(1 / fps)
	assert.ok(
		salvo.missiles.every(
			(e) => e.strike.group.visible && !e.strike.impacted
		)
	)
	snapshots.push(
		salvo.missiles.map((e) => e.strike.missilePosition.clone())
	)
	assert.equal(
		new Set(
			salvo.missiles.map((e) =>
				e.strike.impactPosition.toArray().join(',')
			)
		).size,
		3
	)
	for (let i = 0; i < fps * 3; i++) salvo.update(1 / fps)
	assert.ok(salvo.missiles.every((e) => e.strike.impacted))
	for (const e of salvo.missiles) {
		assert.equal(e.strike.impact(), false, 'impact remains latched')
		assert.equal(
			e.strike.impactPosition.y,
			e.strike.impactPosition.x * 0.03 +
				e.strike.impactPosition.z * 0.01
		)
	}
	for (let i = 0; i < fps * 8; i++) salvo.update(1 / fps)
	assert.ok(
		salvo.missiles.every(
			(e) =>
				!e.strike.dust.points.visible &&
				!e.strike.debris.visible
		)
	)
	salvo.dispose()
	salvo.dispose()
	salvo.update(1)
	assert.equal(salvo.group.children.length, 0)
	assert.deepEqual(
		impact.toArray(),
		[10, 2, 20],
		'input remains unchanged'
	)
}
for (const snapshot of snapshots.slice(1))
	snapshot.forEach((p, i) =>
		assert.ok(
			p.distanceTo(snapshots[0][i]) < 1e-8,
			'trajectory matches across frame rates'
		)
	)

const interrupted = new CinematicMissileSalvo({
	impact: new THREE.Vector3(),
	heightAt: () => 0,
})
interrupted.update(0.2)
interrupted.dispose()
interrupted.update(10)
assert.ok(
	interrupted.missiles.every(
		(e) => e.strike._disposed && !e.strike.impacted
	),
	'early cancellation cannot resurrect missiles'
)
console.log(
	'Missile salvo passed: staggered flight, distinct grounded impacts, 30/60/120 FPS trajectories, bounded effects and cancellation.'
)
