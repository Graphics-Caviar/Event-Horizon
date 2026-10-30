import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'
import { VoidRigAnimator } from './VoidRigAnimator.js'

// Small, reusable visual and collision pool. All combat calculations use world
// coordinates, not Level 2 terrain/rover physics (the Void has zero gravity).
const clamp = THREE.MathUtils.clamp
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()
const LIMIT = Object.freeze({
	minX: -145,
	maxX: 145,
	minY: -78,
	maxY: 95,
	minZ: -440,
	maxZ: 50,
})
const CONFIG = {
	sentinel: {
		hp: 165,
		size: 6.5,
		speed: 8,
		detection: 95,
		damage: 14,
		reach: 9,
		color: 0x9a65ff,
		asset: 'voidSentinel',
		species: 'sentinel',
		abilities: [
			'voidStrike',
			'riftBolt',
			'phaseStep',
			'guardianShield',
		],
	},
	colossus: {
		hp: 310,
		size: 11,
		speed: 4.5,
		detection: 115,
		damage: 22,
		reach: 13,
		color: 0xd68bff,
		asset: 'voidColossus',
		species: 'colossus',
		abilities: [
			'seismicSlam',
			'gravityPunch',
			'voidRoar',
			'armourOverload',
		],
	},
	stalker: {
		hp: 95,
		size: 5.5,
		speed: 13,
		detection: 115,
		damage: 11,
		reach: 8,
		color: 0x874dff,
		asset: 'riftStalker',
		species: 'sentinel',
		abilities: [
			'riftCloak',
			'shadowPounce',
			'dimensionalBlink',
			'executionClaws',
		],
	},
	gravRift: {
		hp: 120,
		size: 8,
		speed: 3.5,
		detection: 110,
		damage: 10,
		reach: 55,
		color: 0x51dfff,
		species: 'entity',
		abilities: [
			'gravityWell',
			'riftPulse',
			'debrisStorm',
			'spatialDistortion',
		],
	},
	entityBoss: {
		hp: 620,
		size: 20,
		speed: 5,
		detection: 400,
		damage: 17,
		reach: 65,
		color: 0x77ffff,
		asset: 'voidEntity',
		species: 'entity',
		abilities: [
			'realityShards',
			'voidTendrils',
			'spatialRift',
			'falseImage',
		],
	},
}
const ENTITY_PHASES = [
	['realityShards', 'voidTendrils', 'spatialRift', 'falseImage'],
	[
		'gravityReversal',
		'realityFracture',
		'temporalEcho',
		'dimensionalPrison',
	],
	[
		'worldCollapse',
		'eventHorizonSurge',
		'infiniteEchoes',
		'existenceErasure',
	],
]
const TELEGRAPH = {
	voidStrike: 0.85,
	riftBolt: 0.8,
	phaseStep: 0.7,
	guardianShield: 0.7,
	seismicSlam: 1.5,
	gravityPunch: 1.25,
	voidRoar: 1.6,
	armourOverload: 0.85,
	riftCloak: 0.65,
	shadowPounce: 1.0,
	dimensionalBlink: 0.8,
	executionClaws: 0.75,
	gravityWell: 1.4,
	riftPulse: 1.15,
	debrisStorm: 1.4,
	spatialDistortion: 1.3,
	realityShards: 0.9,
	voidTendrils: 1.25,
	spatialRift: 1.25,
	falseImage: 0.9,
	gravityReversal: 1.5,
	realityFracture: 1.35,
	temporalEcho: 1.3,
	dimensionalPrison: 1.55,
	worldCollapse: 1.7,
	eventHorizonSurge: 1.6,
	infiniteEchoes: 1.5,
	existenceErasure: 3.4,
}

export class VoidArenaEffects {
	constructor(level, group) {
		this.level = level
		this.group = group
		this.resources = []
		const own = (resource) => {
			this.resources.push(resource)
			return resource
		}
		this.sphere = own(new THREE.IcosahedronGeometry(1, 1))
		this.ringGeometry = own(
			new THREE.TorusGeometry(1, 0.025, 4, 36)
		)
		this.warningMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0xca72ff,
				transparent: true,
				opacity: 0.7,
				depthWrite: false,
			})
		)
		this.boltMaterials = [0x9b58ff, 0x66eaff, 0xff72cf].map(
			(color) =>
				own(
					new THREE.MeshBasicMaterial({
						color,
						transparent: true,
						opacity: 0.88,
						depthWrite: false,
					})
				)
		)
		this.rings = Array.from({ length: 28 }, () => {
			const mesh = new THREE.Mesh(
				this.ringGeometry,
				this.warningMaterial
			)
			mesh.visible = false
			group.add(mesh)
			return { mesh, remaining: 0, duration: 0, size: 1 }
		})
		this.bolts = Array.from({ length: 35 }, (_, i) => {
			const mesh = new THREE.Mesh(
				this.sphere,
				this.boltMaterials[i % 3]
			)
			mesh.visible = false
			group.add(mesh)
			return {
				mesh,
				velocity: new THREE.Vector3(),
				life: 0,
				radius: 2.5,
				damage: 10,
				tracking: 0,
			}
		})
		this.pulseVisuals = Array.from({ length: 10 }, () => {
			const mesh = new THREE.Mesh(
				this.ringGeometry,
				own(
					new THREE.MeshBasicMaterial({
						color: 0x9a6eff,
						transparent: true,
						opacity: 0.65,
						depthWrite: false,
					})
				)
			)
			mesh.visible = false
			group.add(mesh)
			return mesh
		})
		this.fieldVisuals = Array.from({ length: 5 }, () => {
			const mesh = new THREE.Mesh(
				this.sphere,
				own(
					new THREE.MeshBasicMaterial({
						color: 0x5135bd,
						wireframe: true,
						transparent: true,
						opacity: 0.3,
						depthWrite: false,
					})
				)
			)
			mesh.visible = false
			group.add(mesh)
			return mesh
		})
		this.implosions = []
		this.meteors = []
		this.beams = []
		this.pulses = []
		this.fields = []
		this.zones = []
		this.decoys = []
		this._scratch = new THREE.Vector3()
	}
	warn(position, radius, duration = 1.0) {
		const entry = this.rings.find((x) => x.remaining <= 0)
		if (!entry) return
		entry.remaining = entry.duration = duration
		entry.size = Math.max(1, radius)
		entry.mesh.position.copy(position)
		entry.mesh.scale.setScalar(radius)
		entry.mesh.visible = true
	}
	bolt(
		from,
		to,
		{
			damage = 10,
			speed = 35,
			radius = 2.6,
			tracking = 0,
			color = 0,
		} = {}
	) {
		const shot = this.bolts.find((x) => x.life <= 0)
		if (!shot) return
		shot.mesh.position.copy(from)
		shot.mesh.material =
			this.boltMaterials[color % this.boltMaterials.length]
		shot.mesh.scale.setScalar(radius * 0.42)
		shot.velocity
			.subVectors(to, from)
			.normalize()
			.multiplyScalar(speed)
		shot.radius = radius
		shot.life = 5
		shot.tracking = tracking
		shot.damage = damage
		shot.mesh.visible = true
	}
	volley(from, player, count, damage = 10, speed = 35) {
		const countSafe = Math.min(9, Math.max(1, count))
		for (let i = 0; i < countSafe; i++) {
			this._scratch.copy(player)
			this._scratch.x += (i - (countSafe - 1) / 2) * 5
			this._scratch.y += Math.sin(i * 2.4) * 4
			this.bolt(from, this._scratch, {
				damage,
				speed,
				tracking: i === 0 ? 0.5 : 0,
			})
		}
	}
	// A warning marker precedes any damaging location-based attack.
	zone(
		position,
		radius,
		{ warn = 1.1, active = 0.55, damage = 12, color = 0 } = {}
	) {
		if (this.zones.length >= 22) return
		const pos = position.clone()
		this.warn(pos, radius, warn)
		this.zones.push({
			position: pos,
			radius,
			warn,
			active,
			damage,
			elapsed: 0,
			hit: false,
			color,
		})
	}
	pulse(
		position,
		{
			radius = 25,
			duration = 0.9,
			damage = 15,
			knockback = 15,
		} = {}
	) {
		if (this.pulses.length >= 10) return
		const mesh = this.pulseVisuals.find((m) => !m.visible)
		if (!mesh) return
		mesh.position.copy(position)
		mesh.scale.setScalar(0.1)
		mesh.visible = true
		this.pulses.push({
			position: position.clone(),
			radius,
			duration,
			elapsed: 0,
			damage,
			knockback,
			hit: false,
			mesh,
		})
	}
	field(
		position,
		{
			radius = 32,
			duration = 2.4,
			pull = 22,
			damage = 0,
			axis = 'radial',
		} = {}
	) {
		if (this.fields.length >= 5) return
		const mesh = this.fieldVisuals.find((m) => !m.visible)
		if (!mesh) return
		mesh.position.copy(position)
		mesh.scale.setScalar(radius)
		mesh.visible = true
		this.fields.push({
			position: position.clone(),
			radius,
			duration,
			elapsed: 0,
			pull,
			damage,
			axis,
			hit: false,
			mesh,
		})
	}
	meteor(position, delay = 1.1, damage = 15) {
		if (this.meteors.length >= 12) return
		this.warn(position, 7, delay)
		const mesh = new THREE.Mesh(this.sphere, this.boltMaterials[0])
		mesh.position.copy(position)
		mesh.position.y += 28
		mesh.scale.setScalar(2.3)
		this.group.add(mesh)
		this.meteors.push({
			mesh,
			target: position.clone(),
			delay,
			elapsed: 0,
			hit: false,
			damage,
		})
	}
	beam(
		from,
		to,
		{ warning = 0.8, duration = 0.75, damage = 26, radius = 5 } = {}
	) {
		if (this.beams.length >= 4) return
		this.warn(to, radius + 4, warning)
		const geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
		const material = new THREE.MeshBasicMaterial({
			color: 0x85caff,
			transparent: true,
			opacity: 0.55,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		const mesh = new THREE.Mesh(geometry, material)
		mesh.visible = false
		this.group.add(mesh)
		this.beams.push({
			mesh,
			geometry,
			material,
			from: from.clone(),
			to: to.clone(),
			warning,
			duration,
			elapsed: 0,
			hit: false,
			damage,
			radius,
		})
	}
	implode(position, color = 0x68e8ff) {
		// A bounded set of crystalline fragments converges on the defeated core.
		if (this.implosions.length >= 3) return
		const material = new THREE.MeshBasicMaterial({
			color,
			wireframe: true,
			transparent: true,
			opacity: 0.85,
		})
		const fragments = Array.from({ length: 9 }, (_, i) => {
			const mesh = new THREE.Mesh(this.sphere, material)
			const angle = i * 2.399963
			const offset = new THREE.Vector3(
				Math.cos(angle) * (9 + i),
				Math.sin(angle) * (7 + i),
				Math.sin(i * 1.7) * (6 + i)
			)
			mesh.position.copy(position).add(offset)
			mesh.scale.setScalar(0.9 + i * 0.08)
			this.group.add(mesh)
			return { mesh, offset }
		})
		this.implosions.push({
			center: position.clone(),
			fragments,
			material,
			remaining: 1.7,
		})
	}
	decoy(position, duration = 5) {
		if (this.decoys.length >= 6) return
		const material = new THREE.MeshBasicMaterial({
			color: 0x925de3,
			wireframe: true,
			transparent: true,
			opacity: 0.4,
		})
		const mesh = new THREE.Mesh(this.sphere, material)
		mesh.scale.setScalar(7)
		mesh.position.copy(position)
		this.group.add(mesh)
		this.decoys.push({ mesh, duration, hp: 35 })
	}
	pickDecoy(target) {
		// Auto-aim can lock onto a closer illusion instead of always finding the true core.
		return (
			this.decoys.find(
				(d) =>
					d.hp > 0 &&
					d.mesh.position.distanceTo(target) < 30
			) || null
		)
	}
	hitDecoy(decoy, damage) {
		decoy.hp -= damage
		if (decoy.hp <= 0) decoy.duration = 0
	}
	_damage(damage) {
		if (damage > 0 && !this.level.completed)
			this.level._applyAlienHit(damage)
	}
	update(dt) {
		const player = this.level.playerRoot.position
		for (const r of this.rings) {
			if (r.remaining <= 0) continue
			r.remaining -= dt
			r.mesh.visible = r.remaining > 0
			r.mesh.material.opacity = this.warningMaterial.opacity // shared material is constant
			r.mesh.rotation.y += dt * 0.8
		}
		for (const b of this.bolts) {
			if (b.life <= 0) continue
			b.life -= dt
			if (b.tracking > 0) {
				b.tracking -= dt
				this._scratch
					.subVectors(player, b.mesh.position)
					.normalize()
					.multiplyScalar(b.velocity.length())
				b.velocity.lerp(
					this._scratch,
					Math.min(1, dt * 1.5)
				)
			}
			b.mesh.position.addScaledVector(b.velocity, dt)
			if (
				b.mesh.position.distanceToSquared(player) <
				(b.radius + 1.3) ** 2
			) {
				this._damage(b.damage)
				b.life = 0
			}
			if (b.life <= 0) b.mesh.visible = false
		}
		for (let i = this.zones.length - 1; i >= 0; i--) {
			const z = this.zones[i]
			z.elapsed += dt
			if (z.elapsed >= z.warn && !z.hit) {
				// Void movement is 3D; use a spherical hazard, not a ground-only XZ check.
				if (
					player.distanceToSquared(z.position) <
					z.radius ** 2
				)
					this._damage(z.damage)
				z.hit = true
			}
			if (z.elapsed >= z.warn + z.active)
				this.zones.splice(i, 1)
		}
		for (let i = this.pulses.length - 1; i >= 0; i--) {
			const p = this.pulses[i]
			p.elapsed += dt
			const wave =
				p.radius * Math.min(1, p.elapsed / p.duration)
			p.mesh.scale.setScalar(Math.max(0.1, wave))
			p.mesh.material.opacity = Math.max(
				0,
				0.75 * (1 - p.elapsed / p.duration)
			)
			const dist = player.distanceTo(p.position)
			if (
				!p.hit &&
				Math.abs(dist - wave) <
					Math.max(
						3,
						(p.radius * dt) / p.duration + 1
					)
			) {
				this._damage(p.damage)
				p.hit = true
				tmp.subVectors(player, p.position).normalize()
				this.level.velocity.addScaledVector(
					tmp,
					p.knockback
				)
			}
			if (p.elapsed >= p.duration) {
				p.mesh.visible = false
				this.pulses.splice(i, 1)
			}
		}
		for (let i = this.fields.length - 1; i >= 0; i--) {
			const f = this.fields[i]
			f.elapsed += dt
			const distance = player.distanceTo(f.position)
			f.mesh.rotation.y += dt
			f.mesh.material.opacity = Math.max(
				0.05,
				0.35 * (1 - f.elapsed / f.duration)
			)
			if (distance > 2 && distance < f.radius) {
				if (f.axis === 'up') tmp.set(0, 1, 0)
				else if (f.axis === 'down') tmp.set(0, -1, 0)
				else
					tmp.subVectors(
						f.position,
						player
					).normalize()
				const force =
					(1 - distance / f.radius) * f.pull * dt
				this.level.velocity.addScaledVector(tmp, force)
				this.level.velocity.clampLength(0, 58)
				if (f.damage && !f.hit && distance < 7) {
					this._damage(f.damage)
					f.hit = true
				}
			}
			if (f.elapsed >= f.duration) {
				f.mesh.visible = false
				this.fields.splice(i, 1)
			}
		}
		for (let i = this.meteors.length - 1; i >= 0; i--) {
			const m = this.meteors[i]
			m.elapsed += dt
			const progress = Math.min(1, m.elapsed / m.delay)
			m.mesh.position.copy(m.target)
			m.mesh.position.y += 28 * (1 - progress)
			m.mesh.rotation.y += dt * 5
			if (progress >= 1) {
				if (
					!m.hit &&
					player.distanceToSquared(m.target) <=
						7 ** 2
				)
					this._damage(m.damage)
				m.mesh.removeFromParent()
				this.meteors.splice(i, 1)
			}
		}
		for (let i = this.beams.length - 1; i >= 0; i--) {
			const b = this.beams[i]
			b.elapsed += dt
			if (b.elapsed >= b.warning) {
				b.mesh.visible = true
				tmp.subVectors(b.to, b.from)
				const length = tmp.length()
				b.mesh.position
					.copy(b.from)
					.addScaledVector(tmp, 0.5)
				b.mesh.scale.set(b.radius, length, b.radius)
				b.mesh.quaternion.setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					tmp.normalize()
				)
				if (!b.hit) {
					// Distance from pilot to finite beam segment in 3D.
					tmp2.subVectors(player, b.from)
					const along = THREE.MathUtils.clamp(
						tmp2.dot(tmp) /
							Math.max(0.1, length),
						0,
						1
					)
					const point = tmp2.addScaledVector(
						tmp,
						-along * length
					)
					if (point.lengthSq() < b.radius ** 2) {
						this._damage(b.damage)
						b.hit = true
					}
				}
			}
			if (b.elapsed >= b.warning + b.duration) {
				b.mesh.removeFromParent()
				b.geometry.dispose()
				b.material.dispose()
				this.beams.splice(i, 1)
			}
		}
		for (let i = this.implosions.length - 1; i >= 0; i--) {
			const e = this.implosions[i]
			e.remaining -= dt
			const t = 1 - Math.max(0, e.remaining) / 1.7
			for (const f of e.fragments) {
				f.mesh.position
					.copy(e.center)
					.addScaledVector(f.offset, 1 - t)
				f.mesh.rotation.x += dt * 3
				f.mesh.rotation.y += dt * 4
			}
			e.material.opacity = Math.max(0, 0.85 * (1 - t))
			if (e.remaining <= 0) {
				for (const f of e.fragments)
					f.mesh.removeFromParent()
				e.material.dispose()
				this.implosions.splice(i, 1)
			}
		}
		for (let i = this.decoys.length - 1; i >= 0; i--) {
			const d = this.decoys[i]
			d.duration -= dt
			d.mesh.rotation.y += dt
			if (d.duration <= 0) {
				d.mesh.removeFromParent()
				d.mesh.material.dispose()
				this.decoys.splice(i, 1)
			}
		}
	}
	clear() {
		for (const b of this.bolts) {
			b.life = 0
			b.mesh.visible = false
		}
		for (const r of this.rings) {
			r.remaining = 0
			r.mesh.visible = false
		}
		for (const d of this.decoys) {
			d.mesh.removeFromParent()
			d.mesh.material.dispose()
		}
		for (const p of this.pulses) p.mesh.visible = false
		for (const f of this.fields) f.mesh.visible = false
		for (const m of this.meteors) m.mesh.removeFromParent()
		for (const b of this.beams) {
			b.mesh.removeFromParent()
			b.geometry.dispose()
			b.material.dispose()
		}
		this.meteors.length = this.beams.length = 0
		for (const e of this.implosions) {
			for (const part of e.fragments)
				part.mesh.removeFromParent()
			e.material.dispose()
		}
		this.implosions.length =
			this.decoys.length =
			this.zones.length =
			this.fields.length =
			this.pulses.length =
				0
	}
	dispose() {
		this.clear()
		for (const r of this.resources) r.dispose()
	}
}

/** The same four-phase ability timeline drives the guardians and true boss. */
export class VoidArenaFighter {
	constructor(level, group, fx, kind, position) {
		this.level = level
		this.fx = fx
		this.kind = kind
		this.config = CONFIG[kind]
		this.hp = this.maxHp = this.config.hp
		this.home = position.clone()
		this.root = new THREE.Group()
		this.root.name = `void-arena-${kind}`
		this.root.position.copy(position)
		this.position = this.root.position
		this.root.visible = false
		group.add(this.root)
		this.resources = []
		const own = (x) => {
			this.resources.push(x)
			return x
		}
		this.material = own(
			new THREE.MeshStandardMaterial({
				color: this.config.color,
				emissive: this.config.color,
				emissiveIntensity: 0.5,
				metalness: 0.2,
				roughness: 0.55,
			})
		)
		this.core = new THREE.Mesh(
			own(new THREE.IcosahedronGeometry(1, 1)),
			this.material
		)
		this.core.scale.setScalar(this.config.size * 0.42)
		this.root.add(this.core)
		const glowMaterial = own(
			new THREE.MeshBasicMaterial({
				color: this.config.color,
			})
		)
		this.chestCore = new THREE.Mesh(
			own(new THREE.SphereGeometry(0.55, 8, 6)),
			glowMaterial
		)
		this.chestCore.position.set(
			0,
			this.config.size * 0.17,
			this.config.size * 0.3
		)
		this.chestCore.scale.setScalar(
			this.kind === 'colossus' || this.kind === 'entityBoss'
				? 1.4
				: 0.5
		)
		this.root.add(this.chestCore)
		this.fragments = []
		if (this.kind === 'gravRift') {
			for (let i = 0; i < 6; i++) {
				const stone = new THREE.Mesh(
					this.core.geometry,
					this.material
				)
				stone.scale.setScalar(0.38)
				this.root.add(stone)
				this.fragments.push(stone)
			}
		}
		this.shield = new THREE.Mesh(
			own(new THREE.SphereGeometry(1, 12, 10)),
			own(
				new THREE.MeshBasicMaterial({
					color: 0x805bfa,
					wireframe: true,
					transparent: true,
					opacity: 0.28,
				})
			)
		)
		this.shield.scale.setScalar(this.config.size * 0.85)
		this.shield.visible = false
		this.root.add(this.shield)
		this.state = 'patrol'
		this.timer = 0.7
		this.cooldown = 0
		this.abilityIndex = 0
		this.currentAbility = ''
		this.phase = 1
		this.dead = false
		this.active = false
		this.disposed = false
		this.exposed = 0
		this.shieldTime = 0
		this.cloakTime = 0
		this.overloadTime = 0
		this.attackHits = 0
		this.chargeDamage = 0
		this.interrupted = false
		this.stride = 0
		this.time = 0
		this.moveSpeed = 0
		this.model = null
		this.animator = null
		this._lastMove = new THREE.Vector3()
		this._target = new THREE.Vector3()
		this._flank = new THREE.Vector3()
		this._oldAbility = ''
		this._warningPos = new THREE.Vector3()
	}
	activate() {
		if (this.disposed || this.active) return
		this.active = true
		this.root.visible = true
		this._loadModel()
	}
	async _loadModel() {
		const name = this.config.asset
		if (!name) return
		const model = await loadVoidModel(this.level.assetManager, name)
		if (!model || this.disposed || this.dead) return
		model.updateMatrixWorld(true)
		const box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(tmp)
		model.scale.multiplyScalar(
			this.config.size /
				Math.max(size.x, size.y, size.z, 0.001)
		)
		model.updateMatrixWorld(true)
		model.position.sub(
			new THREE.Box3()
				.setFromObject(model)
				.getCenter(new THREE.Vector3())
		)
		// Use the animation clips when present; otherwise the actual rigged bones.
		this.model = model
		this.root.add(model)
		const clips = model.userData?.animations || []
		if (clips.length) {
			this.mixer = new THREE.AnimationMixer(model)
			this.clipActions = new Map(
				clips.map((clip) => [
					clip.name.toLowerCase(),
					this.mixer.clipAction(clip),
				])
			)
		} else
			this.animator = new VoidRigAnimator(
				model,
				this.config.species
			)
		if (this.kind === 'stalker') {
			this.cloakMaterials = []
			model.traverse((node) => {
				if (!node.isMesh || !node.material) return
				const prepare = (source) => {
					const material = source.clone()
					material.transparent = true
					material.depthWrite = false
					this.resources.push(material)
					this.cloakMaterials.push(material)
					return material
				}
				node.material = Array.isArray(node.material)
					? node.material.map(prepare)
					: prepare(node.material)
			})
		}
		if (this.animator.isRigged || model.children.length)
			this.core.visible = false
	}
	takeDamage(amount) {
		if (!this.active || this.dead) return false
		let multiplier = 1
		if (this.shieldTime > 0 && this.exposed <= 0) multiplier = 0.28
		if (this.overloadTime > 0) multiplier = 0.35
		if (this.exposed > 0) multiplier = 1.5
		const applied = Math.max(1, Math.round(amount * multiplier))
		this.hp = Math.max(0, this.hp - applied)
		if (
			this.currentAbility === 'existenceErasure' &&
			this.state === 'windup'
		) {
			this.chargeDamage += applied
			if (this.chargeDamage >= 100) {
				this.interrupted = true
				this.state = 'recover'
				this.timer = 2.3
				this.exposed = 3
			}
		}
		if (this.hp <= 0) this._die()
		return true
	}
	_die() {
		this.dead = true
		this.state = 'dead'
		this.shield.visible = false
		this.material.emissiveIntensity = 0.08
		this.timer = 1.4
		this.fx.implode(this.position, this.config.color)
	}
	get abilities() {
		if (this.kind === 'entityBoss')
			return ENTITY_PHASES[this.phase - 1]
		return this.config.abilities
	}
	_begin(ability, player) {
		this.currentAbility = ability
		this.state = 'windup'
		this.timer = TELEGRAPH[ability] ?? 1.1
		this._warningPos.copy(player)
		this.chargeDamage = 0
		this.interrupted = false
		this.attackHits = 0
		const radius = [
			'seismicSlam',
			'voidRoar',
			'riftPulse',
			'eventHorizonSurge',
			'gravityReversal',
			'gravitationalCrush',
		].includes(ability)
			? 22
			: 7
		this.fx.warn(this.position, radius, this.timer)
		if (
			[
				'shadowPounce',
				'voidTendrils',
				'meteor',
				'worldCollapse',
				'realityFracture',
				'dimensionalPrison',
			].includes(ability)
		)
			this.fx.warn(player, 9, this.timer)
		this.level.voidAudio?.play(
			'charge',
			this.position,
			this.kind === 'colossus' ? 0.65 : 1,
			this.timer
		)
	}
	_execute(player) {
		const fx = this.fx,
			p = this.position,
			a = this.currentAbility
		const melee = (radius, damage) => {
			if (p.distanceTo(player) <= radius) fx._damage(damage)
		}
		switch (a) {
			case 'voidStrike':
				melee(10, 15)
				this.shieldTime = 0
				this.exposed = 2.2
				break
			case 'riftBolt':
				fx.bolt(p, player, {
					damage: 12,
					speed: 37,
					tracking: 0.4,
				})
				break
			case 'phaseStep':
			case 'dimensionalBlink': {
				// Short teleports clamp to the actual zero-gravity combat corridor.
				this._flank
					.copy(player)
					.add(
						new THREE.Vector3(
							12 *
								Math.sin(
									this
										.time
								),
							1,
							12 * Math.cos(this.time)
						)
					)
				this._flank.x = clamp(
					this._flank.x,
					LIMIT.minX,
					LIMIT.maxX
				)
				this._flank.y = clamp(
					this._flank.y,
					LIMIT.minY,
					LIMIT.maxY
				)
				this._flank.z = clamp(
					this._flank.z,
					LIMIT.minZ,
					LIMIT.maxZ
				)
				this.root.position.copy(this._flank)
				break
			}
			case 'guardianShield':
				this.shieldTime = 3.5
				break
			case 'seismicSlam':
				fx.pulse(p, {
					radius: 28,
					damage: 22,
					duration: 0.95,
				})
				this.exposed = 2.6
				break
			case 'gravityPunch':
				melee(13, 26)
				tmp.subVectors(player, p).normalize()
				this.level.velocity.addScaledVector(tmp, 18)
				this.exposed = 2.2
				break
			case 'voidRoar':
				fx.pulse(p, {
					radius: 33,
					damage: 9,
					duration: 1.2,
				})
				this.exposed = 1.8
				for (const foe of fx.fighters || [])
					if (
						foe !== this &&
						!foe.dead &&
						foe.position.distanceTo(p) < 33
					) {
						foe.cooldown = Math.max(
							foe.cooldown,
							0.9
						)
						if (foe.state === 'windup') {
							foe.state = 'recover'
							foe.timer = Math.max(
								foe.timer,
								0.9
							)
						}
					}
				break
			case 'armourOverload':
				this.overloadTime = 4
				break
			case 'riftCloak':
				this.cloakTime = 3.2
				break
			case 'shadowPounce':
				this._flank.copy(this._warningPos)
				this._flank.addScaledVector(
					tmp
						.subVectors(
							this.position,
							this._warningPos
						)
						.normalize(),
					6
				)
				this.root.position.lerp(this._flank, 0.8)
				melee(10, 16)
				this.exposed = 2.5
				break
			case 'executionClaws':
				melee(9, 13)
				fx.zone(this._warningPos, 7, {
					warn: 0.75,
					damage: 11,
				})
				break
			case 'gravityWell':
				fx.field(this._warningPos, {
					radius: 36,
					duration: 3,
					pull: 36,
					damage: 10,
				})
				this.exposed = 2
				break
			case 'riftPulse':
				fx.pulse(p, {
					radius: 32,
					damage: 14,
					duration: 0.9,
				})
				this.exposed = 1.5
				break
			case 'debrisStorm':
				for (let i = 0; i < 3; i++) {
					this._target.copy(player)
					this._target.x += (i - 1) * 9
					fx.meteor(
						this._target,
						0.85 + i * 0.2,
						11
					)
				}
				this.exposed = 2.2
				break
			case 'spatialDistortion':
				fx.field(this._warningPos, {
					radius: 28,
					duration: 2.5,
					pull: 22,
					axis: 'down',
				})
				this.exposed = 2
				break
			case 'realityShards':
				fx.volley(p, player, 4, 13, 32)
				break
			case 'voidTendrils':
				for (let i = 0; i < 3; i++) {
					this._target.copy(this._warningPos)
					this._target.x += 9 * (i - 1)
					fx.zone(this._target, 7, {
						warn: 0.8,
						damage: 16,
					})
				}
				break
			case 'spatialRift':
				fx.volley(p, player, 5, 10, 28)
				fx.field(this._warningPos, {
					radius: 20,
					duration: 1.7,
					pull: 10,
				})
				break
			case 'falseImage':
			case 'infiniteEchoes':
				for (
					let i = 0;
					i < (a === 'infiniteEchoes' ? 4 : 2);
					i++
				) {
					this._target.copy(p)
					this._target.x += (i - 1) * 12
					this._target.y += Math.sin(i * 2.4) * 9
					fx.decoy(this._target, 5.5)
				}
				break
			case 'gravityReversal':
				fx.field(this._warningPos, {
					radius: 32,
					duration: 2.3,
					pull: 34,
					axis: 'up',
				})
				break
			case 'realityFracture':
				for (let i = 0; i < 4; i++) {
					this._target.copy(this._warningPos)
					this._target.x += (i - 1.5) * 13
					fx.zone(this._target, 8, {
						warn: 0.7,
						damage: 14,
					})
				}
				break
			case 'temporalEcho':
				fx.bolt(p, player, { damage: 15, speed: 35 })
				fx.zone(this._warningPos, 8, {
					warn: 1.35,
					damage: 15,
				})
				break
			case 'dimensionalPrison':
				fx.field(this._warningPos, {
					radius: 16,
					duration: 2.0,
					pull: 22,
				})
				fx.zone(this._warningPos, 7, {
					warn: 1.0,
					damage: 10,
				})
				break
			case 'worldCollapse':
				for (let i = 0; i < 3; i++) {
					this._target.copy(this._warningPos)
					this._target.z += i * 13 - 13
					fx.zone(this._target, 9, {
						warn: 0.95,
						damage: 17,
					})
				}
				break
			case 'eventHorizonSurge':
				fx.field(p, {
					radius: 48,
					duration: 3,
					pull: 30,
					damage: 12,
				})
				fx.volley(p, player, 4, 12, 31)
				break
			case 'existenceErasure':
				if (!this.interrupted) {
					fx.beam(p, this._warningPos, {
						warning: 0.8,
						duration: 1.2,
						damage: 38,
						radius: 11,
					})
					fx.volley(p, player, 6, 14, 36)
				}
				break
		}
		this.level.voidAudio?.play(
			'attack',
			p,
			this.kind === 'colossus' ? 0.65 : 1
		)
	}
	update(dt, player) {
		if (!this.active || this.disposed) return
		const step = Math.min(dt, 0.05)
		this.time += step
		if (this.dead) {
			this.timer -= step
			this.root.scale.setScalar(
				Math.max(0.02, this.timer / 1.4)
			)
			if (this.timer <= 0) this.root.visible = false
			return
		}
		this.exposed = Math.max(0, this.exposed - step)
		this.shieldTime = Math.max(0, this.shieldTime - step)
		this.overloadTime = Math.max(0, this.overloadTime - step)
		this.cloakTime = Math.max(0, this.cloakTime - step)
		this.shield.visible =
			this.shieldTime > 0 || this.overloadTime > 0
		this.root.visible = !(
			this.state === 'windup' &&
			['phaseStep', 'dimensionalBlink'].includes(
				this.currentAbility
			) &&
			this.timer < 0.16
		)
		if (this.kind === 'stalker') {
			const opacity = this.cloakTime > 0 ? 0.26 : 1
			this.material.opacity = opacity
			this.material.transparent = opacity < 1
			for (const mat of this.cloakMaterials || [])
				mat.opacity = opacity
		}
		this.shield.material.opacity =
			this.overloadTime > 0 ? 0.6 : 0.27
		this.material.emissiveIntensity =
			this.state === 'windup'
				? 2
				: this.exposed > 0
					? 1.15
					: 0.5
		const height = this.kind === 'entityBoss' ? 0.35 : 0.15
		this.core.rotation.y += step * height
		this.chestCore.scale.setScalar(
			(this.kind === 'colossus' || this.kind === 'entityBoss'
				? 1.4
				: 0.5) *
				(this.state === 'windup'
					? 1.4 + 0.2 * Math.sin(this.time * 10)
					: 1)
		)
		for (let i = 0; i < this.fragments.length; i++) {
			const a = this.time + (i * Math.PI) / 3
			this.fragments[i].position.set(
				Math.cos(a) * 5,
				Math.sin(a * 0.8) * 3,
				Math.sin(a) * 5
			)
		}
		this.core.scale.setScalar(
			this.config.size *
				0.42 *
				(1 +
					(this.state === 'windup'
						? 0.04 *
							Math.sin(this.time * 13)
						: 0))
		)
		const dist = this.position.distanceTo(player)
		if (this.kind === 'entityBoss') {
			const frac = this.hp / this.maxHp
			const newPhase = frac > 0.6 ? 1 : frac > 0.25 ? 2 : 3
			if (newPhase !== this.phase) {
				this.phase = newPhase
				this.state = 'recover'
				this.timer = 2
				this.abilityIndex = 0
				this.fx.clear()
				this.level._showMovementFeedback?.(
					`VOID-ENTITY // PHASE ${this.phase} — ${['THE WATCHER', 'THE UNMAKING', 'BEYOND THE VOID'][this.phase - 1]}`,
					3
				)
			}
		}
		if (this.state === 'patrol' || this.state === 'approach') {
			if (
				this.state === 'patrol' &&
				dist >= this.config.detection
			) {
				this._target.set(
					this.home.x +
						Math.sin(this.time * 0.45) * 10,
					this.home.y +
						Math.cos(this.time * 0.33) * 3,
					this.home.z +
						Math.cos(this.time * 0.45) * 10
				)
			} else {
				if (this.state === 'patrol')
					this.state = 'approach'
				if (this.kind === 'entityBoss')
					this._target
						.copy(this.home)
						.lerp(player, 0.12)
				else this._target.copy(player)
			}
			const desired = this._target.sub(this.position)
			const desiredDistance = desired.length()
			const stopRange =
				this.state === 'patrol'
					? 2
					: this.kind === 'entityBoss'
						? 34
						: this.kind === 'gravRift'
							? 25
							: this.config.reach *
								0.78
			const desiredSpeed =
				this.state === 'patrol'
					? this.config.speed * 0.35
					: desiredDistance > stopRange
						? this.config.speed
						: 0
			this.moveSpeed = THREE.MathUtils.damp(
				this.moveSpeed,
				desiredSpeed,
				this.kind === 'colossus' ? 1.4 : 3.5,
				step
			)
			if (desiredDistance > stopRange)
				this.root.position.addScaledVector(
					desired,
					Math.min(
						1,
						(this.moveSpeed * step) /
							desiredDistance
					)
				)
			this.root.position.x = clamp(
				this.root.position.x,
				LIMIT.minX,
				LIMIT.maxX
			)
			this.root.position.y = clamp(
				this.root.position.y,
				LIMIT.minY,
				LIMIT.maxY
			)
			this.root.position.z = clamp(
				this.root.position.z,
				LIMIT.minZ,
				LIMIT.maxZ
			)
			const yaw = Math.atan2(
				player.x - this.position.x,
				player.z - this.position.z
			)
			this.root.rotation.y +=
				Math.atan2(
					Math.sin(yaw - this.root.rotation.y),
					Math.cos(yaw - this.root.rotation.y)
				) *
				Math.min(
					1,
					step *
						(this.kind === 'colossus'
							? 1.7
							: this.kind ===
								  'stalker'
								? 5
								: 3)
				)
			this.cooldown -= step
			if (
				dist < this.config.detection &&
				this.cooldown <= 0
			) {
				const choices = this.abilities
				const ability =
					choices[
						this.abilityIndex++ %
							choices.length
					]
				this._begin(ability, player)
			}
		} else if (this.state === 'windup') {
			this.timer -= step
			if (this.timer <= 0) {
				this._execute(player)
				this.state = 'recover'
				this.timer =
					this.kind === 'entityBoss'
						? 1.5
						: this.kind === 'colossus'
							? 1.6
							: 0.9
				this.cooldown =
					this.kind === 'entityBoss' ? 0.65 : 0.8
			}
		} else if (this.state === 'recover') {
			// Assassins retreat during recovery rather than attacking from the same spot.
			if (this.kind === 'stalker' && dist < 32) {
				tmp.subVectors(
					this.position,
					player
				).normalize()
				this.root.position.addScaledVector(
					tmp,
					step * this.config.speed * 0.35
				)
				this.root.position.x = clamp(
					this.root.position.x,
					LIMIT.minX,
					LIMIT.maxX
				)
				this.root.position.z = clamp(
					this.root.position.z,
					LIMIT.minZ,
					LIMIT.maxZ
				)
			}
			this.timer -= step
			if (this.timer <= 0) this.state = 'approach'
		}
		if (this.mixer) {
			const hint =
				this.state === 'windup'
					? /attack|charge|cast/
					: this.state === 'recover'
						? /idle|recover/
						: /walk|run|idle/
			const next = [...this.clipActions.entries()].find(
				([name]) => hint.test(name)
			)?.[1]
			if (next && next !== this.currentAction) {
				this.currentAction?.fadeOut(0.2)
				next.reset().fadeIn(0.2).play()
				this.currentAction = next
			}
			this.mixer.update(step)
		} else
			this.animator?.update(step, {
				state:
					this.state === 'windup'
						? 'charge'
						: this.state === 'recover'
							? 'recover'
							: 'walk',
				speed:
					this.state === 'approach'
						? this.config.speed
						: 0,
				airborne: true,
			})
	}
	dispose() {
		this.disposed = true
		this.animator?.dispose()
		this.mixer?.stopAllAction()
		this.root.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}

export { CONFIG as VOID_ARENA_ENEMIES, ENTITY_PHASES }
