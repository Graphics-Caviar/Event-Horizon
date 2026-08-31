/**
 * src/components/CharacterCard/CharacterCard.js
 *
 * Renders one pilot's grid label: just a name + role, sitting under
 * where that pilot's 3D model stands in the shared WebGL scene (see
 * scenes/CharacterSelectScene.js's `characterSlots`). Pure UI: it takes
 * a character data object and two callbacks (onHover, onSelect) and
 * reports intent upward.
 *
 * Deliberately does NOT carry a background panel, description, ability
 * list, or select button anymore — those used to live in a glass box
 * layered over the model's own screen space, which meant the model was
 * always either hidden behind that panel or (once zoomed in for the
 * selection camera shot) fighting with it for the same pixels, since a
 * WebGL canvas can only ever draw behind or in front of the DOM, never
 * "around" it. Full pilot detail now lives in PilotInfoPanel, which
 * mounts off to the side once a pilot is selected — clear of the
 * character's own screen space entirely, so there's nothing left to
 * overlap.
 */

export default class CharacterCard {
  /**
   * @param {object} character  entry from data/characters.js
   * @param {object} handlers
   * @param {(id: string) => void} handlers.onHover   called on pointerenter
   * @param {() => void} handlers.onHoverEnd          called on pointerleave
   * @param {(id: string) => void} handlers.onSelect  called on click
   */
  constructor(character, { onHover, onHoverEnd, onSelect } = {}) {
    this.character = character;

    this._el = document.createElement('article');
    this._el.className = 'character-card interactive';
    this._el.style.setProperty('--card-color', character.themeColor);
    this._el.style.setProperty('--card-color-dim', character.themeColorDim);
    this._el.dataset.characterId = character.id;
    this._el.tabIndex = 0; // keyboard-focusable: Enter/Space select, see below
    this._el.setAttribute('role', 'button');
    this._el.setAttribute('aria-pressed', 'false');
    this._el.setAttribute('aria-label', `Select pilot ${character.name}`);

    this._el.innerHTML = `
      <div class="character-card__label">
        <h2 class="character-card__name">${character.name}</h2>
        <p class="character-card__role">${character.role}</p>
      </div>
    `;

    this._el.addEventListener('pointerenter', () => onHover?.(character.id));
    this._el.addEventListener('pointerleave', () => onHoverEnd?.());

    const select = () => onSelect?.(character.id);
    this._el.addEventListener('click', select);
    this._el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  }

  get element() {
    return this._el;
  }

  /**
   * @param {{ isSelected?: boolean, isHovered?: boolean, isDimmed?: boolean }} state
   */
  setState({ isSelected = false, isHovered = false, isDimmed = false } = {}) {
    this._el.classList.toggle('is-selected', isSelected);
    this._el.classList.toggle('is-hovered', isHovered);
    this._el.classList.toggle('is-dimmed', isDimmed);
    this._el.setAttribute('aria-pressed', String(isSelected));
  }

  destroy() {
    this._el.remove();
  }
}
