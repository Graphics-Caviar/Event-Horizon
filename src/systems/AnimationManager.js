/**
 * AnimationManager — a tiny registry of "things with an update(delta)
 * method". Keeps main.js from having to know about every animated
 * object individually (spaceship, current character, VFX, ...): each
 * object registers itself once, and the render loop just calls
 * `animationManager.update(delta)`.
 */
export class AnimationManager {
  constructor() {
    this._targets = new Set();
  }

  register(target) {
    if (typeof target.update !== 'function') {
      throw new Error('AnimationManager.register() requires an object with an update(delta) method.');
    }
    this._targets.add(target);
  }

  unregister(target) {
    this._targets.delete(target);
  }

  /** @param delta seconds since last frame
   *  @param extraArgs forwarded to every target's update() after delta
   *                    (e.g. a camera reference, for billboarded VFX) */
  update(delta, ...extraArgs) {
    for (const target of this._targets) {
      target.update(delta, ...extraArgs);
    }
  }

  clear() {
    this._targets.clear();
  }
}
