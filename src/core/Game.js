import * as THREE from 'three'
import { Level1 } from '../levels/Level1/Level1.js'
import { SceneManager } from './SceneManager.js'
import { AssetManager } from './AssetManager.js'
import { GameState } from './GameState.js'
import { Menu } from '../ui/Menu.js'
import { AudioManager } from '../audio/AudioManager.js'
import { MenuBackground } from './MenuBackground.js'
import storage from '../services/StorageService.js'
import { CharacterSelectFlow } from '../launchbay/CharacterSelectFlow.js'
import { LaunchBayScene } from '../launchbay/LaunchBayScene.js'
import { getCharacterById } from '../launchbay/data/characters.js'

// Menu -> character select (src/launchbay/CharacterSelectFlow.js, its own
// canvas/HUD) -> Launch Bay (src/launchbay/LaunchBayScene.js, ship pick +
// LAUNCH, drawn on the shared canvas) -> Level 1. Level 1 gameplay
// (src/levels/Level1/**, src/player/**, src/physics/**, src/ui/HUD.js)
// is wired up via _level1() below — see README.md for per-level status.
//
// This replaces the old Menu -> HangarScene + CharacterSelect.js flow.
// CharacterSelectFlow's pilot roster (Zara/Kai/Nyx) is the same three
// pilots as before by id, so gameState.selectedCharacter / StorageService
// stay compatible with what Level1/HUD already expect.

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
			onLaunch: (name) => this._showCharacterSelect(name),
			audioManager: this.audio,
			storage,
		})

		this.characterSelectFlow = null
		this.launchBayScene = null

		this.clock = new THREE.Clock()
		this.menuBackground = new MenuBackground(
			this.sceneManager,
			this.assetManager
		)

		this.menu.showStart()
		this._loop()
	}

	/** PLAY -> callsign entered -> here. Shows the character-select screen
	 * (pick a pilot) before the Launch Bay (pick a ship) and then a level. */
	_showCharacterSelect(name) {
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

		if (this.menuBackground) {
			this.menuBackground.dispose()
			this.menuBackground = null
		}

		this.characterSelectFlow = new CharacterSelectFlow({
			initialPilot: this.gameState.selectedCharacter,
			playerName: this.gameState.playerName,
			onReady: (pilotKey) => {
				this.gameState.selectedCharacter = pilotKey
				this._showLaunchBay()
			},
			onBack: () => this._backToMenu(),
		})
	}

	/** Pilot chosen -> here. Shows the ship the pilot is about to fly
	 * (real spaceship.glb, see LaunchBayScene) before actually launching. */
	_showLaunchBay() {
		if (this.characterSelectFlow) {
			this.characterSelectFlow.dispose()
			this.characterSelectFlow = null
		}

		const pilot = getCharacterById(this.gameState.selectedCharacter)

		this.launchBayScene = new LaunchBayScene(
			this.sceneManager,
			this.assetManager,
			{
				initialShip: this.gameState.selectedShip,
				pilotName: pilot?.name || this.gameState.playerName,
				onLaunch: (shipKey) =>
					this._level1(
						this.gameState.playerName,
						this.gameState.selectedCharacter,
						shipKey
					),
				onBack: () => this._showCharacterSelect(this.gameState.playerName),
			}
		)
	}

	_backToMenu() {
		if (this.characterSelectFlow) {
			this.characterSelectFlow.dispose()
			this.characterSelectFlow = null
		}
		if (this.launchBayScene) {
			this.launchBayScene.dispose()
			this.launchBayScene = null
		}
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

		if (this.characterSelectFlow) {
			this.characterSelectFlow.dispose()
			this.characterSelectFlow = null
		}
		if (this.launchBayScene) {
			this.launchBayScene.dispose()
			this.launchBayScene = null
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
		if (this.launchBayScene) {
			this.launchBayScene.update(delta)
		}
		this.currentLevel?.update?.(delta)
		this.sceneManager.render()
	}
}
