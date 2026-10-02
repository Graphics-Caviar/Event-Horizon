/**
 * src/components/AbilityList/AbilityList.js
 *
 * Pure presentational component: given an array of ability objects from
 * data/characters.js, renders an icon + name + description for each.
 * No selection/hover logic lives here — CharacterCard owns that and just
 * hands this component data.
 */

import { abilityIconSvg } from './icons.js'

export default class AbilityList {
	/** @param {Array<{id:string,name:string,description:string,icon:string}>} abilities */
	constructor(abilities) {
		this._el = document.createElement('ul')
		this._el.className = 'ability-list'
		this.setAbilities(abilities)
	}

	get element() {
		return this._el
	}

	setAbilities(abilities) {
		this._el.innerHTML = ''
		for (const ability of abilities) {
			const item = document.createElement('li')
			item.className = 'ability-list__item'
			item.innerHTML = `
        <span class="ability-list__icon">${abilityIconSvg(ability.icon)}</span>
        <span class="ability-list__text">
          <span class="ability-list__name">${ability.name}</span>
          <span class="ability-list__desc">${ability.description}</span>
        </span>
      `
			this._el.appendChild(item)
		}
	}
}
