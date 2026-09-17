/**
 * src/components/PilotInfoPanel/PilotInfoPanel.js
 *
 * Full pilot detail — name, role, description, stat bars, abilities,
 * SELECT/SELECTED — shown once a pilot is selected. Mounted into
 * #ui-root (not .hud-center) and positioned as a floating card off to
 * the side via CSS (`.pilot-info-panel`), deliberately clear of the
 * character-grid column where the 3D models stand. That's the fix for
 * the model-vs-card overlap: previously this same content lived in a
 * panel directly behind/in front of the pilot's own model, so the two
 * were always fighting for the same screen space. Now they simply
 * don't occupy the same region, so there's nothing to layer.
 *
 * Pure UI, same shape as the old CharacterCard: takes a character (or
 * null) and an onSelect callback, reports intent upward.
 */

import { STAT_KEYS, STAT_LABELS } from '../../data/characters.js'
import AbilityList from '../AbilityList/AbilityList.js'

export default class PilotInfoPanel {
	/** @param {(id: string) => void} [onSelect] */
	constructor({ onSelect } = {}) {
		this._onSelect = onSelect
		this._character = null

		this._el = document.createElement('aside')
		this._el.className = 'pilot-info-panel'
		this._el.setAttribute('aria-live', 'polite')
	}

	get element() {
		return this._el
	}

	/** @param {object|null} character entry from data/characters.js, or null to clear/hide */
	setCharacter(character) {
		this._character = character

		if (!character) {
			this._el.classList.remove('is-visible')
			return
		}

		this._el.style.setProperty('--card-color', character.themeColor)
		this._el.style.setProperty(
			'--card-color-dim',
			character.themeColorDim
		)

		const statsRows = STAT_KEYS.map(
			(key) => `
      <div class="pilot-info-panel__stat-row">
        <span class="pilot-info-panel__stat-label">${STAT_LABELS[key]}</span>
        <div class="pilot-info-panel__stat-track">
          <div class="pilot-info-panel__stat-fill" style="width:${character.stats[key]}%"></div>
        </div>
      </div>
    `
		).join('')

		this._el.innerHTML = `
      <header class="pilot-info-panel__header">
        <h2 class="pilot-info-panel__name">${character.name}</h2>
        <p class="pilot-info-panel__role">${character.role}</p>
      </header>
      <p class="pilot-info-panel__description">${character.description}</p>
      <div class="pilot-info-panel__stats">${statsRows}</div>
      <div class="pilot-info-panel__abilities-mount"></div>
      <button class="pilot-info-panel__select-btn interactive" type="button">
        <span class="pilot-info-panel__select-label-idle">SELECT</span>
        <span class="pilot-info-panel__select-label-active">SELECTED</span>
      </button>
    `

		const abilityList = new AbilityList(character.abilities)
		this._el
			.querySelector('.pilot-info-panel__abilities-mount')
			.appendChild(abilityList.element)

		this._el
			.querySelector('.pilot-info-panel__select-btn')
			.addEventListener('click', () => {
				this._onSelect?.(character.id)
			})

		// is-selected always true here — this panel only ever shows the
		// currently-selected pilot — but keeping the class (rather than
		// hardcoding the button's look) means the idle/active label swap
		// reuses the same CSS pattern the old CharacterCard used.
		this._el.classList.add('is-selected', 'is-visible')
	}

	get character() {
		return this._character
	}
}
