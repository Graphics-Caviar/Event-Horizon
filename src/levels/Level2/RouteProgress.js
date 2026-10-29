/**
 * Advance a monotonic route waypoint using the moving vehicle/player's
 * nearest *forward* road segment. Prevents doubling back to a missed marker.
 * Pure function so it can be regression-tested without Three.js.
 */
export function advanceRouteWaypoint(route, position, currentIndex = 1) {
	if (!route || route.length < 2) return 0
	let index = Math.max(1, Math.min(currentIndex, route.length - 1))
	// Near a bend, regard that waypoint as reached even if slightly off-centre.
	while (
		index < route.length - 1 &&
		Math.hypot(
			position.x - route[index].x,
			position.z - route[index].z
		) < 36
	) {
		index++
	}
	// Project onto nearby forward segments. Advance if already most of the
	// way along the next road section (including when the player cuts a bend).
	let best = null
	for (
		let end = index;
		end <= Math.min(route.length - 1, index + 3);
		end++
	) {
		const a = route[end - 1],
			b = route[end]
		const dx = b.x - a.x,
			dz = b.z - a.z
		const t = Math.max(
			0,
			Math.min(
				1,
				((position.x - a.x) * dx +
					(position.z - a.z) * dz) /
					(dx * dx + dz * dz || 1)
			)
		)
		const distance = Math.hypot(
			position.x - a.x - t * dx,
			position.z - a.z - t * dz
		)
		if (distance < 85 && (!best || distance < best.distance))
			best = { end, t, distance }
	}
	if (best && best.t > 0.82 && best.end < route.length - 1)
		index = Math.max(index, best.end + 1)
	return index
}
