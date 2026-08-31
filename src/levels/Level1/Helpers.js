import * as THREE from 'three'

export function generateUniqueVertices(count, min, max) {
	const vertices = []
	const seen = new Set()

	while (vertices.length < count) {
		const x = Math.random() * (max - min) + min
		const y = Math.random() * (max - min) + min
		const z = Math.random() * (max - min) + min

		const precision = 4
		const key = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`

		if (!seen.has(key)) {
			seen.add(key)
			vertices.push(new THREE.Vector3(x, y, z))
		}
	}

	return vertices
}

export function orbitLikeVelocity(
	celestialBodyGravityStength,
	orbitSpeedFactor,
	position
) {
	// Object should go fast enough perpendicular to the pull so the object
	// look like it is orbiting the celestial body.
	// Adjust orbitSpeedFactor to modify whether it is below that threshold
	// or above, with 1.0 meaning that it should try to be exactly on orbit.
	const r = Math.max(position.length(), 1)
	const speed =
		Math.sqrt(celestialBodyGravityStength / r) * orbitSpeedFactor

	// Get the direction of the object from the celestial body (since it is in origin) and calculate
	// the tangent of that so it is perpendicular to the force applied by the
	// celestial body.
	const radial = position.clone().normalize()
	const up = new THREE.Vector3(0, 1, 0)
	// Cross product of the radial and our up should give something perpendicular to
	// both of these vectors.
	let tangent = new THREE.Vector3().crossVectors(up, radial)
	if (tangent.lengthSq() < 1e-6) {
		tangent = new THREE.Vector3(1, 0, 0)
	}
	tangent.normalize()

	// Now we apply the magnitude of speed speed to the direction required
	// to get orbit.
	return tangent.multiplyScalar(speed)
}
