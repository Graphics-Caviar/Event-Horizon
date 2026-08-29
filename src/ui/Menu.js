export class Menu {
  constructor({ onLaunch, audioManager, storage }) {
    this.onLaunch = onLaunch;
    this.audio = audioManager;
    this.storage = storage;

    this.screens = {
      start: document.getElementById('screen-start'),
      placeholder: document.getElementById('screen-placeholder'),
    };

    this.overlay = document.getElementById('menu-modal-overlay');
    this.modalContent = document.getElementById('modal-content');
    document.getElementById('modal-close').addEventListener('click', () => this._closeModal());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this._closeModal();
    });

    document.getElementById('btn-start').addEventListener('click', () => this._openNameModal());
    document.getElementById('btn-controls').addEventListener('click', () => this._openControlsModal());
    document.getElementById('btn-settings').addEventListener('click', () => this._openSettingsModal());
    document.getElementById('btn-credits').addEventListener('click', () => this._openCreditsModal());
    document.getElementById('btn-exit').addEventListener('click', () => this._openExitModal());
    document.getElementById('btn-back-to-menu').addEventListener('click', () => this.showStart());
  }

  // ---------------- generic modal plumbing ----------------

  _openModal(html) {
    this.modalContent.innerHTML = html;
    this.overlay.classList.remove('hidden');
  }

  _closeModal() {
    this.overlay.classList.add('hidden');
    this.modalContent.innerHTML = '';
  }

  // ---------------- individual modals ----------------

  _openNameModal() {
    this._openModal(`
      <h3>PILOT CALLSIGN</h3>
      <p class="modal-desc">Enter a name before you launch — the Devourer likes to know who it's hunting.</p>
      <input id="player-name-input" class="modal-input" type="text" maxlength="16" placeholder="Enter your name" autocomplete="off" />
      <div class="modal-actions">
        <button id="modal-launch-btn">LAUNCH</button>
      </div>
    `);

    const input = document.getElementById('player-name-input');
    input.value = this.storage.load().playerName;
    input.focus();

    const launch = () => {
      const raw = input.value.trim();
      const name = raw.length > 0 ? raw : 'Pilot';
      this.storage.save({ ...this.storage.load(), playerName: name });
      this._closeModal();
      this.onLaunch(name);
    };
    document.getElementById('modal-launch-btn').addEventListener('click', launch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch(); });
  }

  _openControlsModal() {
    this._openModal(`
      <h3>CONTROLS</h3>
      <p class="modal-desc">Flight controls for The Singularity Run.</p>
      <ul class="key-list">
        <li><span>Accelerate</span><kbd>W / ↑</kbd></li>
        <li><span>Brake / Reverse</span><kbd>S / ↓</kbd></li>
        <li><span>Turn Left</span><kbd>A / ←</kbd></li>
        <li><span>Turn Right</span><kbd>D / →</kbd></li>
      </ul>
    `);
  }

  _openSettingsModal() {
    const muted = this.storage.load().settings.muted;
    this._openModal(`
      <h3>SETTINGS</h3>
      <div class="settings-row">
        <span>Mute sound effects</span>
        <input id="setting-mute" type="checkbox" ${muted ? 'checked' : ''} />
      </div>
    `);

    document.getElementById('setting-mute').addEventListener('change', (e) => {
      const muted = e.target.checked;
      if (this.audio) this.audio.setMuted(muted);
      const profile = this.storage.load();
      profile.settings.muted = muted;
      this.storage.save(profile);
    });
  }

  _openCreditsModal() {
    this._openModal(`
      <h3>CREDITS</h3>
      <div class="credits-text">
        <div><span class="role">Design &amp; Development</span> — Graphics & Cavier</div>
        <div><span class="role">Engine</span> — three.js</div>
        <div><span class="role">Built for</span> — Course project</div>
      </div>
    `);
  }

  _openExitModal() {
    this._openModal(`
      <h3>EXIT GAME</h3>
      <p class="modal-desc">Leave Event Horizon? Any unsaved progress will be lost.</p>
      <div class="modal-actions">
        <button id="modal-exit-cancel" class="btn-secondary">CANCEL</button>
        <button id="modal-exit-confirm" class="btn-danger">EXIT</button>
      </div>
    `);

    document.getElementById('modal-exit-cancel').addEventListener('click', () => this._closeModal());
    document.getElementById('modal-exit-confirm').addEventListener('click', () => {
      // Only closes tabs the page itself opened; browsers block closing a
      // regular tab from script, so this is a graceful fallback either way.
      window.close();
      this._openModal(`
        <h3>SAFE TO CLOSE</h3>
        <p class="modal-desc">You can close this browser tab now. See you out there, Pilot.</p>
      `);
    });
  }

  // ---------------- top-level screens ----------------

  _hideAll() {
    Object.values(this.screens).forEach((el) => el.classList.add('hidden'));
  }

  showStart() {
    this._hideAll();
    this.screens.start.classList.remove('hidden');
  }

  showPlaceholder(playerName) {
    this._hideAll();
    document.getElementById('placeholder-lore').textContent =
      `Gameplay is still being built by the rest of the crew. Check back soon, ${playerName}.`;
    this.screens.placeholder.classList.remove('hidden');
  }

  hideAll() {
    this._hideAll();
    this._closeModal();
  }
}
