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

		// Visuals are separated from the physics group so banking, the
		// climb/dive tilt and engine animation never change the direction
		// used by the flight controller. (Mpilo's PR #13 and this branch both
		// introduced this group independently; it is now shared.)
		this.visualGroup = new THREE.Group()
		this.visualGroup.name = 'spaceship-visuals'
		this.shipGroup.add(this.visualGroup)
		this.createSpaceship()
		this.addObject(this.shipGroup)

		this.position = new THREE.Vector3(0, 0, 300)
		this.velocity = new THREE.Vector3(0, 0, 0)
		this.shipGroup.position.copy(this.position)
		this.setupInitialShipRotation()

		this.thrustPower = handling.thrustPower ?? 100 // forward acceleration while held
		this.reverseFactor = 0.4 // reverse thrust is weaker than forward
		this.turnSpeed = handling.turnSpeed ?? 1.5 // yaw, rad/sec
		this.dragFactor = 0.5 // fraction of velocity kept per second when coasting
		// Used to be gravity * 1.01, read once at construction. Gravity now
		// ramps during the run, so the ceiling is its own tuning value.
		this.maxSpeed = handling.maxSpeed ?? 110
		this.originalMax = this.maxSpeed
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
			up: false,
			down: false,
		}
		this.bindInput()

		// Pulled back from (0, 8, 25): with a real ship model that close, the
		// hull filled the bottom half of the screen and hid the asteroids.
		this.cameraOffset = new THREE.Vector3(0, 9, 44)
		this.cameraLookAhead = new THREE.Vector3(0, 4, -60)
		this.cameraSmoothing = 5
		// Speed-reactive camera and engine effects (Mpilo, PR #13).
		this.baseCameraFov = this.level.sceneManager.camera?.fov || 75
		this.bankAmount = 0.42
		this.bankSmoothing = 7
		this.engineIntensity = 0
		this.elapsedTime = 0
		this.nitrogenBoost = false
		this.nitrogenTimer = 0

		this.createEngineEffects()
		this.createSpeedStreaks()
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
		this.mesh.name = 'spaceship-loading-fallback'
		this.visualGroup.add(this.mesh)
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
			this.visualGroup.add(this.model)
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

	createEngineEffects() {
		this.engineGroup = new THREE.Group()
		this.engineGroup.name = 'engine-effects'
		// Mpilo tuned these positions for ships fitted to 18 units; scale
		// with SHIP_LENGTH so the flame still leaves the tail.
		this.engineGroup.scale.setScalar(SHIP_LENGTH / 18)
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

		// Bank into turns (roll, z). The climb/dive tilt is pitch (x) on the
		// same group, set in updatePhysics, so the two never fight.
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
			// Q/E lift and drop the ship straight up/down (vertical
			// thrusters). They used to pitch the nose, which only changed
			// height indirectly — and only while thrusting.
			case 'KeyQ':
				this.input.up = isDown
				break
			case 'KeyE':
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
		// The speed-reactive FOV widens the SHARED camera. Without restoring
		// it, the menu and hangar would render zoomed out after a run, and
		// each retry would read the widened FOV as its new baseline.
		const camera = this.level.sceneManager.camera
		if (camera && camera.fov !== this.baseCameraFov) {
			camera.fov = this.baseCameraFov
			camera.updateProjectionMatrix()
		}
	}

	applyNitrogenBoost() {
		this.nitrogenBoost = true
		this.nitrogenTimer += 50
		this.maxSpeed = this.originalMax * 2
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

		// Steering: A/D turn the ship left/right. The nose always stays
		// level (Q/E move straight up/down instead), so forward thrust
		// never points the ship into or out of the screen by accident.
		if (this.input.left) this.shipGroup.rotateY(this.turnSpeed * dt)
		if (this.input.right)
			this.shipGroup.rotateY(-this.turnSpeed * dt)

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

		if (
			(this.input.forward || this.input.backward) &&
			this.velocity.length() < this.maxSpeed
		) {
			const forward = new THREE.Vector3(
				0,
				0,
				-1
			).applyQuaternion(this.shipGroup.quaternion)
			const power = this.input.forward
				? this.thrustPower
				: -this.thrustPower * this.reverseFactor
			this.velocity.addScaledVector(forward, power * dt)
			if (this.nitrogenBoost) {
				this.velocity.z += 5
			}
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
		this.visualGroup.rotation.x = this._tilt

		if (this.velocity.length() > this.maxSpeed)
			this.velocity.z -= 20

		this.position.addScaledVector(this.velocity, dt)
		this.shipGroup.position.copy(this.position)
		this.updateFlightEffects(delta, timeScale)

		if (this.blackHole.isBeyondEventHorizon(this.position)) {
			this.onCaptured?.()
		}

		if (this.nitrogenTimer > 0) {
			this.nitrogenTimer -= 1
		}
		if (this.nitrogenTimer <= 0 && this.nitrogenBoost) {
			this.nitrogenBoost = false
			this.maxSpeed = this.originalMax ?? 110
		}
	}
}
