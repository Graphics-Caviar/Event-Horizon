import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'

const SWING_WINDUP = 0.2
const SWING_STRIKE = 0.3
const SWING_RECOVER = 0.35
const SWING_COOLDOWN = 0.85
const BLADE_HALF_LENGTH = 0.8
const BLADE_CONTACT_PADDING = 0.3
const BLADE_CONTACT_SAMPLES = 8
// Held scale relative to the pickup's 2.8 m display fit.
const HELD_SCALE = 1.6 / 2.8
const SWING_END_ANGLE = Math.PI
const SWING_MODES = ['vertical', 'horizontal', 'thrust']

const SWING_MODE_LABELS = {
	vertical: 'Vertical Swing',
	horizontal: 'Horizontal Sweep',
	thrust: 'Forward Thrust',
}
const REST_POSE = { x: 0.08, z: -0.12 }

const smooth01 = (value) => value * value * (3 - 2 * value)

/**
 * The pilot's only weapon on foot: an ancient energy blade. The GLB
 * floats as a pickup near the landing site (glow sprite + light so the
 * site reads from a distance), snaps to the pilot's side on approach,
 * and swings on F through a raised windup, downward strike and follow-through.
 * Damage is applied only when the moving blade touches an enemy. Rover
 * ramming remains the heavy-damage option (Level2's existing path).
 */
export class EnergyBlade {
	constructor(level) {
		this.level = level
		this.equipped = false
		this._swingT = -1
		this._hitEnemies = new Set()
		this._cooldown = 0
		this._spin = Math.random() * Math.PI * 2
		this._model = null
		this._pivot = null
		this._restPosition = null
		this._bladeOrientation = null
		this._overheadPosition = null
		this._strikePosition = null
		this._bladeStart = new THREE.Vector3()
		this._bladeEnd = new THREE.Vector3()
		this._bladeSample = new THREE.Vector3()
		this._previousBladeStart = null
		this._previousBladeEnd = null
		this._bladeMount = null
		this.swingMode = 'vertical'
		const player = level.playerRoot
		const forward = new THREE.Vector3(
			-Math.sin(player.rotation.y),
			0,
			-Math.cos(player.rotation.y)
		)
		const site = level._findWalkableSite(
			player.position.clone().addScaledVector(forward, 4)
		)
		this._baseY = level.planet.heightAt(site.x, site.z) + 1.6
		this._pickup = level.addObject(new THREE.Group())
		this._pickup.name = 'void-blade-pickup'
		this._pickup.position.set(site.x, this._baseY, site.z)
		this._buildBeacon()
		this._load()
	}

	async _load() {
		const model = await loadVoidModel(
			this.level.assetManager,
			'energyBlade'
		)
		if (!model || !this._pickup.parent) return
		this.level._fit(model, 2.8)
		this._model = model
		this._pickup.add(model)
	}

	_buildBeacon() {
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 64
		const ctx = canvas.getContext('2d')
		const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
		gradient.addColorStop(0, 'rgba(255,255,255,1)')
		gradient.addColorStop(0.35, 'rgba(255,255,255,.5)')
		gradient.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 64, 64)
		const material = this.level.own(
			new THREE.SpriteMaterial({
				map: new THREE.CanvasTexture(canvas),
				color: 0x6ef2ff,
				transparent: true,
				opacity: 0.8,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const sprite = new THREE.Sprite(material)
		sprite.scale.setScalar(6)
		this._pickup.add(sprite)
		const light = new THREE.PointLight(0x54e8ff, 1.2, 60, 1.4)
		this._pickup.add(light)
	}

	trySwing() {
		const level = this.level
		if (
			!this.equipped ||
			this._swingT >= 0 ||
			this._cooldown > 0 ||
			level.completed ||
			level.transitionHeld ||
			level.boarded
		) {
			return
		}
		this._swingT = 0
		this._hitEnemies.clear()
		this._cooldown = SWING_COOLDOWN
		this._previousBladeStart = null
		this._previousBladeEnd = null
		level.voidAudio?.play('swing', level.playerRoot.position, 1)
		this._attackConfig = this._getAttackConfig()
	}

	update(delta) {
		const level = this.level
		if (!this._model) return
		if (!this.equipped) {
			this._spin += delta * 1.4
			this._pickup.rotation.y = this._spin
			this._pickup.position.y =
				this._baseY + Math.sin(this._spin * 0.8) * 0.35
			if (
				this._pickup.position.distanceTo(
					level.playerRoot.position
				) < 3.2
			) {
				this._equip()
			}
			return
		}
		this._cooldown = Math.max(0, this._cooldown - delta)
		// Stowed while driving.
		this._model.visible = !level.boarded
		if (this._swingT < 0) return
		this._swingT += delta
		const t = this._swingT
		if (t < SWING_WINDUP) {
			const k = smooth01(t / SWING_WINDUP)
			const attack = this._attackConfig

			this._bladeMount.position.lerpVectors(
				this._restPosition,
				attack.start,
				k
			)

			this._bladeOrientation.rotation.copy(
				attack.bladeRotation
			)

			this._pivot.rotation.set(
				REST_POSE.x * (1 - k),
				0,
				REST_POSE.z * (1 - k)
			)
		} else if (t < SWING_WINDUP + SWING_STRIKE) {
			const k = smooth01((t - SWING_WINDUP) / SWING_STRIKE)

			const attack = this._attackConfig

			this._bladeMount.position.lerpVectors(
				attack.start,
				attack.end,
				k
			)

			this._pivot.rotation.set(
				attack.axis === 'x' ? attack.angle * k : 0,
				attack.axis === 'y' ? attack.angle * k : 0,
				attack.axis === 'z' ? attack.angle * k : 0
			)

			this._strike()
		} else if (t < SWING_WINDUP + SWING_STRIKE + SWING_RECOVER) {
			const k = smooth01(
				(t - SWING_WINDUP - SWING_STRIKE) /
					SWING_RECOVER
			)

			const attack = this._attackConfig

			this._bladeMount.position.lerpVectors(
				attack.end,
				this._restPosition,
				k
			)

			this._pivot.rotation.set(
				attack.axis === 'x'
					? attack.angle * (1 - k) +
							REST_POSE.x * k
					: REST_POSE.x * k,

				attack.axis === 'y'
					? attack.angle * (1 - k)
					: 0,

				attack.axis === 'z'
					? attack.angle * (1 - k) +
							REST_POSE.z * k
					: REST_POSE.z * k
			)

			this._bladeOrientation.rotation.set(
				attack.bladeRotation.x * (1 - k),
				attack.bladeRotation.y * (1 - k),
				attack.bladeRotation.z * (1 - k)
			)
		} else {
			this._swingT = -1

			this._bladeMount.position.copy(this._restPosition)

			this._pivot.rotation.set(REST_POSE.x, 0, REST_POSE.z)

			this._bladeOrientation.rotation.set(0, 0, 0)
		}
	}

	_equip() {
		const level = this.level
		this.equipped = true
		this._pickup.visible = false

		const height = level.pilotWalk?.height ?? 3

		// These positions are relative to the centre of the player.
		// The pivot itself will remain stationary during the swing.
		this._restPosition = new THREE.Vector3(0.7, 0.1, 0.2)

		// Position the centre of the blade above the player's head.
		this._overheadPosition = new THREE.Vector3(
			0,
			height * 0.5 + BLADE_HALF_LENGTH,
			0.15
		)

		this._strikePosition = this._overheadPosition.clone()

		// Rotation pivot at the centre of the player's body.
		this._pivot = new THREE.Group()
		this._pivot.name = 'energy-blade-swing-pivot'
		this._pivot.position.set(0, height * 0.5, 0)

		// The blade mount moves around the central pivot.
		this._bladeMount = new THREE.Group()
		this._bladeMount.name = 'energy-blade-mount'
		this._bladeMount.position.copy(this._restPosition)

		// The GLB is already centred and aligned along local Y.
		this._model.scale.multiplyScalar(HELD_SCALE)
		this._model.position.set(0, 0, 0)
		this._model.rotation.set(Math.PI, Math.PI / 2, 0)

		// Separate group for attack-specific orientation.
		this._bladeOrientation = new THREE.Group()

		this._bladeOrientation.add(this._model)
		this._bladeMount.add(this._bladeOrientation)

		this._pivot.add(this._bladeMount)

		level.playerRoot.add(this._pivot)

		this._pivot.rotation.set(REST_POSE.x, 0, REST_POSE.z)

		level.audio?.playCollect()

		level._showMovementFeedback?.(
			'ANCIENT BLADE ACQUIRED — F TO SWING'
		)
	}

	cycleSwingMode() {
		const currentIndex = SWING_MODES.indexOf(this.swingMode)

		this.swingMode =
			SWING_MODES[(currentIndex + 1) % SWING_MODES.length]

		// Don't change an attack that is already in progress.
		this.level._showMovementFeedback?.(
			`BLADE MODE: ${SWING_MODE_LABELS[this.swingMode].toUpperCase()}`
		)

		return this.swingMode
	}

	_getAttackConfig() {
		switch (this.swingMode) {
			case 'horizontal':
				return {
					// Start on the player's left-hand side.
					start: new THREE.Vector3(-2.0, 0.1, 0),

					// Finish on the player's right-hand side.
					end: new THREE.Vector3(2.0, 0.1, 0),

					axis: 'y',
					angle: 0,

					bladeRotation: new THREE.Euler(
						Math.PI / 2,
						Math.PI / 2,
						0
					),
				}

			case 'thrust':
				return {
					start: new THREE.Vector3(0, 0.1, 0.8),
					end: new THREE.Vector3(0, 0.1, 5.0),

					axis: 'none',
					angle: 0,

					// Rotate the blade to point forwards (+Z).
					bladeRotation: new THREE.Euler(
						Math.PI / 2,
						0,
						0
					),
				}

			case 'vertical':
			default:
				return {
					start: this._overheadPosition.clone(),
					end: this._overheadPosition.clone(),

					axis: 'x',
					angle: 2.0,

					// Keep the existing vertical orientation.
					bladeRotation: new THREE.Euler(0, 0, 0),
				}
		}
	}

	_strike() {
		const level = this.level
		this._model.updateWorldMatrix(true, false)
		this._bladeStart
			.set(0, -BLADE_HALF_LENGTH, 0)
			.applyMatrix4(this._model.matrixWorld)
		this._bladeEnd
			.set(0, BLADE_HALF_LENGTH, 0)
			.applyMatrix4(this._model.matrixWorld)
		let hits = 0
		let hitPosition = null
		const TEMPORAL_SAMPLES = 16

		const previousStart =
			this._previousBladeStart ?? this._bladeStart

		const previousEnd = this._previousBladeEnd ?? this._bladeEnd

		for (const enemy of level.aliens) {
			if (
				enemy.smashed ||
				enemy._loaded === false ||
				!enemy.position ||
				!enemy.damage ||
				this._hitEnemies.has(enemy)
			) {
				continue
			}

			const enemyHeight = enemy.style?.fit ?? 4
			const enemyRadius = enemy.radius ?? 2

			const contactRadius =
				enemyRadius + BLADE_CONTACT_PADDING

			const contactRadiusSq = contactRadius * contactRadius

			let touchesBlade = false

			// Sample the blade at multiple points along its movement.
			for (
				let frameSample = 0;
				frameSample <= TEMPORAL_SAMPLES &&
				!touchesBlade;
				frameSample++
			) {
				const frameK = frameSample / TEMPORAL_SAMPLES

				const start = new THREE.Vector3().lerpVectors(
					previousStart,
					this._bladeStart,
					frameK
				)

				const end = new THREE.Vector3().lerpVectors(
					previousEnd,
					this._bladeEnd,
					frameK
				)

				// Sample points along the blade itself.
				for (
					let bladeSample = 0;
					bladeSample <= BLADE_CONTACT_SAMPLES;
					bladeSample++
				) {
					const bladeK =
						bladeSample /
						BLADE_CONTACT_SAMPLES

					const sample = start
						.clone()
						.lerp(end, bladeK)

					const nearestY = THREE.MathUtils.clamp(
						sample.y,
						enemy.position.y,
						enemy.position.y + enemyHeight
					)

					const dx = sample.x - enemy.position.x
					const dy = sample.y - nearestY
					const dz = sample.z - enemy.position.z

					if (
						dx * dx + dy * dy + dz * dz <=
						contactRadiusSq
					) {
						touchesBlade = true
						break
					}
				}
			}

			if (!touchesBlade) continue

			this._hitEnemies.add(enemy)
			enemy.damage(level.combatConfig.bladeDamage)

			if (enemy.smashed || enemy.hp < enemy.maxHp) {
				hits += 1
				hitPosition ||= enemy.position
			}
		}

		// Save the current blade position for the next frame.
		this._previousBladeStart = this._bladeStart.clone()
		this._previousBladeEnd = this._bladeEnd.clone()
		if (hits > 0 && hitPosition) {
			level._requestShake?.(0.18)
			level.dust?.spawnBurst(
				{
					x: hitPosition.x,
					y: hitPosition.y + 1,
					z: hitPosition.z,
				},
				{
					count: 10,
					strength: 1.8,
					spread: 1.6,
					size: 1,
					upBias: 0.5,
				}
			)
		}
	}

	dispose() {
		this._model?.removeFromParent()
		this._pivot?.removeFromParent()
	}
}
