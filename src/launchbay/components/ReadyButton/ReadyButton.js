/**
 * src/components/ReadyButton/ReadyButton.js
 *
 * Disabled until GameState.selectedCharacter is set. Clicking it is
 * wired to a callback here, but the actual fade + scene transition to
 * the Launch Bay is Stage 8's job — this component only owns the
 * button's own visual state and click reporting.
 */

export default class ReadyButton {
  constructor({ onReady } = {}) {
    this._el = document.createElement('button');
    this._el.type = 'button';
    this._el.className = 'hud-btn hud-btn--ready interactive';
    this._el.disabled = true;
    this._el.innerHTML = `
      <span class="hud-btn--ready-label">READY</span>
      <span class="hud-btn--ready-sub">CONTINUE TO LAUNCH BAY</span>
    `;
    this._el.addEventListener('click', () => {
      if (!this._el.disabled) onReady?.();
    });
  }

  get element() {
    return this._el;
  }

  setEnabled(enabled) {
    this._el.disabled = !enabled;
  }
}
