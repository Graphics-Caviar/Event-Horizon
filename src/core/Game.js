import * as THREE from 'three';
import { Level1 } from '../levels/Level1/Level1.js'
import { SceneManager } from './SceneManager.js';
import { AssetManager } from './AssetManager.js';
import { GameState } from './GameState.js';
import { Menu } from '../ui/Menu.js';
import { AudioManager } from '../audio/AudioManager.js';
import { MenuBackground } from './MenuBackground.js';
import storage from '../services/StorageService.js';

// This build is scoped to the launch/menu screen only. Level 1 gameplay
// (src/levels/Level1/**, src/player/**, src/physics/**, src/ui/HUD.js)
// exists in the repo from an earlier prototype but is deliberately NOT
// wired up here — see README.md. PLAY currently leads to a "coming soon"
// placeholder rather than starting a level.

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
      onLaunch: (name) => this._level1(name),
      audioManager: this.audio,
      storage,
    });

    this.clock = new THREE.Clock();
    this.menuBackground = new MenuBackground(this.sceneManager, this.assetManager);

    this.menu.showStart();
    this._loop();
  }

  _level1(name) {
    this.gameState.playerName = name || this.gameState.playerName;
    console.log(`LAUNCH pressed for "${this.gameState.playerName}".`);
    this.currentLevel?.dispose();
    this.currentLevel = new Level1(this);
    // this.menu.showPlaceholder(this.gameState.playerName);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.menuBackground) {
      this.menuBackground.update(delta);
    }
    this.currentLevel?.update?.(delta);
    this.sceneManager.render();
  }
}
