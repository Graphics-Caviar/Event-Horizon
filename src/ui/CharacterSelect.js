import { CHARACTERS } from '../systems/CharacterManager.js';

const ACCENT_CLASS = { zara: 'accent-cyan', kai: 'accent-green', nyx: 'accent-purple' };
const STAT_NAMES = ['speed', 'firepower', 'durability', 'tech', 'utility'];

/**
 * CharacterSelect — DOM/UI layer for the Hangar screen. Knows nothing
 * about three.js; it only reads CHARACTERS (plain data) and fires
 * callbacks. HangarScene (the 3D side) is driven separately by Game.js
 * listening to those same callbacks — this keeps "what's on screen" and
 * "what's rendered in 3D" as two independently testable pieces.
 */
export class CharacterSelect {
  constructor({ onSelect, onTabChange, onContinue, onBack }) {
    this.onSelect = onSelect;
    this.onTabChange = onTabChange;
    this.onContinue = onContinue;
    this.onBack = onBack;

    this.selectedKey = 'zara';

    this.screen = document.getElementById('screen-character-select');
    this.pilotCardsEl = document.getElementById('pilot-cards');
    this.statComparisonEl = document.getElementById('stat-comparison');
    this.shipInfoEl = document.getElementById('ship-info');
    this.pilotPanel = document.getElementById('pilot-panel');
    this.shipPanel = document.getElementById('ship-panel');
    this.tabPilotBtn = document.getElementById('tab-pilot');
    this.tabShipBtn = document.getElementById('tab-ship');

    this._renderPilotCards();
    this._renderStatComparison();
    this._renderShipInfo();

    this.tabPilotBtn.addEventListener('click', () => this._setTab('pilot'));
    this.tabShipBtn.addEventListener('click', () => this._setTab('ship'));
    document.getElementById('btn-hangar-continue').addEventListener('click', () => this.onContinue(this.selectedKey));
    document.getElementById('btn-hangar-back').addEventListener('click', () => this.onBack());
  }

  _setTab(tab) {
    this.tabPilotBtn.classList.toggle('active', tab === 'pilot');
    this.tabShipBtn.classList.toggle('active', tab === 'ship');
    this.pilotPanel.classList.toggle('hidden', tab !== 'pilot');
    this.shipPanel.classList.toggle('hidden', tab !== 'ship');
    this.onTabChange(tab);
  }

  _renderPilotCards() {
    this.pilotCardsEl.innerHTML = Object.values(CHARACTERS).map((c) => `
      <div class="pilot-card ${ACCENT_CLASS[c.key]} ${c.key === this.selectedKey ? 'selected' : ''}">
        <div class="pilot-card-name">${c.name}</div>
        <div class="pilot-card-role">${c.role}</div>
        <p class="pilot-card-desc">${c.description}</p>
        <div class="pilot-card-abilities">
          ${c.abilities.map((a) => `
            <div class="ability-row">
              <span class="ability-name">${a.name}</span>
              <span class="ability-desc">${a.description}</span>
            </div>
          `).join('')}
        </div>
        <button class="pilot-select-btn" data-key="${c.key}">${c.key === this.selectedKey ? 'SELECTED' : 'SELECT'}</button>
      </div>
    `).join('');

    this.pilotCardsEl.querySelectorAll('.pilot-select-btn').forEach((btn) => {
      btn.addEventListener('click', () => this._selectPilot(btn.dataset.key));
    });
  }

  _selectPilot(key) {
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    this._renderPilotCards();
    this.onSelect(key);
  }

  _renderStatComparison() {
    this.statComparisonEl.innerHTML = STAT_NAMES.map((stat) => `
      <div class="stat-compare-row">
        <span class="stat-compare-label">${stat.toUpperCase()}</span>
        ${Object.values(CHARACTERS).map((c) => `
          <div class="stat-bar-track ${ACCENT_CLASS[c.key]}">
            <div class="stat-bar-fill" style="width:${c.stats[stat] * 10}%"></div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  _renderShipInfo() {
    this.shipInfoEl.innerHTML = `
      <div class="ship-name">ORBITAL RAVEN <span class="ship-mark">MK VII</span></div>
      <div class="ship-tagline">"Built for the impossible."</div>
      <div class="ship-specs">
        <div class="spec-row"><span>Engine</span><span>Twin Ion Thrusters</span></div>
        <div class="spec-row"><span>Hull</span><span>Titanium Composite</span></div>
        <div class="spec-row"><span>Shielding</span><span>Quantum Energy Shield</span></div>
        <div class="spec-row"><span>Crew</span><span>1</span></div>
      </div>
    `;
  }

  show() {
    this.screen.classList.remove('hidden');
    this._setTab('pilot');
  }

  hide() {
    this.screen.classList.add('hidden');
  }

  getSelectedKey() {
    return this.selectedKey;
  }
}
