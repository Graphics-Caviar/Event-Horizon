/**
 * src/utils/animations.js
 *
 * Small, dependency-free motion helpers shared across systems. Kept
 * separate from any one system so CameraSystem, and later UI transitions,
 * all move with the same "feel" instead of each hand-rolling easing.
 */

/**
 * Framerate-independent exponential damping ("lerp done right" — see
 * Freya Holmer's derivation). Unlike a naive `current += (target-current)*t`
 * lerp, this produces the same motion regardless of frame rate, which
 * matters for a camera that must "never move abruptly" per the design brief.
 *
 * @param {number} current  current value
 * @param {number} target   value being approached
 * @param {number} lambda   approach rate — higher = snappier, ~1-10 is typical
 * @param {number} dt       delta time in seconds
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Damps a THREE.Vector3 in place toward a target vector. */
export function dampVector3(current, target, lambda, dt) {
  current.x = damp(current.x, target.x, lambda, dt);
  current.y = damp(current.y, target.y, lambda, dt);
  current.z = damp(current.z, target.z, lambda, dt);
  return current;
}

/** Standard smoothstep, useful for UI fades / non-realtime transitions. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
