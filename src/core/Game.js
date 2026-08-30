import * as THREE from 'three';
import { Level1 } from '../levels/Level1/Level1.js'
import { SceneManager } from './SceneManager.js';
import { AssetManager } from './AssetManager.js';
import { GameState } from './GameState.js';
import { Menu } from '../ui/Menu.js';
import { AudioManager } from '../audio/AudioManager.js';
import { MenuBackground } from './MenuBackground.js';
import storage from '../services/StorageService.js';
import { HangarScene } from './HangarScene.js';
import { CharacterSelect } from '../ui/CharacterSelect.js';

// Menu -> Hangar (character/ship select) -> Level 1. Level 1 gameplay
// (src/levels/Level1/**, src/player/**, src/physics/**, src/ui/HUD.js)
// is wired up via _level1() below — see README.md for per-level status.

export class Game {
  constructor() {
    const canvas = document.getElementById('game-canvas');
    this.sceneManager = new SceneManager(canvas);
    this.assetManager = new AssetManager();
    this.gameState = new GameState();
    this.currentLevel = null;
    this.audio = new AudioManager();

    const profile = storage.load();
    this.gameState.playerName = profile.playerName;
    this.audio.setMuted(profile.settings.muted);

    this.menu = new Menu({
      onLaunch: (name) => this._showHangar(name),
      audioManager: this.audio,
      storage,
    });

    this.hangarScene = null;
    this.characterSelect = null;

    this.clock = new THREE.Clock();
    this.menuBackground = new MenuBackground(this.sceneManager, this.assetManager);

    this.menu.showStart();
    this._loop();
  }

  /** PLAY -> callsign entered -> here. Shows the hangar (pick a pilot,
   * look over the ship) before actually launching into a level. */
  _showHangar(name) {
    this.gameState.playerName = name || this.gameState.playerName;
    this.menu.hideAll();

    if (this.menuBackground) {
      this.menuBackground.dispose();
      this.menuBackground = null;
    }

    this.hangarScene = new HangarScene(this.sceneManager, this.assetManager);
    this.hangarScene.showCharacter('zara');

    this.characterSelect = new CharacterSelect({
      onSelect: (key) => this.hangarScene.showCharacter(key),
      onTabChange: (tab) => {
        if (tab === 'ship') this.hangarScene.showShip();
        else this.hangarScene.showCharacter(this.characterSelect.getSelectedKey());
      },
      onContinue: (key) => this._level1(this.gameState.playerName, key),
      onBack: () => this._backToMenu(),
    });
    this.characterSelect.show();
  }

  _backToMenu() {
    if (this.characterSelect) {
      this.characterSelect.hide();
      this.characterSelect = null;
    }
    if (this.hangarScene) {
      this.hangarScene.dispose();
      this.hangarScene = null;
    }
    this.menuBackground = new MenuBackground(this.sceneManager, this.assetManager);
    this.menu.showStart();
  }

  _level1(name, characterKey) {
    this.gameState.playerName = name || this.gameState.playerName;
    // Stored for whenever Level1/the player model reads it — not
    // consumed anywhere yet, but the pilot's choice survives the launch.
    this.gameState.selectedCharacter = characterKey || this.gameState.selectedCharacter || 'zara';
    console.log(`LAUNCH pressed for "${this.gameState.playerName}" flying as "${this.gameState.selectedCharacter}".`);

    if (this.characterSelect) {
      this.characterSelect.hide();
      this.characterSelect = null;
    }
    if (this.hangarScene) {
      this.hangarScene.dispose();
      this.hangarScene = null;
    }

    this.currentLevel?.dispose();
    this.currentLevel = new Level1(this);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.menuBackground) {
      this.menuBackground.update(delta);
    }
    if (this.hangarScene) {
      this.hangarScene.update(delta);
    }
    this.currentLevel?.update?.(delta);
    this.sceneManager.render();
  }
}
