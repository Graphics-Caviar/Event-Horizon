import * as THREE from 'three'

// Every storm rolls one of these. `multiplier` is what gets handed to
// setGravityInZone(); negative values push things upward. The colour is purely
// a readability cue: cool = light/reversed, hot = heavy.
const VARIANTS = [
	{ label: 'reversed', multiplier: -1, color: 0x9a64ff, weight: 1 },
	{ label: 'weightless', multiplier: 0.15, color: 0x4fd8ff, weight: 2 },
	{ label: 'crushing', multiplier: 3, color: 0xff5a2a, weight: 2 },
]

const RADIUS_RANGE = [22, 34]
const ACTIVE_RANGE = [10, 18] // seconds the gravity zone is live
const FORM_TIME = 4 // warning: cloud grows, ring blinks, gravity untouched
const FADE_TIME = 3 // cloud dissipates, gravity already restored

// Spawn ring around the player so storms are seen coming, not dropped on them.
const SPAWN_DISTANCE = [55, 150]
const SPAWN_ATTEMPTS = 24

const BODY_PUFFS = 38
const CORE_PUFFS = 6
const RING_SEGMENTS = 96

const rand = (min, max) => min + Math.random() * (max - min)
const easeOut = (t) => 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3)

function pickWeighted(items) {
	let roll = Math.random() * items.reduce((s, i) => s + i.weight, 0)
	for (const item of items) {
		roll -= item.weight
		if (roll <= 0) return item
	}
	return items[items.length - 1]
}

/** Soft radial blob drawn on a canvas; tinted per sprite via material.color. */
function makePuffTexture() {
	const size = 64
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d')
	const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
	g.addColorStop(0, 'rgba(255,255,255,1)')
	g.addColorStop(0.4, 'rgba(255,255,255,0.6)')
	g.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, size, size)
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

/**
 * A localized gravity anomaly.
 *
 * Lifecycle: forming -> active -> dissipating -> done
 *  - forming:     visual warning only (cloud grows, ground ring blinks)
 *  - active:      setGravityInZone(center, radius, multiplier) is applied
 *  - dissipating: gravity is restored (multiplier 1) and the cloud fades
 *
 * The zone is a sphere centred on the terrain surface, so the ground ring is
 * a fair picture of where gravity is altered. The cloud itself floats above
 * the zone and is purely visual (no collider).
 *
 * Gravity is only ever touched through `_setGravity`, so if the teammate's
 * API changes (zone handles, a clear method, ...) that is the one place to edit.
 */
export class GravityStorm {
	/** Relative chance of being picked by Hazards. */
	static spawnWeight = 1

	constructor(level, { gravity = null } = {}) {
		this.level = level
		this.gravity = gravity
		this.phase = 'forming'
		this.elapsed = 0 // time spent in the current phase
		this.gravityApplied = false
		this.flash = 0
		this.flashTimer = rand(1, 2.5)
		this.time = 0

		this.variant = pickWeighted(VARIANTS)
		this.radius = rand(...RADIUS_RANGE)
		this.activeDuration = rand(...ACTIVE_RANGE)
		this.center = this._pickCenter()
		this.color = new THREE.Color(this.variant.color)

		this._disposables = []
		this.group = new THREE.Group()
		this.group.name = `gravity-storm-${this.variant.label}`
		this.group.position.set(
			this.center.x,
			this.center.y + this.radius * 0.55,
			this.center.z
		)
		this._buildCloud()
		this._buildRing()
		level.sceneManager.scene.add(this.group)
		this._applyVisuals(0, 0.3)
	}

	get done() {
		return this.phase === 'done'
	}

	/** Random spot in the playable area, a short walk away from the player. */
	_pickCenter() {
		const { planet, playerRoot } = this.level
		const origin = playerRoot.position
		let x = origin.x
		let z = origin.z
		for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
			const angle = rand(0, Math.PI * 2)
			const distance = rand(...SPAWN_DISTANCE)
			x = origin.x + Math.cos(angle) * distance
			z = origin.z + Math.sin(angle) * distance
			if (planet.isInsideBounds(x, z, this.radius + 4)) break
			// Never found a spot (player hugging the edge): head for map centre.
			if (i === SPAWN_ATTEMPTS - 1) {
				const toCenter = new THREE.Vector2(
					planet.center.x - origin.x,
					planet.center.z - origin.z
				).setLength(SPAWN_DISTANCE[0])
				x = origin.x + toCenter.x
				z = origin.z + toCenter.y
			}
		}
		return new THREE.Vector3(x, planet.heightAt(x, z), z)
	}

	_track(resource) {
		this._disposables.push(resource)
		return resource
	}

	_buildCloud() {
		const texture = this._track(makePuffTexture())
		const dark = new THREE.Color(0x15111c)
		this.puffs = []
		this.cores = []

		// Dark body: flattened, domed disc of overlapping soft puffs.
		for (let i = 0; i < BODY_PUFFS; i++) {
			const r = this.radius * Math.sqrt(Math.random()) * 0.95
			const material = this._track(
				new THREE.SpriteMaterial({
					map: texture,
					color: dark
						.clone()
						.lerp(
							this.color,
							rand(0.05, 0.4)
						),
					transparent: true,
					depthWrite: false,
					opacity: 0,
				})
			)
			material.rotation = rand(0, Math.PI * 2)
			const sprite = new THREE.Sprite(material)
			const size = this.radius * rand(0.5, 0.95)
			sprite.scale.set(size, size, 1)
			this.group.add(sprite)
			this.puffs.push({
				sprite,
				angle: rand(0, Math.PI * 2),
				r,
				// Inner puffs ride higher and spin faster -> a vortex shape.
				height:
					(1 - r / this.radius) *
						this.radius *
						0.28 +
					rand(-3, 3),
				speed:
					(0.5 + (1 - r / this.radius)) *
					rand(0.18, 0.32),
				base: rand(0.35, 0.6),
			})
		}

		// Glowing core in the storm's colour; this is what "flashes".
		for (let i = 0; i < CORE_PUFFS; i++) {
			const material = this._track(
				new THREE.SpriteMaterial({
					map: texture,
					color: this.color,
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					opacity: 0,
				})
			)
			const sprite = new THREE.Sprite(material)
			const size = this.radius * rand(0.35, 0.65)
			sprite.scale.set(size, size, 1)
			sprite.position.set(
				rand(-0.25, 0.25) * this.radius,
				rand(-0.05, 0.2) * this.radius,
				rand(-0.25, 0.25) * this.radius
			)
			this.group.add(sprite)
			this.cores.push(sprite)
		}
	}

	/**
	 * Flat ribbon hugging the terrain at the zone's edge. Added to the scene
	 * (not the cloud group) because it sits on the ground, not in the sky.
	 * Deliberately not a PointLight: adding a light mid-game forces three.js to
	 * recompile every lit material and causes a visible hitch.
	 */
	_buildRing() {
		const { planet } = this.level
		const inner = this.radius - 0.7
		const outer = this.radius + 0.7
		const positions = []
		const indices = []
		for (let i = 0; i <= RING_SEGMENTS; i++) {
			const a = (i / RING_SEGMENTS) * Math.PI * 2
			const cos = Math.cos(a)
			const sin = Math.sin(a)
			for (const r of [inner, outer]) {
				const x = this.center.x + cos * r
				const z = this.center.z + sin * r
				positions.push(
					x,
					planet.heightAt(x, z) + 0.45,
					z
				)
			}
			if (i < RING_SEGMENTS) {
				const k = i * 2
				indices.push(
					k,
					k + 1,
					k + 2,
					k + 1,
					k + 3,
					k + 2
				)
			}
		}
		const geometry = this._track(new THREE.BufferGeometry())
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(positions, 3)
		)
		geometry.setIndex(indices)
		geometry.computeBoundingSphere()
		this.ringMaterial = this._track(
			new THREE.MeshBasicMaterial({
				color: this.color,
				transparent: true,
				opacity: 0,
				side: THREE.DoubleSide,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
		)
		this.ring = new THREE.Mesh(geometry, this.ringMaterial)
		this.ring.name = 'gravity-storm-ring'
		this.ring.frustumCulled = false
		this.level.sceneManager.scene.add(this.ring)
	}

	/** The only place that talks to the gravity system. */
	_setGravity(multiplier) {
		if (!this.gravity?.setGravityInZone) {
			if (!GravityStorm._warned) {
				GravityStorm._warned = true
				console.warn(
					'[GravityStorm] No gravity system with setGravityInZone(); running visuals only.'
				)
			}
			return
		}
		this.gravity.setGravityInZone(
			this.center.clone(),
			this.radius,
			multiplier
		)
	}

	_enter(phase) {
		this.phase = phase
		this.elapsed = 0
		if (phase === 'active') {
			this._setGravity(this.variant.multiplier)
			this.gravityApplied = true
		} else if (phase === 'dissipating') {
			this._restoreGravity()
		}
	}

	_restoreGravity() {
		if (!this.gravityApplied) return
		this.gravityApplied = false
		this._setGravity(1)
	}

	/** scale: cloud size factor, intensity: overall opacity 0..1 */
	_applyVisuals(intensity, scale) {
		this.group.scale.setScalar(scale)
		for (const puff of this.puffs) {
			puff.sprite.material.opacity = puff.base * intensity
		}
		const glow = (0.2 + this.flash * 0.8) * intensity
		for (const core of this.cores) core.material.opacity = glow
	}

	update(delta) {
		if (this.done) return
		this.time += delta
		this.elapsed += delta

		// Swirl the cloud.
		for (const puff of this.puffs) {
			puff.angle += puff.speed * delta
			puff.sprite.position.set(
				Math.cos(puff.angle) * puff.r,
				puff.height,
				Math.sin(puff.angle) * puff.r
			)
		}

		let intensity = 1
		let scale = 1
		let ring = 0.5

		if (this.phase === 'forming') {
			const t = this.elapsed / FORM_TIME
			intensity = 0.7 * easeOut(t)
			scale = THREE.MathUtils.lerp(0.35, 1, easeOut(t))
			// Blink faster as activation approaches.
			ring =
				0.25 +
				0.35 *
					(0.5 +
						0.5 *
							Math.sin(
								this.time *
									(4 +
										t *
											10)
							))
			if (t >= 1) this._enter('active')
		} else if (this.phase === 'active') {
			this.flashTimer -= delta
			if (this.flashTimer <= 0) {
				this.flash = 1
				this.flashTimer = rand(0.6, 2.8)
			}
			this.flash *= Math.exp(-delta * 7)
			ring = 0.55 + 0.15 * Math.sin(this.time * 3)
			if (this.elapsed >= this.activeDuration)
				this._enter('dissipating')
		} else if (this.phase === 'dissipating') {
			const t = this.elapsed / FADE_TIME
			intensity = 1 - easeOut(t)
			scale = 1 + 0.15 * easeOut(t)
			ring = 0.5 * intensity
			this.flash *= Math.exp(-delta * 7)
			if (t >= 1) {
				this.dispose()
				return
			}
		}

		this.ringMaterial.opacity = ring
		this._applyVisuals(intensity, scale)
	}

	dispose() {
		if (this.phase === 'done') return
		// A storm cut short (level exit) must not leave gravity altered.
		this._restoreGravity()
		this.phase = 'done'
		this.group.removeFromParent()
		this.ring.removeFromParent()
		for (const resource of this._disposables) resource.dispose()
		this._disposables.length = 0
	}
}
