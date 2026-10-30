import * as THREE from 'three'
import { Level2 } from '../Level2/Level2.js'
import { StormLandscape } from './StormLandscape.js'
import { CrystalPlanet } from './CrystalPlanet.js'
import { STATUS } from '../../core/GameState.js'
import { VoidAudio } from './voidAudio.js'
import { VoidMonuments } from './VoidMonuments.js'
import { EnergyBlade } from './EnergyBlade.js'
import { VoidEnemy } from './VoidEnemy.js'
import { VoidColossus } from './VoidColossus.js'
import { MatterDimension } from './MatterDimension.js'
import { MatterSurvival } from './MatterSurvival.js'
import { VoidDimension } from './VoidDimension.js'

// Shared locomotion and rover, with an independent Level 3 planet.
export class Level3 extends Level2 {
	constructor(game, options = {}) {
		super(game, {
			...options,
			planetClass: CrystalPlanet,
			scriptSet: 3,
			worldSize: options.worldSize ?? 1600,
		})
		this.level = this.state.currentLevel = 3
		this.combatConfig = {
			bladeDamage: 30,
			encounterRange: 150,
			maxAttackers: 4,
			maxActiveEnemies: 8,
			maxMajorEnemies: 10,
			spawnInterval: 0.55,
			lavaDamagePerSecond: 8,
			lavaDamageInterval: 1,
			...options.combatConfig,
		}
		this._rWasDown = false
		// Keep inherited controller references, but retire surface-only scenery.
		this.wreckRoot.removeFromParent()
		for (const collider of this.gameplayColliders) {
			if (
				collider.type === 'wreck' ||
				collider.object === this.wreckRoot
			)
				collider.enabled = false
		}
		this.hazards.enabled = false
		this.roverDisabled = true
		this.rover.group.visible = false
		if (this.rover.collider) this.rover.collider.enabled = false
		this.guide?.group?.removeFromParent()
		if (this.levelHudEl.firstElementChild)
			this.levelHudEl.firstElementChild.textContent =
				'LEVEL 03 // VOID OF GODS'
		this.playerRoot.name = 'level3-pilot'
		this.walkCameraOffset = new THREE.Vector3(8, 5.5, 17)
		this.sceneManager.scene.background = new THREE.Color(0x101222)
		this.sceneManager.scene.fog = new THREE.Fog(0x100923, 90, 900)
		this._lightEnvironment()
		this.stormLandscape = new StormLandscape(this)
		this.dust.material.uniforms.uColor.value.set(0xb0b1ac)
		this._buildJetpack()
		this._buildFlightPose()
		// Reused by the jetpack flight controls to steer relative to the camera.
		this._camForward = new THREE.Vector3()
		this._camRight = new THREE.Vector3()
		// The void warband: positional audio, the ancient monuments, the
		// energy blade, then the enemy roster (Level2's constructor queued
		// its own aliens virtually — the override below defers to here).
		this.voidAudio = new VoidAudio(this.audio)
		this.monuments = new VoidMonuments(this)
		this.matterDimension = new MatterDimension(this)
		// The terrain stays stable for two minutes before collapse begins.
		this.survival = new MatterSurvival(this, {
			collapseSeconds: 45,
			...options.survivalConfig,
		})
		this.blade = new EnergyBlade(this)
		this._voidKills = 0
		this._bossDefeated = false
		// Level 3 reuses Level 2's radio hooks; these cue ids replace the
		// surface ones, and the mission beats are detected in _updateRadio.
		this._radioIntroScript = 'l3.opening'
		this._radioRoverScript = null
		this._radioBeat = { activity: false, complete: false }
		this._fWasDown = false
		this._spawnVoidRoster()
		if (import.meta.env.DEV) window.__level3 = this
	}

	/** R switches Level 3 blade modes; Level 2 still resets the rover. */
	_handleRKey() {
		if (!this.blade?.equipped) return false

		const mode = this.blade.cycleSwingMode()

		const labels = {
			vertical: 'VERTICAL SWING',
			horizontal: 'HORIZONTAL SWEEP',
			thrust: 'FORWARD THRUST',
		}

		this._showMovementFeedback(
			`BLADE MODE — ${labels[mode]}`,
			2
		)

		return true
	}

	/** Keep the cinematic's distant structure visible after landing. This is
	 * decorative ownership only; existing terrain, objectives and roster stay put. */
	adoptArrivalBackdrop(backdrop, ship = null) {
		this.arrivalBackdrop?.dispose()
		this.arrivalBackdrop = backdrop
		this.addObject(backdrop.group)
		this.arrivalShip?.dispose()
		this.arrivalShip = ship
		if (ship) {
			this.addObject(ship.group)
			const size = ship.hullBounds.getSize(
				new THREE.Vector3()
			)
			this._registerGameplayCollider(
				ship.group.position.x,
				ship.group.position.z,
				Math.min(9, Math.max(size.x, size.z) * 0.45),
				'arrival-ship',
				ship.group
			)
		}
	}

	/**
	 * Level 3 swaps the inherited alien roster for the void warband.
	 * Level2's constructor calls this virtually mid-build, before the
	 * audio layer and monument sites exist — so it stays empty and the
	 * real spawning happens in _spawnVoidRoster from the constructor tail.
	 */
	_spawnAliens() {}

	_spawnVoidRoster() {
		const route = this.matterDimension.encounterSites
		const waves = [
			{
				name: 'first-contact',
				progress: 0.045,
				styles: [
					'sentinel',
					'predator',
					'predator',
					'brute',
					'brute',
				],
			},
			{
				name: 'broken-passage',
				progress: 0.26,
				styles: [
					'predator',
					'predator',
					'predator',
					'brute',
					'brute',
					'colossus',
				],
			},
			{
				name: 'volcanic-corridor',
				progress: 0.48,
				styles: [
					'brute',
					'brute',
					'brute',
					'predator',
					'predator',
					'predator',
					'entity',
				],
			},
			{
				name: 'dimensional-ruins',
				progress: 0.69,
				styles: [
					'brute',
					'brute',
					'predator',
					'predator',
					'predator',
					'entity',
					'stalker',
				],
			},
			{
				name: 'space-hub-defense',
				progress: 0.88,
				major: true,
				styles: [
					'brute',
					'brute',
					'predator',
					'predator',
					'stalker',
					'entity',
					'colossus',
				],
			},
		]
		this.encounters = waves.map((wave, encounterIndex) => {
			const site = route[encounterIndex]
			const encounter = {
				...wave,
				site,
				active: false,
				completed: false,
				enemies: [],
			}
			wave.styles.forEach((style, index) => {
				const angle =
					(index / wave.styles.length) *
					Math.PI *
					2
				const radius = 18 + (index % 2) * 8
				const home = site
					.clone()
					.add(
						new THREE.Vector3(
							Math.cos(angle) *
								radius,
							0,
							Math.sin(angle) * radius
						)
					)
				if (style !== 'predator' && style !== 'entity')
					this.matterDimension.avoidLava(home, 5)
				if (
					style !== 'predator' &&
					style !== 'entity'
				) {
					const spot = this._findAlienSpot(
						home,
						style === 'colossus' ? 6 : 3
					)
					if (spot) home.copy(spot)
				}
				const enemy =
					style === 'colossus'
						? new VoidColossus(this, {
								home,
							})
						: new VoidEnemy(this, style, {
								home,
							})
				enemy._encounterIndex = encounterIndex
				enemy._encounterPending = true
				this.aliens.push(enemy)
				encounter.enemies.push(enemy)
			})
			return encounter
		})
		this._encounterDelay = 0
		this._routeProgress = 0
	}

	_updateEncounters(delta) {
		if (!this.encounters?.length) return
		const player = this.playerRoot.position
		this._routeProgress = Math.max(
			this._routeProgress,
			this.matterDimension.routeProgress(player)
		)
		this._encounterDelay = Math.max(0, this._encounterDelay - delta)
		for (const encounter of this.encounters) {
			if (
				!encounter.active &&
				this._routeProgress >= encounter.progress &&
				Math.hypot(
					player.x - encounter.site.x,
					player.z - encounter.site.z
				) > 52
			)
				encounter.active = true
			if (!encounter.active) continue
			if (
				encounter.enemies.every(
					(enemy) => enemy.smashed
				) &&
				encounter.enemies.every(
					(enemy) => !enemy._encounterPending
				)
			)
				encounter.completed = true
			if (encounter.completed || this._encounterDelay > 0)
				continue
			const activeLimit = encounter.major
				? this.combatConfig.maxMajorEnemies
				: this.combatConfig.maxActiveEnemies
			const nearbyLiving = this.aliens.filter(
				(enemy) =>
					enemy._loaded &&
					!enemy.smashed &&
					enemy.position.distanceTo(player) < 220
			).length
			if (nearbyLiving >= activeLimit) return
			const next = encounter.enemies.find(
				(enemy) => enemy._encounterPending
			)
			if (!next) continue
			next._encounterPending = false
			this._encounterDelay = this.combatConfig.spawnInterval
			next.load().catch((error) =>
				console.warn(
					`[Level3] ${encounter.name} spawn failed`,
					error
				)
			)
			return
		}
	}

	_lightEnvironment() {
		for (const object of this.objects) {
			if (object.isHemisphereLight) {
				object.color.set(0xb7c9ed)
				object.groundColor.set(0x302339)
				object.intensity = 1.3
			} else if (object.isDirectionalLight) {
				object.color.set(0xdde9ff)
				object.intensity = 2.2
				object.position
					.copy(object.target.position)
					.add(new THREE.Vector3(-180, 155, -112))
				// The void has a large terrain and crystal field. Keep the shadow
				// map bounded so flying does not trigger an oversized shadow pass.
				object.shadow.mapSize.set(1024, 1024)
			}
		}
		const renderer = this.sceneManager.renderer
		if (renderer) {
			renderer.shadowMap.type = THREE.PCFShadowMap
			renderer.shadowMap.autoUpdate = false
			renderer.shadowMap.needsUpdate = true
		}
		this._shadowTick = 0
	}

	_buildJetpack() {
		this.jetpack = new THREE.Group()
		this.jetpack.name = 'twin-thruster-jetpack'
		const metal = this.own(
			new THREE.MeshStandardMaterial({
				color: 0x41464d,
				roughness: 0.85,
				metalness: 0.6,
			})
		)
		const glow = this.own(
			new THREE.MeshBasicMaterial({
				color: 0xa8ddff,
				transparent: true,
				opacity: 0.85,
			})
		)
		this.jets = []
		for (const x of [-0.31, 0.31]) {
			const tank = new THREE.Mesh(
				this.own(
					new THREE.CylinderGeometry(
						0.23,
						0.26,
						1.05,
						12
					)
				),
				metal
			)
			tank.position.set(x, 0, 0)
			tank.castShadow = true
			this.jetpack.add(tank)
			const flame = new THREE.Mesh(
				this.own(new THREE.ConeGeometry(0.18, 0.9, 12)),
				glow
			)
			flame.rotation.z = Math.PI
			flame.position.set(x, -0.95, 0)
			flame.visible = false
			this.jetpack.add(flame)
			this.jets.push(flame)
		}
		this.playerRoot.add(this.jetpack)
	}

	_setPilot(model, character) {
		const y = this.playerRoot.position.y
		const oldOffset = this.pilotWalk?.footOffset ?? 0
		super._setPilot(model, character)
		if (this._airborne || this.voidDimension)
			this.playerRoot.position.y =
				y - oldOffset + this.pilotWalk.footOffset
		// A late-loaded pilot uses the same visual pivot as the placeholder.
		this.flightOffset?.add(model)
	}

	_buildFlightPose() {
		// Rotate the body and pack together around the torso. Keep the gameplay
		// root upright so yaw, terrain contacts and the chase camera stay stable.
		this.flightPivot = new THREE.Group()
		this.flightPivot.name = 'jetpack-flight-pose'
		this.flightOffset = new THREE.Group()
		this.flightPivot.add(this.flightOffset)
		this.playerRoot.add(this.flightPivot)
		this.flightOffset.add(this.pilotModel, this.jetpack)
	}

	_updateFlightPose(delta) {
		const height = this.pilotWalk?.height ?? 3
		const footOffset = this.pilotWalk?.footOffset ?? 0
		const pivotY = height * 0.52 - footOffset
		this.flightPivot.position.y = pivotY
		this.flightOffset.position.y = -pivotY
		const clearance =
			this.playerRoot.position.y -
			footOffset -
			this.planet.heightAt(
				this.playerRoot.position.x,
				this.playerRoot.position.z
			)
		const flying =
			this._airborne && !this.boarded && !this.completed
		const speedBlend = THREE.MathUtils.smoothstep(
			this._flightSpeed ?? 0,
			1,
			12
		)
		const landingBlend = THREE.MathUtils.smoothstep(
			clearance,
			0.4,
			3
		)
		const pitch = flying
			? Math.PI * 0.5 * speedBlend * landingBlend
			: 0
		this.flightPivot.rotation.x = THREE.MathUtils.damp(
			this.flightPivot.rotation.x,
			pitch,
			flying ? 6 : 12,
			Math.min(delta, 0.05)
		)
		if (this.boarded || this.completed)
			this.flightPivot.rotation.x = 0
	}

	_surfaceHeightAt(x, z) {
		return (
			this.survival?.surfaceHeightAt(x, z) ??
			this.planet.heightAt(x, z)
		)
	}

	_cameraSurfaceHeightAt(x, z) {
		return this._surfaceHeightAt(x, z)
	}

	_updatePlayerMovement(delta) {
		if (this.transitionHeld || this.completed) return
		const thrust = this.survival
			? this.survival.burn(
					delta,
					this.keys.has('Space'),
					this.keys.has('ShiftLeft') ||
						this.keys.has('ShiftRight')
				)
			: this.keys.has('Space')
		this.crouching =
			this.keys.has('KeyC') && !this._airborne && !thrust
		if (
			this.survival?.isGone(
				this.playerRoot.position.x,
				this.playerRoot.position.z
			)
		)
			this._airborne = true
		this.thrusting = thrust
		if (!thrust && !this._airborne) {
			const oldFeet =
				this.playerRoot.position.y -
				(this.pilotWalk?.footOffset ?? 0)
			const oldSupport =
				this.matterDimension?.supportHeightAt(
					this.playerRoot.position.x,
					this.playerRoot.position.z,
					oldFeet
				)
			super._updatePlayerMovement(
				this.crouching ? delta * 0.45 : delta
			)
			if (
				oldSupport >
				this._surfaceHeightAt(
					this.playerRoot.position.x,
					this.playerRoot.position.z
				) +
					1
			) {
				const p = this.playerRoot.position
				const support =
					this.matterDimension.supportHeightAt(
						p.x,
						p.z,
						oldFeet
					)
				if (support >= oldFeet - 1)
					p.y =
						support +
						(this.pilotWalk?.footOffset ??
							0)
				else {
					p.y =
						oldFeet +
						(this.pilotWalk?.footOffset ??
							0)
					this._airborne = true
				}
			}
			return
		}
		this._airborne = true
		const position = this.playerRoot.position
		const startX = position.x
		const startZ = position.z
		const footOffset = this.pilotWalk?.footOffset ?? 0
		this.sceneManager.camera.getWorldDirection(this._camForward)
		this._camForward.y = 0
		this._camForward.normalize()
		this._camRight.crossVectors(
			this._camForward,
			new THREE.Vector3(0, 1, 0)
		)
		const input = this._inputScratch
			.copy(this._camForward)
			.multiplyScalar(
				Number(this.keys.has('KeyW')) -
					Number(this.keys.has('KeyS'))
			)
		input.addScaledVector(
			this._camRight,
			Number(this.keys.has('KeyD')) -
				Number(this.keys.has('KeyA'))
		)
		input.normalize().multiplyScalar(
			this.keys.has('ShiftLeft') ||
				this.keys.has('ShiftRight')
				? 32
				: 18
		)
		this.velocity.lerp(input, 1 - Math.exp(-5 * delta))
		// Once collapse begins, a backwards/downward void current fights the jetpack.
		// Apply acceleration with delta time; do not teleport or override input.
		const suction = this.survival?.getSuction(position)
		if (suction?.backwards) {
			this.velocity.addScaledVector(
				this.survival.direction,
				-suction.backwards * delta
			)
			this.velocity.clampLength(0, 38)
		}
		this._verticalSpeed = THREE.MathUtils.damp(
			this._verticalSpeed,
			thrust
				? this.keys.has('ShiftLeft') ||
					this.keys.has('ShiftRight')
					? 23
					: 15
				: -12,
			4,
			delta
		)
		if (suction?.downwards)
			this._verticalSpeed -= suction.downwards * delta
		position.y += this._verticalSpeed * delta
		const candidate = position
			.clone()
			.addScaledVector(this.velocity, delta)
		this.planet.clampToBounds(candidate, 0.9)
		// Treat a sharp rise in the terrain as a wall. Without this the pilot
		// is moved into the hillside and then snapped up to its surface on the
		// next line, which looks like a mid-flight teleport. Gentle uphill
		// slopes stay flyable because the step allowance is larger than one
		// frame of climb at normal speed.
		const maxClimb = 1.5
		const feet = position.y - footOffset
		const blockedByTerrain = (x, z) =>
			this._surfaceHeightAt(x, z) > feet + maxClimb
		if (blockedByTerrain(candidate.x, candidate.z)) {
			if (!blockedByTerrain(candidate.x, startZ)) {
				candidate.z = startZ
			} else if (!blockedByTerrain(startX, candidate.z)) {
				candidate.x = startX
			} else {
				candidate.x = startX
				candidate.z = startZ
			}
		}
		const ground = this._surfaceHeightAt(candidate.x, candidate.z)
		// Stay outside props at low altitude; fly over them above their clearance.
		// Only resolve nearby prop colliders right at surface level. The old
		// 18-unit band kept snapping a flying pilot against rocks and plants
		// while crossing its edge, which looked like midair jitter.
		if (candidate.y - footOffset < ground + 5) {
			this.planet.resolveCircleCollisions(
				candidate,
				0.9,
				this.gameplayColliders
			)
			this.planet.clampToBounds(candidate, 0.9)
			// A prop push must not shove the pilot back into a hillside.
			if (
				(candidate.x !== startX ||
					candidate.z !== startZ) &&
				blockedByTerrain(candidate.x, candidate.z)
			) {
				candidate.x = startX
				candidate.z = startZ
			}
		}
		// Keep horizontal flight continuous across uneven or collapsing terrain.
		// The previous height gate froze X/Z as soon as an uphill tile rose
		// above the pilot, then resumed after the floor snap, causing jitter.
		position.x = candidate.x
		position.z = candidate.z
		const terrainFloor = this._surfaceHeightAt(
			position.x,
			position.z
		)
		const supportFloor =
			this.matterDimension?.supportHeightAt(
				position.x,
				position.z,
				position.y - footOffset
			) ?? terrainFloor
		// Floating slabs are one-way landing surfaces. While the jetpack is
		// still climbing, ignore them so the pilot cannot snap onto a top from
		// underneath; once descent starts they become solid.
		const floor =
			(this._verticalSpeed > 0
				? terrainFloor
				: supportFloor) + footOffset
		const ceiling = this.baseY + 220 + footOffset
		if (position.y >= ceiling) {
			position.y = ceiling
			this._verticalSpeed = 0
		}
		if (position.y <= floor) {
			position.y = floor
			if (this._verticalSpeed <= 0 && !thrust) {
				this._verticalSpeed = 0
				this._airborne = false
				this.dust.spawnBurst(
					this._feetScratch
						.copy(position)
						.setY(floor - footOffset),
					{
						count: 14,
						strength: 2,
						spread: 1.5,
						size: 0.9,
						upBias: 0.45,
					}
				)
			} else if (this._verticalSpeed < 0) {
				this._verticalSpeed = 0
			}
		}
		this._speed = this.velocity.length()
		this._flightSpeed =
			Math.hypot(position.x - startX, position.z - startZ) /
			Math.max(delta, 1e-5)
		this._slideSpeed = 0
		if (this._speed > 0.5) {
			const yaw = Math.atan2(this.velocity.x, this.velocity.z)
			const difference = Math.atan2(
				Math.sin(yaw - this.playerRoot.rotation.y),
				Math.cos(yaw - this.playerRoot.rotation.y)
			)
			this.playerRoot.rotation.y +=
				difference * (1 - Math.exp(-8 * delta))
		}
		this.pilotWalk?.update(delta, 0, false)
	}

	_toggleBoardRover() {}

	async _loadWreck() {}
	_setWreck() {}
	_buildWreckEffects() {}

	_updateLevelHUD() {
		super._updateLevelHUD()
		if (!this.levelHudEl || !this.aliens) return
		if (!this.enemyStatusEl) {
			this.enemyStatusEl = document.createElement('div')
			this.enemyStatusEl.style.marginTop = '12px'
			this.levelHudEl.appendChild(this.enemyStatusEl)
		}
		if (this.survival) {
			if (!this.survivalHudEl) {
				this.survivalHudEl =
					document.createElement('div')
				this.survivalHudEl.style.marginTop = '12px'
				this.levelHudEl.appendChild(this.survivalHudEl)
			}
			const fuel = Math.ceil(this.survival.fuel)
			const percent =
				(100 * this.survival.fuel) /
				this.survival.config.maxFuel
			this.survivalHudEl.innerHTML = `NITROGEN ${fuel} / ${this.survival.config.maxFuel}<div style="height:8px;background:#263342;margin:5px 0 10px"><div style="height:100%;background:${percent < 25 ? '#ffb347' : '#62ffda'};width:${percent}%"></div></div><span style="color:#ffb37b">${this.survival.remaining > 0 ? 'TERRAIN COLLAPSE IN ' + Math.ceil(this.survival.remaining) + 's' : 'TERRAIN COLLAPSING - KEEP MOVING'}</span>`
		}
		if (!this.bladeModeHudEl) {
			this.bladeModeHudEl = document.createElement('div')
			this.bladeModeHudEl.style.marginTop = '12px'
			this.bladeModeHudEl.style.fontSize = '11px'
			this.levelHudEl.appendChild(this.bladeModeHudEl)
		}
		const bladeModeNames = {
			vertical: 'VERTICAL',
			horizontal: 'HORIZONTAL',
			thrust: 'THRUST',
		}
		this.bladeModeHudEl.textContent = `ATTACK MODE: ${bladeModeNames[this.blade?.swingMode] || 'VERTICAL'} · R TO SWITCH`
		const target = this.aliens
			.filter(
				(e) =>
					e._loaded &&
					!e.smashed &&
					e.position.distanceTo(
						this.playerRoot.position
					) < 35
			)
			.sort(
				(a, b) =>
					a.position.distanceToSquared(
						this.playerRoot.position
					) -
					b.position.distanceToSquared(
						this.playerRoot.position
					)
			)[0]
		this.enemyStatusEl.textContent = target
			? `${target.styleName.toUpperCase()}  ${target.hp} / ${target.maxHp} HP`
			: ''
	}

	_checkPortalArrival() {
		if (
			Math.abs(
				this.playerRoot.position.y -
					(this.planet.heightAt(
						this.portalSite.x,
						this.portalSite.z
					) +
						(this.pilotWalk?.footOffset ??
							0))
			) > 7
		)
			return
		super._checkPortalArrival()
	}

	update(delta) {
		if (this.paused) return
		// Refresh dynamic shadows on alternate frames. The player and enemies
		// still cast moving shadows without rerasterizing the whole void every
		// frame while the jetpack is active.
		const renderer = this.sceneManager.renderer
		if (renderer) {
			this._shadowTick = (this._shadowTick + 1) & 1
			if (this._shadowTick === 0)
				renderer.shadowMap.needsUpdate = true
		}
		if (this.voidDimension) {
			this.voidDimension.update(delta)
			return
		}
		if (!this.transitionHeld && !this.completed)
			this._updateEncounters(delta)
		this.survival?.update(delta)
		this.matterDimension?.update(
			delta,
			!!this.transitionHeld || this.completed
		)
		this.arrivalBackdrop?.update(delta)
		this.arrivalShip?.update(delta, { thrust: 0 })
		const step = Math.min(delta, 0.05)
		super.update(step)
		this.matterDimension?.updateLavaDamage(step)
		if (this.voidDimension) return
		this._updateMissionRadio()
		this.stormLandscape.update(delta)
		// Void warband wiring: the audio listener tracks the camera, the
		// monuments pulse and pull, the blade handles pickup and swings.
		this.voidAudio?.update(this.sceneManager.camera)
		this.monuments?.update(step)
		this.blade?.update(step)

		const rDown = this.keys.has('KeyR')

		if (rDown && !this._rWasDown) {
			this._handleRKey()
		}

		this._rWasDown = rDown

		const fDown = this.keys.has('KeyF')
		if (fDown && !this._fWasDown) {
			this.blade?.trySwing()
		}
		this._fWasDown = fDown
		const height = this.pilotWalk?.height ?? 3
		this.jetpack.position.set(
			0,
			height * 0.64 - (this.pilotWalk?.footOffset ?? 0),
			-0.45
		)
		this.jetpack.visible = !this.boarded
		this._updateFlightPose(delta)
		this.flightOffset.scale.y = THREE.MathUtils.damp(
			this.flightOffset.scale.y,
			this.crouching ? 0.5 : 1,
			15,
			step
		)
		if (
			!this.completed &&
			!this.transitionHeld &&
			this.playerRoot.position.y < this.baseY - 120
		) {
			this.playerHP = 0
			this._gameOver()
		}
		for (const jet of this.jets) {
			jet.visible =
				this.thrusting &&
				!this.boarded &&
				!this.completed
			jet.scale.y =
				0.85 +
				Math.sin(this.elapsedPlayTime * 45) * 0.15
		}
		if (!this.completed && !this.boarded) {
			const bladeModes = {
				vertical: 'Vertical Swing',
				horizontal: 'Horizontal Sweep',
				thrust: 'Forward Thrust',
			}

			const bladeMode = bladeModes[this.blade?.swingMode]
			const bladeHint = this.blade?.equipped
				? ` · F attack · R change attack mode (${bladeMode})`
				: ' · R changes blade attack mode'
			const riftObjective =
				'Cross the Grav Rift to reach the final boss.'
			this.objectiveEl.innerHTML = `<strong>LEVEL 3 · VOID OF GODS · MATTER DIMENSION</strong><br><span style="font-size:12px;opacity:.85">WASD move · Shift sprint · Hold Space to fly · Shift+Space jetpack BOOST (more fuel) · Release to descend / C duck · ${bladeHint}<br>${riftObjective} Collect cyan nitrogen cells, avoid molten pools and dodge falling debris.</span>`
			this._objectiveKey = ''
		}
	}

	/**
	 * Mission-beat transmissions, read off the warband's real state rather
	 * than a timer: the first construct close enough to register, then the
	 * colossus going down. Each fires once per run. Beats with no recorded
	 * conversation (the blade pickup) stay silent — there is no synthetic
	 * speech to fall back on.
	 */
	_updateMissionRadio() {
		if (!this.radio) return
		// The opening transmission owns the first seconds of the level, and
		// the radio carries one conversation at a time: a construct can
		// already be in range on the first frame, so without this gate the
		// activity report would land first and the opening would be
		// silently dropped.
		if (this._radioIntroIn > 0 || this.radio.isPlaying()) return
		if (
			!this._radioBeat.activity &&
			this._nearestVoidDistance() < 85
		) {
			// play() refuses while another conversation is on air (the
			// opening, usually), so the beat only latches when it is
			// actually accepted and can retry next frame otherwise.
			this._radioBeat.activity =
				this.radio.play('l3.activity')
		}
		if (this._bossDefeated && !this._radioBeat.complete) {
			// Same one-shot-on-accept rule: the last exchange is worth a
			// frame or two of waiting rather than being dropped.
			this._radioBeat.complete =
				this.radio.play('l3.complete')
		}
	}

	/** Nearest loaded, intact void construct to the player, in world units. */
	_nearestVoidDistance() {
		const player = this.playerRoot?.position
		if (!player) return Number.POSITIVE_INFINITY
		let nearest = Number.POSITIVE_INFINITY
		for (const alien of this.aliens || []) {
			if (!alien?._loaded || alien.smashed) continue
			const distance = player.distanceTo(alien.position)
			if (distance < nearest) nearest = distance
		}
		return nearest
	}

	/**
	 * Level2's mission formula, extended with the void warband: every
	 * kill pays 150 and the colossus 800, so the fights are worth taking.
	 */
	_completeMission() {
		if (this.completed) return
		if (!this.voidDimension) {
			this.audio?.playEscape()
			this.voidDimension = new VoidDimension(this)
			return
		}
		this.completed = true
		this.rover.inputEnabled = false
		const time = this.elapsedPlayTime
		const bonus =
			(this._voidKills || 0) * 150 +
			(this._bossDefeated ? 800 : 0)
		const score = Math.round(
			1500 +
				Math.max(0, 600 - time) * 3 +
				(this._hasBoarded ? 500 : 0) +
				bonus
		)
		this.state.score = score
		this.state.status = STATUS.LEVEL_COMPLETE
		this.audio?.playEscape()
		this.portal.playArrival()
		// A beat of arrival burst before the results screen takes over.
		this._endTimer = setTimeout(() => {
			this.onEnd?.({
				outcome: 'transited',
				won: true,
				score,
				time,
				hull: Math.round(
					(100 * this.playerHP) / this.maxPlayerHP
				),
				progress: 1,
				level: this.level,
			})
		}, 1500)
	}

	/** Same flow as Level2's, but the results screen should say Level 3. */
	_gameOver() {
		if (this.completed) return
		this.completed = true
		this.state.status = STATUS.GAME_OVER
		this.keys.clear()
		this.velocity.set(0, 0, 0)
		this.rover.inputEnabled = false
		this.rover.speed = 0
		this.audio?.stopRoverEngine()
		this.audio?.playCrash()
		this.radio?.stop()
		const time = this.elapsedPlayTime
		this.state.score = 0
		this._endTimer = setTimeout(() => {
			this.onEnd?.({
				outcome: 'overrun',
				won: false,
				score: 0,
				time,
				hull: 0,
				progress: 0,
				level: this.level,
			})
		}, 1000)
	}

	dispose() {
		this.voidDimension?.dispose()
		this.survival?.dispose()
		this.matterDimension?.dispose()
		this.arrivalBackdrop?.dispose()
		this.arrivalShip?.dispose()
		this.blade?.dispose()
		this.monuments?.dispose()
		this.voidAudio?.dispose()
		this.stormLandscape?.dispose()
		if (import.meta.env.DEV && window.__level3 === this)
			delete window.__level3
		const renderer = this.sceneManager.renderer
		if (renderer) renderer.shadowMap.autoUpdate = true
		super.dispose()
	}
}
