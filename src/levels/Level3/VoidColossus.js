import * as THREE from 'three'
import { VoidEnemy } from './VoidEnemy.js'

/**
 * The Void Colossus — the arena's occupant and the run's final fight.
 * Distinct attack phases instead of a continuous pressure bar:
 *   phase 1 (>66% hp): slow slams with long, readable windups.
 *   phase 2 (33-66%):  alternates slams with wider, faster sweeps.
 *   phase 3 (<33%):    enraged — quicker feet, shorter windups, tighter
 *                      cooldowns.
 * Recovery windows stay generous in every phase; the shockwave ring is
 * dodged by jumping or jetpacking (grounded pilots only).
 */
export class VoidColossus extends VoidEnemy {
	constructor(level, options = {}) {
		super(level, 'colossus', options)
		this._phase = 1
		this._baseChase = this.style.chaseSpeed
		this._baseWindup = this.style.windup
		this._baseCooldown = [...this.style.cooldown]
		this._nextAttack = 'slam'
		this._sweeping = false
		this._shockwave = null
		this._shockT = -1
		this._shockHit = false
	}

	damage(amount, opts = {}) {
		const before = this._phaseOf(this.hp)
		// Far too heavy to stagger; the phase shift carries the reaction.
		super.damage(amount, { ...opts, stagger: false })
		if (this.smashed) return
		const after = this._phaseOf(this.hp)
		if (after > before) this._enterPhase(after)
	}

	_phaseOf(hp) {
		const fraction = hp / this.maxHp
		if (fraction > 0.66) return 1
		if (fraction > 0.33) return 2
		return 3
	}

	_enterPhase(phase) {
		this._phase = phase
		const speedScale = phase === 3 ? 1.5 : phase === 2 ? 1.2 : 1
		const windupScale = phase === 3 ? 0.8 : 1
		const cooldownScale = phase === 3 ? 0.6 : phase === 2 ? 0.8 : 1
		this.style.chaseSpeed = this._baseChase * speedScale
		this.style.windup = this._baseWindup * windupScale
		this.style.cooldown = this._baseCooldown.map(
			(value) => value * cooldownScale
		)
		this._voidAudio?.play('detect', this.position, 0.5)
		this.level._requestShake?.(0.4)
		this.level.dust?.spawnBurst(
			{
				x: this.position.x,
				y: this.planet.heightAt(
					this.position.x,
					this.position.z
				),
				z: this.position.z,
			},
			{
				count: 22,
				strength: 3,
				spread: 4,
				size: 1.5,
				upBias: 0.6,
			}
		)
		this._setGlow(1)
	}

	_onPrepareStart() {
		// Phase 1 slams only; later phases alternate in a wider sweep.
		this._nextAttack =
			this._phase >= 2 && this._nextAttack === 'slam'
				? 'sweep'
				: 'slam'
		this._sweeping = this._nextAttack === 'sweep'
		this._windupOverride = this._sweeping
			? this.style.windup * 0.7
			: 0
	}

	_applyMeleeStrike(playerPos) {
		const wasSweeping = this._sweeping
		super._applyMeleeStrike(playerPos)
		if (!wasSweeping) this._spawnShockwave()
	}

	_spawnShockwave() {
		if (!this._shockwave) {
			const geometry = this.level.own(
				new THREE.RingGeometry(0.86, 1, 48)
			)
			const material = this.level.own(
				new THREE.MeshBasicMaterial({
					color: 0xc9a6ff,
					transparent: true,
					opacity: 0.85,
					side: THREE.DoubleSide,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				})
			)
			this._shockwave = new THREE.Mesh(geometry, material)
			this._shockwave.rotation.x = -Math.PI / 2
			this._shockwave.visible = false
			this.level.addObject(this._shockwave)
		}
		this._shockwave.visible = true
		this._shockwave.position.set(
			this.position.x,
			this.planet.heightAt(this.position.x, this.position.z) +
				0.5,
			this.position.z
		)
		this._shockT = 0
		this._shockHit = false
		this._voidAudio?.play('shock', this.position, 0.6)
	}

	_updateShockwave(delta) {
		if (!this._shockwave?.visible) return
		this._shockT += delta
		const t = Math.min(1, this._shockT / 1.1)
		const radius = 3 + t * 15
		this._shockwave.scale.setScalar(radius)
		this._shockwave.material.opacity = 0.85 * (1 - t)
		if (!this._shockHit) {
			const player = this.level.playerRoot.position
			const distance = Math.hypot(
				player.x - this._shockwave.position.x,
				player.z - this._shockwave.position.z
			)
			// Airborne pilots ride over the ring; grounded ones take the hit.
			const grounded =
				player.y -
					this.planet.heightAt(
						player.x,
						player.z
					) <
				4
			if (grounded && Math.abs(distance - radius) < 2.6) {
				this._shockHit = true
				this.pendingStrike = true
			}
		}
		if (t >= 1) this._shockwave.visible = false
	}

	_onDeath() {
		this.level._bossDefeated = true
	}

	update(delta, playerPos) {
		super.update(delta, playerPos)
		// The ring finishes its run even if the boss itself is culled.
		this._updateShockwave(delta)
	}
}
