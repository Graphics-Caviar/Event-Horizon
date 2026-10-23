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
stalker._enter('prepare')
assert.equal(stalker.state, 'idle', 'attack budget prevents concurrent windups')
assert.equal(VOID_STYLES.stalker.damage, 8)
console.log(
	'Combat: independent HP, configured attacks, invulnerability, lethal clamping, defeat and attack budget passed.'
)
