import * as THREE from 'three'
import { VoidSpaceBackdrop } from './VoidSpaceBackdrop.js'
import { VoidDrifters } from './VoidDrifters.js'
import { VoidBoss, FIREBALL_DAMAGE } from './VoidBoss.js'
import { VoidArenaEffects, VoidArenaFighter } from './VoidArenaCombat.js'
import { VoidGodAbilities } from './VoidGodAbilities.js'
import { VoidPilotBlaster } from './VoidPilotBlaster.js'
import { VoidPrisonBubble } from './VoidPrisonBubble.js'
import { createLevel3Art } from './Level3VisualAssets.js'

/** A separate, explorable zero-gravity space beyond the Matter wormhole. */
export class VoidDimension {
	constructor(level) {
		this.level = level
		this.time = 0
		this.resources = []
		this.hidden = []
		const scene = level.sceneManager.scene
		this.previous = {
			background: scene.background,
			fog: scene.fog,
			environment: scene.environment,
		}
		for (const object of scene.children) {
			if (
				object === level.playerRoot ||
				object.isLight ||
				object.isCamera
			)
				continue
			this.hidden.push([object, object.visible])
			object.visible = false
		}
		this.previousFar = level.sceneManager.camera.far
		level.sceneManager.camera.far = Math.max(this.previousFar, 8000)
		level.sceneManager.camera.updateProjectionMatrix()
		scene.background = new THREE.Color(0x000003)
		scene.fog = null
		scene.environment = null
		this.group = new THREE.Group()
		this.group.name = 'void-dimension-zero-gravity'
		scene.add(this.group)
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const violet = own(
			new THREE.MeshStandardMaterial({
				color: 0x17102b,
				emissive: 0x24105b,
				emissiveIntensity: 0.6,
				metalness: 0.7,
				roughness: 0.35,
			})
		)
		const glow = own(
			new THREE.MeshBasicMaterial({ color: 0x79eeff })
		)
		const stone = own(new THREE.IcosahedronGeometry(1, 0))
		this.shards = []
		for (let i = 0; i < 95; i++) {
			const a = i * 2.39996,
				radius = 55 + (i % 9) * 16
			const mesh = new THREE.Mesh(stone, violet)
			mesh.position.set(
				Math.cos(a) * radius,
				Math.sin(a) * radius,
				100 - i * 7
			)
			mesh.scale.set(6 + (i % 13), 12 + (i % 23), 5 + (i % 7))
			mesh.rotation.set(i, i * 0.7, i * 0.3)
			this.group.add(mesh)
			this.shards.push(mesh)
		}
		const stars = new Float32Array(4800 * 3)
		for (let i = 0; i < 4800; i++) {
			const a = i * 2.39996,
				y = 1 - (2 * (i + 0.5)) / 4800,
				r = Math.sqrt(1 - y * y)
			stars.set(
				[
					Math.cos(a) * r * 6000,
					y * 6000,
					Math.sin(a) * r * 6000 - 200,
				],
				i * 3
			)
		}
		const starGeometry = own(new THREE.BufferGeometry())
		starGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(stars, 3)
		)
		this.group.add(
			new THREE.Points(
				starGeometry,
				own(
					new THREE.PointsMaterial({
						color: 0xc4d5ff,
						size: 3,
						sizeAttenuation: true,
					})
				)
			)
		)
		this.rings = []
		const ringGeometry = own(
			new THREE.TorusGeometry(14, 0.18, 8, 96)
		)
		for (let i = 0; i < 6; i++) {
			const ring = new THREE.Mesh(ringGeometry, glow)
			ring.position.set(0, 8, -45 - i * 65)
			this.group.add(ring)
			this.rings.push(ring)
		}
		this.spaceBackdrop = new VoidSpaceBackdrop(level, this.group)
		this.drifters = new VoidDrifters(level, this.group)
		// The original VoidBoss existed but was never connected to the level.
		// Activate near the last gate; one rigged boss replaces a mass horde.
		this.boss = new VoidBoss(
			this.group,
			new THREE.Vector3(0, 8, -305)
		)
		this.fx = new VoidArenaEffects(level, this.group)
		this.boss.specials = new VoidGodAbilities(
			this.boss,
			this.fx,
			level
		)
        this.prison = new VoidPrisonBubble(level, this.group)
        this.boss.specials.prison = this.prison
        this.arenaArt = createLevel3Art(level, this.group, 'arena', 150)
        // This is decorative scenery behind the boss, not collision geometry.
        this.arenaArt.root.position.set(0, 15, -425)
		// Sequential encounters: do not load all expensive GLBs simultaneously.
		this.guardians = [
			new VoidArenaFighter(
				level,
				this.group,
				this.fx,
				'sentinel',
				new THREE.Vector3(-12, 7, -75)
			),
			new VoidArenaFighter(
				level,
				this.group,
				this.fx,
				'stalker',
				new THREE.Vector3(17, 15, -135)
			),
			new VoidArenaFighter(
				level,
				this.group,
				this.fx,
				'gravRift',
				new THREE.Vector3(-15, 8, -185)
			),
			new VoidArenaFighter(
				level,
				this.group,
				this.fx,
				'colossus',
				new THREE.Vector3(8, 9, -240)
			),
		]
		// A separate boss encounter, not merely another Galactus skin.
		this.entity = new VoidArenaFighter(
			level,
			this.group,
			this.fx,
			'entityBoss',
			new THREE.Vector3(0, 15, -360)
		)
		this.fx.fighters = this.guardians
		this._stage = 'guardians'
		this._victoryT = 0
		this._bossStarted = false
		this._shotCooldown = 0
		this._gateWarningCooldown = 0
		this._lastObjective = ''
		this._pulseScratch = new THREE.Vector3()
		this._pulseGeometry = own(new THREE.SphereGeometry(0.55, 8, 6))
		this._pulseMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0x62efff,
				transparent: true,
				opacity: 0.95,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
		)
        this.blaster = new VoidPilotBlaster(level, this.group)
        this.plasmaArt = createLevel3Art(level, this.group, 'projectile', 3)
		this.pulses = Array.from({ length: 6 }, () => {
			const mesh = new THREE.Mesh(
				this._pulseGeometry,
				this._pulseMaterial
			)
			mesh.visible = false
			this.group.add(mesh)
			return { mesh, life: 0 }
		})
		this.exit = this.rings.at(-1).position
		level.playerRoot.position.set(0, 8, 15)
		level.playerRoot.visible = true
		// First-person mode hides the model itself, not just its gameplay root.
		// The void owns a third-person camera and must clear both visibility states.
		level.firstPerson = false
		level.boarded = false
		if (level.pilotModel) level.pilotModel.visible = true
		if (level.flightPivot) level.flightPivot.rotation.set(0, 0, 0)
		if (level.flightOffset) level.flightOffset.scale.setScalar(1)
		this.pilotLight = new THREE.PointLight(0xc6e4ff, 24, 18, 2)
		this.pilotLight.name = 'void-pilot-fill-light'
		this.group.add(this.pilotLight)
		level.velocity.set(0, 0, 0)
		level.keys.clear()
		level.radio?.stop()
		level.survivalHudEl &&
			(level.survivalHudEl.textContent =
				'ZERO GRAVITY // MATTER SIGNAL LOST')
		level.enemyStatusEl && (level.enemyStatusEl.textContent = '')
		level.levelHudEl.firstElementChild.textContent =
			'LEVEL 03 // VOID DIMENSION'
		level.sceneManager.camera.position.set(0, 12, 27)
		level.sceneManager.camera.lookAt(0, 9.5, 15)
		this.direction = new THREE.Vector3()
		this.worldMin = new THREE.Vector3(-250, -240, -480)
		this.worldMax = new THREE.Vector3(250, 260, 140)
		this.lightOffset = new THREE.Vector3(2, 4, 4)
		this.camOffset = new THREE.Vector3(0, 4, 12)
		this.lookOffset = new THREE.Vector3(0, 1.5, 0)
		this.cameraTarget = new THREE.Vector3()
	}
	update(delta) {
		const l = this.level,
			dt = Math.min(delta, 0.05)
		this.time += dt
		// Level3 skips Level2.update() in the Void, so decay the inherited
		// invulnerability window here or only the first projectile can hurt.
		l.damageCooldown = Math.max(0, l.damageCooldown - dt)
		this._gateWarningCooldown = Math.max(
			0,
			this._gateWarningCooldown - dt
		)
		this.spaceBackdrop.update(this.time)
		this.drifters.update(dt)
		l.playerRoot.visible = true
		if (l.pilotModel) l.pilotModel.visible = true
		this.pilotLight.position
			.copy(l.playerRoot.position)
			.add(this.lightOffset)
        this.prison.update(dt)
		if (!l.completed) {
			l.elapsedPlayTime += dt
			// Encounter activation is proximity based; retired guardians cannot
			// respawn or deal damage after their defeat.
			for (const foe of this.guardians) {
				if (
					!foe.active &&
					!foe.dead &&
					l.playerRoot.position.distanceTo(
						foe.home
					) < 110
				)
					foe.activate()
			}
			if (
				this._stage === 'guardians' &&
				this.guardians.every((foe) => foe.dead)
			) {
				this._stage = 'god'
				l._showMovementFeedback?.(
					'THE VOID-GOD AWAKENS — APPROACH THE FINAL ARENA',
					3
				)
			}
			if (this._stage === 'god' && this.boss.dead) {
				this._stage = 'entity'
				this.entity.activate()
				this.fx.clear()
				this.fx.implode(this.boss.position, 0xb36aff)
				l._showMovementFeedback?.(
					'THE VOID-ENTITY AWAKENS — THE TRUE FINAL ENCOUNTER',
					3
				)
			}
			if (this._stage === 'entity' && this.entity.dead) {
				this._stage = 'escape'
				this.fx.clear()
				this.fx.implode(this.entity.position, 0x64ffff)
				this._victoryT = 2.6
				l._showMovementFeedback?.(
					'VOID STABILIZING — ESCAPE THROUGH THE CYAN GATE',
					3
				)
			}
			if (l.survivalHudEl)
				l.survivalHudEl.textContent =
					'ZERO GRAVITY // MATTER SIGNAL LOST'
			if (l.enemyStatusEl) l.enemyStatusEl.textContent = ''
			this.direction.set(
				Number(l.keys.has('KeyD')) -
					Number(l.keys.has('KeyA')),
				Number(l.keys.has('Space')) -
					Number(l.keys.has('KeyC')),
				Number(l.keys.has('KeyS')) -
					Number(l.keys.has('KeyW'))
			)
			if (this.direction.lengthSq())
				this.direction.normalize()
            if (this.prison.trapped) {
                l.velocity.set(0, 0, 0)
            } else {
                const speed = l.keys.has('ShiftLeft') ? 36 : 22
                l.velocity.lerp(
                    this.direction.multiplyScalar(speed),
                    1 - Math.exp(-dt * 3)
                )
                l.playerRoot.position.addScaledVector(l.velocity, dt)
                l.playerRoot.position.clamp(this.worldMin, this.worldMax)
            }
            // Float pose, not the old seated/rover pose.
            l.pilotWalk?.update(dt, l.velocity.length() * dt, false)
            const visibleTarget = this._currentTarget()
            if (visibleTarget?.position && !visibleTarget.dead) {
                const dx = visibleTarget.position.x - l.playerRoot.position.x
                const dz = visibleTarget.position.z - l.playerRoot.position.z
                const yaw = Math.atan2(dx, dz)
                const turn = Math.atan2(
                    Math.sin(yaw - l.playerRoot.rotation.y),
                    Math.cos(yaw - l.playerRoot.rotation.y)
                )
                l.playerRoot.rotation.y += turn * (1 - Math.exp(-dt * 4))
            }
            if (l.flightPivot) {
                l.flightPivot.rotation.z = THREE.MathUtils.damp(
                    l.flightPivot.rotation.z, -l.velocity.x / 150, 4, dt)
                l.flightPivot.rotation.x = THREE.MathUtils.damp(
                    l.flightPivot.rotation.x, -l.velocity.z / 180, 4, dt)
            }
            this.blaster.update(dt, visibleTarget)
			// Entering the boss arena starts the encounter and lazy GLB load.
			if (
				this._stage === 'god' &&
				!this._bossStarted &&
				l.playerRoot.position.distanceTo(
					this.boss.arena
				) < 195
			) {
				this._bossStarted = true
				this.boss.activate(l.assetManager)
                this.arenaArt.load()
			}
			const objective = this._stage
			if (objective !== this._lastObjective) {
				this._lastObjective = objective
				l.objectiveEl.innerHTML =
					objective === 'escape'
						? '<strong>VOID OF GODS // VICTORY</strong><br>The Void-Entity has fallen. Fly through the final cyan ring to escape.'
						: objective === 'entity'
							? '<strong>TRUE FINAL BOSS // VOID-ENTITY</strong><br>Hold F to fire. Watch telegraphed rifts, gravity fields and the exposed core; interrupt the final attack.'
							: objective === 'god'
								? '<strong>VOID-GOD // GALACTUS</strong><br>Hold F to fire energy pulses. Dodge marked attacks and target the chest core during the final charge.'
								: '<strong>VOID GUARDIANS</strong><br>WASD drift · Space/C rise/descend · Shift boost · Hold F to fire. Defeat Sentinel, Rift-Stalker, Grav-Rift and Colossus.'
			}
			if (l.keys.has('KeyF') && this._shotCooldown <= 0)
				this._firePulse()
			if (l.playerRoot.position.distanceTo(this.exit) < 12) {
				if (
					this._stage === 'escape' &&
					this._victoryT <= 0
				)
					l._completeMission()
				else if (this._gateWarningCooldown <= 0) {
					this._gateWarningCooldown = 2.5
					l._showMovementFeedback?.(
						'DEFEAT EVERY VOID GUARDIAN AND BOTH BOSSES TO UNLOCK THE EXIT',
						2.5
					)
				}
			}
		}
        this.arenaArt.root.visible = this.arenaArt.ready && this._bossStarted &&
            l.playerRoot.position.distanceTo(this.boss.arena) < 255
        if (this._stage !== 'god' || this.boss.dead) this.prison.clear()
		this._shotCooldown = Math.max(0, this._shotCooldown - dt)
		for (const foe of this.guardians)
			foe.update(dt, l.playerRoot.position)
		if (this._stage === 'entity' || this._stage === 'escape')
			this.entity.update(dt, l.playerRoot.position)
		if (this._bossStarted && !l.completed) {
			this.boss.update(dt, l.playerRoot.position)
			if (this.boss.pendingHit) {
				this.boss.pendingHit = false
				l._applyAlienHit(FIREBALL_DAMAGE)
			}
		}
		this.fx.update(dt)
		this._victoryT = Math.max(0, this._victoryT - dt)
		if (l.enemyStatusEl && !l.completed) {
			const target = this._currentTarget()
			l.enemyStatusEl.textContent = target
				? `${target.kind === 'entityBoss' ? 'VOID-ENTITY' : target === this.boss ? 'VOID-GOD' : target.kind.toUpperCase()}  ${Math.ceil(target.hp)} / ${target.maxHp} HP${target === this.boss ? ` // ${this.boss.specials.phaseLabel}` : target.kind === 'entityBoss' ? ` // PHASE ${target.phase}` : ''}`
				: this._stage === 'escape'
					? 'VOID DEFEATED // EXIT OPEN'
					: 'LOCATE THE NEXT GUARDIAN'
		}

		this._updatePulses(dt)
		for (const shard of this.shards) {
			shard.rotation.x += dt * 0.06
			shard.rotation.z += dt * 0.035
		}
		for (let i = 0; i < this.rings.length; i++)
			this.rings[i].scale.setScalar(
				1 + Math.sin(this.time * 1.5 + i) * 0.035
			)
		this.cameraTarget
			.copy(l.playerRoot.position)
			.add(this.camOffset)
		l.sceneManager.camera.position.lerp(
			this.cameraTarget,
			1 - Math.exp(-dt * 5)
		)
		this.cameraTarget
			.copy(l.playerRoot.position)
			.add(this.lookOffset)
		l.sceneManager.camera.lookAt(this.cameraTarget)
	}
	_currentTarget() {
		if (this._stage === 'guardians') {
			let closest = null,
				distance = Number.POSITIVE_INFINITY
			for (const foe of this.guardians) {
				if (!foe.active || foe.dead) continue
				const d = foe.position.distanceToSquared(
					this.level.playerRoot.position
				)
				if (d < distance) {
					distance = d
					closest = foe
				}
			}
			return closest
		}
		if (this._stage === 'god')
			return this._bossStarted && !this.boss.dead
				? this.boss
				: null
		if (this._stage === 'entity')
			return this.entity.active && !this.entity.dead
				? this.entity
				: null
		return null
	}
	_firePulse() {
		const target = this._currentTarget()
		if (
			!target ||
			this.level.playerRoot.position.distanceTo(
				target.position
			) > 145
		)
			return
		const shot = this.pulses.find((item) => item.life <= 0)
		if (!shot) return
		shot.life = 1.85
        this.blaster.fireOrigin(shot.mesh.position)
        this.plasmaArt.load()
		shot.mesh.visible = true
		shot.target = target
		shot.decoy = this.fx.pickDecoy(target.position)
		this._shotCooldown = 0.6
	}
	_updatePulses(dt) {
        // At most one expensive decorative projectile is visible, even
        // if all six gameplay pulses are active simultaneously.
        this.plasmaArt.root.visible = false
        let heroUsed = false
		for (const shot of this.pulses) {
			if (shot.life <= 0) continue
			shot.life -= dt
			const target = shot.target
			if (
				shot.life <= 0 ||
				!target ||
				target.dead ||
				this.level.completed
			) {
				shot.life = 0
				shot.mesh.visible = false
				continue
			}
			const aim =
				shot.decoy && shot.decoy.hp > 0
					? shot.decoy.mesh.position
					: target.position
			this._pulseScratch.subVectors(aim, shot.mesh.position)
			const distance = this._pulseScratch.length()
			if (
				distance <
				(target === this.boss
					? 8.5
					: target.kind === 'entityBoss'
						? 9
						: 4.5)
			) {
				if (shot.decoy && shot.decoy.hp > 0)
					this.fx.hitDecoy(shot.decoy, 35)
				else if (target === this.boss) {
					this.boss.receiveDamage(35)
					if (this.boss.dead)
						this.level._galactusDefeated = true
				} else target.takeDamage(35)
				shot.life = 0
				shot.mesh.visible = false
			} else if (distance > 0.01) {
				shot.mesh.position.addScaledVector(
					this._pulseScratch,
					Math.min(distance, 85 * dt) / distance
				)
                if (this.plasmaArt.ready && !heroUsed) {
                    heroUsed = true
                    this.plasmaArt.root.visible = true
                    this.plasmaArt.root.position.copy(shot.mesh.position)
                    this.plasmaArt.root.lookAt(aim)
                    shot.mesh.visible = false
                } else {
                    shot.mesh.visible = true
                }
			}
		}
	}

	dispose() {
        this.prison.dispose()
        this.blaster.dispose()
        this.plasmaArt.dispose()
        this.arenaArt.dispose()
		this.boss.dispose()
		for (const foe of this.guardians) foe.dispose()
		this.entity.dispose()
		this.fx.dispose()
		this.drifters.dispose()
		this.spaceBackdrop.dispose()
		this.level.sceneManager.camera.far = this.previousFar
		this.level.sceneManager.camera.updateProjectionMatrix()
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
		for (const [object, visible] of this.hidden)
			object.visible = visible
		Object.assign(this.level.sceneManager.scene, this.previous)
	}
}
