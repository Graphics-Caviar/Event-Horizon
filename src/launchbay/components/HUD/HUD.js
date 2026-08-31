/**
 * src/components/HUD/HUD.js
 *
 * Top-level screen shell: title/tagline (top-left), CHARACTER SELECT
 * header (top-center), player profile (top-right), PILOT INFO copy and
 * BACK/SETTINGS/READY (bottom). The character grid mounts into
 * `.hud-center` via `mountCenterContent()`, so HUD owns overall layout
 * without needing to know how that piece is built.
 *
 * Placement note: the brief lists both READY and SETTINGS as
 * "bottom right." Read literally that's two controls in the same slot,
 * so I split them — SETTINGS sits with BACK on the bottom-left as a
 * secondary/navigation action, READY owns the bottom-right as the
 * primary call to action. Flag this if a different split was intended.
 */

import ReadyButton from '../ReadyButton/ReadyButton.js'

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`

export default class HUD {
	/**
	 * @param {object} options
	 * @param {string} options.playerName
	 * @param {number|string} options.playerLevel
	 * @param {() => void} [options.onBack]
	 * @param {() => void} [options.onSettings]
	 * @param {() => void} [options.onReady]
	 */
	constructor({
		playerName,
		playerLevel,
		onBack,
		onSettings,
		onReady,
	} = {}) {
		this._el = document.createElement('div')
		this._el.className = 'hud-shell'

		this._el.innerHTML = `
      <header class="hud-topbar">
        <div class="hud-topbar__brand">
          <div class="hud-topbar__title">EVENT HORIZON</div>
          <div class="hud-topbar__tagline">ESCAPE FROM SINGULARITY</div>
        </div>
        <div class="hud-topbar__header">
          <div class="hud-topbar__header-main">CHARACTER SELECT</div>
          <div class="hud-topbar__header-sub">CHOOSE YOUR PILOT</div>
        </div>
        <div class="hud-topbar__profile">
          <div class="hud-topbar__profile-name">${playerName}</div>
          <div class="hud-topbar__profile-level">LEVEL ${playerLevel}</div>
        </div>
      </header>

      <div class="hud-center"></div>

      <footer class="hud-bottombar">
        <div class="hud-bottombar__left">
          <button class="hud-btn hud-btn--ghost interactive" data-action="back" type="button">
            BACK
          </button>
          <button class="hud-btn hud-btn--icon interactive" data-action="settings" type="button" aria-label="Settings">
            ${GEAR_ICON}
          </button>
        </div>
        <p class="hud-bottombar__info">
          <span class="hud-bottombar__info-title">PILOT INFO</span>
          Pilots are more than just their skills. Your choice will shape your
          journey across the stars. Adapt, survive, and escape the singularity.
        </p>
        <div class="hud-bottombar__right"></div>
      </footer>
    `

		this._centerSlot = this._el.querySelector('.hud-center')
		this._readyButton = new ReadyButton({ onReady })
		this._el
			.querySelector('.hud-bottombar__right')
			.appendChild(this._readyButton.element)

		this._el
			.querySelector('[data-action="back"]')
			.addEventListener('click', () => onBack?.())
		this._el
			.querySelector('[data-action="settings"]')
			.addEventListener('click', () => onSettings?.())
	}

	get element() {
		return this._el
	}

	/** Appends content (the character grid) into the HUD's center region. */
	mountCenterContent(el) {
		this._centerSlot.appendChild(el)
	}

	setReadyEnabled(enabled) {
		this._readyButton.setEnabled(enabled)
	}

	/** Tints the READY button and header accents to match the selected pilot. */
	setAccentColor(color) {
		this._el.style.setProperty(
			'--hud-accent',
			color ?? 'var(--color-text-primary)'
		)
	}
}
