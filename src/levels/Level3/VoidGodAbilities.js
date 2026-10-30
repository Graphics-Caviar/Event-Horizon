import * as THREE from 'three'

// All three boss phases share the same telegraph/active/recovery contract.
// The original rigged Galactus boss and pooled fireballs are retained.
const PHASES = [
	['cosmicCleave', 'voidProjectiles', 'gravityStomp', 'armourOfTheVoid'],
	['singularityBeam', 'meteoricCollapse', 'gravitationalCrush', 'voidClones'],
	['realityBreak', 'apocalypticBarrage', 'eventHorizon', 'finalAnnihilation'],
]
const WARNING = {
	cosmicCleave: 1.15, voidProjectiles: 1.0, gravityStomp: 1.3, armourOfTheVoid: 0.9,
	singularityBeam: 2.0, meteoricCollapse: 1.5, gravitationalCrush: 1.5, voidClones: 1.0,
	realityBreak: 1.6, apocalypticBarrage: 1.4, eventHorizon: 1.8, finalAnnihilation: 3.6,
}

export class VoidGodAbilities {
	constructor(boss, effects, level) {
		this.boss = boss
		this.fx = effects
		this.level = level
		this.phase = 1
		this.state = 'cooldown'
		this.timer = 2.1
		this.abilityIndex = 0
		this.activeAbility = ''
		this.shield = 0
		this.exposed = 0
		this.interruptDamage = 0
		this._warningTarget = new THREE.Vector3()
		this._target = new THREE.Vector3()
		this._lastPhase = 1
		this._notify = ''
	}
	get busy() { return this.state === 'windup' || this.state === 'recover' }
	get phaseLabel() { return ['AWAKENING', 'STAR EATER', 'GODFALL'][this.phase - 1] }
	onDamage(amount) {
		if (this.activeAbility === 'finalAnnihilation' && this.state === 'windup') {
			this.interruptDamage += amount
			if (this.interruptDamage >= 90) {
				this.activeAbility = ''
				this.state = 'recover'
				this.timer = 2.5
				this.exposed = 3.2
				this.level._showMovementFeedback?.('ANNIHILATION INTERRUPTED — CORE EXPOSED', 2.5)
			}
		}
	}
	damageFactor() { return this.shield > 0 ? 0.35 : this.exposed > 0 ? 1.5 : 1 }
	start(ability, player) {
		this.activeAbility = ability
		this.state = 'windup'
		this.timer = WARNING[ability]
		this.interruptDamage = 0
		this._warningTarget.copy(player)
		this.fx.warn(this.boss.position, ability === 'finalAnnihilation' ? 35 : 16, this.timer)
		if (['singularityBeam', 'meteoricCollapse', 'realityBreak', 'finalAnnihilation'].includes(ability)) this.fx.warn(player, 14, this.timer)
		this.level.voidAudio?.play('charge', this.boss.position, 0.7, this.timer)
		if (ability === 'finalAnnihilation') this.level._showMovementFeedback?.('DANGER — SHOOT THE CHEST CORE TO INTERRUPT', 3)
	}
	fire(player) {
		const b = this.boss, fx = this.fx, pos = b.position, attack = this.activeAbility
		switch (attack) {
			case 'cosmicCleave':
				fx.zone(this._warningTarget, 14, { warn: 0.45, damage: 20 }); break
			case 'voidProjectiles':
				fx.volley(pos, player, 3, 15, 35); break
			case 'gravityStomp':
				fx.pulse(pos, { radius: 36, duration: 1.15, damage: 20, knockback: 15 }); break
			case 'armourOfTheVoid':
				this.shield = 3.5; break
			case 'singularityBeam':
				fx.beam(pos, this._warningTarget, { warning: 0.6, duration: 1.0, damage: 26, radius: 9 }); fx.volley(pos, player, 3, 12, 46); this.exposed = 2; break
			case 'meteoricCollapse':
				for (let i = 0; i < 5; i++) {
					this._target.copy(this._warningTarget)
					this._target.x += Math.cos(i * 2.399) * (8 + i * 3)
					this._target.z += Math.sin(i * 2.399) * (8 + i * 3)
					fx.meteor(this._target, 0.7 + i * 0.2, 18)
				}
				break
			case 'gravitationalCrush':
				fx.field(pos, { radius: 55, duration: 2.8, pull: 38 });
				fx.pulse(pos, { radius: 32, duration: 1.25, damage: 19 }); break
			case 'voidClones':
				for (let i = 0; i < 3; i++) {
					this._target.copy(pos); this._target.x += (i - 1) * 22
					fx.decoy(this._target, 6)
				}
				break
			case 'realityBreak':
				for (let i = 0; i < 4; i++) {
					this._target.copy(this._warningTarget); this._target.x += (i - 1.5) * 16
					fx.zone(this._target, 9, { warn: 0.75 + 0.15 * i, damage: 22 })
				}
				break
			case 'apocalypticBarrage': fx.volley(pos, player, 8, 15, 39); break
			case 'eventHorizon':
				fx.field(pos, { radius: 60, duration: 3.8, pull: 36, damage: 13 }); break
			case 'finalAnnihilation':
				fx.beam(pos, this._warningTarget, { warning: 0.75, duration: 1.3, damage: 42, radius: 12 });
				fx.volley(pos, player, 7, 16, 43); break
		}
		this.level.voidAudio?.play('attack', pos, 0.8)
	}
	update(dt, player) {
		if (!this.boss.activated || this.boss.dead) return
		this.shield = Math.max(0, this.shield - dt)
		this.exposed = Math.max(0, this.exposed - dt)
		const ratio = this.boss.hp / this.boss.maxHp
		const phase = ratio > 0.65 ? 1 : ratio > 0.25 ? 2 : 3
		if (phase !== this.phase) {
			this.phase = phase
			this.state = 'cooldown'; this.timer = 2.4; this.activeAbility = ''; this.abilityIndex = 0
			this.fx.clear()
			this.level._showMovementFeedback?.(`VOID-GOD // PHASE ${phase} — ${this.phaseLabel}`, 3)
		}
		this.timer -= dt
		if (this.state === 'cooldown') {
			if (this.timer <= 0) {
				const attacks = PHASES[this.phase - 1]
				this.start(attacks[this.abilityIndex++ % attacks.length], player)
			}
		} else if (this.state === 'windup') {
			if (this.timer <= 0) {
				this.fire(player)
				this.state = 'recover'
				this.timer = this.phase === 3 ? 1.15 : 1.7
				this.exposed = Math.max(this.exposed, this.phase === 1 ? 0 : 1.0)
			}
		} else if (this.state === 'recover' && this.timer <= 0) {
			this.activeAbility = ''
			this.state = 'cooldown'
			this.timer = this.phase === 3 ? 0.65 : 1.1
		}
		if (this.busy) {
			this.boss._state = 'recover'
			this.boss._timer = Math.max(this.boss._timer, this.timer)
		}
	}
}
