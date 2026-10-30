import * as THREE from 'three'

// Constrain the final camera position, after smoothing, so lag cannot carry
// the near plane through a ridge. Keep the whole sightline above the surface.
// A custom surface sampler lets levels with removable terrain (Level 3's
// collapse) report "no ground" instead of the original, already-gone surface.
export function constrainTerrainCamera(
	position,
	target,
	planet,
	surfaceAt = (x, z) => planet.heightAt(x, z)
) {
	planet.clampToBounds(position, 2)
	const distance = Math.hypot(
		position.x - target.x,
		position.z - target.z
	)
	const steps = Math.max(1, Math.ceil(distance / 0.5))
	// If the focus is below the surface (for example while falling through
	// collapsed ground), lifting the camera to clear the ridge near the focus
	// would divide by a tiny t and catapult it thousands of units into the
	// sky. Treat a buried focus as standing on the surface instead.
	const targetFloor = surfaceAt(target.x, target.z)
	const focusY = Number.isFinite(targetFloor)
		? Math.max(target.y, targetFloor + 0.6)
		: target.y
	for (let i = 1; i <= steps; i++) {
		const t = i / steps
		const x = THREE.MathUtils.lerp(target.x, position.x, t)
		const z = THREE.MathUtils.lerp(target.z, position.z, t)
		const height = surfaceAt(x, z)
		if (!Number.isFinite(height)) continue
		const floor = height + 0.6
		position.y = Math.max(position.y, focusY + (floor - focusY) / t)
	}
	// Padding covers near-plane corners and tiny ridges between samples.
	for (const dx of [-0.6, 0, 0.6])
		for (const dz of [-0.6, 0, 0.6]) {
			const height = surfaceAt(
				position.x + dx,
				position.z + dz
			)
			if (!Number.isFinite(height)) continue
			position.y = Math.max(position.y, height + 1.2)
		}
	return position
}
