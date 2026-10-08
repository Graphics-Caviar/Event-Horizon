export class Menu {
	constructor({
		onPlay,
		onTestLevel2,
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
			pause: document.getElementById('screen-pause'),
			results: document.getElementById('screen-results'),
		}

		this.levelCards = [
			...document.querySelectorAll('.level-card[data-level]'),
		]
		const level1Card = document.querySelector(
			'.level-card[data-level="1"]'
		)
		level1Card?.addEventListener('click', () => this.onPlay())
		level1Card?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				this.onPlay()
			}
		})
		const level2Card = document.querySelector(
			'.level-card[data-level="2"]'
		)
		level2Card?.addEventListener('click', () => onTestLevel2?.())
		level2Card?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				onTestLevel2?.()
			}
		})
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

	// ---------------- level progression ----------------

	/**
	 * Lock every level above the player's progress. Level 1 can never be
	 * locked. The markup ships with levels 2 and 3 already locked, so this
	 * mainly REMOVES locks once real progress is known — no flash of
	 * unlocked levels while the profile is still loading.
	 *
	 * @param {number} highestUnlocked the highest level the player may play
	 */
	setUnlockedLevel(highestUnlocked) {
		const unlocked = Math.max(
			1,
			Math.floor(Number(highestUnlocked)) || 1
		)
		for (const card of this.levelCards) {
			const level = Number(card.dataset.level)
			// Level 2 is temporarily available for direct gameplay testing.
			card.classList.toggle(
				'is-locked',
				level !== 2 && level > unlocked
			)
		}
	}

	// ---------------- individual modals ----------------

	_openControlsModal() {
		this._openModal(`
      <h3>CONTROLS</h3>
      <p class="modal-desc">Flight controls for The Singularity Run. Escape the black hole's pull and steer around the asteroids.</p>
      <ul class="key-list">
        <li><span>Forward</span><kbd>W / ↑</kbd></li>
        <li><span>Brake / Reverse</span><kbd>S / ↓</kbd></li>
        <li><span>Left</span><kbd>A / ←</kbd></li>
        <li><span>Right</span><kbd>D / →</kbd></li>
        <li><span>Up</span><kbd>Q</kbd></li>
        <li><span>Down</span><kbd>E</kbd></li>
        <li><span>Pause</span><kbd>Esc</kbd></li>
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
      <div class="credits-text" tabindex="0" aria-label="Project and technology credits">
        <div><span class="role">Design &amp; Development</span> — Graphics &amp; Cavier</div>
        <div><span class="role">Built for</span> — Course project</div>
        <h4>THIRD-PARTY TECHNOLOGY</h4>
        <ul class="credits-list">
          <li><a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">Three.js</a> — mrdoob and contributors. 3D rendering, model loading, and procedural noise utilities. <small>MIT license</small></li>
          <li><a href="https://firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase</a> — Google and contributors. Authentication, cloud saves, leaderboards, and analytics. <small>JavaScript SDK: Apache-2.0 license</small></li>
          <li><a href="https://rapier.rs/" target="_blank" rel="noopener noreferrer">Rapier</a> — Dimforge and contributors. Physics library included in the project's physics module. <small>Apache-2.0 license</small></li>
          <li><a href="https://github.com/google/draco" target="_blank" rel="noopener noreferrer">Draco</a> — Google and contributors. Compressed 3D model decoding support in the launch-bay asset loader.</li>
          <li><a href="https://vite.dev/" target="_blank" rel="noopener noreferrer">Vite</a> — Evan You and contributors. Development server and production builds. <small>MIT license</small></li>
          <li><a href="https://prettier.io/" target="_blank" rel="noopener noreferrer">Prettier</a> — James Long and contributors. Code formatting. <small>MIT license</small></li>
          <li><a href="https://fonts.google.com/" target="_blank" rel="noopener noreferrer">Google Fonts</a> — Orbitron, Rajdhani, and Share Tech Mono typefaces used by the launch-bay interface.</li>
        </ul>
      </div>`)
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
