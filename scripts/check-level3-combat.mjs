import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Level2 } from '../src/levels/Level2/Level2.js'
import { VoidEnemy, VOID_STYLES } from '../src/levels/Level3/VoidEnemy.js'

const player = Object.assign(Object.create(Level2.prototype), {
	playerHP: 100,
	damageCooldown: 0,
	completed: false,
	_flashDamage() {},
	_updateLevelHUD() {},
	_gameOver() {
		this.completed = true
	},
})
assert.equal(player._applyAlienHit(10), false)
assert.equal(player.playerHP, 90)
player._applyAlienHit(30)
assert.equal(player.playerHP, 90, 'invulnerability prevents duplicate hits')
player.damageCooldown = 0
player._applyAlienHit(200)
assert.equal(player.playerHP, 0)
assert.equal(player.completed, true)

const level = {
	aliens: [],
	combatConfig: { maxAttackers: 1 },
	addObject() {},
	playerRoot: { position: new THREE.Vector3() },
	planet: {
		heightAt() {
			return 0
		},
	},
}
function enemy(style) {
	const e = new VoidEnemy(level, style, { home: new THREE.Vector3() })
	e._loaded = true
	e._drawHpBar = () => {}
	level.aliens.push(e)
	return e
}
const predator = enemy('predator'),
	brute = enemy('brute')
assert.equal(predator.hp, 60)
assert.equal(brute.hp, 180)
predator.damage(30)
assert.equal(predator.hp, 30)
assert.equal(brute.hp, 180, 'health is independent')
assert.equal(predator.attackDamage, 10)
brute._onPrepareStart()
assert.equal(brute.attackDamage, 20)
brute._onPrepareStart()
assert.equal(brute.attackDamage, 30)
brute.damage(999)
assert.equal(brute.hp, 0)
assert.equal(brute.state, 'dead')
assert.equal(brute.pendingStrike, false)
brute._applyMeleeStrike = () => {
	throw Error('dead enemy attacked')
}
brute.update(1 / 60)

predator._enter('dive')
const stalker = enemy('stalker')
assert.equal(
	stalker._enter('prepare'),
	false,
	'attack budget rejects concurrent windups'
)
assert.equal(stalker.state, 'idle')
let attackCues = 0
stalker._voidAudio = { play: () => attackCues++ }
stalker.state = 'chase'
stalker._groundCombat(1 / 60, new THREE.Vector3(0, 0, 1), 1)
assert.equal(stalker.state, 'chase')
assert.equal(attackCues, 0, 'rejected windup has no attack cue')
assert.ok(stalker._cooldown > 0, 'rejected windup is briefly deferred')
stalker.state = 'prepare'
predator.state = 'orbit'
predator._attackIndex = 0
predator._cooldown = 0
predator._voidAudio = { play: () => attackCues++ }
predator._setGlow = () => {}
predator._flyerCombat(1 / 60, new THREE.Vector3(0, 0, 1), 1)
assert.equal(predator.state, 'orbit')
assert.equal(attackCues, 0, 'rejected dive has no attack cue')
assert.equal(
	predator._attackIndex,
	0,
	'rejected attack does not advance the attack cycle'
)
assert.equal(VOID_STYLES.stalker.damage, 8)
console.log(
	'Combat: independent HP, configured attacks, invulnerability, lethal clamping, defeat and attack budget passed.'
)
