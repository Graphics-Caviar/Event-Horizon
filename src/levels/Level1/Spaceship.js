import * as THREE from 'three'
import { SHIPS } from '../../systems/ShipManager.js'

const DEBUG = true

export class Spaceship {
	constructor(level, blackHole) {
		this.level = level
		this.blackHole = blackHole

		this.collisionRadius = 10 // rough fit for the cone (radius 6, height 18) — tune to taste
		this.onAsteroidCollision = null

		this.shipGroup = new THREE.Group()
		this.shipGroup.name = 'spaceship'

		// Visuals are separated from the physics group so banking and engine
		// animation do not change the direction used by the flight controller.
		this.visualGroup = new THREE.Group()
		this.visualGroup.name = 'spaceship-visuals'
		this.shipGroup.add(this.visualGroup)
		this.createSpaceship()
		this.addObject(this.shipGroup)

		this.position = new THREE.Vector3(0, 0, 300)
		this.velocity = new THREE.Vector3(0, 0, 0)
		this.shipGroup.position.copy(this.position)
		this.setupInitialShipRotation()

		this.thrustPower = 100 // forward acceleration while held
		this.reverseFactor = 0.4 // reverse thrust is weaker than forward
		this.turnSpeed = 1.5 // yaw, rad/sec
		this.pitchSpeed = 1.2 // pitch, rad/sec
		this.dragFactor = 0.5 // fraction of velocity kept per second when coasting
		this.maxSpeed = this.blackHole.getGravityStrength() * 1.01 // clamp so escalating gravity can't blow it up

		this.input = {
			forward: false,
			backward: false,
			left: false,
			right: false,
			pitchUp: false,
			pitchDown: false,
		}
		this.bindInput()

		this.cameraOffset = new THREE.Vector3(0, 8, 25)
		this.cameraLookAhead = new THREE.Vector3(0, 2, -10)
		this.cameraSmoothing = 5
		this.baseCameraFov = this.level.sceneManager.camera?.fov || 75
		this.bankAmount = 0.42
		this.bankSmoothing = 7
		this.engineIntensity = 0
		this.elapsedTime = 0

		this.createEngineEffects()
		this.createSpeedStreaks()
		this.setupInitialCamera()
	}

	addObject(object) {
		this.level.addObject(object)
	}
	own(resource) {
		this.level.own(resource)
	}
	getPosition() {
		return this.position
	}

	createSpaceship() {
		// Keep a tiny procedural craft as a loading/error fallback so gameplay
		// can start immediately even while the selected GLB is being decoded.
		const geo = new THREE.ConeGeometry(6, 18, 8)
		this.own(geo)
		geo.rotateX(-Math.PI / 2)

		const mat = new THREE.MeshStandardMaterial({
			color: 0x99ccff,
			emissive: 0x224466,
			emissiveIntensity: 0.5,
		})
		this.own(mat)

		this.mesh = new THREE.Mesh(geo, mat)
		this.mesh.name = 'spaceship-loading-fallback'
		this.visualGroup.add(this.mesh)

		this.loadSelectedModel()
	}

	async loadSelectedModel() {
		const selectedKey = this.level.game.gameState.selectedShip
		const config = SHIPS[selectedKey] || SHIPS.vanguard

		try {
			const model = await this.level.assetManager.loadModel(
				config.model
			)
			if (!this.shipGroup.parent) return

			model.name = `spaceship-model-${config.key}`
			model.traverse((child) => {
				if (child.isMesh) {
					child.castShadow = true
					child.receiveShadow = true
				}
			})

			// GLB files can have wildly different authoring units and origins.
			// Normalize each selected craft to the same gameplay footprint.
			let box = new THREE.Box3().setFromObject(model)
			const size = box.getSize(new THREE.Vector3())
			const longestAxis =
				Math.max(size.x, size.y, size.z) || 1
			model.scale.setScalar(18 / longestAxis)

			box = new THREE.Box3().setFromObject(model)
			const center = box.getCenter(new THREE.Vector3())
			model.position.sub(center)

			// The flight controller treats local -Z as forward. If a particular
			// asset was authored facing the opposite direction, adjust this one
			// rotation rather than changing the physics/controller code.
			model.rotation.y = Math.PI

			this.visualGroup.add(model)
			this.visualGroup.remove(this.mesh)
			this.model = model

			const fitted = new THREE.Box3().setFromObject(model)
			const fittedSize = fitted.getSize(new THREE.Vector3())
			this.collisionRadius =
				Math.max(fittedSize.x, fittedSize.y) * 0.45
		} catch (error) {
			console.error(
				`Unable to load selected ship ${config.key}:`,
				error
			)
		}
	}

	createEngineEffects() {
		this.engineGroup = new THREE.Group()
		this.engineGroup.name = 'engine-effects'
		this.visualGroup.add(this.engineGroup)

		const flameGeometry = new THREE.ConeGeometry(1.2, 7, 12)
		flameGeometry.rotateX(Math.PI / 2)
		this.own(flameGeometry)

		const flameMaterial = new THREE.MeshBasicMaterial({
			color: 0x66ccff,
			transparent: true,
			opacity: 0.75,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		this.own(flameMaterial)

		this.engineFlame = new THREE.Mesh(flameGeometry, flameMaterial)
		this.engineFlame.position.set(0, 0, 10.5)
		this.engineFlame.visible = false
		this.engineGroup.add(this.engineFlame)

		this.engineLight = new THREE.PointLight(0x66ccff, 0, 30, 2)
		this.engineLight.position.set(0, 0, 8)
		this.engineGroup.add(this.engineLight)
	}

	createSpeedStreaks() {
		const count = 90
		const positions = new Float32Array(count * 3)
		for (let i = 0; i < count; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 90
			positions[i * 3 + 1] = (Math.random() - 0.5) * 55
			positions[i * 3 + 2] = Math.random() * 160 - 80
		}

		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)
		this.own(geometry)

		const material = new THREE.PointsMaterial({
			color: 0xcceeff,
			size: 0.55,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		this.own(material)

		this.speedStreaks = new THREE.Points(geometry, material)
		this.speedStreaks.name = 'speed-streaks'
		this.shipGroup.add(this.speedStreaks)
	}

	updateFlightEffects(delta, timeScale) {
		const dt = delta * timeScale
		this.elapsedTime += dt
		const speedRatio = THREE.MathUtils.clamp(
			this.velocity.length() / Math.max(this.maxSpeed, 1),
			0,
			1
		)

		const targetBank = this.input.left
			? this.bankAmount
			: this.input.right
				? -this.bankAmount
				: 0
		const bankT = 1 - Math.exp(-this.bankSmoothing * dt)
		this.visualGroup.rotation.z = THREE.MathUtils.lerp(
			this.visualGroup.rotation.z,
			targetBank,
			bankT
		)

		const targetEngine = this.input.forward
			? 1
			: this.input.backward
				? 0.3
				: 0
		this.engineIntensity = THREE.MathUtils.lerp(
			this.engineIntensity,
			targetEngine,
			1 - Math.exp(-9 * dt)
		)

		if (this.engineFlame) {
			this.engineFlame.visible = this.engineIntensity > 0.03
			const pulse =
				0.9 + Math.sin(this.elapsedTime * 28) * 0.12
			this.engineFlame.scale.set(
				0.7 + this.engineIntensity * 0.45,
				0.7 + this.engineIntensity * 0.45,
				pulse * (0.45 + this.engineIntensity * 1.2)
			)
			this.engineFlame.material.opacity =
				0.25 + this.engineIntensity * 0.65
			this.engineLight.intensity = this.engineIntensity * 8
		}

		if (this.speedStreaks) {
			this.speedStreaks.material.opacity =
				THREE.MathUtils.clamp(
					(speedRatio - 0.12) * 1.15,
					0,
					0.8
				)
			this.speedStreaks.material.size =
				0.35 + speedRatio * 0.85
			const positions =
				this.speedStreaks.geometry.attributes.position
			for (let i = 0; i < positions.count; i++) {
				let z =
					positions.getZ(i) +
					(18 + speedRatio * 150) * dt
				if (z > 80) z = -80
				positions.setZ(i, z)
			}
			positions.needsUpdate = true
		}
	}

	setupInitialShipRotation() {
		this.shipGroup.rotation.y = Math.PI
	}

	setupInitialCamera() {
		const camera = this.level.sceneManager.camera
		if (!camera) return

		const desiredPosition = this.cameraOffset
			.clone()
			.applyQuaternion(this.shipGroup.quaternion)
			.add(this.position)

		camera.position.set(
			desiredPosition.x,
			desiredPosition.y,
			desiredPosition.z
		)

		const lookTarget = this.cameraLookAhead
			.clone()
			.applyQuaternion(this.shipGroup.quaternion)
			.add(this.position)
		camera.lookAt(lookTarget)
	}

	bindInput() {
		this._onKeyDown = (e) => this.setKey(e.code, true)
		this._onKeyUp = (e) => this.setKey(e.code, false)
		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('keyup', this._onKeyUp)
	}

	setKey(code, isDown) {
		switch (code) {
			case 'KeyW':
			case 'ArrowUp':
				this.input.forward = isDown
				break
			case 'KeyS':
			case 'ArrowDown':
				this.input.backward = isDown
				break
			case 'KeyA':
			case 'ArrowLeft':
				this.input.left = isDown
				break
			case 'KeyD':
			case 'ArrowRight':
				this.input.right = isDown
				break
			case 'KeyQ':
				this.input.pitchUp = isDown
				break
			case 'KeyE':
				this.input.pitchDown = isDown
				break
		}
	}

	dispose() {
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
	}

	updateCamera(delta, timeScale) {
		const camera = this.level.sceneManager.camera
		if (!camera) return

		const dt = delta * timeScale

		const speedRatio = THREE.MathUtils.clamp(
			this.velocity.length() / Math.max(this.maxSpeed, 1),
			0,
			1
		)
		const dynamicOffset = this.cameraOffset.clone()
		dynamicOffset.z += speedRatio * 10
		dynamicOffset.y += speedRatio * 2

		const desiredPosition = dynamicOffset
			.applyQuaternion(this.shipGroup.quaternion)
			.add(this.position)

		// A small acceleration shake makes thrust readable without making the
		// camera uncomfortable while coasting.
		if (this.input.forward && speedRatio > 0.08) {
			const shake = 0.08 + speedRatio * 0.16
			desiredPosition.x +=
				Math.sin(this.elapsedTime * 37) * shake
			desiredPosition.y +=
				Math.cos(this.elapsedTime * 43) * shake
		}

		const t = 1 - Math.exp(-this.cameraSmoothing * dt)
		camera.position.lerp(desiredPosition, t)

		const targetFov = this.baseCameraFov + speedRatio * 10
		const nextFov = THREE.MathUtils.lerp(
			camera.fov,
			targetFov,
			1 - Math.exp(-4 * dt)
		)
		if (Math.abs(nextFov - camera.fov) > 0.01) {
			camera.fov = nextFov
			camera.updateProjectionMatrix()
		}

		const lookTarget = this.cameraLookAhead
			.clone()
			.applyQuaternion(this.shipGroup.quaternion)
			.add(this.position)
		camera.lookAt(lookTarget)
	}

	updatePhysics(delta, timeScale) {
		const dt = delta * timeScale

		// Steering
		if (this.input.left) this.shipGroup.rotateY(this.turnSpeed * dt)
		if (this.input.right)
			this.shipGroup.rotateY(-this.turnSpeed * dt)
		if (this.input.pitchUp)
			this.shipGroup.rotateX(this.pitchSpeed * dt)
		if (this.input.pitchDown)
			this.shipGroup.rotateX(-this.pitchSpeed * dt)

		const r = this.blackHole.getSignedDistance(this.position)
		const gravityDir = this.blackHole.getGravityDirection()
		if (DEBUG) {
			console.log(`Velocity: `, this.velocity.length())
			console.log(`Distance: `, r)
		}
		this.velocity.addScaledVector(
			gravityDir,
			this.blackHole.getGravityStrength() * dt
		)

		if (this.input.forward || this.input.backward) {
			const forward = new THREE.Vector3(
				0,
				0,
				-1
			).applyQuaternion(this.shipGroup.quaternion)
			const power = this.input.forward
				? this.thrustPower
				: -this.thrustPower * this.reverseFactor
			this.velocity.addScaledVector(forward, power * dt)
		} else {
			this.velocity.multiplyScalar(
				Math.pow(this.dragFactor, dt)
			)
		}

		if (this.velocity.length() > this.maxSpeed)
			this.velocity.setLength(this.maxSpeed)

		this.position.addScaledVector(this.velocity, dt)
		this.shipGroup.position.copy(this.position)
		this.updateFlightEffects(delta, timeScale)

		if (this.blackHole.isBeyondEventHorizon(this.position))
			this.onCaptured?.()
	}
}
