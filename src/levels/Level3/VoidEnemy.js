import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'
import { VoidRigAnimator } from './VoidRigAnimator.js'

const CULL_DISTANCE = 260
// Rover impact above this speed hurts the enemy instead of the crew
// (same thresholds as Level2's Alien).
const RAM_SPEED_MIN = 6
const RAM_DAMAGE = 75

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const _forward = new THREE.Vector3()
const _step = new THREE.Vector3()
const _orbitPoint = new THREE.Vector3()

const rand = ([min, max]) => min + Math.random() * (max - min)

/**
 * One shared radial-gradient texture backs every telegraph glow sprite;
 * created lazily and never disposed (same lifetime model as the GLB
 * cache). Colour is set per enemy via the sprite material.
 */
let _glowTexture = null
const glowTexture = () => {
	if (_glowTexture) return _glowTexture
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d')
	const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
	gradient.addColorStop(0, 'rgba(255,255,255,1)')
	gradient.addColorStop(0.35, 'rgba(255,255,255,.5)')
	gradient.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, 64, 64)
	_glowTexture = new THREE.CanvasTexture(canvas)
	return _glowTexture
}

/**
 * Combat personalities for the void warband. Rigged Void GLBs
 * use procedural bone movement; nonrigged fallbacks retain body
 * choreography — the same phase timeline a boned arm swing would follow
 * (weight shift in `windup`, committed lunge in `active`, overshoot +
 * settle in `recover`) driven through lean, pitch, bank and stride rather
 * than faked bone rotation. Reported limitation; see the level summary.
 *
 * Fields the state machine reads:
 *   hp / speed / chaseSpeed / turnDamp / accel — locomotion and life
 *   noticeRange                               — configurable detect range
 *   attackRange / attackArc                   — hit envelope (cos dot)
 *   windup / active / recover                 — attack phase lengths
 *   cooldown: [min, max]                      — between-attack rest
 *   repositionTime                            — RETREAT after attacks (0 = press)
 *   stride                                    — metres per footfall event
 *   stagger                                   — hit-reaction length
 *   slamRadius                                — heavies crack the ground
 *   idleLoop                                  — positional breathing hum
 */
export const VOID_STYLES = {
	stalker: {
		asset: 'riftStalker',
		hp: 50,
		damage: 8,
		fit: 5.4,
		radius: 2,
		speed: 5,
		chaseSpeed: 7.6,
		turnDamp: 7,
		accel: 6,
		noticeRange: 58,
		attackRange: 5.4,
		attackArc: 0.5,
		windup: 0.42,
		active: 0.2,
		recover: 0.5,
		cooldown: [0.5, 1.1],
		repositionTime: 1.1,
		stride: 2.1,
		stagger: 0.5,
		kind: 'ground',
		voice: 1.5,
		glow: 0x6ef2ff,
		idleLoop: false,
	},
	sentinel: {
		asset: 'voidSentinel',
		hp: 180,
		damage: 20,
		heavyDamage: 30,
		fit: 7.2,
		radius: 2.8,
		speed: 2.6,
		chaseSpeed: 3.4,
		turnDamp: 3.2,
		accel: 3.4,
		noticeRange: 50,
		attackRange: 6.6,
		attackArc: 0.2,
		windup: 0.95,
		active: 0.28,
		recover: 1.2,
		cooldown: [1.6, 2.6],
		repositionTime: 0,
		stride: 3.4,
		stagger: 0.28,
		kind: 'ground',
		voice: 0.8,
		glow: 0xb48cff,
		idleLoop: true,
		slamRadius: 7.5,
	},
	entity: {
		asset: 'voidEntity',
		hp: 60,
		damage: 10,
		fit: 6.6,
		radius: 2.4,
		speed: 6.5,
		chaseSpeed: 6.5,
		turnDamp: 3,
		accel: 4,
		noticeRange: 95,
		attackRange: 70,
		attackArc: 0,
		windup: 1.1,
		active: 0,
		recover: 0.9,
		cooldown: [2.6, 4.4],
		repositionTime: 0,
		stride: 0,
		stagger: 0.4,
		kind: 'flyer',
		voice: 1.2,
		glow: 0x7affd8,
		idleLoop: true,
		altitude: 24,
		orbitRadius: 30,
		heavyEvery: 3,
		diveEvery: 4,
		diveDuration: 2.6,
	},
	colossus: {
		asset: 'voidColossus',
		hp: 350,
		damage: 25,
		fit: 9.5,
		radius: 3.6,
		speed: 2.2,
		chaseSpeed: 3,
		turnDamp: 2.6,
		accel: 2.6,
		noticeRange: 70,
		attackRange: 8.5,
		attackArc: 0.1,
		windup: 1.25,
		active: 0.32,
		recover: 1.5,
		cooldown: [3.4, 5],
		repositionTime: 0,
		stride: 4.6,
		stagger: 0.35,
		kind: 'ground',
		voice: 0.55,
		glow: 0xc9a6ff,
		idleLoop: true,
		slamRadius: 9,
	},
}

VOID_STYLES.predator = {
	...VOID_STYLES.entity,
	asset: 'flyingPredator',
	speed: 23,
	chaseSpeed: 27,
	altitude: 15,
	orbitRadius: 20,
	diveEvery: 2,
	cooldown: [1.7, 2.3],
	noticeRange: 190,
}
VOID_STYLES.brute = {
	...VOID_STYLES.sentinel,
	asset: 'alienBrute',
	speed: 8,
	chaseSpeed: 13,
	accel: 7,
	noticeRange: 170,
	cooldown: [1.7, 2.3],
	heavyCooldown: 5,
}

/**
 * A Void of Gods combatant. Duck-types the Level2 Alien surface —
 * update(delta, playerPos), combatMode, pendingStrike, smashed, radius,
 * kind, checkRoverCollision, checkPlayerCollision, damage — so Level2's
 * combat loop, crowd separation and damage systems run unchanged.
 */
export class VoidEnemy {
	constructor(level, styleName, options = {}) {
		const style = VOID_STYLES[styleName]
		this.level = level
		this.styleName = styleName
		// Per-instance copy: the boss re-scales phases on its own tuning.
		this.style = { ...style, cooldown: [...style.cooldown] }
		this.kind = style.kind
		this.radius = style.radius
		this.hp = this.maxHp = style.hp
		// Mirrors Alien: Level2's separation and rover logic treat
		// `smashed` as out-of-play.
		this.smashed = false
		this.combatMode = false
		this.pendingStrike = false

		this.group = new THREE.Group()
		this.group.name = `void-${styleName}`
		this.group.position.copy(options.home)
		this.group.visible = false
		level.addObject(this.group)
		this.position = this.group.position

		this.planet = level.planet
		this.target = level.playerRoot
		this._voidAudio = level.voidAudio
		this._loopId = `void-${styleName}-${VoidEnemy._serial++}`

		// State machine.
		this.state = 'idle'
		this._timer = 1 + Math.random() * 2
		this._phaseT = 0
		this._cooldown = 0
		this._staggerT = 0
		this._heading = Math.random() * Math.PI * 2
		this._prevHeading = this._heading
		this.group.rotation.y = this._heading
		this._velocity = new THREE.Vector3()
		this._walked = 0
		this._bob = Math.random() * Math.PI * 2
		this._leanPitch = 0
		this._visualTurn = 0
		this._attackPitch = 0
		this._climbVisual = 0
		this._hitFlash = 0
		this._struckThisAttack = false
		this._windupOverride = 0
		this._stuckTimer = 0
		this._stuckScratch = this.position.clone()
		this._detour = null
		this._moveTargetScratch = new THREE.Vector3()
		this._patrolTarget = null
		this._ramCooldown = 0
		this._contactCooldown = 0
		this._deathT = -1
		this._deathDir = 1

		this._model = null
		this._fitScale = 1
		this._baseY = 0
		this._glow = null
		this._hpBar = null
		this._loaded = false
		this._disposed = false
	}

	async load() {
		if (this._disposed) return
		const model = await loadVoidModel(
			this.level.assetManager,
			this.style.asset
		)
		if (!model || this._disposed || !this.group.parent) return
		this.level._fit(model, this.style.fit)
		this._fitScale = model.scale.x
		model.updateMatrixWorld(true)
		const box = new THREE.Box3().setFromObject(model)
		// Ground the feet: _fit centres the bounding box, so lift min.y
		// back to the root origin.
		model.position.y += -box.min.y
		this._baseY = model.position.y
		// 1.5M-triangle bodies stay out of the shadow pass.
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = false
				child.receiveShadow = false
			}
		})
		this.group.add(model)
		this._model = model
		this.rigAnimator = new VoidRigAnimator(model, this.styleName)
		this._buildGlow(box)
		this._buildHpBar(box)
		if (this.kind !== 'flyer') {
			// Solid to the pilot and rover while idling; opens up once
			// combat starts (same contract as Alien).
			this.collider = this.level._registerGameplayCollider(
				this.position.x,
				this.position.z,
				this.radius,
				'alien',
				this.group
			)
		}
		if (this.kind === 'flyer') this._preloadBolts()
		this._syncToTerrain(0)
		this._loaded = true
	}

	_buildGlow(box) {
		const height = box.max.y - box.min.y
		const material = this.level.own(
			new THREE.SpriteMaterial({
				map: glowTexture(),
				color: this.style.glow,
				transparent: true,
				opacity: 0,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const sprite = new THREE.Sprite(material)
		sprite.scale.setScalar(height * 0.9)
		sprite.position.y = this._baseY + height * 0.62
		this.group.add(sprite)
		this._glow = sprite
	}

	_setGlow(level) {
		if (this._glow) this._glow.material.opacity = level * 0.75
	}

	_buildHpBar(box) {
		const height = box.max.y - box.min.y
		const canvas = document.createElement('canvas')
		canvas.width = 96
		canvas.height = 12
		const texture = new THREE.CanvasTexture(canvas)
		const material = this.level.own(
			new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				opacity: 0.95,
				depthWrite: false,
			})
		)
		const sprite = new THREE.Sprite(material)
		sprite.scale.set(2.8, 0.36, 1)
		sprite.position.y = this._baseY + height * 1.06
		sprite.visible = false
		this.group.add(sprite)
		this._hpBar = {
			sprite,
			canvas,
			ctx: canvas.getContext('2d'),
			texture,
			timer: 0,
		}
	}

	_drawHpBar() {
		const bar = this._hpBar
		if (!bar) return
		const { ctx, canvas } = bar
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.fillStyle = 'rgba(8,12,20,.8)'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.fillStyle = '#8ef3ff'
		ctx.fillRect(
			2,
			2,
			(canvas.width - 4) * (this.hp / this.maxHp),
			canvas.height - 4
		)
		bar.texture.needsUpdate = true
		bar.sprite.visible = true
		bar.timer = 4
	}

	update(delta, playerPos = this.target.position) {
		if (!this._loaded || !this.group.parent) return
		if (this.smashed) {
			this._updateDeath(delta)
			return
		}

		if (
			this.kind !== 'flyer' &&
			this.level.survival?.isGone(
				this.position.x,
				this.position.z
			)
		) {
			this._die()
			this.group.visible = false
			return
		}

		const dx = playerPos.x - this.position.x
		const dz = playerPos.z - this.position.z
		const distance = Math.hypot(dx, dz)
		const culled = distance > CULL_DISTANCE
		if (this.group.visible === culled) this.group.visible = !culled

		// Every gate timer decays here, before any early return, so no
		// cooldown can ever freeze shut (see the Alien.js lesson).
		this._cooldown = Math.max(0, this._cooldown - delta)
		this._ramCooldown = Math.max(0, this._ramCooldown - delta)
		this._contactCooldown = Math.max(
			0,
			this._contactCooldown - delta
		)
		this._hitFlash = Math.max(0, this._hitFlash - delta * 2.5)
		if (this._hpBar && this._hpBar.timer > 0) {
			this._hpBar.timer -= delta
			if (this._hpBar.timer <= 0)
				this._hpBar.sprite.visible = false
		}

		if (this._hpBar)
			this._hpBar.sprite.visible =
				this._hpBar.timer > 0 && distance < 35
		this._updateBolts(delta)
		this._updateAudio(distance)
		if (culled) return

		if (!this.combatMode) {
			if (distance < this.style.noticeRange) {
				this.combatMode = true
				this._enter('detect')
				this._timer = 0.45
				this._voidAudio?.play(
					'detect',
					this.position,
					this.style.voice
				)
			} else {
				this._wanderUpdate(delta)
				this._updateBody(delta)
				return
			}
		}

		if (this.kind === 'flyer') {
			this._flyerCombat(delta, playerPos, distance)
		} else {
			this._groundCombat(delta, playerPos, distance)
		}
		this._updateBody(delta)
	}

	_enter(state) {
		if (['prepare', 'charge', 'dive'].includes(state)) {
			const count = this.level.aliens.filter(
				(e) =>
					e !== this &&
					!e.smashed &&
					[
						'prepare',
						'strike',
						'charge',
						'dive',
					].includes(e.state)
			).length
			if (
				count >=
				(this.level.combatConfig?.maxAttackers ?? 3)
			)
				return false
		}
		this.state = state
		this._phaseT = 0
		return true
	}

	// ------------------------------------------------------------------
	// Ground state machine: idle/patrol → detect → chase → prepare →
	// strike → recover (→ reposition) → chase, with stagger interrupts.
	// ------------------------------------------------------------------
	_groundCombat(delta, playerPos, distance) {
		switch (this.state) {
			case 'detect':
				this._faceTowards(playerPos, delta, 6)
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 8 * delta)
				)
				this._timer -= delta
				if (this._timer <= 0) this._enter('chase')
				break
			case 'chase': {
				if (
					distance <= this.style.attackRange &&
					this._cooldown <= 0
				) {
					if (!this._enter('prepare')) {
						this._cooldown = Math.max(
							this._cooldown,
							0.3
						)
						break
					}
					this._struckThisAttack = false
					this._windupOverride = 0
					this._onPrepareStart?.()
					const windup =
						this._windupOverride ||
						this.style.windup
					this._voidAudio?.play(
						'charge',
						this.position,
						this.style.voice,
						windup
					)
					this._setGlow(1)
					break
				}
				if (distance <= this.style.attackRange) {
					// Attack spent: hold ground and square up until the
					// cooldown clears instead of re-swinging every frame.
					this._velocity.multiplyScalar(
						Math.max(0, 1 - 6 * delta)
					)
					this._faceTowards(playerPos, delta, 4)
					break
				}
				// Sprint at range and settle as it closes: the approach
				// reads as acceleration, not a constant-speed slide.
				const speed = THREE.MathUtils.lerp(
					this.style.speed,
					this.style.chaseSpeed,
					Math.min(1, distance / 40)
				)
				this._moveTowards(playerPos, delta, speed)
				this._antiStuck(delta, playerPos)
				break
			}
			case 'prepare': {
				// Weight shift: slow, committed, readable. Higher turn
				// authority so it can square up mid-windup.
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 8 * delta)
				)
				this._faceTowards(playerPos, delta, 5)
				this._phaseT += delta
				const windup =
					this._windupOverride ||
					this.style.windup
				const t = Math.min(1, this._phaseT / windup)
				this._attackPitch =
					-0.45 * Math.sin(t * Math.PI * 0.5)
				this._setGlow(
					0.45 +
						0.55 *
							Math.abs(
								Math.sin(
									this
										._phaseT *
										14
								)
							)
				)
				if (this._phaseT >= windup) {
					this._enter('strike')
					// The body commits: a lunge impulse along the facing.
					this._velocity.addScaledVector(
						this._forward(),
						this.styleName === 'sentinel'
							? 7
							: 12
					)
				}
				break
			}
			case 'strike': {
				this._phaseT += delta
				const t = Math.min(
					1,
					this._phaseT / this.style.active
				)
				this._attackPitch = THREE.MathUtils.lerp(
					-0.45,
					0.62,
					t
				)
				// Damage lands mid-swing, once per attack, and only if the
				// pilot is inside the hit envelope.
				if (!this._struckThisAttack && t >= 0.45) {
					this._struckThisAttack = true
					this._applyMeleeStrike(playerPos)
				}
				if (this._phaseT >= this.style.active) {
					this._enter('recover')
					this._setGlow(0)
					this._cooldown =
						(this._heavyAttack
							? (this.style
									.heavyCooldown ??
								5)
							: rand(
									this
										.style
										.cooldown
								)) +
						this.style.recover
				}
				break
			}
			case 'recover': {
				// Follow-through settles back to stance; a wide-open window
				// by design — this is when the pilot punishes.
				this._phaseT += delta
				const t = Math.min(
					1,
					this._phaseT / this.style.recover
				)
				this._attackPitch = 0.62 * (1 - t)
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 5 * delta)
				)
				if (this._phaseT >= this.style.recover) {
					this._attackPitch = 0
					if (
						this.style.repositionTime > 0 &&
						Math.random() < 0.65
					) {
						this._enter('reposition')
						this._timer =
							this.style.repositionTime
						this._detour =
							this._tangentPoint(
								playerPos,
								14 +
									Math.random() *
										10
							)
					} else {
						this._enter('chase')
					}
				}
				break
			}
			case 'reposition':
				this._moveTowards(
					this._detour ?? playerPos,
					delta,
					this.style.chaseSpeed * 0.85
				)
				this._timer -= delta
				if (
					this._timer <= 0 ||
					this.position.distanceTo(
						this._detour ?? playerPos
					) < 2.5
				) {
					this._enter('chase')
				}
				break
			case 'stagger':
				this._staggerT -= delta
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 9 * delta)
				)
				this._attackPitch =
					Math.sin(this._staggerT * 22) * 0.1
				if (this._staggerT <= 0) {
					this._attackPitch = 0
					this._enter('chase')
				}
				break
		}
	}

	/** Hook for style-specific attack selection (boss slams vs sweeps). */
	_onPrepareStart() {
		this._attackCount = (this._attackCount ?? 0) + 1
		this._heavyAttack =
			!!this.style.heavyDamage && this._attackCount % 2 === 0
		if (this._heavyAttack) this._windupOverride = 1.25
	}

	get attackDamage() {
		return this._heavyAttack
			? this.style.heavyDamage
			: this.style.damage
	}

	_applyMeleeStrike(playerPos) {
		const dx = playerPos.x - this.position.x
		const dz = playerPos.z - this.position.z
		const distance = Math.hypot(dx, dz)
		const sweeping = this._sweeping
		const reach = this.style.attackRange + (sweeping ? 2.5 : 1.6)
		const forward = this._forward()
		const inArc =
			distance <= reach &&
			(distance < 1.5 ||
				(forward.x * dx + forward.z * dz) / distance >
					(sweeping
						? 0.05
						: this.style.attackArc))
		if (
			inArc &&
			Math.abs(playerPos.y - this.position.y) <
				this.style.fit + 1
		) {
			// One boolean per attack; Level2 applies hull damage through
			// its own cooldown + knockback path.
			this.pendingStrike = true
			this._voidAudio?.play(
				'hit',
				playerPos,
				this.style.voice
			)
		}
		// Heavies crack the ground whether or not the pilot was caught.
		if (this.style.slamRadius && !sweeping) this._groundSlam()
	}

	_groundSlam() {
		const forward = this._forward()
		const x = this.position.x + forward.x * 2.2
		const z = this.position.z + forward.z * 2.2
		this.level.dust?.spawnBurst(
			{
				x,
				y: this.planet.heightAt(x, z),
				z,
			},
			{
				count: 18,
				strength: 2.6,
				spread: 3,
				size: 1.4,
				upBias: 0.5,
			}
		)
		this.level._requestShake?.(0.3)
	}

	// ------------------------------------------------------------------
	// Flyer state machine: orbit → charge (volley) → recover, with a
	// committed low dive every few volleys so the blade and rover can
	// punish it.
	// ------------------------------------------------------------------
	_flyerCombat(delta, playerPos, distance) {
		switch (this.state) {
			case 'detect':
				this._faceTowards(playerPos, delta, 5)
				this._timer -= delta
				if (this._timer <= 0) {
					this._enter('orbit')
					this._orbitAngle = Math.atan2(
						this.position.z - playerPos.z,
						this.position.x - playerPos.x
					)
					this._orbitSpeed =
						(Math.random() < 0.5 ? 1 : -1) *
						(0.22 + Math.random() * 0.16)
					this._cooldown =
						1.2 + Math.random() * 1.5
					this._attackIndex = 0
				}
				break
			case 'orbit': {
				this._orbitAngle += this._orbitSpeed * delta
				_orbitPoint.set(
					playerPos.x +
						Math.cos(this._orbitAngle) *
							this.style.orbitRadius,
					0,
					playerPos.z +
						Math.sin(this._orbitAngle) *
							this.style.orbitRadius
				)
				this._moveTowards(
					_orbitPoint,
					delta,
					this.style.speed
				)
				if (
					this._cooldown <= 0 &&
					!this.pendingStrike
				) {
					const attackIndex =
						(this._attackIndex ?? 0) + 1
					const heavy =
						attackIndex %
							this.style
								.heavyEvery ===
						0
					const dive =
						attackIndex %
							this.style.diveEvery ===
						0
					if (
						!this._enter(
							dive ? 'dive' : 'charge'
						)
					) {
						this._cooldown = Math.max(
							this._cooldown,
							0.3
						)
						break
					}
					this._attackIndex = attackIndex
					this._heavyNext = heavy && !dive
					this._struckThisAttack = false
					this._voidAudio?.play(
						'charge',
						this.position,
						this.style.voice,
						this.style.windup
					)
					if (dive) {
						this._voidAudio?.play(
							'dive',
							this.position,
							this.style.voice
						)
					}
					this._setGlow(1)
				}
				break
			}
			case 'charge': {
				// Telegraphed volley: hover steady, glow pulses, then fire.
				this._faceTowards(playerPos, delta, 4)
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 3 * delta)
				)
				this._phaseT += delta
				this._setGlow(
					0.4 +
						0.6 *
							Math.abs(
								Math.sin(
									this
										._phaseT *
										10
								)
							)
				)
				if (this._phaseT >= this.style.windup) {
					this._fireBolt(
						playerPos,
						this._heavyNext
					)
					this._enter('recover')
					this._setGlow(0)
					this._cooldown =
						rand(this.style.cooldown) +
						this.style.recover
				}
				break
			}
			case 'dive': {
				this._phaseT += delta
				if (this._phaseT < this.style.windup) {
					this._velocity.multiplyScalar(
						Math.exp(-4 * delta)
					)
					break
				}
				const t =
					(this._phaseT - this.style.windup) /
					this.style.diveDuration
				if (t < 0.55) {
					this._moveTowards(
						playerPos,
						delta,
						this.styleName === 'predator'
							? 32
							: 17
					)
				} else if (t < 0.75) {
					this._velocity.multiplyScalar(
						Math.max(0, 1 - 4 * delta)
					)
					if (!this._struckThisAttack) {
						this._struckThisAttack = true
						const dy = Math.abs(
							playerPos.y -
								this.position.y
						)
						if (
							distance < 6.5 &&
							dy < 5 &&
							this.level
								.damageCooldown <=
								0
						) {
							this.pendingStrike = true
							this._voidAudio?.play(
								'attack',
								playerPos,
								this.style.voice
							)
							this.level.dust?.spawnBurst(
								{
									x: playerPos.x,
									y: this.planet.heightAt(
										playerPos.x,
										playerPos.z
									),
									z: playerPos.z,
								},
								{
									count: 10,
									strength: 2,
									spread: 2,
									size: 1,
									upBias: 0.6,
								}
							)
						}
					}
				} else {
					// Climb back out of reach.
					this._velocity.multiplyScalar(
						Math.max(0, 1 - 2 * delta)
					)
				}
				if (t >= 1) {
					this._enter('orbit')
					this._setGlow(0)
					this._cooldown =
						rand(this.style.cooldown) +
						(this.styleName === 'predator'
							? 0
							: 1.4)
				}
				break
			}
			case 'recover':
				this._phaseT += delta
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 3 * delta)
				)
				if (this._phaseT >= this.style.recover) {
					this._enter('orbit')
				}
				break
			case 'stagger':
				// Knocked low — briefly blade-reachable.
				this._staggerT -= delta
				this._velocity.multiplyScalar(
					Math.max(0, 1 - 5 * delta)
				)
				if (this._staggerT <= 0) this._enter('orbit')
				break
		}
	}

	async _preloadBolts() {
		const normal = await loadVoidModel(
			this.level.assetManager,
			'energyBolt'
		)
		const heavy = await loadVoidModel(
			this.level.assetManager,
			'energyBoltHeavy'
		)
		if (this._disposed || !this.group.parent) return
		this._boltPool = []
		for (const [type, template] of [
			['normal', normal],
			['heavy', heavy],
		]) {
			if (!template) continue
			for (let i = 0; i < 2; i++) {
				const mesh = template.clone()
				this.level._fit(
					mesh,
					type === 'heavy' ? 2.8 : 2.2
				)
				mesh.visible = false
				this.level.addObject(mesh)
				this._boltPool.push({
					mesh,
					type,
					active: false,
					life: 0,
					velocity: new THREE.Vector3(),
				})
			}
		}
	}

	_fireBolt(playerPos, heavy) {
		const pool = this._boltPool
		if (!pool) return
		const bolt = pool.find(
			(candidate) =>
				!candidate.active &&
				candidate.type === (heavy ? 'heavy' : 'normal')
		)
		if (!bolt) return
		bolt.active = true
		bolt.life = 4
		bolt.mesh.visible = true
		bolt.mesh.position.copy(this.position)
		bolt.mesh.position.y -= 1.5
		bolt.velocity
			.copy(playerPos)
			.sub(bolt.mesh.position)
			.normalize()
			.multiplyScalar(heavy ? 15 : 26)
		this._voidAudio?.play(
			heavy ? 'boltHeavy' : 'bolt',
			this.position,
			this.style.voice
		)
	}

	_updateBolts(delta) {
		const pool = this._boltPool
		if (!pool) return
		for (const bolt of pool) {
			if (!bolt.active) continue
			bolt.life -= delta
			const p = bolt.mesh.position
			p.addScaledVector(bolt.velocity, delta)
			bolt.mesh.rotation.y += delta * 3
			bolt.mesh.rotation.x += delta * 1.7
			const hitRadius = bolt.type === 'heavy' ? 3.6 : 2.4
			const hitPlayer =
				this.level.damageCooldown <= 0 &&
				p.distanceTo(this.level.playerRoot.position) <
					hitRadius
			if (hitPlayer) {
				// Ranged hits flow through the same telegraphed channel as
				// melee: one strike, Level2's cooldown + knockback apply.
				this.pendingStrike = true
				this._voidAudio?.play(
					'hit',
					p,
					this.style.voice
				)
			}
			const hitGround =
				p.y <= this.planet.heightAt(p.x, p.z) + 0.5
			if (hitPlayer || hitGround || bolt.life <= 0) {
				bolt.active = false
				bolt.mesh.visible = false
				this.level.dust?.spawnBurst(
					{
						x: p.x,
						y: Math.max(
							p.y,
							this.planet.heightAt(
								p.x,
								p.z
							)
						),
						z: p.z,
					},
					{
						count: 8,
						strength: 1.6,
						spread: 1.6,
						size: 0.9,
						upBias: 0.4,
					}
				)
			}
		}
	}

	// ------------------------------------------------------------------
	// Locomotion, grounding and body language.
	// ------------------------------------------------------------------
	_wanderUpdate(delta) {
		if (this.state === 'detect') this._enter('idle')
		this._timer -= delta
		if (this.state === 'idle') {
			this._velocity.multiplyScalar(
				Math.max(0, 1 - 6 * delta)
			)
			if (this._timer <= 0) {
				// Pick a nearby patrol target on walkable ground.
				for (let attempt = 0; attempt < 6; attempt++) {
					const angle =
						Math.random() * Math.PI * 2
					const radius = 8 + Math.random() * 26
					const x =
						this.position.x +
						Math.cos(angle) * radius
					const z =
						this.position.z +
						Math.sin(angle) * radius
					if (
						!this.planet.isInsideBounds(
							x,
							z,
							this.radius + 2
						)
					) {
						continue
					}
					if (
						this.planet.slopeDegreesAt(
							x,
							z
						) > 22
					) {
						continue
					}
					this._patrolTarget = new THREE.Vector3(
						x,
						0,
						z
					)
					break
				}
				if (this._patrolTarget) {
					this._enter('patrol')
					this._timer = 8
				} else {
					this._timer = 2 + Math.random() * 3
				}
			}
		} else if (this.state === 'patrol') {
			this._moveTowards(
				this._patrolTarget,
				delta,
				this.style.speed * 0.45
			)
			if (
				this._timer <= 0 ||
				this.position.distanceTo(this._patrolTarget) < 2
			) {
				this._enter('idle')
				this._timer = 2 + Math.random() * 4
			}
		}
	}

	_moveTowards(point, delta, speed) {
		const target = this._moveTargetScratch.copy(point)
		if (this.kind !== 'flyer')
			this.level.matterDimension?.avoidLava(
				target,
				this.radius + 3
			)
		const dx = target.x - this.position.x
		const dz = target.z - this.position.z
		const distance = Math.hypot(dx, dz)
		if (distance > 0.001) {
			// Accelerate toward the desired pace; never snap.
			const blend = 1 - Math.exp(-this.style.accel * delta)
			this._velocity.x +=
				((dx / distance) * speed - this._velocity.x) *
				blend
			this._velocity.z +=
				((dz / distance) * speed - this._velocity.z) *
				blend
			this._faceDirection(dx, dz, delta, this.style.turnDamp)
		} else {
			this._velocity.multiplyScalar(
				Math.max(0, 1 - 8 * delta)
			)
		}
	}

	_faceTowards(point, delta, damp) {
		const dx = point.x - this.position.x
		const dz = point.z - this.position.z
		if (Math.hypot(dx, dz) > 0.001) {
			this._faceDirection(dx, dz, delta, damp)
		}
	}

	_faceDirection(dx, dz, delta, damp) {
		const target = Math.atan2(dx, dz)
		let diff = (target - this._heading) % (Math.PI * 2)
		if (diff > Math.PI) diff -= Math.PI * 2
		if (diff < -Math.PI) diff += Math.PI * 2
		this._heading += diff * (1 - Math.exp(-damp * delta))
	}

	_forward() {
		return _forward
			.set(
				Math.sin(this._heading),
				0,
				Math.cos(this._heading)
			)
			.clone()
	}

	_updateBody(delta) {
		// Integrate the planar velocity, then resolve against props and
		// bounds so nothing clips through rocks or leaves the map.
		_step.copy(this._velocity).multiplyScalar(delta)
		const nextGround = this.planet.heightAt(
			this.position.x + _step.x,
			this.position.z + _step.z
		)
		const oldGround = this.planet.heightAt(
			this.position.x,
			this.position.z
		)
		if (
			this.kind !== 'flyer' &&
			Math.abs(nextGround - oldGround) >
				Math.max(1.5, _step.length() * 1.2)
		) {
			this._velocity.set(
				-this._velocity.z * 0.5,
				0,
				this._velocity.x * 0.5
			)
			_step.set(0, 0, 0)
		}
		this.position.x += _step.x
		this.position.z += _step.z
		if (
			this.kind !== 'flyer' ||
			this.position.y < nextGround + 18
		) {
			const colliderEnabled = this.collider?.enabled
			if (this.collider) this.collider.enabled = false
			this.planet.resolveCircleCollisions(
				this.position,
				this.radius,
				this.level.gameplayColliders
			)
			if (this.collider)
				this.collider.enabled = colliderEnabled
		}
		this.planet.clampToBounds(this.position, this.radius)
		this._syncToTerrain(delta)
		// The enemy moves every frame, so keep its solid footprint aligned
		// with the body instead of leaving a pass-through gap at its spawn.
		if (this.collider) {
			this.collider.x = this.position.x
			this.collider.z = this.position.z
		}

		const speed = Math.hypot(this._velocity.x, this._velocity.z)
		this._walked += speed * delta
		// Footstep events fire on the stride: dust and thump together,
		// locked to the same phase that drives the body bob.
		if (
			this.style.stride > 0 &&
			this._walked >= this.style.stride
		) {
			this._walked -= this.style.stride
			this._footfall()
		}

		// Turn-rate tracking feeds the banking lean.
		const turnDelta =
			(this._heading - this._prevHeading) /
			Math.max(delta, 1e-4)
		this._prevHeading = this._heading
		this._visualTurn = THREE.MathUtils.damp(
			this._visualTurn,
			turnDelta,
			4,
			delta
		)
		const lean = Math.min(1, speed / this.style.chaseSpeed)
		this._leanPitch = THREE.MathUtils.damp(
			this._leanPitch,
			lean * 0.16,
			5,
			delta
		)
		if (this._model) {
			if (this.kind === 'flyer') {
				this._model.rotation.x =
					-this._climbVisual * 0.5 +
					this._attackPitch
				this._model.rotation.z =
					Math.sin(this._bob) * 0.08 -
					this._visualTurn * 0.12
			} else {
				this._model.rotation.x =
					this._leanPitch + this._attackPitch
				this._model.rotation.z = -this._visualTurn * 0.2
			}
			// Hit pop scales on top of the fit factor — never assume 1
			// (the _fit-scale lesson from the Level2 aliens).
			this._model.scale.setScalar(
				this._fitScale * (1 + this._hitFlash * 0.05)
			)
		}
		this.group.rotation.y = this._heading
		this.rigAnimator?.update(delta, {
			state: this.state,
			speed,
			airborne: this.kind === 'flyer',
		})
	}

	_syncToTerrain(delta) {
		const ground = this.planet.heightAt(
			this.position.x,
			this.position.z
		)
		if (this.kind !== 'flyer') {
			// Damped so slopes read as weight transfer, not snapping.
			this.position.y =
				delta > 0
					? THREE.MathUtils.damp(
							this.position.y,
							ground,
							18,
							delta
						)
					: ground
			return
		}
		// Flyers cruise on wing power above the terrain; dives drop to
		// strike range and staggers dip low enough to be punished.
		const hovering =
			this.state !== 'dive' ||
			this._phaseT < this.style.windup ||
			this._phaseT >
				this.style.windup +
					this.style.diveDuration * 0.75
		const staggerDip = this.state === 'stagger' ? 7 : 0
		// Level 3 flying Predators follow the jetpack's altitude rather
		// than repeatedly diving at ground level while the pilot is above.
		const pilotY = this.level.playerRoot.position.y
		const airborneY = THREE.MathUtils.clamp(
			pilotY + 3,
			ground + 7,
			ground + 70
		)
		const targetY = hovering
			? (this.styleName === 'predator'
					? airborneY
					: ground + this.style.altitude) +
				Math.sin(this._bob) * 1.8 -
				staggerDip
			: this.styleName === 'predator'
				? THREE.MathUtils.clamp(
						pilotY,
						ground + 3.2,
						ground + 70
					)
				: ground + 3.2
		this.position.y =
			delta > 0
				? THREE.MathUtils.damp(
						this.position.y,
						targetY,
						hovering ? 2.2 : 3.4,
						delta
					)
				: targetY
		this._bob += delta * 1.4
		// Climb/dive drives the silhouette pitch.
		const climb = THREE.MathUtils.clamp(
			(targetY - this.position.y) * 0.25,
			-1,
			1
		)
		this._climbVisual = THREE.MathUtils.damp(
			this._climbVisual,
			climb,
			4,
			delta
		)
	}

	_footfall() {
		const y = this.planet.heightAt(this.position.x, this.position.z)
		this.level.dust?.spawnFoot(
			{ x: this.position.x, y, z: this.position.z },
			{ ratio: 0.9 }
		)
		this._voidAudio?.play('step', this.position, this.style.voice)
	}

	_antiStuck(delta, playerPos) {
		// Grinding an obstacle while chasing? Take a tangential detour
		// instead of pushing into the wall forever.
		this._stuckTimer += delta
		if (this._stuckTimer < 1.4) return
		const moved = this.position.distanceTo(this._stuckScratch)
		this._stuckTimer = 0
		this._stuckScratch.copy(this.position)
		if (moved < 1.6 && this.state === 'chase') {
			this._detour = this._tangentPoint(
				playerPos,
				10 + Math.random() * 8
			)
			this._enter('reposition')
			this._timer = 1.4
		}
	}

	_tangentPoint(playerPos, radius) {
		const dx = this.position.x - playerPos.x
		const dz = this.position.z - playerPos.z
		const angle =
			Math.atan2(dz, dx) +
			(Math.random() < 0.5 ? 1 : -1) *
				(0.7 + Math.random() * 0.6)
		const point = new THREE.Vector3(
			playerPos.x + Math.cos(angle) * radius,
			0,
			playerPos.z + Math.sin(angle) * radius
		)
		this.planet.clampToBounds(point, this.radius)
		return point
	}

	// ------------------------------------------------------------------
	// Damage, death and the Level2-compat collision surface.
	// ------------------------------------------------------------------

	/**
	 * Rover rams and blade swings land here.
	 *   'ram'  — the rover drove into us at speed: we take the damage.
	 *   'bite' — slow contact: Level2 drains hull HP.
	 *   null   — nothing this frame. Flyers are never rammed.
	 */
	checkRoverCollision(rover, roverRadius = 8) {
		if (this.smashed || !this._loaded) return null
		if (this.kind === 'flyer') return null
		const dx = this.position.x - rover.group.position.x
		const dz = this.position.z - rover.group.position.z
		const dy = this.position.y - rover.group.position.y
		const dist = Math.hypot(dx, dz)
		const hit =
			dist <= this.radius + roverRadius &&
			Math.abs(dy) <= this.radius + 1.5
		if (!hit) return null
		if (Math.abs(rover.speed ?? 0) >= RAM_SPEED_MIN) {
			if (this._ramCooldown > 0) return null
			this._ramCooldown = 0.5
			if (dist > 0.001) {
				this._velocity.set(
					(dx / dist) * 10,
					0,
					(dz / dist) * 10
				)
			}
			this.damage(RAM_DAMAGE)
			return 'ram'
		}
		if (this._contactCooldown > 0) return null
		this._contactCooldown = 2.4
		return null
	}

	/**
	 * Body contact alone never hurts the pilot — every point of damage
	 * flows through a telegraphed strike's pendingStrike, at the strike
	 * frame, gated by Level2's damage cooldown.
	 */
	checkPlayerCollision() {
		return false
	}

	damage(amount, { stagger = true } = {}) {
		if (this.smashed || !this._loaded) return
		this.hp = Math.max(0, this.hp - amount)
		this._drawHpBar()
		this._hitFlash = 1
		if (this.hp <= 0) {
			this._die()
			return
		}
		if (stagger) {
			this.pendingStrike = false
			this._setGlow(0)
			this._enter('stagger')
			this._staggerT = this.style.stagger
			this._voidAudio?.play(
				'stagger',
				this.position,
				this.style.voice
			)
		}
	}

	_die() {
		this.smashed = true
		this.state = 'dead'
		if (this.collider) this.collider.enabled = false
		for (const bolt of this._boltPool ?? []) {
			bolt.active = false
			bolt.mesh.visible = false
		}
		this.hp = 0
		this.pendingStrike = false
		this._setGlow(0)
		this._voidAudio?.stopLoop(this._loopId)
		this._voidAudio?.play('death', this.position, this.style.voice)
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
				count: 18,
				strength: 2.6,
				spread: 3.2,
				size: 1.4,
				upBias: 0.6,
			}
		)
		this.level._requestShake?.(0.35)
		if (this._hpBar) this._hpBar.sprite.visible = false
		this._deathT = 0
		this._deathDir = Math.random() < 0.5 ? 1 : -1
		this.level._voidKills = (this.level._voidKills || 0) + 1
		this._onDeath?.()
	}

	_onDeath() {}

	_updateDeath(delta) {
		if (this._deathT < 0) return
		this._deathT += delta
		this.rigAnimator?.update(delta, { state: 'dead' })
		// Tip over, then sink below the crust; the wreck stays until the
		// level tears down (same contract as Alien).
		const tip = Math.min(1, this._deathT / 0.9)
		this.group.rotation.z = tip * tip * 1.35 * this._deathDir
		if (this._deathT > 1.2) {
			this.position.y -= 1.1 * delta
		}
	}

	_updateAudio(distance) {
		if (!this._voidAudio) return
		if (this.style.idleLoop && distance < 220) {
			this._voidAudio.startLoop(
				this._loopId,
				this.position,
				this.style.voice
			)
			this._voidAudio.moveLoop(this._loopId, this.position)
			this._voidAudio.setLoopLevel(
				this._loopId,
				THREE.MathUtils.clamp(1 - distance / 220, 0, 1)
			)
		} else {
			this._voidAudio.stopLoop(this._loopId)
		}
	}

	dispose() {
		this._disposed = true
		this.rigAnimator?.dispose()
		this._hpBar?.texture.dispose()
		this._voidAudio?.stopLoop(this._loopId)
		if (this._boltPool) {
			for (const bolt of this._boltPool) {
				bolt.mesh.removeFromParent()
			}
			this._boltPool = null
		}
	}
}

VoidEnemy._serial = 0

// Shared import guard: WORLD_UP is reserved for subclass pose math.
export { WORLD_UP }
