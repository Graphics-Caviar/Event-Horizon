import * as THREE from 'three'

// Constrain the final camera position, after smoothing, so lag cannot carry
// the near plane through a ridge. Keep the whole sightline above the surface.
export function constrainTerrainCamera(position, target, planet) {
	planet.clampToBounds(position, 2)
	const distance = Math.hypot(
		position.x - target.x,
		position.z - target.z
	)
	const steps = Math.max(1, Math.ceil(distance / 0.5))
	for (let i = 1; i <= steps; i++) {
		const t = i / steps
		const x = THREE.MathUtils.lerp(target.x, position.x, t)
		const z = THREE.MathUtils.lerp(target.z, position.z, t)
		const floor = planet.heightAt(x, z) + 0.6
		position.y = Math.max(
			position.y,
			target.y + (floor - target.y) / t
		)
	}
	// Padding covers near-plane corners and tiny ridges between samples.
	for (const dx of [-0.6, 0, 0.6])
		for (const dz of [-0.6, 0, 0.6]) {
			position.y = Math.max(
				position.y,
				planet.heightAt(
					position.x + dx,
					position.z + dz
				) + 1.2
			)
		}
	return position
}
