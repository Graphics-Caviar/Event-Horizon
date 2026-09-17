export class Menu {
	constructor({
		onPlay,
		onLeaderboard,
		onSignOut,
		audioManager,
		storage,
	}) {
		// PLAY no longer collects a callsign here — the pilot registry
		// (AuthScreen) owns identity now, so Menu just reports the click.
		this.onPlay = onPlay || (() => {})
		this.onLeaderboard = onLeaderboard || (() => {})
		this.onSignOut = onSignOut || (() => {})
		this.audio = audioManager
		this.storage = storage

		// AuthScreen and LeaderboardScreen own their own show/hide, but they
		// are registered here too so showStart()/hideAll() can never leave
		// one of them stranded on top of the menu.
		this.screens = {
			start: document.getElementById('screen-start'),
			placeholder:
				document.getElementById('screen-placeholder'),
			auth: document.getElementById('screen-auth'),
			leaderboard:
				document.getElementById('screen-leaderboard'),
		}

		this.accountEl = document.getElementById('menu-account')
		this.accountGuestEl =
			document.getElementById('menu-account-guest')
		this.accountNameEl =
			document.getElementById('menu-account-name')

		this.overlay = document.getElementById('menu-modal-overlay')
		this.modalContent = document.getElementById('modal-content')
		document.getElementById('modal-close').addEventListener(
			'click',
			() => this._closeModal()
		)
		this.overlay.addEventListener('click', (e) => {
			if (e.target === this.overlay) this._closeModal()
		})

		document.getElementById('btn-start').addEventListener(
			'click',
			() => this.onPlay()
		)
		document.getElementById('btn-leaderboard').addEventListener(
			'click',
			() => this.onLeaderboard()
		)
		document.getElementById('btn-sign-out').addEventListener(
			'click',
			() => this.onSignOut()
		)
		document.getElementById('btn-controls').addEventListener(
			'click',
			() => this._openControlsModal()
		)
		document.getElementById('btn-settings').addEventListener(
			'click',
			() => this._openSettingsModal()
		)
		document.getElementById('btn-credits').addEventListener(
			'click',
			() => this._openCreditsModal()
		)
		document.getElementById('btn-exit').addEventListener(
			'click',
			() => this._openExitModal()
		)
		document.getElementById('btn-back-to-menu').addEventListener(
			'click',
			() => this.showStart()
		)
	}

	// ---------------- generic modal plumbing ----------------

	_openModal(html) {
		this.modalContent.innerHTML = html
		this.overlay.classList.remove('hidden')
	}

	_closeModal() {
		this.overlay.classList.add('hidden')
		this.modalContent.innerHTML = ''
	}

	// ---------------- account badge ----------------

	/**
	 * Greet whoever is playing, above the menu buttons: "WELCOME <callsign>".
	 *
	 * @param {string|null} name the callsign to greet, or null to hide the
	 *        greeting entirely (nobody signed in and no cached name).
	 * @param {{isGuest?: boolean}} options isGuest tags the greeting so a
	 *        guest or offline session is not mistaken for a real account.
	 */
	setAccount(name, { isGuest = false } = {}) {
		if (!this.accountEl) return
		if (name) {
			this.accountNameEl.textContent = name
			this.accountGuestEl?.classList.toggle(
				'hidden',
				!isGuest
			)
			this.accountEl.classList.remove('hidden')
		} else {
			this.accountNameEl.textContent = ''
			this.accountGuestEl?.classList.add('hidden')
			this.accountEl.classList.add('hidden')
		}
	}

	// ---------------- individual modals ----------------

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
    `)
	}

	_openSettingsModal() {
		const muted = this.storage.load().settings.muted
		this._openModal(`
      <h3>SETTINGS</h3>
      <div class="settings-row">
        <span>Mute sound effects</span>
        <input id="setting-mute" type="checkbox" ${muted ? 'checked' : ''} />
      </div>
    `)

		document.getElementById('setting-mute').addEventListener(
			'change',
			(e) => {
				const muted = e.target.checked
				if (this.audio) this.audio.setMuted(muted)
				const profile = this.storage.load()
				profile.settings.muted = muted
				this.storage.save(profile)
			}
		)
	}

	_openCreditsModal() {
		this._openModal(`
      <h3>CREDITS</h3>
      <div class="credits-text">
        <div><span class="role">Design &amp; Development</span> — Graphics & Cavier</div>
        <div><span class="role">Engine</span> — three.js</div>
        <div><span class="role">Built for</span> — Course project</div>
      </div>
    `)
	}

	_openExitModal() {
		this._openModal(`
      <h3>EXIT GAME</h3>
      <p class="modal-desc">Leave Event Horizon? Any unsaved progress will be lost.</p>
      <div class="modal-actions">
        <button id="modal-exit-cancel" class="btn-secondary">CANCEL</button>
        <button id="modal-exit-confirm" class="btn-danger">EXIT</button>
      </div>
    `)

		document.getElementById('modal-exit-cancel').addEventListener(
			'click',
			() => this._closeModal()
		)
		document.getElementById('modal-exit-confirm').addEventListener(
			'click',
			() => {
				// Only closes tabs the page itself opened; browsers block closing a
				// regular tab from script, so this is a graceful fallback either way.
				window.close()
				this._openModal(`
        <h3>SAFE TO CLOSE</h3>
        <p class="modal-desc">You can close this browser tab now. See you out there, Pilot.</p>
      `)
			}
		)
	}

	// ---------------- top-level screens ----------------

	_hideAll() {
		Object.values(this.screens).forEach((el) =>
			el.classList.add('hidden')
		)
	}

	showStart() {
		this._hideAll()
		this.screens.start.classList.remove('hidden')
	}

	showPlaceholder(playerName) {
		this._hideAll()
		document.getElementById('placeholder-lore').textContent =
			`Gameplay is still being built by the rest of the crew. Check back soon, ${playerName}.`
		this.screens.placeholder.classList.remove('hidden')
	}

	hideAll() {
		this._hideAll()
		this._closeModal()
	}
}
