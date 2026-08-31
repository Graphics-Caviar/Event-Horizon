import { Zara } from '../models/Zara.js';
import { Kai } from '../models/Kai.js';
import { Nyx } from '../models/Nyx.js';

/**
 * Character configuration data. Each entry is deliberately data, not
 * behaviour — the actual 3D model class lives in `modelClass` and gets
 * instantiated on demand by CharacterManager, so this object is safe to
 * use directly for UI (a character-select screen) without touching
 * three.js at all.
 */
export const CHARACTERS = {
  zara: {
    key: 'zara',
    name: 'Zara Voss',
    role: 'The Ace Pilot',
    description: 'A former military pilot with unmatched skills in high-speed maneuvers and survival.',
    stats: { speed: 9, firepower: 6, durability: 6, tech: 5, utility: 5 },
    abilities: [
      { id: 'afterburn', name: 'Afterburn', description: 'Short burst of extreme speed.' },
      { id: 'precisionShot', name: 'Precision Shot', description: 'Increased accuracy for weapons.' },
      { id: 'evasiveRoll', name: 'Evasive Roll', description: 'Quick dodge in any direction.' },
    ],
    colorTheme: 0x4de3ff,
    modelClass: Zara,
  },
  kai: {
    key: 'kai',
    name: 'Kai Ryder',
    role: 'The Scavenger',
    description: 'A resourceful engineer who can make the most out of any situation.',
    stats: { speed: 6, firepower: 5, durability: 8, tech: 9, utility: 8 },
    abilities: [
      { id: 'salvageExpert', name: 'Salvage Expert', description: 'Find more resources and ammo.' },
      { id: 'repairDrone', name: 'Repair Drone', description: 'Deploy a drone that repairs your vehicle.' },
      { id: 'hacker', name: 'Hacker', description: 'Bypass systems and unlock restricted areas.' },
    ],
    colorTheme: 0x7dffa0,
    modelClass: Kai,
  },
  nyx: {
    key: 'nyx',
    name: 'Nyx',
    role: 'The Void Walker',
    description: 'A mysterious figure with the ability to manipulate gravity and phase through danger.',
    stats: { speed: 8, firepower: 4, durability: 5, tech: 10, utility: 7 },
    abilities: [
      { id: 'gravityShift', name: 'Gravity Shift', description: 'Manipulate gravity to your advantage.' },
      { id: 'phaseStep', name: 'Phase Step', description: 'Short teleport through obstacles.' },
      { id: 'voidShield', name: 'Void Shield', description: 'Become intangible for a short time.' },
    ],
    colorTheme: 0xa86bff,
    modelClass: Nyx,
  },
};

/**
 * CharacterManager — owns the "which character is selected" state and
 * the lifecycle of the currently-instantiated 3D model. Only ever one
 * model is alive at a time; switching characters disposes the old one
 * before creating the new one, so GPU resources never pile up as the
 * player browses the select screen.
 */
export class CharacterManager {
  constructor(scene) {
    this.scene = scene;
    this.selectedKey = null;
    this.currentModel = null;
  }

  getConfig(key) {
    const config = CHARACTERS[key];
    if (!config) throw new Error(`Unknown character key: "${key}"`);
    return config;
  }

  getAllConfigs() {
    return Object.values(CHARACTERS);
  }

  /** Selects a character by key, disposing whichever model was
   * previously active, and returns the newly-created model instance. */
  select(key) {
    const config = this.getConfig(key);

    if (this.currentModel) {
      this.currentModel.dispose();
      this.currentModel = null;
    }

    this.currentModel = new config.modelClass(this.scene);
    this.selectedKey = key;
    return this.currentModel;
  }

  getSelectedConfig() {
    return this.selectedKey ? this.getConfig(this.selectedKey) : null;
  }

  dispose() {
    if (this.currentModel) {
      this.currentModel.dispose();
      this.currentModel = null;
    }
    this.selectedKey = null;
  }
}
