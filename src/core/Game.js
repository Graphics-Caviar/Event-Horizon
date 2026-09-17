import * as THREE from 'three'
import { Level1 } from '../levels/Level1/Level1.js'
import { SceneManager } from './SceneManager.js'
import { AssetManager } from './AssetManager.js'
import { GameState } from './GameState.js'
import { Menu } from '../ui/Menu.js'
import { AudioManager } from '../audio/AudioManager.js'
import { MenuBackground } from './MenuBackground.js'
import storage from '../services/StorageService.js'
import { HangarScene } from './HangarScene.js'
import { CharacterSelect } from '../ui/CharacterSelect.js'
import { AuthScreen } from '../ui/AuthScreen.js'
import { LeaderboardScreen } from '../ui/LeaderboardScreen.js'
import { SHIPS } from '../systems/ShipManager.js'

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
			onLeaderboard: () => this._showLeaderboard(),
			onSignOut: () => this._signOut(),
			audioManager: this.audio,
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
		this.hangarScene = null
		this.characterSelect = null

		this.clock = new THREE.Clock()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)

		this._showMenu()
		this._loop()
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
		this._updateGreeting(status)

		// Keep the greeting and cached profile in step if the player signs in
		// or out later, without Menu needing to know the backend exists.
		this.backend?.onAuthChange((user, nextStatus) => {
			this._adoptProfile()
			this._updateGreeting(nextStatus)
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

	/** Show the home page, greeting whoever is currently playing. */
	_showMenu() {
		this._updateGreeting(this.backend?.status())
		this.menu.showStart()
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
		this.hangarScene.showCharacterOverview()

		this.characterSelect = new CharacterSelect({
			initialPilot: this.gameState.selectedCharacter,
			initialShip: this.gameState.selectedShip,
			onSelectPilot: (key) => {
				this.gameState.selectedCharacter = key
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

		this.currentLevel?.dispose()
		this.currentLevel = new Level1(this)
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
		this.currentLevel?.update?.(delta)
		this.sceneManager.render()
	}
}
