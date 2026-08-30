import * as THREE from 'three';
import { Character } from './Character.js';

export class Zara extends Character {
  _createMaterials() {
    const base = super._createMaterials();
    return Object.assign(base, {
      suit: new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.55, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: 0x4de3ff, emissive: 0x1c6f80, emissiveIntensity: 1.2, roughness: 0.3 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.75 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0a1620, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }),
    });
  }

  _addHeadDetails(head) {
    // Hair pulled back into a bun (per the reference art) rather than a
    // full helmet — reads clearly from a distance and is cheap to build.
    const bunGeo = new THREE.SphereGeometry(0.07, 10, 10);
    this._geometries.push(bunGeo);
    const bun = new THREE.Mesh(bunGeo, this.materials.hair);
    bun.position.set(0, 0.05, -0.13);
    head.add(bun);

    const capGeo = new THREE.SphereGeometry(0.165, 14, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this._geometries.push(capGeo);
    const cap = new THREE.Mesh(capGeo, this.materials.hair);
    cap.position.y = 0.02;
    head.add(cap);

    // Thin cyan visor strip — the "small blue glowing elements" from the brief.
    const visorGeo = new THREE.BoxGeometry(0.22, 0.05, 0.06);
    this._geometries.push(visorGeo);
    const visor = new THREE.Mesh(visorGeo, this.materials.accent);
    visor.position.set(0, 0.01, 0.14);
    head.add(visor);
  }

  _addTorsoDetails(torso) {
    // Armoured shoulder pauldrons with an accent stripe.
    const padGeo = new THREE.BoxGeometry(0.16, 0.08, 0.18);
    this._geometries.push(padGeo);
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(padGeo, this.materials.suit);
      pad.position.set(side * 0.33, 0.66, 0);
      torso.add(pad);
    }

    const stripeGeo = new THREE.BoxGeometry(0.06, 0.4, 0.02);
    this._geometries.push(stripeGeo);
    const stripe = new THREE.Mesh(stripeGeo, this.materials.accent);
    stripe.position.set(0.16, 0.35, 0.26);
    torso.add(stripe);
  }

  _addEquipment(equipment) {
    const beltGeo = new THREE.TorusGeometry(0.27, 0.03, 8, 16);
    this._geometries.push(beltGeo);
    const belt = new THREE.Mesh(beltGeo, this.materials.dark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.02;
    equipment.add(belt);

    const buckleGeo = new THREE.BoxGeometry(0.08, 0.06, 0.03);
    this._geometries.push(buckleGeo);
    const buckle = new THREE.Mesh(buckleGeo, this.materials.accent);
    buckle.position.set(0, 0.02, 0.27);
    equipment.add(buckle);

    // Boots and gloves: recolour the existing hand/foot meshes rather
    // than adding new geometry — cheap way to sell "armoured boots" and
    // "gloves" from the brief.
    this.leftHand.material = this.materials.dark;
    this.rightHand.material = this.materials.dark;
    this.leftFoot.material = this.materials.accent;
    this.rightFoot.material = this.materials.accent;
  }

  /** Afterburn — short burst of extreme speed, visualised as a streaking
   * blue trail firing backward from the character. */
  playAbility() {
    for (let i = 0; i < 16; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x4de3ff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * 0.15,
        0.9 + (Math.random() - 0.5) * 0.35,
        0.15 + Math.random() * 0.1
      );
      // +Z = backward relative to the character's -Z forward facing.
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 2.4 + Math.random() * 1.2);
      this._spawnEffectParticle({ position, velocity, life: 0.4 + Math.random() * 0.3, material, scale: 0.14 + Math.random() * 0.08 });
    }
  }
}
