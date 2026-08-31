/**
 * src/systems/CameraSystem.js
 *
 * Owns all camera motion so CharacterSelectScene never sets camera
 * position/lookAt directly — that keeps "make the camera feel cinematic"
 * a single, tunable responsibility.
 *
 * STAGE 2 scope (done): idle orbit + gentle vertical bob, damped so the
 * camera never snaps.
 * STAGE 5 scope (this update): focusOn()/release() ease the orbit toward
 * a selected pilot's slot and back, reusing the same damping — a target
 * change, not a different motion system.
 */

import * as THREE from 'three';
import { damp } from '../utils/animations.js';

const IDLE_RADIUS = 4.6; // closer than the original 6.2 — pilots need to read
                          // large enough that their heads clear the card's
                          // info panel and land in the transparent space above it
const IDLE_HEIGHT = 1.85;
const IDLE_HEIGHT_BOB = 0.18;
const IDLE_ANGULAR_SPEED = 0.045; // radians/sec — deliberately slow
const IDLE_BOB_SPEED = 0.35;
const FOCUS_HEIGHT_LIFT = 1.0; // camera sits this much above its look-at point when focused — a gentle downward angle, not a steep one
const DAMP_LAMBDA = 2.2; // how eagerly the camera chases its target transform

export class CameraSystem {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;

    // The point the camera looks at. A plain Vector3 (not camera.lookAt
    // directly) so it can itself be damped later when focusing a pilot.
    this.lookTarget = new THREE.Vector3(0, 1.3, 0);
    this._dampedLookTarget = this.lookTarget.clone();

    // Desired position, recomputed each frame from orbit parameters; the
    // camera's actual position damps toward this rather than jumping to it.
    this._desiredPosition = new THREE.Vector3();
    this._angle = -Math.PI / 2; // start facing the scene head-on

    this._focus = null; // set by Stage 5's focusOn(); null = idle orbit
  }

  /**
   * Advance the orbit and (eventually) any active focus transition, then
   * apply the damped result to the real THREE.PerspectiveCamera.
   * @param {number} dt delta time in seconds
   * @param {number} elapsed total elapsed time in seconds
   */
  update(dt, elapsed) {
    this._angle += IDLE_ANGULAR_SPEED * dt;

    let targetLook;

    if (this._focus) {
      // Fixed shot relative to the pilot's own slot (set in focusOn) —
      // a small vertical bob keeps it from feeling frozen, but the
      // camera no longer orbits the world origin while focused.
      const bob = Math.sin(elapsed * IDLE_BOB_SPEED) * (IDLE_HEIGHT_BOB * 0.4);
      this._desiredPosition.set(
        this._focus.position.x,
        this._focus.position.y + bob,
        this._focus.position.z
      );
      targetLook = this._focus.lookAt;
    } else {
      const bob = Math.sin(elapsed * IDLE_BOB_SPEED) * IDLE_HEIGHT_BOB;
      this._desiredPosition.set(
        Math.cos(this._angle) * IDLE_RADIUS,
        IDLE_HEIGHT + bob,
        Math.sin(this._angle) * IDLE_RADIUS
      );
      targetLook = this.lookTarget;
    }

    this.camera.position.x = damp(this.camera.position.x, this._desiredPosition.x, DAMP_LAMBDA, dt);
    this.camera.position.y = damp(this.camera.position.y, this._desiredPosition.y, DAMP_LAMBDA, dt);
    this.camera.position.z = damp(this.camera.position.z, this._desiredPosition.z, DAMP_LAMBDA, dt);

    this._dampedLookTarget.x = damp(this._dampedLookTarget.x, targetLook.x, DAMP_LAMBDA, dt);
    this._dampedLookTarget.y = damp(this._dampedLookTarget.y, targetLook.y, DAMP_LAMBDA, dt);
    this._dampedLookTarget.z = damp(this._dampedLookTarget.z, targetLook.z, DAMP_LAMBDA, dt);

    this.camera.lookAt(this._dampedLookTarget);
  }

  /**
   * Ease the camera to a fixed shot directly in front of a specific
   * pilot's slot: `selectedOrbitRadius` units in front of them (+Z, the
   * same side the idle camera generally views from) and `heightOffset`
   * plus a small lift above the ground, looking at their own position.
   * All motion still flows through the same damp() calls in update(),
   * so this never snaps — it's a target change, not a teleport.
   *
   * Deliberately NOT derived from an orbit around the world origin
   * (the previous approach: `radius`/`angle` computed via
   * `Math.atan2` on the slot's own x/z). That only produced sane
   * full-body framing for Kai by coincidence, because his slot sits
   * almost exactly on the Z axis. For Zara and Nyx — offset sideways
   * from the origin — the same math put the camera very close to them
   * along a line through the origin, at a steep, erratic angle, which
   * is what was cropping their heads/feet out of frame. Positioning
   * relative to the pilot's own slot instead gives every pilot the
   * identical shot geometry, so framing no longer depends on where
   * their slot happens to sit in the grid.
   *
   * @param {THREE.Vector3} slotPosition  world position of the pilot's slot
   * @param {{ selectedOrbitRadius: number, heightOffset: number }} framing
   */
  focusOn(slotPosition, framing) {
    this._focus = {
      position: new THREE.Vector3(
        slotPosition.x,
        framing.heightOffset + FOCUS_HEIGHT_LIFT,
        slotPosition.z + framing.selectedOrbitRadius
      ),
      lookAt: new THREE.Vector3(slotPosition.x, framing.heightOffset, slotPosition.z),
    };
  }

  /** Release focus back to the idle orbit. */
  release() {
    this._focus = null;
  }
}
