import * as THREE from 'three'
import { Level2 } from '../Level2/Level2.js'
import { StormLandscape } from './StormLandscape.js'
import { CrystalPlanet } from './CrystalPlanet.js'

// Shared locomotion and rover, with an independent Level 3 planet.
export class Level3 extends Level2 {
	constructor(game, options = {}) {
		super(game, { ...options, planetClass: CrystalPlanet })
		this.level = this.state.currentLevel = 3
		this.playerRoot.name = 'level3-pilot'
		this.walkCameraOffset = new THREE.Vector3(8, 5.5, 17)
		this.sceneManager.scene.background = new THREE.Color(0x303b50)
		this.sceneManager.scene.fog = new THREE.Fog(0x303b50, 420, 2100)
		this._lightEnvironment()
		this.stormLandscape = new StormLandscape(this)
		this.dust.material.uniforms.uColor.value.set(0xb0b1ac)
		this._buildJetpack()
		this._buildFlightPose()
		if (import.meta.env.DEV) window.__level3 = this
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
		const thrust = this.keys.has('Space')
		this.thrusting = thrust
		if (!thrust && !this._airborne) {
			super._updatePlayerMovement(delta)
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
			this.planet.heightAt(candidate.x, candidate.z) +
				footOffset <=
			position.y
		) {
			position.x = candidate.x
			position.z = candidate.z
		}
		const floor =
			this.planet.heightAt(position.x, position.z) +
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

	_toggleBoardRover() {
		if (!this.boarded && this._airborne) return
		super._toggleBoardRover()
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
		super.update(Math.min(delta, 0.05))
		this.stormLandscape.update(delta)
		const height = this.pilotWalk?.height ?? 3
		this.jetpack.position.set(
			0,
			height * 0.64 - (this.pilotWalk?.footOffset ?? 0),
			-0.45
		)
		this.jetpack.visible = !this.boarded
		this._updateFlightPose(delta)
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
			this.objectiveEl.innerHTML =
				'<strong>LEVEL 3 · THE ASHEN WASTES</strong><br><span style="font-size:12px;opacity:.85">WASD move · Shift sprint · Hold Space to fly · Release to descend · E board rover<br>Reach the escape portal on foot, by jetpack or rover.</span>'
			this._objectiveKey = ''
		}
	}

	dispose() {
		this.stormLandscape?.dispose()
		if (import.meta.env.DEV && window.__level3 === this)
			delete window.__level3
		super.dispose()
	}
}
