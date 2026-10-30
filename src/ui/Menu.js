/**
 * Per-level intel for the main menu. Hints are ordered from a nudge to a
 * full route, and are revealed one at a time — the modal never dumps the
 * whole solution. Everything below describes mechanics that exist in
 * Level1.js / Level2.js / Level3.js today.
 */
const LEVEL_INTEL = Object.freeze({
	1: {
		name: 'LEVEL 1 · THE SINGULARITY RUN',
		overview: "Fly Horizon One out of the black hole's pull, thread the asteroid field and cross the escape ring. Hull integrity and elapsed time both feed your score.",
		hints: [
			'W thrusts, S brakes, A/D steer, Q/E climb and dive, and V switches camera view. The singularity pulls harder the longer you take.',
			'Blue nitrogen canisters refill your boost. Fly through one when you need a burst of speed.',
			'The beacon ring at 5000 units is the exit. Keep the nose on it and steer only around the rocks that are actually in your path.',
			'Below 160 units of clearance the proximity alarm sounds. Thrust directly away from the horizon before the drift wins.',
		],
	},
	2: {
		name: 'LEVEL 2 · ALIEN PLANET EXODUS',
		overview: 'Horizon One is down on an alien surface. Reach the exploration rover and drive through the escape portal before the local wildlife finishes the job.',
		hints: [
			'WASD walks, Shift sprints, Space jumps, V toggles the camera. Follow the yellow guide line to the rover.',
			'Press E within 9 m of the rover to board; E again exits. Driving is far faster than walking.',
			'The rover cannot climb the steepest ridges — back out and take the longer line. Lava and deep water will damage you.',
			'Aliens bite if they catch you. Keep moving, and remember the yellow line switches to the portal once you have boarded.',
		],
	},
	3: {
		name: 'LEVEL 3 · THE VOID OF GODS',
		overview: 'The gate opens onto the ashen wastes. Cross the storm, deal with the void warband and reach the escape portal.',
		hints: [
			'Hold Space to fly with the jetpack, release to descend. Shift still sprints on the ground.',
			'An energy blade waits near the landing site. Walk within 3 m to equip it, press F to swing, and press R to switch between vertical and horizontal attacks.',
			'Void constructs pay 150 points each and the colossus 800. The colossus shockwave only strikes grounded pilots — stay airborne when the ring passes.',
			'The portal accepts you on foot, by jetpack or by rover. If the warband is overwhelming you, fly over them instead of fighting.',
		],
	},
})

export class Menu {
	constructor({
		onPlay,
		onTestLevel2,
		onTestLevel3,
		onLeaderboard,
		onSignOut,
		audioManager,
		radio,
		storage,
	}) {
		// PLAY no longer collects a callsign here — the pilot registry
		// (AuthScreen) owns identity now, so Menu just reports the click.
		this.onPlay = onPlay || (() => {})
		this.onLeaderboard = onLeaderboard || (() => {})
		this.onSignOut = onSignOut || (() => {})
		this.audio = audioManager
		// Radio owns the subtitle overlay; the settings modal toggles it live.
		this.radio = radio || null
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
		const level3Card = document.querySelector(
			'.level-card[data-level="3"]'
		)
		level3Card?.setAttribute('tabindex', '0')
		level3Card?.setAttribute('role', 'button')
		level3Card?.addEventListener('click', () => onTestLevel3?.())
		level3Card?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				onTestLevel3?.()
			}
		})
		// INTEL sits inside the clickable card, so it stops propagation:
		// reading hints must never launch a level by accident.
		for (const card of this.levelCards) {
			const level = Number(card.dataset.level)
			if (!LEVEL_INTEL[level]) continue
			const intel = document.createElement('button')
			intel.type = 'button'
			intel.className = 'level-intel'
			intel.textContent = 'INTEL'
			intel.setAttribute(
				'aria-label',
				`Mission intel and hints for Level ${level}`
			)
			intel.addEventListener('click', (event) => {
				event.stopPropagation()
				this._openIntelModal(level)
			})
			// The card answers Enter/Space itself; keep those on the button.
			intel.addEventListener('keydown', (event) =>
				event.stopPropagation()
			)
			card.appendChild(intel)
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
			// Terrain levels are available for direct gameplay testing.
			card.classList.toggle(
				'is-locked',
				level !== 2 && level !== 3 && level > unlocked
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
		const { settings } = this.storage.load()
		const percent = (value) => Math.round(Number(value) * 100)
		const checked = (value) => (value ? 'checked' : '')
		this._openModal(`
      <h3>SETTINGS</h3>
      <div class="settings-row">
        <span>Mute all audio</span>
        <input id="setting-mute" type="checkbox" ${checked(settings.muted)} />
      </div>
      <div class="settings-row">
        <span>Radio subtitles</span>
        <input id="setting-subtitles" type="checkbox" ${checked(settings.subtitles !== false)} />
      </div>
      <label class="settings-slider">
        <span>Dialogue <output id="setting-dialogue-value">${percent(settings.dialogueVolume)}%</output></span>
        <input id="setting-dialogue" type="range" min="0" max="1" step="0.05" value="${settings.dialogueVolume}" />
      </label>
      <label class="settings-slider">
        <span>Music <output id="setting-music-value">${percent(settings.musicVolume)}%</output></span>
        <input id="setting-music" type="range" min="0" max="1" step="0.05" value="${settings.musicVolume}" />
      </label>
      <label class="settings-slider">
        <span>Sound effects <output id="setting-sfx-value">${percent(settings.sfxVolume)}%</output></span>
        <input id="setting-sfx" type="range" min="0" max="1" step="0.05" value="${settings.sfxVolume}" />
      </label>
      <p class="modal-desc">Music ducks automatically while the radio is transmitting. Subtitles can stay on with the sound off.</p>
    `)

		// One write path for every control: apply live, then persist.
		const persist = (key, value) => {
			const profile = this.storage.load()
			profile.settings[key] = value
			this.storage.save(profile)
		}

		document.getElementById('setting-mute').addEventListener(
			'change',
			(e) => {
				const muted = e.target.checked
				this.audio?.setMuted(muted)
				persist('muted', muted)
			}
		)
		document.getElementById('setting-subtitles').addEventListener(
			'change',
			(e) => {
				const enabled = e.target.checked
				this.radio?.setSubtitlesEnabled(enabled)
				persist('subtitles', enabled)
			}
		)

		for (const channel of ['dialogue', 'music', 'sfx']) {
			const input = document.getElementById(
				`setting-${channel}`
			)
			const output = document.getElementById(
				`setting-${channel}-value`
			)
			if (!input) continue
			input.addEventListener('input', (e) => {
				const value = Number(e.target.value)
				this.audio?.setChannelVolume(channel, value)
				if (output)
					output.textContent = `${percent(value)}%`
				persist(`${channel}Volume`, value)
			})
		}
	}

	/**
	 * Level intel: mission overview plus clues that reveal one at a time,
	 * so the modal never hands over the whole route at once.
	 */
	_openIntelModal(level) {
		const intel = LEVEL_INTEL[level]
		if (!intel) return
		const clues = intel.hints
			.map(
				(hint, index) => `
      <li class="intel-clue" data-clue="${index}" hidden>
        <span class="intel-clue-index">${String(index + 1).padStart(2, '0')}</span>
        <p>${hint}</p>
      </li>`
			)
			.join('')
		this._openModal(`
      <h3>${intel.name}</h3>
      <p class="modal-desc">${intel.overview}</p>
      <ol class="intel-clues">${clues}</ol>
      <div class="modal-actions">
        <button id="intel-reveal" class="btn-secondary" type="button"></button>
      </div>
    `)

		const reveal = document.getElementById('intel-reveal')
		const items = [
			...this.modalContent.querySelectorAll('.intel-clue'),
		]
		let revealed = 0
		const syncButton = () => {
			if (revealed >= items.length) {
				reveal.hidden = true
				return
			}
			reveal.textContent = `REVEAL ${revealed === 0 ? 'FIRST' : 'NEXT'} CLUE · ${revealed}/${items.length}`
		}
		syncButton()
		reveal.addEventListener('click', () => {
			if (revealed >= items.length) return
			items[revealed].hidden = false
			revealed += 1
			syncButton()
		})
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
          <li><a href="https://rapier.rs/" target="_blank" rel="noopener noreferrer">Rapier Physics Engine</a> — Dimforge and contributors. Level 2 rover gravity, terrain collisions, and six-wheel suspension. <small>Apache-2.0 license</small></li>
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
