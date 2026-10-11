import { GravityStorm } from './GravityStorm.js'

/**
 * Every hazard Level 2 can throw at the player, keyed by name.
 *
 * To add one: write a class with
 *   constructor(level, { gravity })   // builds itself and starts
 *   update(delta)
 *   get done()                        // true once it has fully finished
 *   dispose()                         // must be safe to call at any time
 *   static spawnWeight                // optional, relative chance (default 1)
 * and add it here. Nothing else needs to change.
 */
export const HAZARD_TYPES = Object.freeze({
	gravityStorm: GravityStorm,
})

const CONFIG = {
	firstRollDelay: 15,
	rollInterval: [10, 20],
	spawnChance: 0.6,
	maxActive: 1,
}

const rand = (min, max) => min + Math.random() * (max - min)

export class Hazards {
	constructor(
		level,
		{ gravity = level.gravitySystem, types = HAZARD_TYPES } = {}
	) {
		this.level = level
		this.gravity = gravity
		this.types = types
		this.active = []
		this.enabled = true
		this.rollTimer = CONFIG.firstRollDelay
	}

	update(delta) {
		for (const hazard of this.active) hazard.update(delta)
		this.active = this.active.filter((hazard) => !hazard.done)

		if (!this.enabled) return
		this.rollTimer -= delta
		if (this.rollTimer > 0) return
		this.rollTimer = rand(...CONFIG.rollInterval)

		if (this.active.length >= CONFIG.maxActive) return
		if (Math.random() >= CONFIG.spawnChance) return
		this.spawn()
	}

	/**
	 * Spawn a hazard now. With no argument one is picked at random (weighted by
	 * each class's spawnWeight); pass a key of HAZARD_TYPES to force one, e.g.
	 * `level.hazards.spawn('gravityStorm')` from the console while testing.
	 */
	spawn(type = this._pickType()) {
		const HazardClass = this.types[type]
		if (!HazardClass) return null
		const hazard = new HazardClass(this.level, {
			gravity: this.gravity,
		})
		this.active.push(hazard)
		return hazard
	}

	_pickType() {
		const entries = Object.entries(this.types).map(
			([key, Class]) => ({
				key,
				weight: Class.spawnWeight ?? 1,
			})
		)
		let roll =
			Math.random() *
			entries.reduce((s, e) => s + e.weight, 0)
		for (const entry of entries) {
			roll -= entry.weight
			if (roll <= 0) return entry.key
		}
		return entries[entries.length - 1]?.key
	}

	dispose() {
		for (const hazard of this.active) hazard.dispose()
		this.active.length = 0
	}
}
