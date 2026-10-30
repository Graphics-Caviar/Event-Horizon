import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'

/**
 * VoidBoss — the final boss of the Void Dimension zero-gravity arena.
 *
 * Uses the optimized void_god GLB for its final appearance. The procedural
 * creature remains as a visual fallback if the asset fails to load.
 *
 * Performance notes (freeze prevention):
 *  - All scratch vectors are pre-allocated as instance fields; no `new
 *    THREE.Vector3` ever appears inside update().
 *  - The fireball pool is pre-warmed in the constructor with SHARED geometry
 *    so _spawnFireball() never creates geometry or materials at runtime.
 *  - The HP-bar canvas is redrawn only when the HP value actually changes.
 */

// ─── constants ────────────────────────────────────────────────────────────────

const BOSS_MAX_HP = 500
const FIREBALL_SPEED = 28 // m/s
const FIREBALL_RADIUS = 3.5 // hit-sphere radius in world units
const FIREBALL_DAMAGE = 18 // HP deducted per fireball hit
const FIREBALL_LIFE = 6 // seconds before auto-despawn
const FIREBALL_POOL = 6 // pre-warmed pool size (avoids runtime alloc)
const ORBIT_RADIUS = 38 // metres from arena centre
const ORBIT_ALTITUDE = 18 // Y above the arena centre Y
const WINDUP_TIME = 1.8 // seconds of telegraph before firing
const RECOVER_TIME = 1.2 // seconds between volleys (phase 1)
const ENRAGE_THRESHOLD = 0.33 // fraction of maxHp at which boss enrages
const BOSS_SCALE = 3.4 // world-space size multiplier
const HP_BAR_OFFSET_Y = 6 // world units above root.position for the HP bar

// ─── glow texture (shared singleton) ──────────────────────────────────────────

let _glowTex = null
const glowTexture = () => {
	if (_glowTex) return _glowTex
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d')
	const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
	g.addColorStop(0, 'rgba(255,120,0,1)')
	g.addColorStop(0.4, 'rgba(255,60,0,.5)')
	g.addColorStop(1, 'rgba(255,30,0,0)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, 64, 64)
	_glowTex = new THREE.CanvasTexture(canvas)
	return _glowTex
}

// ─── VoidBoss ─────────────────────────────────────────────────────────────────

export class VoidBoss {
	/**
	 * @param {THREE.Group}   parentGroup  scene group owned by VoidDimension
	 * @param {THREE.Vector3} arenaCenter  world position of the arena centre
	 */
	constructor(parentGroup, arenaCenter, assetManager) {
		this.arena = arenaCenter.clone()
		this.hp = BOSS_MAX_HP
		this.maxHp = BOSS_MAX_HP
		this.pendingHit = false
		this.dead = false
		this.won = false
		this._disposed = false

		// State machine
		this._state = 'idle'
		this._timer = 1.0 // small delay before first attack
		this._orbitAngle = 0
		this._orbitSpeed = 0.28 // rad/s
		this._time = 0
		this._deathT = -1
		this._hitFlash = 0
		this._jawOpen = 0
		this._lastHpDrawn = -1 // dirty flag for HP bar canvas

		// Pre-allocated scratch vectors — avoids `new THREE.Vector3` in update()
		this._scratchOrbit = new THREE.Vector3()
		this._scratchDir = new THREE.Vector3()
		this._scratchAim = new THREE.Vector3()

		this._fireballs = []
		this._resources = []
		const own = (r) => {
			this._resources.push(r)
			return r
		}

		// ── materials ──────────────────────────────────────────────────────
		this._matBody = own(
			new THREE.MeshStandardMaterial({
				color: 0x1a0a28,
				emissive: 0x6600aa,
				emissiveIntensity: 0.55,
				roughness: 0.45,
				metalness: 0.6,
			})
		)
		this._matScale = own(
			new THREE.MeshStandardMaterial({
				color: 0x110022,
				emissive: 0x440088,
				emissiveIntensity: 0.3,
				roughness: 0.8,
			})
		)
		this._matEye = own(
			new THREE.MeshBasicMaterial({
				color: 0xff2200,
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		this._matWing = own(
			new THREE.MeshStandardMaterial({
				color: 0x2b0a44,
				emissive: 0x880033,
				emissiveIntensity: 0.4,
				transparent: true,
				opacity: 0.82,
				side: THREE.DoubleSide,
				roughness: 0.9,
			})
		)

		// Fireball materials — one per pool slot so opacity animates independently
		// They share the same property set but are separate instances.
		const _fbCoreMats = []
		const _fbHaloMats = []
		for (let i = 0; i < FIREBALL_POOL; i++) {
			_fbCoreMats.push(
				own(
					new THREE.MeshBasicMaterial({
						color: 0xffee44,
						transparent: true,
						opacity: 0.95,
						blending: THREE.AdditiveBlending,
						depthWrite: false,
					})
				)
			)
			_fbHaloMats.push(
				own(
					new THREE.MeshBasicMaterial({
						color: 0xff6600,
						transparent: true,
						opacity: 0.7,
						blending: THREE.AdditiveBlending,
						depthWrite: false,
					})
				)
			)
		}

		// ── geometries ─────────────────────────────────────────────────────
		const gBodyCore = own(new THREE.IcosahedronGeometry(1.2, 1)) // detail=1 not 2 (fewer tris)
		const gSpine = own(new THREE.OctahedronGeometry(0.22, 0))
		const gHead = own(new THREE.SphereGeometry(0.72, 10, 10)) // was 14,14 → 10,10
		const gJaw = own(new THREE.BoxGeometry(0.72, 0.22, 0.55))
		const gEye = own(new THREE.SphereGeometry(0.14, 6, 6))
		const gHorn = own(new THREE.ConeGeometry(0.09, 0.7, 5))
		const gArmUpper = own(
			new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6)
		) // CapsuleGeometry → Cylinder (lighter)
		const gClaw = own(new THREE.BoxGeometry(0.28, 0.14, 0.55))
		// SHARED fireball geometries — pre-created in constructor, never again at runtime
		const gFbCore = own(new THREE.SphereGeometry(0.55, 6, 6))
		const gFbOct = own(new THREE.OctahedronGeometry(0.9, 0))

		// Wing: simple tapered triangle fan via ShapeGeometry
		const wingShape = new THREE.Shape()
		wingShape.moveTo(0, 0)
		wingShape.lineTo(2.8, 0.8)
		wingShape.lineTo(2.4, 2.6)
		wingShape.lineTo(0.3, 2.8)
		wingShape.closePath()
		const gWing = own(new THREE.ShapeGeometry(wingShape, 4))

		// ── root group ─────────────────────────────────────────────────────
		this.root = new THREE.Group()
		this.root.name = 'void-boss'
		this.root.scale.setScalar(BOSS_SCALE)
		this.root.position.set(
			this.arena.x + ORBIT_RADIUS,
			this.arena.y + ORBIT_ALTITUDE,
			this.arena.z
		)
		parentGroup.add(this.root)

		// ── body ───────────────────────────────────────────────────────────
		this.body = new THREE.Group()
		this.root.add(this.body)

		this.body.add(new THREE.Mesh(gBodyCore, this._matBody))

		// Spine ridges
		this._spineSegs = []
		for (let i = 0; i < 5; i++) {
			const seg = new THREE.Mesh(gSpine, this._matScale)
			seg.position.set(0, 0.85 + i * 0.38, -0.55)
			seg.scale.set(1, 1.4, 0.7)
			this.body.add(seg)
			this._spineSegs.push(seg)
		}

		// ── head ───────────────────────────────────────────────────────────
		this.headGroup = new THREE.Group()
		this.headGroup.position.set(0, 1.45, 0.6)
		this.body.add(this.headGroup)
		this.headGroup.add(new THREE.Mesh(gHead, this._matBody))

		this.jawPivot = new THREE.Group()
		this.jawPivot.position.set(0, -0.38, 0.26)
		this.headGroup.add(this.jawPivot)
		const jaw = new THREE.Mesh(gJaw, this._matScale)
		jaw.position.set(0, -0.12, 0)
		this.jawPivot.add(jaw)

		for (const [x] of [[-0.26], [0.26]]) {
			const eye = new THREE.Mesh(gEye, this._matEye)
			eye.position.set(x, 0.14, 0.62)
			this.headGroup.add(eye)
		}
		for (const [x, rz] of [
			[-0.3, 0.3],
			[0.3, -0.3],
		]) {
			const horn = new THREE.Mesh(gHorn, this._matScale)
			horn.position.set(x, 0.72, -0.1)
			horn.rotation.set(-0.3, 0, rz)
			this.headGroup.add(horn)
		}

		// ── wings ──────────────────────────────────────────────────────────
		for (const sx of [-1, 1]) {
			const wing = new THREE.Mesh(gWing, this._matWing)
			wing.position.set(sx * 0.9, 0.2, 0)
			wing.rotation.y = sx < 0 ? -0.5 : Math.PI + 0.5
			wing.scale.x = sx
			this.body.add(wing)
		}

		// ── arms ───────────────────────────────────────────────────────────
		this.leftArm = null
		this.rightArm = null
		for (const sx of [-1, 1]) {
			const armRoot = new THREE.Group()
			armRoot.position.set(sx * 1.0, -0.2, 0.3)
			this.body.add(armRoot)

			const upper = new THREE.Mesh(gArmUpper, this._matScale)
			upper.position.y = -0.5
			upper.rotation.z = sx * 0.3
			armRoot.add(upper)

			const claw = new THREE.Mesh(gClaw, this._matScale)
			claw.position.set(0, -1.1, 0.18)
			claw.rotation.x = 0.5
			armRoot.add(claw)

			if (sx < 0) this.leftArm = armRoot
			else this.rightArm = armRoot
		}

		// ── glow aura sprite ───────────────────────────────────────────────
		this._auraMat = own(
			new THREE.SpriteMaterial({
				map: glowTexture(),
				color: 0xff3300,
				transparent: true,
				opacity: 0,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
		)
		const aura = new THREE.Sprite(this._auraMat)
		aura.scale.setScalar(6)
		this.root.add(aura)

		// ── point light ────────────────────────────────────────────────────
		this._light = new THREE.PointLight(0xff3300, 0, 80, 2)
		this.root.add(this._light)

		// ── HP bar sprite ──────────────────────────────────────────────────
		this._buildHpBar(parentGroup)

		// ── Pre-warm fireball pool (geometry never created at runtime) ──────
		for (let i = 0; i < FIREBALL_POOL; i++) {
			const group = new THREE.Group()
			const core = new THREE.Mesh(gFbCore, _fbCoreMats[i])
			const halo = new THREE.Mesh(gFbOct, _fbHaloMats[i])
			group.add(core, halo)
			group.visible = false
			parentGroup.add(group)
			this._fireballs.push({
				group,
				coreMat: _fbCoreMats[i],
				haloMat: _fbHaloMats[i],
				active: false,
				life: 0,
				velocity: new THREE.Vector3(),
				rot: Math.random() * Math.PI * 2,
			})
		}

		// Expose world position reference
		this.position = this.root.position
		this._loadGodModel(assetManager)
	}

	async _loadGodModel(assetManager) {
		if (!assetManager) return
		const model = await loadVoidModel(assetManager, 'voidGod')
		if (!model || this._disposed) return

		model.updateMatrixWorld(true)
		const bounds = new THREE.Box3().setFromObject(model)
		const size = bounds.getSize(new THREE.Vector3())
		const center = bounds.getCenter(new THREE.Vector3())
		const fit = 6 / Math.max(size.x, size.y, size.z, 0.001)
		model.scale.setScalar(fit)
		model.position.set(
			-center.x * fit,
			-center.y * fit,
			-center.z * fit
		)
		model.name = 'void-god-final-boss-model'
		model.traverse((part) => {
			if (!part.isMesh) return
			part.castShadow = false
			part.receiveShadow = false
		})
		this.root.add(model)
		this._godModel = model
		this.body.visible = false
	}

	// ── HP bar ──────────────────────────────────────────────────────────────

	_buildHpBar(parentGroup) {
		const canvas = document.createElement('canvas')
		canvas.width = 256
		canvas.height = 20
		const texture = new THREE.CanvasTexture(canvas)
		this._resources.push(texture)
		const mat = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
		})
		this._resources.push(mat)
		const sprite = new THREE.Sprite(mat)
		sprite.scale.set(16, 1.4, 1)
		sprite.position.copy(this.root.position)
		sprite.position.y += HP_BAR_OFFSET_Y
		parentGroup.add(sprite)
		this._hpBarSprite = sprite
		this._hpBarCanvas = canvas
		this._hpBarCtx = canvas.getContext('2d')
		this._hpBarTexture = texture
		this._drawHpBar()
	}

	_drawHpBar() {
		const hp = Math.max(0, this.hp)
		if (hp === this._lastHpDrawn) return // skip if unchanged
		this._lastHpDrawn = hp
		const { _hpBarCtx: ctx, _hpBarCanvas: cv } = this
		ctx.clearRect(0, 0, cv.width, cv.height)
		ctx.fillStyle = 'rgba(10,5,20,.85)'
		ctx.fillRect(0, 0, cv.width, cv.height)
		const frac = hp / this.maxHp
		ctx.fillStyle =
			frac > 0.6
				? '#ff4400'
				: frac > 0.3
					? '#ff8800'
					: '#ffdd00'
		ctx.fillRect(3, 3, (cv.width - 6) * frac, cv.height - 6)
		ctx.fillStyle = '#fff'
		ctx.font = 'bold 10px monospace'
		ctx.textAlign = 'center'
		ctx.fillText(
			`VOID GOD  ${hp} / ${this.maxHp}`,
			cv.width / 2,
			cv.height - 4
		)
		this._hpBarTexture.needsUpdate = true
	}

	// ── fireball spawning ───────────────────────────────────────────────────

	_spawnFireball(targetPos, playerVelocity) {
		// Only ever reactivates a pre-warmed pool entry — no alloc at runtime.
		const fb = this._fireballs.find((f) => !f.active)
		if (!fb) return // pool exhausted (all 6 in flight) — silently skip

		// Spawn from the boss head (world position via scratch)
		this.headGroup.getWorldPosition(fb.group.position)
		// Lead the pilot by the projectile's travel time so shots stay aimed
		// at their flight path instead of the position from the start of windup.
		const distance = fb.group.position.distanceTo(targetPos)
		this._scratchAim.copy(targetPos)
		if (playerVelocity)
			this._scratchAim.addScaledVector(
				playerVelocity,
				Math.min(distance / FIREBALL_SPEED, 1.5)
			)
		this._scratchDir
			.subVectors(this._scratchAim, fb.group.position)
			.normalize()
		// Offset spawn point so ball starts outside the boss body
		fb.group.position.addScaledVector(this._scratchDir, 2.5)
		fb.velocity
			.copy(this._scratchDir)
			.multiplyScalar(FIREBALL_SPEED)
		fb.active = true
		fb.life = FIREBALL_LIFE
		fb.group.visible = true
	}

	// ── damage from player gun ──────────────────────────────────────────────

	receiveDamage(amount) {
		if (this.dead) return
		this.hp = Math.max(0, this.hp - amount)
		this._hitFlash = 1
		this._drawHpBar()
		if (this.hp <= 0) this._die()
	}

	_die() {
		this.dead = true
		this.won = true
		this._deathT = 0
		this._auraMat.opacity = 0
		this._light.intensity = 0
		this._hpBarSprite.visible = false
		for (const fb of this._fireballs) {
			fb.active = false
			fb.group.visible = false
		}
	}

	// ── update ──────────────────────────────────────────────────────────────

	update(delta, playerPos, playerVelocity) {
		this._time += delta
		this._hitFlash = Math.max(0, this._hitFlash - delta * 2.5)

		if (this.dead) {
			this._updateDeath(delta)
			return
		}

		// Orbit the arena — reuse scratch vector, zero new allocs
		this._orbitAngle += this._orbitSpeed * delta
		this._scratchOrbit.set(
			this.arena.x +
				Math.cos(this._orbitAngle) * ORBIT_RADIUS,
			this.arena.y +
				ORBIT_ALTITUDE +
				Math.sin(this._time * 0.7) * 3,
			this.arena.z + Math.sin(this._orbitAngle) * ORBIT_RADIUS
		)
		this.root.position.lerp(
			this._scratchOrbit,
			1 - Math.exp(-delta * 1.8)
		)

		// HP bar follows boss (world-space, outside the scaled root)
		this._hpBarSprite.position.copy(this.root.position)
		this._hpBarSprite.position.y += HP_BAR_OFFSET_Y

		// Face the player
		const dx = playerPos.x - this.root.position.x
		const dz = playerPos.z - this.root.position.z
		const targetYaw = Math.atan2(dx, dz)
		let diff = (targetYaw - this.root.rotation.y) % (Math.PI * 2)
		if (diff > Math.PI) diff -= Math.PI * 2
		if (diff < -Math.PI) diff += Math.PI * 2
		this.root.rotation.y += diff * (1 - Math.exp(-delta * 3))

		// Body idle animation
		this.body.position.y =
			(Math.sin(this._time * 1.1) * 0.12) / BOSS_SCALE
		this.body.rotation.z = Math.sin(this._time * 0.6) * 0.04
		for (let i = 0; i < this._spineSegs.length; i++)
			this._spineSegs[i].rotation.y =
				Math.sin(this._time * 2 + i * 0.8) * 0.25
		const armSway = Math.sin(this._time * 1.4) * 0.18
		if (this.leftArm) this.leftArm.rotation.z = armSway
		if (this.rightArm) this.rightArm.rotation.z = -armSway

		// Enrage threshold
		const enraged = this.hp / this.maxHp < ENRAGE_THRESHOLD
		const cooldown = enraged ? RECOVER_TIME * 0.55 : RECOVER_TIME

		// ── state machine ──────────────────────────────────────────────────
		switch (this._state) {
			case 'idle':
				this._timer -= delta
				this._auraMat.opacity = Math.max(
					0,
					this._auraMat.opacity * (1 - delta * 3)
				)
				this._light.intensity = 0
				this._jawOpen = Math.max(
					0,
					this._jawOpen - delta * 3
				)
				if (this._timer <= 0) {
					this._state = 'windup'
					this._timer =
						WINDUP_TIME *
						(enraged ? 0.7 : 1)
				}
				break

			case 'windup':
				// Telegraph: aura flashes, jaw opens
				this._timer -= delta
				this._auraMat.opacity =
					0.5 +
					0.5 *
						Math.abs(
							Math.sin(
								this._timer * 8
							)
						)
				this._light.intensity =
					12 * this._auraMat.opacity
				this._jawOpen = Math.min(
					1,
					this._jawOpen + delta * 2
				)
				if (this._timer <= 0) {
					this._spawnFireball(
						playerPos,
						playerVelocity
					)
					if (enraged) {
						// Keep the enraged follow-up aimed at the same predicted path.
						this._spawnFireball(
							playerPos,
							playerVelocity
						)
					}
					this._state = 'recover'
					this._timer = cooldown
				}
				break

			case 'recover':
				this._timer -= delta
				this._auraMat.opacity = Math.max(
					0,
					this._auraMat.opacity - delta * 2
				)
				this._light.intensity = Math.max(
					0,
					this._light.intensity * (1 - delta * 3)
				)
				this._jawOpen = Math.max(
					0,
					this._jawOpen - delta * 4
				)
				if (this._timer <= 0) {
					this._state = 'idle'
					this._timer = 0.4 + Math.random() * 0.6
				}
				break
		}

		// Jaw
		this.jawPivot.rotation.x = this._jawOpen * 0.55

		// Hit flash (tint emissive)
		const flash = this._hitFlash
		this._matBody.emissive.setRGB(
			0.4 + flash * 0.6,
			flash * 0.3,
			0.67 + flash * 0.2
		)
		this._matEye.color.setRGB(1, 0.13 + flash * 0.3, flash * 0.15)

		// ── fireball updates ────────────────────────────────────────────────
		this.pendingHit = false
		for (const fb of this._fireballs) {
			if (!fb.active) continue
			fb.life -= delta
			if (fb.life <= 0) {
				fb.active = false
				fb.group.visible = false
				continue
			}
			fb.group.position.addScaledVector(fb.velocity, delta)
			fb.rot += delta * 3.5
			// Reuse group's euler — no new allocs
			fb.group.rotation.y = fb.rot
			fb.group.rotation.x = fb.rot * 0.7

			// Fade near end-of-life
			const fade = Math.min(1, fb.life * 2)
			fb.coreMat.opacity = 0.95 * fade
			fb.haloMat.opacity = 0.7 * fade

			// Hit detection
			if (
				fb.group.position.distanceTo(playerPos) <
				FIREBALL_RADIUS
			) {
				this.pendingHit = true
				fb.active = false
				fb.group.visible = false
			}
		}
	}

	// ── death animation ─────────────────────────────────────────────────────

	_updateDeath(delta) {
		if (this._deathT < 0) return
		this._deathT += delta
		const t = Math.min(1, this._deathT / 2.2)
		this.root.rotation.z = t * t * 1.8
		this.root.scale.setScalar(
			BOSS_SCALE * Math.max(0.001, 1 - t * t)
		)
	}

	// ── dispose ─────────────────────────────────────────────────────────────

	dispose() {
		this._disposed = true
		for (const fb of this._fireballs) fb.group.removeFromParent()
		this._fireballs.length = 0
		this._hpBarSprite.removeFromParent()
		this.root.removeFromParent()
		for (const r of this._resources) r.dispose()
		this._resources.length = 0
	}
}
