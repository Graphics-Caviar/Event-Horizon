import * as THREE from 'three'

/**
 * "Change course" warning: a red wireframe box around every asteroid the
 * ship will hit if it holds its current velocity.
 *
 * The prediction uses the same spheres as AsteroidField.checkShipCollision's
 * broad phase (the whole-model radius plus the ship's collisionRadius), so a
 * box only appears for a real threat and clears as soon as the player has
 * steered off it. Boxes are pooled and share one geometry and material:
 * nothing is allocated per frame.
 */
export class CollisionWarning {
	/**
	 * @param {object} level owns the geometry/material and the box group
	 * @param {object} asteroidField the Level 1 AsteroidField
	 * @param {object} spaceship the Level 1 Spaceship
	 * @param {object} [options]
	 * @param {number} [options.lookahead] seconds ahead a hit is predicted
	 * @param {number} [options.margin] extra miss distance still flagged
	 * @param {number} [options.maxBoxes] most warnings shown at once
	 * @param {number} [options.padding] box size relative to the rock's diameter
	 */
	constructor(
		level,
		asteroidField,
		spaceship,
		{
			lookahead = 2.5,
			margin = 2,
			maxBoxes = 8,
			padding = 1.15,
		} = {}
	) {
		this.field = asteroidField
		this.ship = spaceship
		this.lookahead = lookahead
		this.margin = margin
		this.padding = padding
		this.elapsed = 0
		this.count = 0 // boxes shown this frame

		// One unit cube for every box; each is scaled to its asteroid.
		const cube = new THREE.BoxGeometry(1, 1, 1)
		const geometry = level.own(new THREE.EdgesGeometry(cube))
		cube.dispose()
		const material = level.own(
			new THREE.LineBasicMaterial({
				color: 0xff3030,
				transparent: true,
				depthWrite: false,
			})
		)
		this.material = material

		this.group = new THREE.Group()
		this.group.name = 'collisionWarnings'
		level.addObject(this.group)

		this.boxes = []
		for (let i = 0; i < maxBoxes; i++) {
			const box = new THREE.LineSegments(geometry, material)
			box.name = `collisionWarning_${i}`
			box.visible = false
			this.group.add(box)
			this.boxes.push(box)
		}

		this._relPos = new THREE.Vector3()
		this._relVel = new THREE.Vector3()
	}

	/** @param {number} dt scaled frame time, in seconds */
	update(dt) {
		this.elapsed += dt
		const count = this.field.loaded ? this._placeBoxes() : 0
		for (let i = 0; i < this.boxes.length; i++)
			this.boxes[i].visible = i < count
		this.count = count
	}

	/** Hide every box, e.g. once the run is over. */
	clear() {
		for (const box of this.boxes) box.visible = false
		this.count = 0
	}

	/** Box each asteroid on a collision course; returns how many. */
	_placeBoxes() {
		const { asteroids, models } = this.field
		const extra = this.ship.collisionRadius + this.margin
		// Every box pulses together: a slight breathe in size and opacity.
		const wave = Math.sin(this.elapsed * 9)
		const size = this.padding * 2 * (1 + wave * 0.04)
		this.material.opacity = 0.85 + wave * 0.15

		let count = 0
		for (const a of asteroids) {
			if (count === this.boxes.length) break
			const radius = models[a.modelIndex].radius * a.scale
			const reach = radius + extra
			if (!this._onCollisionCourse(a, reach)) continue

			// Asteroids are recycled in place with fresh vectors, so
			// read the position every frame rather than keeping it.
			const box = this.boxes[count++]
			box.position.copy(a.position)
			box.scale.setScalar(radius * size)
		}
		return count
	}

	/** Closest point of approach between the ship and asteroid `a`, both
	 * flying straight on at their current velocities. */
	_onCollisionCourse(a, reach) {
		const ship = this.ship
		const p = this._relPos.subVectors(a.position, ship.position)
		const v = this._relVel.subVectors(a.velocity, ship.velocity)
		const speedSq = v.lengthSq()
		if (speedSq < 1e-6) return false

		// Negative means the rock is already moving away from the ship.
		const t = -p.dot(v) / speedSq
		if (t < 0) return false

		// Past the lookahead, test where the rock is at the lookahead
		// instead: still inside reach then means contact starts within it.
		p.addScaledVector(v, Math.min(t, this.lookahead))
		return p.lengthSq() < reach * reach
	}
}
