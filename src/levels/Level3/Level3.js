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

// Shared locomotion and rover, with an independent Level 3 planet.
export class Level3 extends Level2 {
	constructor(game, options = {}) {
		super(game, {
			...options,
			planetClass: CrystalPlanet,
			scriptSet: 3,
		})
		this.level = this.state.currentLevel = 3
		this.combatConfig = {
			bladeDamage: 30,
			encounterRange: 130,
			maxAttackers: 3,
			...options.combatConfig,
		}
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
		// The void warband: positional audio, the ancient monuments, the
		// energy blade, then the enemy roster (Level2's constructor queued
		// its own aliens virtually — the override below defers to here).
		this.voidAudio = new VoidAudio(this.audio)
		this.monuments = new VoidMonuments(this)
		this.matterDimension = new MatterDimension(this)
		this.survival = new MatterSurvival(this, options.survivalConfig)
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
		const sites = this.monuments.sites
		// The colossus queues first: the heaviest GLB should reach the
		// field earliest, and the arena is the fight that matters.
		const defs = [
			{
				style: 'colossus',
				home: sites.arena
					.clone()
					.add(new THREE.Vector3(30, 0, 24)),
			},
			// Rift stalkers hunt the routes in fast, darting packs.
			{
				style: 'stalker',
				home: this.landingSite
					.clone()
					.add(new THREE.Vector3(70, 0, -95)),
			},
			{
				style: 'stalker',
				home: sites.rift
					.clone()
					.add(new THREE.Vector3(34, 0, 22)),
			},
			{
				style: 'stalker',
				home: this.portalSite
					.clone()
					.add(new THREE.Vector3(60, 0, -95)),
			},
			{
				style: 'stalker',
				home: this.crashSite
					.clone()
					.add(new THREE.Vector3(85, 0, 25)),
			},
			// Sentinels anchor the ruins.
			{
				style: 'brute',
				home: sites.reactor
					.clone()
					.add(new THREE.Vector3(-18, 0, 26)),
			},
			{
				style: 'sentinel',
				home: sites.bridge
					.clone()
					.add(new THREE.Vector3(-24, 0, 18)),
			},
			// Void entities orbit the anomalies and rain energy bolts.
			{ style: 'predator', home: sites.rift.clone() },
			{ style: 'entity', home: sites.arena.clone() },
		]
		defs.forEach((def, index) => {
			const spot = this._findAlienSpot(
				def.home,
				def.style === 'colossus' ? 6 : 3
			)
			if (spot) def.home = spot
			const enemy =
				def.style === 'colossus'
					? new VoidColossus(this, {
							home: def.home,
						})
					: new VoidEnemy(this, def.style, {
							home: def.home,
						})
			this.aliens.push(enemy)
			enemy._encounterPending = true
		})
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
			}
		}
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
		if (this._airborne)
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

	_updatePlayerMovement(delta) {
		if (this.transitionHeld || this.completed) return
		const thrust = this.survival
			? this.survival.burn(delta, this.keys.has('Space'))
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
				this.planet.heightAt(
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
				? 28
				: 18
		)
		this.velocity.lerp(input, 1 - Math.exp(-5 * delta))
		this._verticalSpeed = THREE.MathUtils.damp(
			this._verticalSpeed,
			thrust ? 15 : -12,
			4,
			delta
		)
		position.y += this._verticalSpeed * delta
		const candidate = position
			.clone()
			.addScaledVector(this.velocity, delta)
		this.planet.clampToBounds(candidate, 0.9)
		const ground = this.planet.heightAt(candidate.x, candidate.z)
		// Stay outside props at low altitude; fly over them above their clearance.
		if (candidate.y - footOffset < ground + 18) {
			this.planet.resolveCircleCollisions(
				candidate,
				0.9,
				this.gameplayColliders
			)
			this.planet.clampToBounds(candidate, 0.9)
		}
		if (
			(this.survival?.surfaceHeightAt(
				candidate.x,
				candidate.z
			) ?? this.planet.heightAt(candidate.x, candidate.z)) +
				footOffset <=
			position.y
		) {
			position.x = candidate.x
			position.z = candidate.z
		}
		const floor =
			(this.matterDimension?.supportHeightAt(
				position.x,
				position.z,
				position.y - footOffset
			) ?? this.planet.heightAt(position.x, position.z)) +
			footOffset
		const ceiling = this.baseY + 220 + footOffset
		if (position.y >= ceiling) {
			position.y = ceiling
			this._verticalSpeed = 0
		}
		if (position.y <= floor) {
			position.y = floor
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
		if (!this.transitionHeld && !this.completed) {
			let attacking = 0
			for (const enemy of this.aliens) {
				if (
					[
						'prepare',
						'strike',
						'charge',
						'dive',
					].includes(enemy.state)
				)
					attacking++
			}
			this._encounterDelay = Math.max(
				0,
				(this._encounterDelay ?? 0) - delta
			)
			for (const enemy of this.aliens) {
				const distance = enemy.position.distanceTo(
					this.playerRoot.position
				)
				if (
					enemy._encounterPending &&
					this._encounterDelay <= 0 &&
					distance > 22 &&
					distance <
						this.combatConfig.encounterRange
				) {
					this._encounterDelay = 0.6
					enemy._encounterPending = false
					enemy.load().catch((error) =>
						console.warn(
							'[Level3] Encounter load failed',
							error
						)
					)
				}
				if (
					attacking >=
						this.combatConfig
							.maxAttackers &&
					['chase', 'orbit'].includes(enemy.state)
				)
					enemy._cooldown = Math.max(
						enemy._cooldown,
						0.3
					)
			}
		}
		this.survival?.update(delta)
		this.matterDimension?.update(
			delta,
			!!this.transitionHeld || this.completed
		)
		this.arrivalBackdrop?.update(delta)
		this.arrivalShip?.update(delta, { thrust: 0 })
		const step = Math.min(delta, 0.05)
		super.update(step)
		this._updateMissionRadio()
		this.stormLandscape.update(delta)
		// Void warband wiring: the audio listener tracks the camera, the
		// monuments pulse and pull, the blade handles pickup and swings.
		this.voidAudio?.update(this.sceneManager.camera)
		this.monuments?.update(step)
		this.blade?.update(step)
		const fDown = this.keys.has('KeyF')
		if (fDown && !this._fWasDown) this.blade?.trySwing()
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
			const bladeHint = this.blade?.equipped
				? ' · F swing blade'
				: ''
			this.objectiveEl.innerHTML = `<strong>LEVEL 3 · VOID OF GODS · MATTER DIMENSION</strong><br><span style="font-size:12px;opacity:.85">WASD move · Shift sprint · Hold Space to fly (uses fuel) · Release to descend / C duck · ${bladeHint}<br>Escape before the ground vanishes. Collect cyan nitrogen canisters. Dodge amber impacts; duck cyan fragments.</span>`
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
		super.dispose()
	}
}
