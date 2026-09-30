import * as THREE from 'three'

// Per-frame velocity/distance logging. Keep this off: at 60fps it wrote
// ~120 console lines a second, which measurably costs frame time.
const DEBUG = false

/** World-space length the selected ship model is fitted to. The original
 * placeholder cone was 18 long; asteroids are roughly 4-14 across. */
const SHIP_LENGTH = 16

/**
 * Turn applied to each ship model so its nose points down local -z, the
 * direction updatePhysics() thrusts along.
 *
 * These are measured, not guessed: each model was rendered top-down against
 * a forward marker. They are single merged meshes normalised into a near
 * cube (the Starfighter is 1.98 wide x 1.95 long), so there is no reliable
 * "long axis" to infer orientation from — an automatic guess flew the
 * Starfighter backwards. Uncorrected, all three flew backwards or sideways.
 * If a model file is replaced, re-check its entry here.
 */
const MODEL_YAW = {
	vanguard: Math.PI, // authored nose towards +z
	starfighter: -Math.PI / 2, // authored nose towards -x
	aegis: Math.PI, // authored nose towards +z
}

export class Spaceship {
	/**
	 * @param {object} level
	 * @param {object} blackHole
	 * @param {object} [options]
	 * @param {string} [options.shipKey] which ship the player picked
	 * @param {string|string[]} [options.modelPath] GLB path(s) to fly
	 * @param {object} [options.handling] per-ship tuning (Level1.handlingFor)
	 */
	constructor(
		level,
		blackHole,
		{ shipKey, modelPath, handling = {} } = {}
	) {
		this.level = level
		this.blackHole = blackHole
		this.shipKey = shipKey

		// Roughly the hull's half-width once fitted to SHIP_LENGTH. Ships are
		// long and thin, so a sphere this size is fairer than one enclosing
		// the whole length.
		this.collisionRadius = 6
		this.onAsteroidCollision = null

		this.shipGroup = new THREE.Group()
		this.shipGroup.name = 'spaceship'
		this.createSpaceship()
		this.addObject(this.shipGroup)

		this.position = new THREE.Vector3(0, 0, 300)
		this.velocity = new THREE.Vector3(0, 0, 0)
		this.shipGroup.position.copy(this.position)
		this.setupInitialShipRotation()

		this.thrustPower = handling.thrustPower ?? 100 // forward acceleration while held
		this.reverseFactor = 0.4 // reverse thrust is weaker than forward
		this.turnSpeed = handling.turnSpeed ?? 1.5 // yaw, rad/sec
		this.pitchSpeed = handling.pitchSpeed ?? 1.2 // pitch, rad/sec
		this.dragFactor = 0.5 // fraction of velocity kept per second when coasting
		// Used to be gravity * 1.01, read once at construction. Gravity now
		// ramps during the run, so the ceiling is its own tuning value.
		this.maxSpeed = handling.maxSpeed ?? 110
		// Vertical thrusters: push the ship straight up/down relative to
		// itself without changing its heading — the quick sidestep for
		// dodging an asteroid. Weaker than the main engine, so climbing
		// never beats simply flying away from the hole.
		this.verticalThrust =
			handling.verticalThrust ?? this.thrustPower * 0.6
		// Fraction of up/down drift kept per second once the key is let go,
		// so the ship settles instead of sliding on forever.
		this.verticalDamping = 0.05
		this._tilt = 0 // visual nose tilt while climbing/diving (radians)

		this.input = {
			forward: false,
			backward: false,
			left: false,
			right: false,
			pitchUp: false,
			pitchDown: false,
			up: false,
			down: false,
		}
		this.bindInput()

		// Pulled back from (0, 8, 25): with a real ship model that close, the
		// hull filled the bottom half of the screen and hid the asteroids.
		this.cameraOffset = new THREE.Vector3(0, 9, 44)
		this.cameraLookAhead = new THREE.Vector3(0, 4, -60)
		this.cameraSmoothing = 5
		this.setupInitialCamera()

		this.model = null
		this._disposed = false
		if (modelPath) this.loadModel(modelPath)
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

	/** True while the forward thruster is held — drives the engine audio. */
	get isThrusting() {
		return this.input.forward
	}

	createSpaceship() {
		// Placeholder, shown until the selected ship model has loaded (and
		// kept if it fails to load), so the level never renders without a ship.
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
		// Everything drawn goes in `visual`, a child of shipGroup, so the
		// climb/dive tilt is purely cosmetic: physics reads shipGroup only.
		this.visual = new THREE.Group()
		this.visual.add(this.mesh)
		this.shipGroup.add(this.visual)
	}

	/**
	 * Swap the placeholder cone for the ship the player picked in the hangar.
	 * The model is a clone of AssetManager's cached copy, so it shares
	 * geometry and materials with the hangar preview: nothing here may
	 * mutate or dispose them.
	 */
	async loadModel(pathOrPaths) {
		try {
			const model =
				await this.level.assetManager.loadModel(
					pathOrPaths
				)
			if (this._disposed) return
			this.model = this._fitModel(model)
			this.visual.add(this.model)
			this.mesh.visible = false
		} catch (error) {
			console.warn(
				'[Level1] Ship model failed to load; flying the placeholder.',
				error?.message
			)
		}
	}

	/** Orient the model nose-down local -z, scale it to SHIP_LENGTH and
	 * centre it on the ship's origin, all inside a pivot so the model's own
	 * transform is left untouched. */
	_fitModel(model) {
		const pivot = new THREE.Group()
		pivot.add(model)

		pivot.rotation.y = MODEL_YAW[this.shipKey] || 0
		pivot.updateMatrixWorld(true)

		let box = new THREE.Box3().setFromObject(pivot)
		const size = box.getSize(new THREE.Vector3())
		const longest = Math.max(size.x, size.y, size.z)
		if (longest > 0) pivot.scale.setScalar(SHIP_LENGTH / longest)
		pivot.updateMatrixWorld(true)

		box = new THREE.Box3().setFromObject(pivot)
		pivot.position.sub(box.getCenter(new THREE.Vector3()))
		return pivot
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
			case 'Space':
			case 'KeyR':
				this.input.up = isDown
				break
			// Shift for players who expect it, F because tapping Shift five
			// times on Windows opens the Sticky Keys prompt mid-game.
			case 'ShiftLeft':
			case 'ShiftRight':
			case 'KeyF':
				this.input.down = isDown
				break
		}
	}

	/** Release every key. Called on pause and window blur: a key let go
	 * while the game is not listening never sends its keyup, and would
	 * otherwise stay "held" when play resumes. */
	clearInput() {
		for (const key of Object.keys(this.input))
			this.input[key] = false
	}

	dispose() {
		this._disposed = true
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

		const gravityDir = this.blackHole.getGravityDirection()
		if (DEBUG) {
			console.log(`Velocity: `, this.velocity.length())
			console.log(
				`Distance: `,
				this.blackHole.getSignedDistance(this.position)
			)
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

		// Vertical thrusters, along the ship's own up axis so "up" always
		// matches the top of the screen in the chase camera.
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
			this.shipGroup.quaternion
		)
		const lift = (this.input.up ? 1 : 0) - (this.input.down ? 1 : 0)
		if (lift !== 0) {
			this.velocity.addScaledVector(
				up,
				lift * this.verticalThrust * dt
			)
		} else {
			// Bleed off only the up/down component; forward flight and the
			// black hole's pull are left alone.
			const drift = this.velocity.dot(up)
			const kept = Math.pow(this.verticalDamping, dt)
			this.velocity.addScaledVector(up, -drift * (1 - kept))
		}
		// Tip the nose into the climb or dive so the input reads visually.
		const tiltTarget = lift * 0.22
		this._tilt +=
			(tiltTarget - this._tilt) * (1 - Math.exp(-8 * dt))
		this.visual.rotation.x = this._tilt

		if (this.velocity.length() > this.maxSpeed)
			this.velocity.setLength(this.maxSpeed)

		this.position.addScaledVector(this.velocity, dt)
		this.shipGroup.position.copy(this.position)

		if (this.blackHole.isBeyondEventHorizon(this.position))
			this.onCaptured?.()
	}
}
