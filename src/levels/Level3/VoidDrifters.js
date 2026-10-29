import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'
import { VoidRigAnimator } from './VoidRigAnimator.js'

/** Three limited, rigged threats in the zero-gravity Void Dimension.
 * Uses fixed model counts: no hidden thousands-of-enemies performance cost.
 * Failure to load one GLB never blocks the exit or the level transition.
 */
export class VoidDrifters {
	constructor(level, parent) {
		this.level = level
		this.parent = parent
		this.disposed = false
		this.time = 0
		this.scratch = new THREE.Vector3()
		this.actors = [
			{
				asset: 'voidEntity',
				species: 'entity',
				at: [-16, 12, -95],
				speed: 8,
				damage: 10,
				radius: 6,
			},
			{
				asset: 'voidSentinel',
				species: 'sentinel',
				at: [13, 9, -208],
				speed: 5.5,
				damage: 15,
				radius: 7,
			},
			{
				asset: 'voidColossus',
				species: 'colossus',
				at: [-18, 10, -310],
				speed: 3.5,
				damage: 25,
				radius: 9,
			},
		].map((config, i) => {
			const root = new THREE.Group()
			root.name = `void-dimension-${config.species}`
			root.position.fromArray(config.at)
			parent.add(root)
			return {
				...config,
				root,
				origin: root.position.clone(),
				animator: null,
				model: null,
				cooldown: i + 0.6,
				phase: i * 2.5,
			}
		})
		for (const actor of this.actors) this.load(actor)
	}

	async load(actor) {
		try {
			const model = await loadVoidModel(
				this.level.assetManager,
				actor.asset
			)
			if (this.disposed || !actor.root.parent || !model)
				return
			this.level._fit(
				model,
				actor.species === 'colossus' ? 10 : 6
			)
			model.updateMatrixWorld(true)
			// Recenter vertically after fitting so the drift pivot is the torso.
			const bounds = new THREE.Box3().setFromObject(model)
			model.position.y -= (bounds.min.y + bounds.max.y) / 2
			model.traverse((part) => {
				if (part.isMesh) part.castShadow = false
			})
			actor.root.add(model)
			actor.model = model
			actor.animator = new VoidRigAnimator(
				model,
				actor.species
			)
		} catch (error) {
			console.warn(
				`[Level3] Void ${actor.species} model unavailable:`,
				error?.message
			)
		}
	}

	update(delta) {
		if (this.disposed || this.level.completed) return
		const dt = Math.min(Math.max(delta, 0), 0.05)
		this.time += dt
		const player = this.level.playerRoot.position
		for (const actor of this.actors) {
			if (!actor.model) continue
			actor.cooldown = Math.max(0, actor.cooldown - dt)
			this.scratch.subVectors(player, actor.root.position)
			const distance = this.scratch.length()
			const chasing = distance < 85
			const attack = chasing && distance < actor.radius
			let speed = 0
			if (chasing && distance > actor.radius * 0.75) {
				this.scratch.multiplyScalar(
					1 / Math.max(distance, 0.001)
				)
				speed = actor.speed
				actor.root.position.addScaledVector(
					this.scratch,
					speed * dt
				)
			} else if (!chasing) {
				actor.root.position.y = THREE.MathUtils.damp(
					actor.root.position.y,
					actor.origin.y +
						Math.sin(
							this.time + actor.phase
						) *
							2,
					1.4,
					dt
				)
			}
			// Steer their visual fronts toward the moving pilot.
			const yaw = Math.atan2(
				player.x - actor.root.position.x,
				player.z - actor.root.position.z
			)
			const turn = Math.atan2(
				Math.sin(yaw - actor.root.rotation.y),
				Math.cos(yaw - actor.root.rotation.y)
			)
			actor.root.rotation.y += turn * (1 - Math.exp(-3 * dt))
			actor.animator?.update(dt, {
				state: attack
					? 'prepare'
					: chasing
						? 'chase'
						: 'idle',
				speed,
				airborne: actor.species === 'entity',
			})
			if (attack && actor.cooldown <= 0) {
				actor.cooldown =
					actor.species === 'colossus' ? 3.8 : 2.5
				this.level._applyAlienHit(actor.damage)
			}
		}
	}

	dispose() {
		this.disposed = true
		for (const actor of this.actors) {
			actor.animator?.dispose()
			actor.root.removeFromParent()
		}
		this.actors.length = 0
	}
}
