import * as THREE from 'three';
import { Character } from './Character.js';
import { createVoidMaterial } from '../shaders/voidShader.js';

export class Nyx extends Character {
  _createMaterials() {
    const base = super._createMaterials();
    return Object.assign(base, {
      suit: new THREE.MeshStandardMaterial({ color: 0x0e0d14, roughness: 0.6, metalness: 0.15, transparent: true, opacity: 1 }),
      cloak: new THREE.MeshStandardMaterial({ color: 0x111018, roughness: 0.85, transparent: true, opacity: 1 }),
      mask: new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.4, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xa86bff, emissive: 0x5a2b99, emissiveIntensity: 1.4, roughness: 0.3 }),
    });
  }

  _addHeadDetails(head) {
    // Mask covering the lower face.
    const maskGeo = new THREE.SphereGeometry(0.1, 10, 10, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.4);
    this._geometries.push(maskGeo);
    const mask = new THREE.Mesh(maskGeo, this.materials.mask);
    mask.position.set(0, -0.03, 0.03);
    head.add(mask);

    // Glowing eye slits.
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.02, 0.02);
    this._geometries.push(eyeGeo);
    const eyes = new THREE.Mesh(eyeGeo, this.materials.accent);
    eyes.position.set(0, 0.02, 0.15);
    head.add(eyes);

    // Hood draping over the head, larger than the skull so it reads as
    // fabric rather than a helmet.
    const hoodGeo = new THREE.SphereGeometry(0.22, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
    this._geometries.push(hoodGeo);
    const hood = new THREE.Mesh(hoodGeo, this.materials.cloak);
    hood.position.y = -0.02;
    head.add(hood);
  }

  _addTorsoDetails(torso) {
    // Cloak: a wide cone draping from the shoulders down past the hips,
    // open at the front (thetaLength < 2π) so it reads as a coat, not a
    // solid tent.
    const cloakGeo = new THREE.ConeGeometry(0.42, 1.1, 16, 1, true, 0.35, Math.PI * 1.7);
    this._geometries.push(cloakGeo);
    const cloak = new THREE.Mesh(cloakGeo, this.materials.cloak);
    cloak.position.y = -0.15;
    cloak.rotation.y = Math.PI * 0.15;
    torso.add(cloak);
    this.cloakMesh = cloak;

    // Purple piping down the front.
    const pipingGeo = new THREE.BoxGeometry(0.03, 0.7, 0.02);
    this._geometries.push(pipingGeo);
    const piping = new THREE.Mesh(pipingGeo, this.materials.accent);
    piping.position.set(0, 0.35, 0.27);
    torso.add(piping);
  }

  _addEquipment() {
    this.leftHand.material = this.materials.mask;
    this.rightHand.material = this.materials.mask;
    this.leftFoot.material = this.materials.dark;
    this.rightFoot.material = this.materials.dark;
  }

  /**
   * @param kind 'gravity' | 'phase' | 'shield' — defaults to 'gravity'.
   * All three reuse the same void shader material factory, just on
   * different geometry / with different timing, to show the shader
   * being genuinely shared rather than copy-pasted per ability.
   */
  playAbility(kind = 'gravity') {
    if (kind === 'phase') this._playPhaseStep();
    else if (kind === 'shield') this._playVoidShield();
    else this._playGravityShift();
  }

  _playGravityShift() {
    if (!this._ringGeometry) {
      this._ringGeometry = new THREE.TorusGeometry(0.4, 0.05, 12, 32);
    }
    const material = createVoidMaterial(0xa86bff);
    const ring = new THREE.Mesh(this._ringGeometry, material);
    ring.position.set(0, 1.0, 0.5);
    ring.rotation.x = Math.PI / 2;
    this.effects.add(ring);
    this._voidEffects = this._voidEffects || [];
    this._voidEffects.push({ type: 'ring', mesh: ring, material, life: 1.2, maxLife: 1.2 });

    // Debris pulled inward toward the ring centre — constant-velocity
    // particles aimed at the centre approximate a gravity pull well
    // enough for a short-lived VFX without a real per-particle force sim.
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.2 + Math.random() * 0.6;
      const start = new THREE.Vector3(Math.cos(angle) * radius, 1.0 + (Math.random() - 0.5) * 0.4, 0.5 + Math.sin(angle) * radius);
      const toCenter = new THREE.Vector3(0, 1.0, 0.5).sub(start).normalize().multiplyScalar(2.6);
      const sparkMaterial = new THREE.MeshBasicMaterial({
        color: 0xa86bff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._spawnEffectParticle({ position: start, velocity: toCenter, life: 0.5, material: sparkMaterial, scale: 0.05 });
    }
  }

  _playPhaseStep() {
    this._phase = { t: 0, duration: 0.6 };
  }

  _playVoidShield() {
    if (!this._shieldGeometry) {
      this._shieldGeometry = new THREE.SphereGeometry(0.65, 20, 20);
    }
    const material = createVoidMaterial(0xa86bff);
    const shield = new THREE.Mesh(this._shieldGeometry, material);
    shield.position.y = 0.9;
    this.effects.add(shield);
    this._voidEffects = this._voidEffects || [];
    this._voidEffects.push({ type: 'shield', mesh: shield, material, life: 1.4, maxLife: 1.4 });
  }

  update(delta, options) {
    super.update(delta, options);

    if (this._voidEffects && this._voidEffects.length) {
      for (let i = this._voidEffects.length - 1; i >= 0; i--) {
        const fx = this._voidEffects[i];
        fx.material.uniforms.uTime.value += delta;
        fx.life -= delta;
        const fade = Math.max(0, fx.life / fx.maxLife);
        fx.material.uniforms.uIntensity.value = fade;
        if (fx.type === 'ring') fx.mesh.rotation.z += delta * 2;
        if (fx.life <= 0) {
          this.effects.remove(fx.mesh);
          fx.material.dispose();
          this._voidEffects.splice(i, 1);
        }
      }
    }

    if (this._phase) {
      this._phase.t += delta;
      const p = this._phase.t / this._phase.duration;
      // Fades opacity down and back up over the phase duration (a smooth
      // sine window rather than a linear dip, so it doesn't "pop").
      const opacity = 1 - Math.sin(Math.min(p, 1) * Math.PI) * 0.75;
      this.materials.suit.opacity = opacity;
      this.materials.cloak.opacity = opacity;
      if (p >= 1) {
        this.materials.suit.opacity = 1;
        this.materials.cloak.opacity = 1;
        this._phase = null;
      }
    }
  }

  dispose() {
    if (this._voidEffects) {
      for (const fx of this._voidEffects) {
        this.effects.remove(fx.mesh);
        fx.material.dispose();
      }
      this._voidEffects.length = 0;
    }
    if (this._ringGeometry) this._ringGeometry.dispose();
    if (this._shieldGeometry) this._shieldGeometry.dispose();
    super.dispose();
  }
}
