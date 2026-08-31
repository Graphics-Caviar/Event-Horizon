import { CHARACTERS } from '../systems/CharacterManager.js';
import { SHIPS } from '../systems/ShipManager.js';
import storage from '../services/StorageService.js';

const ACCENT_CLASS = {
	zara: 'accent-cyan',
	kai: 'accent-green',
	nyx: 'accent-purple',
	raven: 'accent-cyan',
	phantom: 'accent-gold',
	interceptor: 'accent-purple',
};

const PILOT_STAT_NAMES = ['speed', 'firepower', 'durability', 'tech', 'utility'];
const SHIP_STAT_NAMES = [
	'speed',
	'firepower',
	'durability',
	'shields',
	'agility',
];

/**
 * CharacterSelect — DOM/UI layer for the Hangar screen.
 * Supports choosing both Pilot and Starfighter, showing live stats,
 * and saving selections directly to local storage.
 */
export class CharacterSelect {
	constructor({
		initialPilot,
		initialShip,
		onSelectPilot,
		onSelectShip,
		onTabChange,
		onContinue,
		onBack,
		onPreviewLanding,
		storageService = storage,
	}) {
		this.storage = storageService;
		this.onSelectPilot = onSelectPilot || (() => {});
		this.onSelectShip = onSelectShip || (() => {});
		this.onTabChange = onTabChange || (() => {});
		this.onContinue = onContinue || (() => {});
		this.onBack = onBack || (() => {});
		this.onPreviewLanding = onPreviewLanding || (() => {});

		this.selectedPilotKey =
			initialPilot ||
			this.storage.getSelectedPilot() ||
			'zara';
		this.selectedShipKey =
			initialShip || this.storage.getSelectedShip() || 'raven';

		this.screen = document.getElementById('screen-character-select');
		this.pilotCardsEl = document.getElementById('pilot-cards');
		this.statComparisonEl =
			document.getElementById('stat-comparison');
		this.shipCardsEl = document.getElementById('ship-cards');
		this.shipStatComparisonEl = document.getElementById(
			'ship-stat-comparison'
		);
		this.pilotPanel = document.getElementById('pilot-panel');
		this.shipPanel = document.getElementById('ship-panel');
		this.tabPilotBtn = document.getElementById('tab-pilot');
		this.tabShipBtn = document.getElementById('tab-ship');

		this._renderPilotCards();
		this._renderPilotStatComparison();
		this._renderShipCards();
		this._renderShipStatComparison();

		this.tabPilotBtn.addEventListener('click', () =>
			this._setTab('pilot')
		);
		this.tabShipBtn.addEventListener('click', () =>
			this._setTab('ship')
		);
		document.getElementById('btn-hangar-continue').addEventListener(
			'click',
			() => {
				this.onContinue(
					this.selectedPilotKey,
					this.selectedShipKey
				);
			}
		);
		document.getElementById('btn-hangar-preview-landing')?.addEventListener('click', () => {
			this.onPreviewLanding(this.selectedPilotKey, this.selectedShipKey);
		});
		document.getElementById('btn-hangar-back').addEventListener(
			'click',
			() => this.onBack()
		);
	}

	_setTab(tab) {
		this.tabPilotBtn.classList.toggle('active', tab === 'pilot');
		this.tabShipBtn.classList.toggle('active', tab === 'ship');
		this.pilotPanel.classList.toggle('hidden', tab !== 'pilot');
		this.shipPanel.classList.toggle('hidden', tab !== 'ship');
		this.onTabChange(tab);
	}

	_renderPilotCards() {
		this.pilotCardsEl.innerHTML = Object.values(CHARACTERS).map((c) => {
			const isSelected = c.key === this.selectedPilotKey;
			return `
				<div class="pilot-card ${ACCENT_CLASS[c.key]} ${isSelected ? 'selected' : ''}" data-key="${c.key}">
					<div class="pilot-card-header">
						<div class="pilot-card-title-group">
							<div class="pilot-card-name">${c.name}</div>
							<div class="pilot-card-role">${c.role}</div>
						</div>
						<div class="pilot-card-badge ${isSelected ? 'badge-selected' : ''}">
							${isSelected ? 'ACTIVE' : 'SELECT'}
						</div>
					</div>
					<p class="pilot-card-desc">${c.description}</p>
					<div class="pilot-card-abilities">
						${c.abilities.map((a) => `
							<div class="ability-row">
								<span class="ability-name">${a.name}:</span>
								<span class="ability-desc">${a.description}</span>
							</div>
						`).join('')}
					</div>
				</div>
			`;
		}).join('');

		this.pilotCardsEl.querySelectorAll('.pilot-card').forEach((card) => {
			card.addEventListener('click', () => this._selectPilot(card.dataset.key));
		});
	}

	_selectPilot(key) {
		if (key === this.selectedPilotKey) return;
		this.selectedPilotKey = key;
		this.storage.setSelectedPilot(key);
		this._renderPilotCards();
		this.onSelectPilot(key);
	}

	_renderPilotStatComparison() {
		this.statComparisonEl.innerHTML = PILOT_STAT_NAMES.map(
			(stat) => `
      <div class="stat-compare-row">
        <span class="stat-compare-label">${stat.toUpperCase()}</span>
        ${Object.values(CHARACTERS).map((c) => `
          <div class="stat-bar-track ${ACCENT_CLASS[c.key]}" title="${c.name}: ${c.stats[stat]} / 10">
            <div class="stat-bar-fill" style="width:${c.stats[stat] * 10}%"></div>
          </div>
        `).join('')}
      </div>
    `
		).join('');
	}

	_renderShipCards() {
		if (!this.shipCardsEl) return;
		this.shipCardsEl.innerHTML = Object.values(SHIPS).map((s) => {
			const isSelected = s.key === this.selectedShipKey;
			return `
				<div class="ship-card ${s.accentClass} ${isSelected ? 'selected' : ''}" data-key="${s.key}">
					<div class="ship-card-header">
						<div class="ship-card-title-group">
							<div class="ship-card-name">${s.name} <span class="ship-card-mark">${s.mark}</span></div>
							<div class="ship-card-role">${s.role}</div>
						</div>
						<div class="ship-card-badge ${isSelected ? 'badge-selected' : ''}">
							${isSelected ? 'ACTIVE' : 'SELECT'}
						</div>
					</div>
					<div class="ship-card-tagline">${s.tagline}</div>
					<p class="ship-card-desc">${s.description}</p>
					<div class="ship-card-specs">
						${s.specs.map((spec) => `
							<div class="spec-mini-row">
								<span>${spec.label}</span>
								<span>${spec.value}</span>
							</div>
						`).join('')}
					</div>
				</div>
			`;
		}).join('');

		this.shipCardsEl.querySelectorAll('.ship-card').forEach((card) => {
			card.addEventListener('click', () => this._selectShip(card.dataset.key));
		});
	}

	_selectShip(key) {
		if (key === this.selectedShipKey) return;
		this.selectedShipKey = key;
		this.storage.setSelectedShip(key);
		this._renderShipCards();
		this.onSelectShip(key);
	}

	_renderShipStatComparison() {
		if (!this.shipStatComparisonEl) return;
		this.shipStatComparisonEl.innerHTML = SHIP_STAT_NAMES.map(
			(stat) => `
      <div class="stat-compare-row">
        <span class="stat-compare-label">${stat.toUpperCase()}</span>
        ${Object.values(SHIPS).map((s) => `
          <div class="stat-bar-track ${s.accentClass}" title="${s.name}: ${s.stats[stat]} / 10">
            <div class="stat-bar-fill" style="width:${s.stats[stat] * 10}%"></div>
          </div>
        `).join('')}
      </div>
    `
		).join('');
	}

	show() {
		this.screen.classList.remove('hidden');
		this._setTab('pilot');
	}

	hide() {
		this.screen.classList.add('hidden');
	}

	getSelectedPilotKey() {
		return this.selectedPilotKey;
	}

	getSelectedShipKey() {
		return this.selectedShipKey;
	}
}
