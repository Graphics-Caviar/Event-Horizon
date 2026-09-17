import { CHARACTERS } from '../systems/CharacterManager.js'
import { SHIPS } from '../systems/ShipManager.js'
import storage from '../services/StorageService.js'

const ACCENT_CLASS = {
	zara: 'accent-cyan',
	kai: 'accent-green',
	nyx: 'accent-purple',
	vanguard: 'accent-green',
	starfighter: 'accent-cyan',
	aegis: 'accent-purple',
}

const SHIP_STAT_NAMES = [
	'speed',
	'firepower',
	'durability',
	'shields',
	'agility',
]

const PILOT_DETAIL_STATS = [
	['speed', 'SPEED'],
	['firepower', 'FIRE'],
	['tech', 'TECH'],
]

const ABILITY_ICONS = ['⚡', '◎', '◇']

/**
 * CharacterSelect — DOM/UI layer for the Hangar screen.
 * Pilot selection uses a cinematic two-stage layout:
 * lineup -> focused pilot details. Ship selection remains independent.
 */
export class CharacterSelect {
	constructor({
		initialPilot,
		initialShip,
		onSelectPilot,
		onSelectShip,
		onPilotOverview,
		onTabChange,
		onContinue,
		onBack,
		storageService = storage,
	}) {
		this.storage = storageService
		this.onSelectPilot = onSelectPilot || (() => {})
		this.onSelectShip = onSelectShip || (() => {})
		this.onPilotOverview = onPilotOverview || (() => {})
		this.onTabChange = onTabChange || (() => {})
		this.onContinue = onContinue || (() => {})
		this.onBack = onBack || (() => {})

		this.selectedPilotKey =
			initialPilot ||
			this.storage.getSelectedPilot() ||
			'zara'
		const savedShip = initialShip || this.storage.getSelectedShip()
		this.selectedShipKey = SHIPS[savedShip]
			? savedShip
			: 'starfighter'
		this.pilotView = 'overview'
		this.activeTab = 'pilot'

		this.screen = document.getElementById('screen-character-select')
		this.pilotCardsEl = document.getElementById('pilot-cards')
		this.pilotOverviewEl = document.getElementById('pilot-overview')
		this.pilotDetailEl = document.getElementById('pilot-detail')
		this.pilotDetailCardEl =
			document.getElementById('pilot-detail-card')
		this.pilotPanel = document.getElementById('pilot-panel')
		this.shipCardsEl = document.getElementById('ship-cards')
		this.shipStatComparisonEl = document.getElementById(
			'ship-stat-comparison'
		)
		this.shipPanel = document.getElementById('ship-panel')
		this.tabPilotBtn = document.getElementById('tab-pilot')
		this.tabShipBtn = document.getElementById('tab-ship')
		this.continueBtn = document.getElementById(
			'btn-hangar-continue'
		)
		this.backBtn = document.getElementById('btn-hangar-back')

		this._renderPilotLineup()
		this._renderShipCards()
		this._renderShipStatComparison()

		this.tabPilotBtn.addEventListener('click', () =>
			this._setTab('pilot')
		)
		this.tabShipBtn.addEventListener('click', () =>
			this._setTab('ship')
		)
		document.getElementById('btn-pilot-overview').addEventListener(
			'click',
			() => this._showPilotOverview()
		)
		this.continueBtn.addEventListener('click', () => {
			if (this.activeTab === 'pilot') {
				this._setTab('ship')
				return
			}
			this.onContinue(
				this.selectedPilotKey,
				this.selectedShipKey
			)
		})
		this.backBtn.addEventListener('click', () => {
			if (this.activeTab === 'ship') {
				this._setTab('pilot')
				return
			}
			if (this.pilotView === 'detail') {
				this._showPilotOverview()
				return
			}
			this.onBack()
		})
	}

	_setTab(tab) {
		this.activeTab = tab
		this.tabPilotBtn.classList.toggle('active', tab === 'pilot')
		this.tabShipBtn.classList.toggle('active', tab === 'ship')
		this.pilotPanel.classList.toggle('hidden', tab !== 'pilot')
		this.shipPanel.classList.toggle('hidden', tab !== 'ship')
		this.continueBtn.textContent =
			tab === 'pilot' ? 'READY → SHIP SELECT' : 'LAUNCH →'
		this.backBtn.textContent =
			tab === 'pilot' ? '← BACK' : '← PILOT'

		if (tab === 'pilot') {
			this._showPilotOverview(false)
			this.onPilotOverview()
		} else {
			this.onTabChange(tab)
		}
	}

	_renderPilotLineup() {
		this.pilotCardsEl.innerHTML = Object.values(CHARACTERS)
			.map(
				(c) => `
			<button class="pilot-lineup-choice ${ACCENT_CLASS[c.key]} ${c.key === this.selectedPilotKey ? 'selected' : ''}" data-key="${c.key}" aria-label="Inspect ${c.name}">
				<span class="pilot-lineup-marker">${c.key === this.selectedPilotKey ? 'SELECTED PILOT' : 'INSPECT'}</span>
				<span class="pilot-lineup-name">${c.name}</span>
				<span class="pilot-lineup-role">${c.role.replace(/^The\s+/i, '')}</span>
			</button>
		`
			)
			.join('')

		this.pilotCardsEl
			.querySelectorAll('.pilot-lineup-choice')
			.forEach((btn) => {
				btn.addEventListener('click', () =>
					this._inspectPilot(btn.dataset.key)
				)
			})
	}

	_inspectPilot(key) {
		this.selectedPilotKey = key
		this.pilotView = 'detail'
		this._renderPilotLineup()
		this._renderPilotDetail()
		this.pilotOverviewEl.classList.add('hidden')
		this.pilotDetailEl.classList.remove('hidden')
		this.continueBtn.classList.add('pilot-detail-footer-hidden')
		this.backBtn.classList.add('pilot-detail-footer-hidden')
		this.onSelectPilot(key)
	}

	_renderPilotDetail() {
		const c = CHARACTERS[this.selectedPilotKey]
		this.pilotDetailCardEl.className = `pilot-detail-card ${ACCENT_CLASS[c.key]}`
		this.pilotDetailCardEl.innerHTML = `
			<div class="pilot-detail-eyebrow">PILOT DOSSIER</div>
			<h2>${c.name}</h2>
			<div class="pilot-detail-role">${c.role.replace(/^The\s+/i, '')}</div>
			<p>${c.description}</p>

			<div class="pilot-detail-stats">
				${PILOT_DETAIL_STATS.map(
					([key, label]) => `
					<div class="pilot-detail-stat">
						<span>${label}</span>
						<div class="pilot-detail-track"><i style="width:${c.stats[key] * 10}%"></i></div>
						<strong>${c.stats[key]}</strong>
					</div>`
				).join('')}
			</div>

			<div class="pilot-detail-abilities-title">ABILITIES</div>
			<div class="pilot-detail-abilities">
				${c.abilities
					.map(
						(a, index) => `
					<div class="pilot-detail-ability">
						<span class="pilot-detail-ability-icon">${ABILITY_ICONS[index] || '◇'}</span>
						<span><b>${a.name}</b><small>${a.description}</small></span>
					</div>`
					)
					.join('')}
			</div>

			<button id="btn-confirm-pilot" class="pilot-confirm-btn">SELECT ${c.name.toUpperCase()}</button>
		`

		document.getElementById('btn-confirm-pilot').addEventListener(
			'click',
			() => {
				this.storage.setSelectedPilot(
					this.selectedPilotKey
				)
				this._renderPilotLineup()
				this._setTab('ship')
			}
		)
	}

	_showPilotOverview(notifyScene = true) {
		this.pilotView = 'overview'
		this.pilotDetailEl.classList.add('hidden')
		this.pilotOverviewEl.classList.remove('hidden')
		this.continueBtn.classList.remove('pilot-detail-footer-hidden')
		this.backBtn.classList.remove('pilot-detail-footer-hidden')
		if (notifyScene) this.onPilotOverview()
	}

	_renderShipCards() {
		if (!this.shipCardsEl) return
		this.shipCardsEl.innerHTML = Object.values(SHIPS)
			.map(
				(s) => `
      <div class="ship-card ${s.accentClass} ${s.key === this.selectedShipKey ? 'selected' : ''}">
        <div class="ship-card-name">${s.name} <span class="ship-card-mark">${s.mark}</span></div>
        <div class="ship-card-role">${s.role}</div>
        <div class="ship-card-tagline">${s.tagline}</div>
        <p class="ship-card-desc">${s.description}</p>
        <div class="ship-card-specs">
          ${s.specs
			.map(
				(spec) => `
            <div class="spec-mini-row">
              <span>${spec.label}</span>
              <span>${spec.value}</span>
            </div>
          `
			)
			.join('')}
        </div>
        <button class="ship-select-btn" data-key="${s.key}">${s.key === this.selectedShipKey ? 'SELECTED' : 'SELECT'}</button>
      </div>
    `
			)
			.join('')

		this.shipCardsEl
			.querySelectorAll('.ship-select-btn')
			.forEach((btn) => {
				btn.addEventListener('click', () =>
					this._selectShip(btn.dataset.key)
				)
			})
	}

	_selectShip(key) {
		if (key === this.selectedShipKey) return
		this.selectedShipKey = key
		this.storage.setSelectedShip(key)
		this._renderShipCards()
		this.onSelectShip(key)
	}

	_renderShipStatComparison() {
		if (!this.shipStatComparisonEl) return
		this.shipStatComparisonEl.innerHTML = SHIP_STAT_NAMES.map(
			(stat) => `
      <div class="stat-compare-row">
        <span class="stat-compare-label">${stat.toUpperCase()}</span>
        ${Object.values(SHIPS)
		.map(
			(s) => `
          <div class="stat-bar-track ${s.accentClass}">
            <div class="stat-bar-fill" style="width:${s.stats[stat] * 10}%"></div>
          </div>
        `
		)
		.join('')}
      </div>
    `
		).join('')
	}

	show() {
		this.screen.classList.remove('hidden')
		this._setTab('pilot')
	}

	hide() {
		this.screen.classList.add('hidden')
	}

	getSelectedPilotKey() {
		return this.selectedPilotKey
	}

	getSelectedShipKey() {
		return this.selectedShipKey
	}
}
