import * as THREE from 'three';
import { Level1 } from '../levels/Level1/Level1.js'
import { SceneManager } from './SceneManager.js';
import { AssetManager } from './AssetManager.js';
import { GameState, STATUS } from './GameState.js';
import { Menu } from '../ui/Menu.js';
import { MenuBackground } from './MenuBackground.js';

export class Game {
  constructor() {
    const canvas = document.getElementById('game-canvas');
    this.sceneManager = new SceneManager(canvas);
    this.assetManager = new AssetManager();
    this.gameState = new GameState();
    this.currentLevel = null;

    this.menu = new Menu({
      onStart: (name) => this._startLevel1(name),
      onRetry: () => this._startLevel1(this.gameState.playerName),
    });

    this.clock = new THREE.Clock();
    this.menuBackground = new MenuBackground(this.sceneManager, this.assetManager);

    this.menu.showStart();
    this._loop();
  }

  _startLevel1(name) {
    // TODO: Level 1 not wired up yet.
    this.gameState.playerName = name || this.gameState.playerName;
    console.log(`LAUNCH pressed for "${this.gameState.playerName}".`);
    this.currentLevel?.dispose();
    this.currentLevel = new Level1(this);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.gameState.status === STATUS.MENU && this.menuBackground) {
      this.menuBackground.update(delta);
    }
    this.currentLevel?.update?.(delta);
    this.sceneManager.render();
  }
}
