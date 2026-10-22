import * as THREE from 'three'
import { Level1 } from '../levels/Level1/Level1.js'
import { clearScene } from './Level.js'
import { Level2 } from '../levels/Level2/Level2.js'
import { Level3 } from '../levels/Level3/Level3.js'
import { Level1ToLevel2Cutscene } from '../cutscenes/Level1ToLevel2Cutscene.js'
import { Level2ToLevel3Cutscene } from '../cutscenes/Level2ToLevel3Cutscene.js'
import { SceneManager } from './SceneManager.js'
import { AssetManager } from './AssetManager.js'
import { GameState, STATUS } from './GameState.js'
import { Menu } from '../ui/Menu.js'
import { AudioManager } from '../audio/AudioManager.js'
import { RadioDialogue } from '../audio/RadioDialogue.js'
import { MenuBackground } from './MenuBackground.js'
import storage from '../services/StorageService.js'
import { HangarScene } from './HangarScene.js'
import { CharacterSelect } from '../ui/CharacterSelect.js'
import { AuthScreen } from '../ui/AuthScreen.js'
import { LeaderboardScreen } from '../ui/LeaderboardScreen.js'
import { LevelScreens } from '../ui/LevelScreens.js'
import { SHIPS } from '../systems/ShipManager.js'
import { CHARACTERS } from '../systems/CharacterManager.js'
import { ALIEN_MODELS } from '../levels/Level2/Alien.js'
import { ASTEROID_MODELS } from '../levels/Level1/AsteroidField.js'
import { DEFAULT_MODEL as ROVER_MODEL } from '../levels/Level2/Rover.js'

// Menu -> Pilot registry (sign in / create account) -> Hangar
// (character/ship select) -> Level 1. Level 1 gameplay
// (src/levels/Level1/**, src/player/**, src/physics/**, src/ui/HUD.js)
// is wired up via _level1() below — see README.md for per-level status.
//
// Sign-in is required to play WHEN the backend is reachable. When it is not
// (no .env, database not created, offline) the registry offers an offline
// path instead of locking the player out of a game that works fine without
// a backend.

export class Game {
	constructor() {
		const canvas = document.getElementById('game-canvas')
		this.sceneManager = new SceneManager(canvas)
		this.assetManager = new AssetManager()
		this.gameState = new GameState()
		this.currentLevel = null
		this.audio = new AudioManager()

		const profile = storage.load()
		this.gameState.playerName = profile.playerName
		this.gameState.selectedCharacter = profile.selectedCharacter
		this.gameState.selectedShip = profile.selectedShip
		this.audio.setMuted(profile.settings.muted)
		this.audio.setChannelVolumes({
			music: profile.settings.musicVolume,
			sfx: profile.settings.sfxVolume,
			dialogue: profile.settings.dialogueVolume,
		})

		// The two-way radio lives for the whole session: levels only call
		// radio.play('<script id>'), so playback, subtitles, ducking and
		// teardown stay in one place (src/audio/RadioDialogue.js).
		this.radio = new RadioDialogue(this.audio, {
			subtitles: profile.settings.subtitles !== false,
		})

		// The Firebase SDK is ~550 kB, and nothing needs it until after the
		// menu is on screen — so it is pulled in via dynamic import(),
		// which keeps it out of the main bundle as its own lazy chunk.
		//
		// Deliberately NOT awaited: the menu comes up off localStorage
		// straight away and the cloud profile merges in behind it. If
		// Firebase is unconfigured or unreachable this settles into
		// local-only mode and the game is unaffected.
		this.backend = null
		this.backendReady = import('../services/FirebaseService.js')
			.then(({ default: backend }) => {
				this.backend = backend
				return backend.init()
			})
			.then((status) => {
				this._onBackendReady(status)
				return this.backend
			})
			.catch((error) => {
				console.warn(
					'[Backend] Unavailable, running local-only:',
					error?.message
				)
				return null
			})

		this.menu = new Menu({
			onPlay: () => this._onPlay(),
			onTestLevel2: () => this._testLevel2(),
			onTestLevel3: () => this._testLevel3(),
			onLeaderboard: () => this._showLeaderboard(),
			onSignOut: () => this._signOut(),
			audioManager: this.audio,
			radio: this.radio,
			storage,
		})

		this.authScreen = new AuthScreen({
			onSignIn: (username, password) =>
				this.backend?.signIn(username, password) ?? {
					ok: false,
					error: 'Backend still loading — try again in a moment.',
				},
			onSignUp: (username, password) =>
				this.backend?.signUp(username, password) ?? {
					ok: false,
					error: 'Backend still loading — try again in a moment.',
				},
			onGuest: (displayName) =>
				this._playAsGuest(displayName),
			onBack: () => this._showMenu(),
			onAuthenticated: () => this._showHangar(),
		})

		this.leaderboardScreen = null
		// Pause and results overlays for whichever level is running.
		this.levelScreens = new LevelScreens({
			onResume: () => this.currentLevel?.setPaused?.(false),
			onRestart: () => this._restartLevel(),
			onQuit: () => this._exitLevelToMenu(),
		})
		this.hangarScene = null
		this.characterSelect = null

		this.clock = new THREE.Clock()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)

		// Keep the menu and every other UI screen hidden until every model
		// needed by the game has been downloaded and parsed. The normal menu
		// background keeps rendering behind this blocking loading screen.
		this.menu.hideAll()
		this.loadingScreen = this._createLoadingScreen()
		this._loop()
		void this._preloadStartupModels()
	}

	/** Create the blocking startup overlay above the normal animated menu background. */
	_createLoadingScreen() {
		const screen = document.createElement('div')
		screen.id = 'model-preload-screen'
		screen.setAttribute('role', 'status')
		screen.setAttribute('aria-live', 'polite')
		Object.assign(screen.style, {
			position: 'fixed',
			inset: '0',
			zIndex: '100000',
			display: 'grid',
			placeItems: 'center',
			padding: '24px',
			boxSizing: 'border-box',
			background: 'rgba(3, 7, 17, 0.34)',
			color: '#d9f7ff',
			fontFamily: 'system-ui, sans-serif',
			textAlign: 'center',
		})

		const panel = document.createElement('div')
		Object.assign(panel.style, {
			width: 'min(420px, 100%)',
			padding: '28px 24px',
			border: '1px solid rgba(94, 209, 238, 0.34)',
			borderRadius: '10px',
			background: 'rgba(4, 12, 25, 0.78)',
			boxShadow: '0 14px 50px rgba(0, 0, 0, 0.22)',
		})

		const title = document.createElement('div')
		title.textContent = 'EVENT HORIZON'
		Object.assign(title.style, {
			fontSize: '13px',
			fontWeight: '700',
			letterSpacing: '0.24em',
			marginBottom: '9px',
		})

		const status = document.createElement('div')
		status.textContent = 'PREPARING FLIGHT SYSTEMS…'
		Object.assign(status.style, {
			fontSize: '11px',
			letterSpacing: '0.14em',
			color: '#86c8d8',
			marginBottom: '18px',
		})

		const track = document.createElement('div')
		track.setAttribute('role', 'progressbar')
		track.setAttribute('aria-valuemin', '0')
		track.setAttribute('aria-valuemax', '11')
		track.setAttribute('aria-valuenow', '0')
		Object.assign(track.style, {
			width: '100%',
			height: '8px',
			overflow: 'hidden',
			border: '1px solid rgba(107, 202, 228, 0.5)',
			borderRadius: '999px',
			background: 'rgba(10, 28, 44, 0.95)',
			boxSizing: 'border-box',
		})

		const fill = document.createElement('div')
		Object.assign(fill.style, {
			width: '0%',
			height: '100%',
			borderRadius: '999px',
			background: 'linear-gradient(90deg, #25a9dc, #a7f0ff)',
			transition: 'width 160ms ease-out',
		})
		track.appendChild(fill)

		const counter = document.createElement('div')
		counter.textContent = '0 / 11 MODELS LOADED'
		Object.assign(counter.style, {
			fontSize: '11px',
			fontFamily: 'ui-monospace, monospace',
			letterSpacing: '0.08em',
			marginTop: '11px',
			color: '#d9f7ff',
		})

		const error = document.createElement('div')
		Object.assign(error.style, {
			fontSize: '12px',
			lineHeight: '1.5',
			color: '#ffb7a9',
			marginTop: '15px',
		})
		error.hidden = true

		const retry = document.createElement('button')
		retry.type = 'button'
		retry.textContent = 'RETRY LOADING'
		retry.hidden = true
		Object.assign(retry.style, {
			marginTop: '16px',
			padding: '10px 18px',
			border: '1px solid rgba(108, 220, 245, 0.8)',
			borderRadius: '5px',
			background: 'rgba(21, 112, 145, 0.28)',
			color: '#e3fbff',
			font: 'inherit',
			fontSize: '11px',
			fontWeight: '700',
			letterSpacing: '0.1em',
			cursor: 'pointer',
		})
		retry.addEventListener('click', () => {
			void this._preloadStartupModels()
		})

		panel.append(title, status, track, counter, error, retry)
		screen.appendChild(panel)
		document.body.appendChild(screen)
		this._loadingStatus = status
		this._loadingTrack = track
		this._loadingFill = fill
		this._loadingCounter = counter
		this._loadingError = error
		this._loadingRetry = retry
		return screen
	}

	/** Preload the unique GLB models used by the hangar and all gameplay levels. */
	async _preloadStartupModels() {
		if (this._startupPreloadActive || !this.loadingScreen) return
		this._startupPreloadActive = true
		const models = [
			...Object.values(CHARACTERS).map((config) => ({
				name: `${config.name} pilot`,
				paths: config.model,
			})),
			...Object.values(SHIPS).map((config) => ({
				name: `${config.name} ship`,
				paths: config.model,
			})),
			...Object.entries(ALIEN_MODELS).map(([name, path]) => ({
				name: `${name} alien`,
				paths: path,
			})),
			...ASTEROID_MODELS.map((path, index) => ({
				name: `asteroid ${index + 1}`,
				paths: path,
			})),
			{ name: 'exploration rover', paths: ROVER_MODEL },
		]
		const loaded = new Set()
		const failures = []

		this._loadingStatus.textContent = 'PREPARING FLIGHT SYSTEMS…'
		this._loadingError.hidden = true
		this._loadingError.textContent = ''
		this._loadingRetry.hidden = true
		this._loadingRetry.disabled = true
		this._loadingTrack.setAttribute(
			'aria-valuemax',
			String(models.length)
		)
		this._updateModelLoadingProgress(loaded.size, models.length)

		await Promise.all(
			models.map(async (entry) => {
				try {
					await this.assetManager.preloadModel(
						entry.paths
					)
					loaded.add(entry.name)
				} catch (error) {
					failures.push({
						name: entry.name,
						error,
					})
					console.error(
						`[Startup] Failed to preload ${entry.name}:`,
						error
					)
				} finally {
					this._updateModelLoadingProgress(
						loaded.size,
						models.length
					)
				}
			})
		)

		this._startupPreloadActive = false
		this._loadingRetry.disabled = false
		if (failures.length) {
			this._loadingStatus.textContent =
				'SOME MODELS COULD NOT BE LOADED'
			const failedNames = failures
				.map(({ name }) => name)
				.join(', ')
			this._loadingError.textContent = `Could not load ${failures.length} of ${models.length} models: ${failedNames}. Check the asset paths or connection, then retry.`
			this._loadingError.hidden = false
			this._loadingRetry.hidden = false
			return
		}

		this.loadingScreen.remove()
		this.loadingScreen = null
		this._showMenu()
	}

	_updateModelLoadingProgress(loaded, total) {
		if (!this._loadingCounter || !this._loadingFill) return
		this._loadingCounter.textContent = `${loaded} / ${total} MODELS LOADED`
		this._loadingFill.style.width = `${total ? (loaded / total) * 100 : 0}%`
		this._loadingTrack.setAttribute('aria-valuenow', String(loaded))
	}

	/**
	 * Called once the backend has finished signing in and syncing. By now
	 * ProfileService has already merged the cloud profile down into
	 * localStorage, so this just re-reads it — but only while we are still
	 * sitting on the menu, so a slow sync can never reach in and change the
	 * pilot or mute state mid-run.
	 */
	_onBackendReady(status) {
		if (status.ready && status.signedIn) {
			console.info(
				`[Backend] Online as ${status.username || status.uid}${status.emulator ? ' (emulator)' : ''}.`
			)
		} else if (status.ready) {
			console.info(
				'[Backend] Reachable; nobody signed in yet.'
			)
		} else {
			console.info(
				'[Backend] Local-only; progress stays in this browser.'
			)
		}

		this._adoptProfile()
		this._refreshHome(status)

		// Keep the greeting and cached profile in step if the player signs in
		// or out later, without Menu needing to know the backend exists.
		this.backend?.onAuthChange((user, nextStatus) => {
			this._adoptProfile()
			this._refreshHome(nextStatus)
		})
	}

	/**
	 * Drive the "WELCOME <callsign>" line on the home page.
	 *
	 * One rule for all three session kinds: greet whatever name we have, and
	 * tag it GUEST when it is not backed by a real account. A signed-in
	 * account uses its callsign; a guest or offline player uses the callsign
	 * they typed on the registry screen (kept in localStorage). With no name
	 * at all, the greeting stays hidden rather than saying "WELCOME".
	 */
	_updateGreeting(status) {
		const accountName = status?.username || null
		const name = accountName || storage.load().playerName || null
		this.menu.setAccount(name, {
			// Until the backend has reported in, a cached callsign could
			// belong to either an account or a guest — show it unlabelled
			// rather than briefly mislabelling a real account as a guest.
			isGuest:
				Boolean(status) &&
				Boolean(name) &&
				!accountName,
		})
	}

	/**
	 * Bring everything on the home page up to date with the current player:
	 * the greeting and the level locks. Both depend on the same session state
	 * and are refreshed together, so no code path can update one and forget
	 * the other.
	 */
	_refreshHome(status) {
		this._updateGreeting(status)
		this.menu.setUnlockedLevel(this._highestUnlockedLevel())
	}

	/**
	 * Only a synced cloud profile knows real progress. Everyone else — not
	 * signed in, offline, or signed in but before the sync lands — starts at
	 * level 1, so levels 2 and 3 stay locked until progress says otherwise.
	 */
	_highestUnlockedLevel() {
		return this.backend?.profile?.profile?.highestUnlockedLevel || 1
	}

	/** Show the home page, greeting whoever is currently playing. */
	_showMenu() {
		this._refreshHome(this.backend?.status())
		this.menu.showStart()
		this._preloadPilot()
	}

	_preloadPilot() {
		const config =
			CHARACTERS[this.gameState.selectedCharacter] ||
			CHARACTERS.zara
		void this.assetManager
			.preloadModel(config.model)
			.catch((error) => {
				console.warn(
					'[Level2] Pilot preload unavailable:',
					error?.message
				)
			})
	}

	/**
	 * Re-read the locally cached profile into GameState. ProfileService has
	 * already merged the cloud copy down into localStorage by the time this
	 * runs, so this is just picking up the result — and only while we are
	 * out of a level, so a slow sync can never change the pilot mid-run.
	 */
	_adoptProfile() {
		if (this.currentLevel) return
		const profile = storage.load()
		this.gameState.playerName = profile.playerName
		this.gameState.selectedCharacter = profile.selectedCharacter
		this.gameState.selectedShip = profile.selectedShip
		this.audio.setMuted(profile.settings.muted)
		this.audio.setChannelVolumes({
			music: profile.settings.musicVolume,
			sfx: profile.settings.sfxVolume,
			dialogue: profile.settings.dialogueVolume,
		})
		this.radio.setSubtitlesEnabled(
			profile.settings.subtitles !== false
		)
		this._preloadPilot()
	}

	/** True when a real account could be created or signed into right now. */
	_isBackendAvailable() {
		const status = this.backend?.status()
		return Boolean(status?.configured && status?.ready)
	}

	/** PLAY: straight to the hangar if already signed in, otherwise the
	 * pilot registry. */
	async _onPlay() {
		this.menu.hideAll()

		// The backend is a lazy chunk, so on a fast click it may not have
		// landed yet. Wait for it rather than showing a disabled form.
		if (!this.backend) await this.backendReady

		if (this.backend?.status().signedIn) {
			this._showHangar()
			return
		}

		const available = this._isBackendAvailable()
		this.authScreen.show({
			available,
			reason: available
				? undefined
				: this._unavailableReason(),
		})
	}

	_unavailableReason() {
		const status = this.backend?.status()
		if (!status?.configured) {
			return 'Accounts need Firebase. Copy .env.example to .env and fill in the VITE_FIREBASE_* values. You can still play offline — progress is saved in this browser only.'
		}
		return 'Could not reach Firebase, so accounts are unavailable. You can still play offline — progress is saved in this browser only.'
	}

	/**
	 * Play without an account. With a reachable backend this is a real
	 * anonymous session (progress syncs, tied to this browser); without one
	 * it is purely local. Either way the typed callsign is kept as a label.
	 */
	async _playAsGuest(displayName) {
		if (displayName) {
			storage.setPlayerName(displayName)
			this.gameState.playerName = displayName
		}

		if (!this._isBackendAvailable()) {
			console.info('[Backend] Playing offline (no account).')
			return { ok: true }
		}

		const result = await this.backend.signInAsGuest()
		if (!result.ok) {
			// Guest sign-in needs the Anonymous provider enabled. If it is
			// off, fall back to offline rather than blocking play.
			console.warn(
				`[Auth] Guest sign-in unavailable (${result.error}); playing offline.`
			)
			return { ok: true }
		}
		if (displayName) storage.setPlayerName(displayName)
		return result
	}

	async _signOut() {
		const wasSignedIn = Boolean(this.backend?.status().signedIn)
		await this.backend?.signOut()

		// A real sign-out clears the cached profile via ProfileService, but an
		// offline session has no auth state to change and nothing clears it
		// for us — do it here so SIGN OUT means the same thing in both modes.
		if (!wasSignedIn) storage.reset({ silent: true })

		this.gameState.playerName = ''
		this._adoptProfile()
		this._showMenu()
	}

	_showLeaderboard() {
		this.menu.hideAll()
		if (!this.leaderboardScreen) {
			this.leaderboardScreen = new LeaderboardScreen({
				backend: this.backend,
				onBack: () => this._showMenu(),
			})
		}
		// The facade is created lazily, so refresh the reference in case the
		// screen was built before the chunk landed.
		this.leaderboardScreen.backend = this.backend
		this.leaderboardScreen.show()
	}

	/** Signed in (or playing offline) -> here. Shows the hangar (pick a
	 * pilot, look over the ship) before actually launching into a level. */
	_showHangar() {
		const profile = storage.load()
		// The account callsign is the identity when there is one; otherwise
		// fall back to whatever this browser has cached.
		this.gameState.playerName =
			this.backend?.status().username ||
			profile.playerName ||
			this.gameState.playerName ||
			'Pilot'
		this.gameState.selectedCharacter =
			profile.selectedCharacter ||
			this.gameState.selectedCharacter ||
			'zara'
		const savedShip =
			profile.selectedShip || this.gameState.selectedShip
		this.gameState.selectedShip = SHIPS[savedShip]
			? savedShip
			: 'starfighter'
		this.menu.hideAll()

		if (this.menuBackground) {
			this.menuBackground.dispose()
			this.menuBackground = null
		}

		this.hangarScene = new HangarScene(
			this.sceneManager,
			this.assetManager
		)
		// The ship tab keeps its text in a left sidebar; frame the 3D ship
		// inside the empty stage on the right instead of dead-centre.
		this.hangarScene.setShipStage(
			document.getElementById('ship-stage')
		)
		// Each lineup pilot stands above its own name card; the card row's
		// CSS is what sets the spacing between pilots.
		this.hangarScene.setPilotAnchor((key) =>
			document.querySelector(
				`.pilot-lineup-choice[data-key="${key}"]`
			)
		)
		this.hangarScene.showCharacterOverview()

		this.characterSelect = new CharacterSelect({
			initialPilot: this.gameState.selectedCharacter,
			initialShip: this.gameState.selectedShip,
			onSelectPilot: (key) => {
				this.gameState.selectedCharacter = key
				this._preloadPilot()
				this.hangarScene.showCharacter(key)
			},
			onPilotOverview: () => {
				this.hangarScene.showCharacterOverview()
			},
			onSelectShip: (key) => {
				this.gameState.selectedShip = key
				this.hangarScene.showShip(key)
			},
			onTabChange: (tab) => {
				if (tab === 'ship') {
					this.hangarScene.showShip(
						this.characterSelect.getSelectedShipKey()
					)
				} else {
					this.hangarScene.showCharacterOverview()
				}
			},
			onContinue: (pilotKey, shipKey) =>
				this._level1(
					this.gameState.playerName,
					pilotKey,
					shipKey
				),
			onBack: () => this._backToMenu(),
			storageService: storage,
		})
		this.characterSelect.show()
		// Soft ambient pad while the player is in the hangar/launch bay.
		this.audio.startHangarMusic()
	}

	_backToMenu() {
		if (this.characterSelect) {
			this.characterSelect.hide()
			this.characterSelect = null
		}
		if (this.hangarScene) {
			this.hangarScene.dispose()
			this.hangarScene = null
		}
		this.audio.stopHangarMusic()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)
		this._showMenu()
	}

	_level1(name, characterKey, shipKey) {
		this.gameState.playerName = name || this.gameState.playerName
		this.gameState.selectedCharacter =
			characterKey ||
			this.gameState.selectedCharacter ||
			'zara'
		this.gameState.selectedShip =
			shipKey || this.gameState.selectedShip || 'starfighter'

		storage.save({
			playerName: this.gameState.playerName,
			selectedCharacter: this.gameState.selectedCharacter,
			selectedShip: this.gameState.selectedShip,
		})

		console.log(
			`LAUNCH pressed for "${this.gameState.playerName}" flying as "${this.gameState.selectedCharacter}" in spaceship "${this.gameState.selectedShip}".`
		)

		if (this.characterSelect) {
			this.characterSelect.hide()
			this.characterSelect = null
		}
		if (this.hangarScene) {
			this.hangarScene.dispose()
			this.hangarScene = null
		}
		this.audio.stopHangarMusic()

		this._startLevel1()
	}

	/** Start (or restart) Level 1 with the pilot and ship from the hangar. */
	_startLevel1() {
		this._activeLevelNumber = 1
		this.radio.stop()
		this.radio.setCinematic(false)
		this._preloadPilot()
		this.levelScreens.hideAll()
		this.menu.hideAll()
		this.currentLevel?.dispose()
		this.currentLevel = new Level1(this, {
			shipKey: this.gameState.selectedShip,
			pilotKey: this.gameState.selectedCharacter,
			onPauseChange: (paused) =>
				paused
					? this.levelScreens.showPause()
					: this.levelScreens.hidePause(),
			onEnd: (result) => this._onLevelEnd(result),
		})
	}

	/**
	 * A run has finished: show the result straight away, then post it to the
	 * leaderboard and fill in the outcome when the backend answers. The
	 * result screen never waits on the network.
	 */
	async _onLevelEnd(result) {
		// Ignore stale/doubled success events before touching the active radio
		// or persistence. Level3 also extends Level2, so check its level number.
		if (
			result.won &&
			result.level === 2 &&
			(!(this.currentLevel instanceof Level2) ||
				this.currentLevel.level !== 2 ||
				this.currentLevel._transitStarted)
		)
			return
		// Results/pause screens own the screen from here; the radio must not
		// talk over them. Levels that hand straight to a cutscene re-key up
		// their own traffic afterwards.
		this.radio.stop()
		// Level 2's escape is a story transition now: the transit cinematic
		// shoots the still-live surface world, so the Level 2 ambience keeps
		// breathing under the alien-ship discovery before the ascent into space.
		if (result.won && result.level === 2) {
			this._saveCompletedLevel2Run(result)
			this._startLevel2ToLevel3Cutscene(result)
			return
		}
		this.audio.stopAmbience()
		// A successful escape is now a story transition rather than a results
		// screen. Persist the Level 1 run in the background, then hand the exact
		// exit transform/momentum into the cinematic. Failures keep the existing
		// results/retry flow.
		if (result.won && result.outcome === 'escaped') {
			this._saveCompletedLevel1Run(result)
			this._startLevel1ToLevel2Cutscene(result.handoff)
			return
		}

		const status = this.backend?.status()
		const canSave = Boolean(status?.ready && status?.signedIn)
		this.levelScreens.showResults(
			result,
			canSave
				? {
						text: 'Saving your run to the leaderboard…',
					}
				: {
						text: 'Offline run — sign in to post scores to the leaderboard.',
					}
		)
		if (!canSave) return

		const levelBefore = this._highestUnlockedLevel()
		const scoreId = await this.backend.submitRun(this.gameState, {
			completed: result.won,
		})
		if (this.gameState.status === STATUS.PLAYING) return

		if (!scoreId) {
			this.levelScreens.setNote({
				text: "Couldn't reach the leaderboard — this run wasn't saved.",
				tone: 'warn',
			})
			return
		}
		const unlockedNow = this._highestUnlockedLevel() > levelBefore
		this.levelScreens.setNote({
			text: unlockedNow
				? `Score saved · Level ${this._highestUnlockedLevel()} unlocked`
				: 'Score saved to the leaderboard',
			tone: 'good',
		})
	}

	_saveCompletedLevel1Run(result) {
		const status = this.backend?.status()
		if (!status?.ready || !status?.signedIn) return

		// submitRun only needs these plain values. Snapshot them before the
		// cinematic changes currentLevel/status so asynchronous network work
		// cannot accidentally submit the Level 2 state instead.
		const completedState = {
			playerName: this.gameState.playerName,
			score: result.score,
			elapsedTime: result.time,
			nitrogenCollected: this.gameState.nitrogenCollected,
			currentLevel: 1,
		}
		void this.backend
			.submitRun(completedState, { completed: true })
			.catch((error) =>
				console.warn(
					'[Backend] Level 1 completion could not be saved:',
					error?.message
				)
			)
	}

	_saveCompletedLevel2Run(result) {
		const status = this.backend?.status()
		if (!status?.ready || !status?.signedIn) return

		// Same snapshot rule as Level 1: plain values captured before the
		// cinematic changes currentLevel/status, so asynchronous network work
		// cannot accidentally submit the Level 3 state instead.
		const completedState = {
			playerName: this.gameState.playerName,
			score: result.score,
			elapsedTime: result.time,
			nitrogenCollected: this.gameState.nitrogenCollected,
			currentLevel: 2,
		}
		void this.backend
			.submitRun(completedState, { completed: true })
			.catch((error) =>
				console.warn(
					'[Backend] Level 2 completion could not be saved:',
					error?.message
				)
			)
	}

	/**
	 * The Level 2 escape: commandeering an alien vessel and wormhole transit into
	 * Level 3. The still-live Level 2 world is handed to the cutscene (NOT
	 * disposed here) — the cinematic shoots it, disposes it at the transit
	 * and builds the existing Level 3 on the other side.
	 */
	_startLevel2ToLevel3Cutscene(result) {
		const level = this.currentLevel
		if (
			!(level instanceof Level2) ||
			level.level !== 2 ||
			level._transitStarted
		)
			return
		level._transitStarted = true
		this.levelScreens.hideAll()
		this.menu.hideAll()
		// Cinematic subtitles ride higher over the letterbox; the transit
		// conversation keys up fresh after _onLevelEnd's stop().
		this.radio.setCinematic(true)
		this.gameState.status = STATUS.CUTSCENE
		// A skip or a load failure must never fall back to replaying Level 2.
		this._activeLevelNumber = 3
		let cinematic
		cinematic = new Level2ToLevel3Cutscene(this, {
			level,
			result,
			onComplete: (level3) => {
				if (this.currentLevel !== cinematic) {
					level3?.dispose()
					return
				}
				this._onLevel2ToLevel3Complete(level3)
			},
		})
		this.currentLevel = cinematic
	}

	_onLevel2ToLevel3Complete(level3) {
		// Retire the finished cinematic shell (it disposes nothing more once
		// complete); the live Level 3 world it built is what the loop takes
		// over, exactly like the crash cutscene hands Level 2 back.
		this.currentLevel?.dispose?.()
		this.currentLevel = level3 || null
		if (!level3) {
			// Level 3 could not be built (the cutscene's failure path already
			// cleaned the scene): recover to the menu rather than stranding
			// the player on a black screen.
			this._exitLevelToMenu()
			return
		}
		this.gameState.status = STATUS.PLAYING
	}

	_startLevel1ToLevel2Cutscene(handoff) {
		this.levelScreens.hideAll()
		this.menu.hideAll()
		this.currentLevel?.dispose()
		// Cut the last gameplay transmission; the crash traffic starts fresh
		// and subtitles move up over the comic captions.
		this.radio.stop()
		this.radio.setCinematic(true)
		this.gameState.status = STATUS.CUTSCENE
		this.currentLevel = new Level1ToLevel2Cutscene(this, {
			handoff,
			onComplete: (transition) =>
				this._startLevel2(transition),
		})
	}

	/** Direct menu entry for testing the current Level 2 implementation. */
	_testLevel2() {
		this.menu.hideAll()
		this.radio.stop()
		this.radio.setCinematic(false)
		this.levelScreens.hideAll()
		this.menuBackground?.dispose()
		this.menuBackground = null
		clearScene(this.sceneManager.scene)
		this.gameState.reset()
		document.activeElement?.blur?.()
		this._startLevel2()
	}

	_startLevel2(transition = {}) {
		this._activeLevelNumber = 2
		// Reached from the crash cinematic: gameplay subtitles drop back
		// over the HUD and the cinematic's last transmission is cut.
		this.radio.stop()
		this.radio.setCinematic(false)
		this.currentLevel?.dispose()
		this.currentLevel = new Level2(this, {
			transition,
			onEnd: (result) => this._onLevelEnd(result),
		})
	}

	/** Results-screen retry: relaunch whichever level was just played. */
	_testLevel3() {
		this.menu.hideAll()
		this.radio.stop()
		this.radio.setCinematic(false)
		this.levelScreens.hideAll()
		this.currentLevel?.dispose()
		this.currentLevel = null
		this.menuBackground?.dispose()
		this.menuBackground = null
		clearScene(this.sceneManager.scene)
		this.gameState.reset()
		document.activeElement?.blur?.()
		this._activeLevelNumber = 3
		this.currentLevel = new Level3(this, {
			onEnd: (result) => this._onLevelEnd(result),
		})
	}

	_restartLevel() {
		if (this._activeLevelNumber === 3) this._testLevel3()
		else if (this._activeLevelNumber === 2) this._testLevel2()
		else this._startLevel1()
	}

	/** Leave the level for the home page, restoring what the level cleared. */
	_exitLevelToMenu() {
		this.levelScreens.hideAll()
		// Nothing may keep transmitting after the level is gone.
		this.radio.stop()
		this.audio.stopAmbience()
		this.radio.setCinematic(false)
		this.currentLevel?.dispose()
		this.currentLevel = null
		this.gameState.status = STATUS.MENU
		// Level 1 empties the scene on start, SceneManager's default lights
		// included; the menu needs them back.
		this.sceneManager.addLights()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)
		// Refreshes the greeting and the level locks — a Level 1 escape
		// unlocks Level 2 right here.
		this._showMenu()
	}

	_loop() {
		requestAnimationFrame(() => this._loop())
		const delta = Math.min(this.clock.getDelta(), 0.1)
		if (this.menuBackground) {
			this.menuBackground.update(delta)
		}
		if (this.hangarScene) {
			this.hangarScene.update(delta)
		}
		// Radio timing is frame-driven so pausing/skipping a level freezes
		// the conversation with it (no orphaned timers).
		this.radio.update(delta)
		this.currentLevel?.update?.(delta)
		this.sceneManager.render()
	}
}
