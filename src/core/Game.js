import * as THREE from 'three';
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
    this.audio = new AudioManager();

    const profile = storage.load();
    this.gameState.playerName = profile.playerName;
    this.audio.setMuted(profile.settings.muted);

    this.menu = new Menu({
      onLaunch: (name) => this._showPlaceholder(name),
      audioManager: this.audio,
      storage,
    });

    this.clock = new THREE.Clock();
    this.menuBackground = new MenuBackground(this.sceneManager, this.assetManager);

    this.menu.showStart();
    this._loop();
  }

  _showPlaceholder(name) {
    this.gameState.playerName = name || this.gameState.playerName;
    this.menu.showPlaceholder(this.gameState.playerName);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const delta = Math.min(this.clock.getDelta(), 0.1); // clamp huge tab-switch gaps
    this.menuBackground.update(delta);
    this.sceneManager.render();
  }
}
