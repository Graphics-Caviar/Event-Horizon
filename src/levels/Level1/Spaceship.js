import * as THREE from 'three'

const DEBUG = true

export class Spaceship {
	constructor(level, blackHole) {
		this.level = level
		this.blackHole = blackHole

		this.collisionRadius = 10 // rough fit for the cone (radius 6, height 18) — tune to taste
		this.onAsteroidCollision = null

		this.shipGroup = new THREE.Group()
		this.shipGroup.name = 'spaceship'
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
		this.shipGroup.add(this.mesh)
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

		const desiredPosition = this.cameraOffset
			.clone()
			.applyQuaternion(this.shipGroup.quaternion)
			.add(this.position)

		const t = 1 - Math.exp(-this.cameraSmoothing * dt)
		camera.position.lerp(desiredPosition, t)

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

		if (this.blackHole.isBeyondEventHorizon(this.position))
			this.onCaptured?.()
	}
}
