import { GravityStorm } from './GravityStorm.js'

/**
 * Every hazard Level 2 can throw at the player, keyed by name.
 *
 * To add one: write a class with
 *   constructor(level)                // builds itself and starts
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
	constructor(level, { types = HAZARD_TYPES } = {}) {
		this.level = level
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
		const hazard = new HazardClass(this.level)
		this.active.push(hazard)
		console.log('Spawned: ', hazard)
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

	/**
	 * Gravity multiplier at a world position ({x, y, z}, e.g. a Vector3):
	 * 1 outside every storm, otherwise the storm's multiplier (can be 0 or
	 * negative). Call this from movement code, e.g.
	 *   const g = this.level.hazards.gravityMultiplierAt(this.group.position)
	 */
	gravityMultiplierAt(position) {
		return GravityStorm.getMultiplierAt(position)
	}

	/** Live gravity zones as [{ name, center, radius, multiplier }], e.g. for a HUD. */
	getGravityZones() {
		return GravityStorm.active.map(
			({ name, center, radius, multiplier }) => ({
				name,
				center,
				radius,
				multiplier,
			})
		)
	}

	/**
	 * Movement speed factor at a position: 1 outside storms, below 1 in heavy
	 * gravity (floored at 0.15 so players are slowed, never frozen) and up to
	 * 1.4 in light or reversed gravity. Tune the curve here, in one place.
	 *   speed * this.level.hazards.speedFactorAt(position)
	 */
	speedFactorAt(position) {
		const g = this.gravityMultiplierAt(position)
		if (g >= 1) return Math.max(0.15, 1 / Math.sqrt(g))
		return 1 + 0.4 * (1 - Math.max(g, 0))
	}

	dispose() {
		for (const hazard of this.active) hazard.dispose()
		this.active.length = 0
	}
}
