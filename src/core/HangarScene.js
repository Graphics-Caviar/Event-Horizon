import * as THREE from 'three';
import { Spaceship } from '../models/Spaceship.js';
import { CharacterManager } from '../systems/CharacterManager.js';
import { SHIPS } from '../systems/ShipManager.js';

/**
 * HangarScene — the 3D content behind the character-select screen.
 * Owns its own THREE.Group (added to the existing SceneManager's scene,
 * no second renderer/canvas needed) so it can be disposed as one unit
 * when the player either goes back to the menu or launches into Level1.
 */
export class HangarScene {
  constructor(sceneManager, assetManager) {
    this.sceneManager = sceneManager;
    this.camera = sceneManager.camera;
    this.group = new THREE.Group();

    this.starfield = assetManager.createStarfield(2000, 500);
    this.group.add(this.starfield);

    this.lightingRig = Spaceship.createLightingRig();
    this.group.add(this.lightingRig);

    const podiumGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.3, 24);
    const podiumMat = new THREE.MeshStandardMaterial({
      color: 0x11151f, metalness: 0.6, roughness: 0.4, emissive: 0x0b3a44, emissiveIntensity: 0.4,
    });
    this.podium = new THREE.Mesh(podiumGeo, podiumMat);
    this.podium.position.set(0.75, -0.15, 0);
    this.group.add(this.podium);

    // CharacterManager only needs something with .add() — a Group works
    // exactly the same as a Scene for this purpose.
    this.characterManager = new CharacterManager(this.group);
    this.ship = null;
    this._currentShipKey = null;

    this._time = 0;
    this._mode = 'character'; // 'character' | 'ship'

    sceneManager.scene.add(this.group);
  }

  showCharacter(key) {
    this._mode = 'character';
    if (this.ship) {
      this.ship.dispose();
      this.ship = null;
      this._currentShipKey = null;
    }
    const model = this.characterManager.select(key);
    model.root.position.set(0.75, 0, 0);
    model.setState('idle');
    this.podium.position.set(0.75, -0.15, 0);
    this.podium.visible = true;
    return model;
  }

  showShip(shipKey = 'raven') {
    this._mode = 'ship';
    this.characterManager.dispose(); // drops the current character model
    this.podium.visible = false;

    if (this.ship && this._currentShipKey === shipKey) {
      return;
    }

    if (this.ship) {
      this.ship.dispose();
      this.ship = null;
    }

    const shipConfig = SHIPS[shipKey] || SHIPS.raven;
    this._currentShipKey = shipKey;
    this.ship = new Spaceship(this.group, { colors: shipConfig.colors });
    this.ship.group.scale.setScalar(0.55);
    this.ship.group.position.set(1.1, 0.2, 0);
  }

  update(delta) {
    this._time += delta;

    if (this._mode === 'character' && this.characterManager.currentModel) {
      const model = this.characterManager.currentModel;
      model.update(delta, { camera: this.camera });
      model.root.rotation.y = this._time * 0.4; // slow turntable spin
      this.camera.position.set(
        Math.sin(this._time * 0.15) * 0.3,
        1.45,
        2.9
      );
      this.camera.lookAt(0.75, 0.9, 0);
    } else if (this._mode === 'ship' && this.ship) {
      // Gentle auto-idle motion so the ship isn't a static prop — small
      // simulated throttle/turn oscillation, not real input.
      this.ship.update(delta, {
        throttle: 0.3 + Math.sin(this._time * 0.6) * 0.2,
        turnInput: Math.sin(this._time * 0.4),
      });
      this.ship.group.rotation.y = this._time * 0.25;
      this.camera.position.set(
        Math.sin(this._time * 0.1) * 0.3,
        1.5,
        6.8
      );
      this.camera.lookAt(1.1, 0.2, 0);
    }
  }

  dispose() {
    this.characterManager.dispose();
    if (this.ship) {
      this.ship.dispose();
      this.ship = null;
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
