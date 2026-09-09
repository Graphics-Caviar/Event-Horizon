/**
 * src/components/StatsPanel/StatsPanel.js
 *
 * Renders the five stat categories (speed/firepower/durability/tech/
 * utility) as horizontal bars, one per pilot per category, color-coded
 * to each pilot's theme — a side-by-side comparison rather than a
 * single-pilot readout, since the brief frames this as "pilot stats
 * comparison."
 *
 * `setEmphasis(id)` brightens one pilot's bars and dims the other two;
 * main.js calls this on hover (falling back to the current selection,
 * or nothing) so the panel reacts the same way the cards do.
 */

import { CHARACTERS, STAT_KEYS, STAT_LABELS } from '../../data/characters.js'

export default class StatsPanel {
	/** @param {typeof CHARACTERS} characters */
	constructor(characters = CHARACTERS) {
		this._characters = characters

		this._el = document.createElement('div')
		this._el.className = 'stats-panel'

		const legend = characters
			.map(
				(c) => `
        <div class="stats-panel__legend-item" data-legend-id="${c.id}">
          <span class="stats-panel__legend-dot" style="--dot-color: ${c.themeColor}"></span>
          ${c.name}
        </div>`
			)
			.join('')

		const rows = STAT_KEYS.map((statKey) => {
			const bars = characters
				.map(
					(c) => `
          <div class="stats-panel__bar-track" data-bar-id="${c.id}">
            <div class="stats-panel__bar-fill" style="width:${c.stats[statKey]}%; --bar-color:${c.themeColor}"></div>
          </div>`
				)
				.join('')

			return `
        <div class="stats-panel__row">
          <span class="stats-panel__row-label">${STAT_LABELS[statKey]}</span>
          <div class="stats-panel__row-bars">${bars}</div>
        </div>`
		}).join('')

		this._el.innerHTML = `
      <div class="stats-panel__legend">${legend}</div>
      <div class="stats-panel__rows">${rows}</div>
    `

		this._barTracks = [
			...this._el.querySelectorAll('[data-bar-id]'),
		]
		this._legendItems = [
			...this._el.querySelectorAll('[data-legend-id]'),
		]
	}

	get element() {
		return this._el
	}

	/**
	 * @param {string|null} id  pilot id to emphasize, or null to show all
	 *   three at equal weight (no hover, nothing selected)
	 */
	setEmphasis(id) {
		for (const track of this._barTracks) {
			const isTarget = track.dataset.barId === id
			track.classList.toggle(
				'is-emphasized',
				Boolean(id) && isTarget
			)
			track.classList.toggle(
				'is-dimmed',
				Boolean(id) && !isTarget
			)
		}
		for (const item of this._legendItems) {
			const isTarget = item.dataset.legendId === id
			item.classList.toggle(
				'is-emphasized',
				Boolean(id) && isTarget
			)
			item.classList.toggle(
				'is-dimmed',
				Boolean(id) && !isTarget
			)
		}
	}
}
