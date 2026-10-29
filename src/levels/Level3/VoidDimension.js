import * as THREE from 'three'
import { VoidSpaceBackdrop } from './VoidSpaceBackdrop.js'
import { VoidBoss } from './VoidBoss.js'

// Player gun settings inside the void dimension
const GUN_DAMAGE = 35 // damage per bullet that hits the boss
const GUN_COOLDOWN = 0.22 // seconds between shots
const BULLET_SPEED = 85 // m/s
const BULLET_RADIUS = 1.8 // hit sphere against the boss body
const BOSS_DAMAGE = 18 // HP the player loses per fireball hit
const PLAYER_MAX_HP = 100 // pool for the void boss fight (mirrors level HP)

/** A separate, explorable zero-gravity space beyond the Matter wormhole.
 *  Now hosts the final Void Devourer boss encounter. */
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
						size: 1.5,
						sizeAttenuation: false,
					})
				)
			)
		)
		this.spaceBackdrop = new VoidSpaceBackdrop(level, this.group)
		this.shards = this.spaceBackdrop.shards
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
		this.cameraTarget = new THREE.Vector3()
		this.cameraYaw = 0
		this.cameraPitch = -0.2
		this.cameraDistance = 12
		this._lookDragging = false
		this._lastPointerX = 0
		this._lastPointerY = 0
		this._cameraDirection = new THREE.Vector3()
		this._aimDirection = new THREE.Vector3()
		this._aimRaycaster = new THREE.Raycaster()
		this._aimScreenPoint = new THREE.Vector2(0, 0.12)
		this.aimTarget = new THREE.Vector3()
		this._gunForward = new THREE.Vector3(0, 0, 1)
		this._gunAimDirection = new THREE.Vector3()
		this._gunWorldPosition = new THREE.Vector3()
		this._gunParentQuaternion = new THREE.Quaternion()
		this._gunHandPosition = new THREE.Vector3()
		this._gunGripOffset = new THREE.Vector3()
		this._gunGripLocal = new THREE.Vector3(0, -0.19, 0.01)
		this._weaponShoulder = new THREE.Vector3()
		this._weaponElbow = new THREE.Vector3()
		this._armDirection = new THREE.Vector3()
		this._armUp = new THREE.Vector3(0, 1, 0)
		this._gunMuzzleLocal = new THREE.Vector3(0, 0, 0.88)
		this.gun = this._buildBossGun()
		this._attachGunToPilot()
		this._updateCamera()

		// ── Boss fight setup ────────────────────────────────────────────────
		// The arena is centred close to the first navigation beacon,
		// giving the player space to manoeuvre before reaching the exit.
		const arenaCenter = new THREE.Vector3(0, 8, -48)
		this.boss = new VoidBoss(this.group, arenaCenter)

		// Player HP for the void boss fight (separate from the main level pool
		// so we do not destroy level state; synced to level.playerHP visually).
		this._playerHP = PLAYER_MAX_HP
		this._gunCooldown = 0
		this._bullets = []
		this._bossDefeated = false
		this._playerDefeated = false

		// Gun bullet geometry + material (created once, pooled)
		this._bulletMat = own(
			new THREE.MeshBasicMaterial({
				color: 0x00ffee,
				transparent: true,
				opacity: 0.92,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this._bulletGeo = own(new THREE.SphereGeometry(0.28, 6, 6))

		// HUD overlay elements
		this._buildBossHUD()

		// Right-drag aims by orbiting the view; left-click fires independently.
		this._onPointerDown = (e) => {
			if (e.button === 0) {
				level._mouseDown = true
			}
			if (e.button === 2) {
				this._lookDragging = true
				this._lastPointerX = e.clientX
				this._lastPointerY = e.clientY
				e.preventDefault()
			}
		}
		this._onPointerMove = (e) => {
			if (!this._lookDragging) return
			const dx = e.clientX - this._lastPointerX
			const dy = e.clientY - this._lastPointerY
			this._lastPointerX = e.clientX
			this._lastPointerY = e.clientY
			this.cameraYaw -= dx * 0.004
			this.cameraPitch = THREE.MathUtils.clamp(
				this.cameraPitch + dy * 0.004,
				-1.05,
				0.78
			)
			e.preventDefault()
		}
		this._onPointerUp = (e) => {
			if (e.type === 'pointercancel') {
				level._mouseDown = false
				this._lookDragging = false
				return
			}
			if (e.button === 0) {
				level._mouseDown = false
			}
			if (e.button === 2) this._lookDragging = false
		}
		this._onContextMenu = (e) => e.preventDefault()
		this._onWheel = (e) => {
			if (e.ctrlKey) return
			e.preventDefault()
			this.cameraDistance = THREE.MathUtils.clamp(
				this.cameraDistance + e.deltaY * 0.012,
				6,
				28
			)
		}
		window.addEventListener('pointerdown', this._onPointerDown)
		window.addEventListener('pointerup', this._onPointerUp)
		window.addEventListener('pointermove', this._onPointerMove)
		window.addEventListener('pointercancel', this._onPointerUp)
		window.addEventListener('contextmenu', this._onContextMenu)
		this._wheelTarget = level.sceneManager.renderer?.domElement
		this._wheelTarget?.addEventListener('wheel', this._onWheel, {
			passive: false,
		})
	}

	// ── Boss HUD ────────────────────────────────────────────────────────────

	_buildBossHUD() {
		// Inject a minimal DOM HUD overlay for the void boss fight.
		// Reuses the existing level HUD container if possible.
		this._bossHudEl = document.createElement('div')
		this._bossHudEl.id = 'void-boss-hud'
		Object.assign(this._bossHudEl.style, {
			position: 'fixed',
			bottom: '28px',
			left: '50%',
			transform: 'translateX(-50%)',
			background: 'rgba(0,0,0,0.65)',
			color: '#fff',
			fontFamily: 'monospace',
			fontSize: '13px',
			padding: '10px 22px 10px',
			borderRadius: '6px',
			textAlign: 'center',
			pointerEvents: 'none',
			zIndex: '999',
			minWidth: '340px',
		})
		this._bossHudEl.innerHTML = this._bossHudHTML()
		document.body.appendChild(this._bossHudEl)
		this._aimReticleEl = document.createElement('div')
		this._aimReticleEl.id = 'void-aim-reticle'
		Object.assign(this._aimReticleEl.style, {
			position: 'fixed',
			left: '50%',
			// Keep the sight clear of the pilot's face in the chase camera.
			top: '44%',
			width: '22px',
			height: '22px',
			transform: 'translate(-50%, -50%)',
			background: 'linear-gradient(rgba(120,245,255,.95),rgba(120,245,255,.95)) center top / 1px 6px no-repeat, linear-gradient(rgba(120,245,255,.95),rgba(120,245,255,.95)) center bottom / 1px 6px no-repeat, linear-gradient(rgba(120,245,255,.95),rgba(120,245,255,.95)) left center / 6px 1px no-repeat, linear-gradient(rgba(120,245,255,.95),rgba(120,245,255,.95)) right center / 6px 1px no-repeat',
			filter: 'drop-shadow(0 0 3px rgba(70,235,255,.9))',
			pointerEvents: 'none',
			zIndex: '1000',
		})
		const aimDot = document.createElement('span')
		Object.assign(aimDot.style, {
			position: 'absolute',
			width: '3px',
			height: '3px',
			left: '50%',
			top: '50%',
			transform: 'translate(-50%, -50%)',
			borderRadius: '50%',
			background: '#e8fdff',
		})
		this._aimReticleEl.appendChild(aimDot)
		document.body.appendChild(this._aimReticleEl)
	}

	_updateCamera() {
		const camera = this.level.sceneManager.camera
		this.cameraTarget.copy(this.level.playerRoot.position)
		this.cameraTarget.y += 1.5
		const cosPitch = Math.cos(this.cameraPitch)
		this._cameraDirection.set(
			Math.sin(this.cameraYaw) * cosPitch,
			Math.sin(this.cameraPitch),
			-Math.cos(this.cameraYaw) * cosPitch
		)
		this._cameraDirection.normalize()
		camera.position
			.copy(this.cameraTarget)
			.addScaledVector(
				this._cameraDirection,
				-this.cameraDistance
			)
		camera.lookAt(this.cameraTarget)
	}

	_buildBossGun() {
		const gun = new THREE.Group()
		gun.name = 'void-boss-sidearm'
		const own = (resource) => {
			this.resources.push(resource)
			return resource
		}
		const frame = own(
			new THREE.MeshStandardMaterial({
				color: 0x718596,
				emissive: 0x152635,
				emissiveIntensity: 0.55,
				metalness: 0.82,
				roughness: 0.3,
			})
		)
		const dark = own(
			new THREE.MeshStandardMaterial({
				color: 0x354552,
				emissive: 0x0b1822,
				emissiveIntensity: 0.35,
				metalness: 0.42,
				roughness: 0.68,
			})
		)
		const cyan = own(
			new THREE.MeshStandardMaterial({
				color: 0x65f2ff,
				emissive: 0x13bcd5,
				emissiveIntensity: 1.8,
				metalness: 0.3,
				roughness: 0.25,
			})
		)
		const addPart = (geometry, material, position, rotation) => {
			const mesh = new THREE.Mesh(own(geometry), material)
			mesh.position.set(...position)
			if (rotation) mesh.rotation.set(...rotation)
			mesh.castShadow = true
			gun.add(mesh)
			return mesh
		}
		addPart(
			new THREE.BoxGeometry(0.23, 0.17, 0.48),
			frame,
			[0, 0, 0.2]
		)
		addPart(
			new THREE.BoxGeometry(0.17, 0.27, 0.14),
			dark,
			[0, -0.19, 0.01],
			[0.16, 0, 0]
		)
		addPart(
			new THREE.BoxGeometry(0.12, 0.19, 0.17),
			dark,
			[0, 0.17, 0.12]
		)
		addPart(
			new THREE.CylinderGeometry(0.05, 0.065, 0.38, 12),
			frame,
			[0, 0.01, 0.59],
			[Math.PI / 2, 0, 0]
		)
		addPart(
			new THREE.CylinderGeometry(0.075, 0.07, 0.035, 12),
			cyan,
			[0, 0.01, 0.8],
			[Math.PI / 2, 0, 0]
		)
		addPart(
			new THREE.BoxGeometry(0.18, 0.035, 0.16),
			dark,
			[0, 0.105, 0.27]
		)
		addPart(
			new THREE.BoxGeometry(0.035, 0.035, 0.12),
			cyan,
			[0, 0.13, 0.25]
		)
		return gun
	}

	_attachGunToPilot() {
		const model = this.level.pilotModel
		if (!model || this.gun.parent === model) return
		this.gun.removeFromParent()
		model.updateWorldMatrix(true, true)
		const inverseModel = model.matrixWorld.clone().invert()
		const bounds = new THREE.Box3()
		model.traverse((node) => {
			if (!node.isMesh) return
			node.geometry.computeBoundingBox()
			const localMatrix = inverseModel
				.clone()
				.multiply(node.matrixWorld)
			bounds.union(
				node.geometry.boundingBox
					.clone()
					.applyMatrix4(localMatrix)
			)
		})
		const size = bounds.getSize(new THREE.Vector3())
		this._gunHandPosition.set(
			bounds.max.x - size.x * 0.3,
			bounds.min.y + size.y * 0.52,
			bounds.max.z * 0.1
		)
		this._buildWeaponArm(model, size)
		this.gun.position.copy(this._gunHandPosition)
		model.add(this.gun)
	}

	_buildWeaponArm(model, size) {
		this.weaponArm?.removeFromParent()
		this._weaponModelSize = size.clone()
		this.weaponArm = new THREE.Group()
		this.weaponArm.name = 'pilot-right-arm-holding-void-gun'
		const own = (resource) => {
			this.resources.push(resource)
			return resource
		}
		const sleeve = own(
			new THREE.MeshStandardMaterial({
				color: 0x354a5b,
				metalness: 0.32,
				roughness: 0.62,
				emissive: 0x101c2b,
				emissiveIntensity: 0.4,
			})
		)
		const glove = own(
			new THREE.MeshStandardMaterial({
				color: 0x17232e,
				metalness: 0.25,
				roughness: 0.8,
			})
		)
		const limbGeometry = own(
			new THREE.CylinderGeometry(0.065, 0.09, 1, 10)
		)
		const jointGeometry = own(
			new THREE.SphereGeometry(0.085, 10, 8)
		)
		const makeMesh = (geometry, material) => {
			const mesh = new THREE.Mesh(geometry, material)
			mesh.castShadow = true
			mesh.receiveShadow = true
			this.weaponArm.add(mesh)
			return mesh
		}
		this.weaponArm.upperArm = makeMesh(limbGeometry, sleeve)
		this.weaponArm.forearm = makeMesh(limbGeometry, sleeve)
		this.weaponArm.shoulder = makeMesh(jointGeometry, sleeve)
		this.weaponArm.elbow = makeMesh(jointGeometry, sleeve)
		this.weaponArm.glove = makeMesh(
			own(new THREE.SphereGeometry(0.095, 12, 10)),
			glove
		)
		model.add(this.weaponArm)
		this._updateWeaponArm()
	}

	_updateWeaponArm() {
		if (!this.weaponArm) return
		const { x: width, y: height } = this._weaponModelSize
		const hand = this._gunHandPosition
		const shoulder = this._weaponShoulder.set(
			hand.x - width * 0.19,
			hand.y + height * 0.19,
			hand.z
		)
		const elbow = this._weaponElbow.set(
			hand.x - width * 0.08,
			hand.y + height * 0.1,
			hand.z + this._weaponModelSize.z * 0.12
		)
		this._placeArmSegment(this.weaponArm.upperArm, shoulder, elbow)
		this._placeArmSegment(this.weaponArm.forearm, elbow, hand)
		this.weaponArm.shoulder.position.copy(shoulder)
		this.weaponArm.elbow.position.copy(elbow)
		this.weaponArm.glove.position.copy(hand)
	}

	_placeArmSegment(mesh, start, end) {
		const direction = this._armDirection.subVectors(end, start)
		mesh.position.copy(start).add(end).multiplyScalar(0.5)
		mesh.quaternion.setFromUnitVectors(
			this._armUp,
			direction.normalize()
		)
		mesh.scale.y = start.distanceTo(end)
	}

	_aimGunAtView() {
		if (!this.gun.parent) return
		const camera = this.level.sceneManager.camera
		camera.updateWorldMatrix(true, false)
		this._aimRaycaster.setFromCamera(this._aimScreenPoint, camera)
		this._aimDirection.copy(this._aimRaycaster.ray.direction)
		this.aimTarget
			.copy(camera.position)
			.addScaledVector(this._aimDirection, 1000)
		this.gun.updateWorldMatrix(true, false)
		this.gun.getWorldPosition(this._gunWorldPosition)
		this._gunAimDirection
			.subVectors(this.aimTarget, this._gunWorldPosition)
			.normalize()
		this.gun.parent
			.getWorldQuaternion(this._gunParentQuaternion)
			.invert()
		this._gunAimDirection.applyQuaternion(this._gunParentQuaternion)
		this.gun.quaternion.setFromUnitVectors(
			this._gunForward,
			this._gunAimDirection
		)
		this._gunGripOffset
			.copy(this._gunGripLocal)
			.applyQuaternion(this.gun.quaternion)
			.multiplyScalar(this.gun.scale.x)
		this.gun.position
			.copy(this._gunHandPosition)
			.sub(this._gunGripOffset)
		this._updateWeaponArm()
	}

	_bossHudHTML() {
		const phf = Math.max(
			0,
			Math.round((this._playerHP / PLAYER_MAX_HP) * 100)
		)
		const bhf = Math.max(
			0,
			Math.round(
				((this.boss?.hp ?? 0) /
					(this.boss?.maxHp ?? 1)) *
					100
			)
		)
		return (
			`<div style="margin-bottom:6px;color:#8ef3ff;letter-spacing:1px">▶ VOID BOSS FIGHT ◀</div>` +
			`<div style="margin-bottom:3px">YOUR HP &nbsp;<span style="color:${phf > 50 ? '#44ff88' : phf > 25 ? '#ffb347' : '#ff4444'}">${phf}%</span> &nbsp;|&nbsp; ` +
			`BOSS HP &nbsp;<span style="color:${bhf > 50 ? '#ff4400' : bhf > 25 ? '#ff8800' : '#ffee00'}">${bhf}%</span></div>` +
			`<div style="font-size:10px;opacity:.75;margin-top:4px">` +
			`WASD fly · Space rise · C descend · Right-drag to aim · Crosshair marks your shot · Left-click or E to fire · Wheel zoom</div>`
		)
	}

	_updateBossHUD() {
		if (this._bossHudEl)
			this._bossHudEl.innerHTML = this._bossHudHTML()
	}

	// ── Gun / shooting ───────────────────────────────────────────────────────

	_tryShoot(playerPos) {
		// Fire from the pilot's weapon muzzle toward the center-screen aim point.
		const dir = new THREE.Vector3()
		let origin = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0))
		if (this.gun.parent) {
			this.gun.updateWorldMatrix(true, false)
			origin = this._gunMuzzleLocal
				.clone()
				.applyMatrix4(this.gun.matrixWorld)
		}
		dir.subVectors(this.aimTarget, origin).normalize()

		const bullet = new THREE.Mesh(this._bulletGeo, this._bulletMat)
		bullet.position.copy(origin).addScaledVector(dir, 0.25)
		this.group.add(bullet)

		this._bullets.push({
			mesh: bullet,
			velocity: dir.clone().multiplyScalar(BULLET_SPEED),
			life: 3.5,
		})
	}

	_updateBullets(delta, playerPos) {
		for (let i = this._bullets.length - 1; i >= 0; i--) {
			const b = this._bullets[i]
			b.life -= delta
			if (b.life <= 0) {
				b.mesh.removeFromParent()
				this._bullets.splice(i, 1)
				continue
			}
			b.mesh.position.addScaledVector(b.velocity, delta)

			// Hit test against boss
			if (!this.boss.dead) {
				const dist = b.mesh.position.distanceTo(
					this.boss.position
				)
				if (
					dist <
					BULLET_RADIUS *
						3.4 /* account for boss scale */
				) {
					this.boss.receiveDamage(GUN_DAMAGE)
					b.mesh.removeFromParent()
					this._bullets.splice(i, 1)
				}
			}
		}
	}

	update(delta) {
		const l = this.level,
			dt = Math.min(delta, 0.05)
		this.time += dt
		this.spaceBackdrop.update(this.time)
		this._attachGunToPilot()
		this._updateCamera()
		l.playerRoot.visible = true
		if (l.pilotModel) l.pilotModel.visible = true
		this.pilotLight.position
			.copy(l.playerRoot.position)
			.add(new THREE.Vector3(2, 4, 4))

		if (!l.completed) {
			l.elapsedPlayTime += dt
			if (l.survivalHudEl)
				l.survivalHudEl.textContent =
					'ZERO GRAVITY // VOID BOSS ARENA'
			if (l.enemyStatusEl) l.enemyStatusEl.textContent = ''

			// ── Player movement (zero-gravity drift) ─────────────────────
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
			const speed = l.keys.has('ShiftLeft') ? 36 : 22
			l.velocity.lerp(
				this.direction.multiplyScalar(speed),
				1 - Math.exp(-dt * 3)
			)
			l.playerRoot.position.addScaledVector(l.velocity, dt)
			l.playerRoot.position.clamp(
				new THREE.Vector3(-250, -240, -480),
				new THREE.Vector3(250, 260, 140)
			)
			// Keep the pilot in a floating pose and show the jetpack plumes while
			// drifting, so movement reads as powered flight instead of walking.
			const flying = l.velocity.lengthSq() > 0.35
			for (const jet of l.jets ?? []) {
				jet.visible = flying
				jet.scale.y =
					0.9 + Math.sin(this.time * 38) * 0.12
			}
			l.thrusting = flying
			l.pilotWalk?.update(dt, 0, true)

			// ── Boss fight logic ─────────────────────────────────────────
			if (!this._bossDefeated && !this._playerDefeated) {
				const playerPos = l.playerRoot.position
				this._aimGunAtView()

				// Update boss AI + fireballs
				this.boss.update(dt, playerPos)

				// Fireball hit: deduct player HP
				if (this.boss.pendingHit) {
					this._playerHP = Math.max(
						0,
						this._playerHP - BOSS_DAMAGE
					)
					// Sync to level HP so the main HUD bar reacts
					l.playerHP = Math.round(
						(this._playerHP /
							PLAYER_MAX_HP) *
							(l.maxPlayerHP ?? 100)
					)
					// Flash the HUD
					l.hud?.setWarning?.(true)
					setTimeout(
						() =>
							l.hud?.setWarning?.(
								false
							),
						600
					)
					if (this._playerHP <= 0) {
						this._playerDefeated = true
						this._showOutcome(false)
					}
				}

				// Boss defeated
				if (this.boss.won && !this._bossDefeated) {
					this._bossDefeated = true
					l._bossDefeated = true
					this._showOutcome(true)
					l._completeMission()
					return
				}

				// Player gun: Left-click or E key fires
				this._gunCooldown = Math.max(
					0,
					this._gunCooldown - dt
				)
				const shooting =
					l.keys.has('KeyE') || l._mouseDown
				if (shooting && this._gunCooldown <= 0) {
					this._gunCooldown = GUN_COOLDOWN
					this._tryShoot(playerPos.clone())
				}
				this._updateBullets(dt, playerPos)

				// Update objective text
				const bossHpPct = Math.round(
					(this.boss.hp / this.boss.maxHp) * 100
				)
				const myHpPct = Math.round(
					(this._playerHP / PLAYER_MAX_HP) * 100
				)
				l.objectiveEl.innerHTML =
					`<strong>VOID BOSS FIGHT</strong><br>` +
					`<span style="color:#ff4400">VOID DEVOURER ${bossHpPct}% HP</span>` +
					` &nbsp;|&nbsp; ` +
					`<span style="color:#44ff88">YOUR HP ${myHpPct}%</span><br>` +
					`<span style="font-size:11px;opacity:.8">` +
					`Dodge fireballs (C descend / Space rise). Right-drag to aim, then left-click or E to shoot!` +
					`</span>`

				this._updateBossHUD()
			} else if (this._playerDefeated) {
				// Player died — game over handled by _showOutcome
			}
		}

		// ── Environment animations ────────────────────────────────────────
		// Camera follows the pilot while preserving the player's orbit angle.
		this._updateCamera()
	}

	// ── Outcome banner ───────────────────────────────────────────────────────

	_showOutcome(won) {
		const el = document.createElement('div')
		el.id = 'void-boss-outcome'
		Object.assign(el.style, {
			position: 'fixed',
			top: '50%',
			left: '50%',
			transform: 'translate(-50%,-50%)',
			background: won
				? 'rgba(0,40,0,0.88)'
				: 'rgba(40,0,0,0.88)',
			color: won ? '#44ff88' : '#ff4444',
			fontFamily: 'monospace',
			fontSize: '28px',
			fontWeight: 'bold',
			padding: '36px 56px',
			borderRadius: '10px',
			textAlign: 'center',
			zIndex: '9999',
			pointerEvents: 'none',
			letterSpacing: '2px',
		})
		el.innerHTML = won
			? '⚡ VOID BOSS KILLED ⚡<br><span style="font-size:16px;opacity:.8">GAME COMPLETE</span>'
			: '☠ DEVOURED BY THE VOID ☠<br><span style="font-size:16px;opacity:.8">You were overwhelmed</span>'
		document.body.appendChild(el)
		this._outcomeEl = el
		// If player lost, trigger game-over after a delay
		if (!won) {
			setTimeout(() => {
				this.level.playerHP = 0
				this.level._gameOver?.()
			}, 2200)
		}
	}

	dispose() {
		this.spaceBackdrop.dispose()
		this.boss?.dispose()
		// Clean up bullets
		for (const b of this._bullets ?? []) b.mesh.removeFromParent()
		// Remove mouse listeners
		if (this._onPointerDown)
			window.removeEventListener(
				'pointerdown',
				this._onPointerDown
			)
		if (this._onPointerUp)
			window.removeEventListener(
				'pointerup',
				this._onPointerUp
			)
		if (this._onPointerMove)
			window.removeEventListener(
				'pointermove',
				this._onPointerMove
			)
		if (this._onPointerUp)
			window.removeEventListener(
				'pointercancel',
				this._onPointerUp
			)
		if (this._onContextMenu)
			window.removeEventListener(
				'contextmenu',
				this._onContextMenu
			)
		this._wheelTarget?.removeEventListener('wheel', this._onWheel)
		this.level._mouseDown = false
		this.gun?.removeFromParent()
		this.weaponArm?.removeFromParent()
		// Remove HUD overlays
		this._bossHudEl?.remove()
		this._aimReticleEl?.remove()
		this._outcomeEl?.remove()
		this.level.sceneManager.camera.far = this.previousFar
		this.level.sceneManager.camera.updateProjectionMatrix()
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
		for (const [object, visible] of this.hidden)
			object.visible = visible
		Object.assign(this.level.sceneManager.scene, this.previous)
	}
}
