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
import { LandingScene } from './LandingScene.js'
import { LandingUI } from '../ui/LandingUI.js'

// Menu -> Hangar (character/ship select) -> Level 1 -> LandingScene (End of Stage) -> Level 2.
// Level 1 gameplay (src/levels/Level1/**, src/player/**, src/physics/**, src/ui/HUD.js)
// transitions into LandingScene upon singularity escape / stage victory.

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

		this.menu = new Menu({
			onLaunch: (name) => this._showHangar(name),
			audioManager: this.audio,
			storage,
		})

		this.hangarScene = null
		this.characterSelect = null
		this.landingScene = null
		this.landingUI = null

		this.clock = new THREE.Clock()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)

		this.menu.showStart()

		// Hotkey: Press 'V' anytime to preview/trigger the Landing Scene & Stage Victory
		window.addEventListener('keydown', (e) => {
			if (
				(e.key === 'v' || e.key === 'V') &&
				!e.target.matches('input, textarea')
			) {
				this.showLandingScene(
					this.gameState.selectedShip,
					this.gameState.selectedCharacter
				)
			}
		})

		this._loop()
	}

	/** PLAY -> callsign entered -> here. Shows the hangar (pick a pilot,
	 * look over the ship) before actually launching into a level. */
	_showHangar(name) {
		const profile = storage.load()
		this.gameState.playerName =
			name || profile.playerName || this.gameState.playerName
		this.gameState.selectedCharacter =
			profile.selectedCharacter ||
			this.gameState.selectedCharacter ||
			'zara'
		this.gameState.selectedShip =
			profile.selectedShip ||
			this.gameState.selectedShip ||
			'raven'
		this.menu.hideAll()

		this._cleanupAllScenes()

		this.hangarScene = new HangarScene(
			this.sceneManager,
			this.assetManager
		)
		this.hangarScene.showCharacter(this.gameState.selectedCharacter)

		this.characterSelect = new CharacterSelect({
			initialPilot: this.gameState.selectedCharacter,
			initialShip: this.gameState.selectedShip,
			onSelectPilot: (key) => {
				this.gameState.selectedCharacter = key
				this.hangarScene.showCharacter(key)
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
					this.hangarScene.showCharacter(
						this.characterSelect.getSelectedPilotKey()
					)
				}
			},
			onContinue: (pilotKey, shipKey) =>
				this._level1(
					this.gameState.playerName,
					pilotKey,
					shipKey
				),
			onPreviewLanding: (pilotKey, shipKey) =>
				this.showLandingScene(shipKey, pilotKey),
			onBack: () => this._backToMenu(),
			storageService: storage,
		})
		this.characterSelect.show()
	}

	_cleanupAllScenes() {
		if (this.menuBackground) {
			this.menuBackground.dispose()
			this.menuBackground = null
		}
		if (this.characterSelect) {
			this.characterSelect.hide()
			this.characterSelect = null
		}
		if (this.hangarScene) {
			this.hangarScene.dispose()
			this.hangarScene = null
		}
		if (this.landingUI) {
			this.landingUI.hide()
			this.landingUI = null
		}
		if (this.landingScene) {
			this.landingScene.dispose()
			this.landingScene = null
		}
		if (this.currentLevel) {
			this.currentLevel.dispose?.()
			this.currentLevel = null
		}
	}

	_backToMenu() {
		this._cleanupAllScenes()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)
		this.menu.showStart()
	}

	_level1(name, characterKey, shipKey) {
		this.gameState.playerName = name || this.gameState.playerName
		this.gameState.selectedCharacter =
			characterKey ||
			this.gameState.selectedCharacter ||
			'zara'
		this.gameState.selectedShip =
			shipKey || this.gameState.selectedShip || 'raven'

		storage.save({
			playerName: this.gameState.playerName,
			selectedCharacter: this.gameState.selectedCharacter,
			selectedShip: this.gameState.selectedShip,
		})

		console.log(
			`LAUNCH pressed for "${this.gameState.playerName}" flying as "${this.gameState.selectedCharacter}" in spaceship "${this.gameState.selectedShip}".`
		)

		this._cleanupAllScenes()
		this.currentLevel = new Level1(this)
	}

	/** Shows the planetary landing cinematic for the selected starfighter */
	showLandingScene(shipKey, pilotKey) {
		const activeShipKey =
			shipKey || this.gameState.selectedShip || 'raven'
		const activePilotKey =
			pilotKey || this.gameState.selectedCharacter || 'zara'

		this._cleanupAllScenes()

		this.landingScene = new LandingScene(
			this.sceneManager,
			this.assetManager,
			{
				shipKey: activeShipKey,
				pilotKey: activePilotKey,
				onComplete: () => {
					if (this.landingUI) {
						this.landingUI.showDebrief()
					}
				},
			}
		)

		this.landingUI = new LandingUI({
			playerName: this.gameState.playerName,
			pilotKey: activePilotKey,
			shipKey: activeShipKey,
			onContinue: () => {
				// Continue to Level 2
				this._showPlaceholderLevel2()
			},
			onReplay: () => {
				if (this.landingScene) {
					this.landingScene.restart()
				}
			},
			onMenu: () => {
				this._backToMenu()
			},
			onSkip: () => {
				if (this.landingScene) {
					this.landingScene.skip()
				}
			},
		})

		this.landingUI.show()
	}

	_showPlaceholderLevel2() {
		this._cleanupAllScenes()
		const placeholder =
			document.getElementById('screen-placeholder')
		if (placeholder) {
			placeholder.querySelector('h1').textContent = 'STAGE 2'
			placeholder.querySelector('h2').textContent =
				'Level 2 — Alien Planet Exodus'
			placeholder.querySelector(
				'#placeholder-lore'
			).textContent =
				'Touchdown confirmed on the alien surface. Atmospheric rover and exploration mechanics are preparing for launch.'
			placeholder.classList.remove('hidden')
			const backBtn =
				document.getElementById('btn-back-to-menu')
			if (backBtn) {
				backBtn.onclick = () => {
					placeholder.classList.add('hidden')
					this._backToMenu()
				}
			}
		}
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
		if (this.landingScene) {
			this.landingScene.update(delta)
		}
		this.currentLevel?.update?.(delta)
		this.sceneManager.render()
	}
}
