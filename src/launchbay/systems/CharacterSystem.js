/**
 * src/systems/CharacterSystem.js
 *
 * Owns the three CharacterModel instances (one per pilot), attaches each
 * to its anchor group in CharacterSelectScene.characterSlots, and drives
 * their per-frame update. Implements the `update(dt, elapsed)` interface
 * CharacterSelectScene's render loop expects, so it registers as a plain
 * updatable — the scene doesn't need to know anything model-specific.
 *
 * STAGE 4 (done): loading + attaching + idle playback.
 * STAGE 5 (this update): setHovered()/setSelected() coordinate the visual
 * response to selection across three separate systems that don't know
 * about each other — CharacterModel's scale pulse, CharacterSelectScene's
 * rim-light emphasis, and (from main.js) CameraSystem's focus — so hover
 * and click always mean the same thing everywhere, not three places to
 * keep in sync by hand.
 */

import { CHARACTERS } from '../data/characters.js';
import CharacterModel from '../components/CharacterModel/CharacterModel.js';

export class CharacterSystem {
  /** @param {import('../scenes/CharacterSelectScene.js').CharacterSelectScene} scene */
  constructor(scene) {
    this.scene = scene;
    this._models = new Map(); // character id -> CharacterModel
    this._hoveredId = null;
    this._selectedId = null;

    for (const character of CHARACTERS) {
      const slot = scene.characterSlots[character.id];
      if (!slot) {
        console.warn(`[CharacterSystem] no scene slot found for "${character.id}" — skipping`);
        continue;
      }

      const model = new CharacterModel(character, {
        onReady: () => {
          console.log(`[CharacterSystem] "${character.id}" model ready`);
        },
        onError: (err) => {
          console.warn(`[CharacterSystem] "${character.id}" using fallback: ${err.message}`);
        },
      });

      slot.add(model.root);
      this._models.set(character.id, model);
    }
  }

  /** @param {string} id */
  getModel(id) {
    return this._models.get(id) ?? null;
  }

  /**
   * @param {string|null} id  id of the hovered pilot, or null when the
   *   pointer leaves every card
   */
  setHovered(id) {
    if (this._hoveredId === id) return;
    const previousId = this._hoveredId;
    this._hoveredId = id;

    // Hover attempts a brief non-looping "ability" clip as the pilot's
    // subtle animation; if the model has no such clip (or no animations
    // at all) this is a silent no-op and the scale pulse alone carries
    // the feedback. Leaving hover returns to idle.
    if (previousId) this._models.get(previousId)?.play('idle', { fade: 0.3 });
    if (id && !this._selectedId) {
      this._models.get(id)?.play('ability', { fade: 0.25, loop: false });
    }

    this._refreshEmphasis();
  }

  /** @param {string|null} id  id of the selected pilot, or null to clear selection */
  setSelected(id) {
    if (this._selectedId === id) return;
    this._selectedId = id;

    if (id) this._models.get(id)?.play('idle', { fade: 0.3 });
    this._refreshEmphasis();
  }

  /**
   * Recomputes and (re)dispatches the scale-pulse target and rim-light
   * emphasis target for every pilot based on current hover/selection.
   * Centralizing this here (rather than scattering the same if/else
   * across CharacterModel and CharacterSelectScene) is what keeps hover
   * and selection visually consistent as more states get added later.
   */
  _refreshEmphasis() {
    for (const [id, model] of this._models) {
      const isSelected = id === this._selectedId;
      const isHovered = id === this._hoveredId && !this._selectedId;
      const isDimmed = Boolean(this._selectedId) && !isSelected;

      let targetScale = 1;
      if (isSelected) targetScale = 1.08;
      else if (isHovered) targetScale = 1.05;
      else if (isDimmed) targetScale = 0.95;
      model.setTargetScale(targetScale);

      let lightMultiplier = 1;
      if (isSelected) lightMultiplier = 1.8;
      else if (isHovered) lightMultiplier = 1.3;
      else if (isDimmed) lightMultiplier = 0.35;
      this.scene.setEmphasis(id, lightMultiplier);
    }
  }

  /** Matches the updatable interface CharacterSelectScene's loop expects. */
  update(dt, elapsed) {
    for (const model of this._models.values()) {
      model.update(dt, elapsed);
    }
  }

  dispose() {
    for (const model of this._models.values()) model.dispose();
    this._models.clear();
  }
}

