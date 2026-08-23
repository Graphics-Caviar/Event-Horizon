import * as THREE from 'three';

// Purely decorative — sits behind the start screen so the menu doesn't open
// on a dead black canvas. Owns its own group so it can be cleanly removed
// the moment the player launches into Level 1, without touching lights or
// anything Level1.js adds to the same scene/camera afterwards.
export class MenuBackground {
  constructor(sceneManager, assetManager) {
    this.camera = sceneManager.camera;
    this.group = new THREE.Group();

    this.starfield = assetManager.createStarfield(3500, 1000);
    this.group.add(this.starfield);

    this.nebula = this._buildNebula();
    this.group.add(this.nebula);

    this.distantHole = this._buildDistantHole();
    this.group.add(this.distantHole);

    this.asteroids = this._buildAsteroidDrift(assetManager);
    this.group.add(this.asteroids);

    sceneManager.scene.add(this.group);

    this.camera.position.set(0, 3, 26);
    this.camera.lookAt(0, -1, -80);

    this._t = 0;
  }

  _buildNebula() {
    // A loose haze of large, soft, colour-tinted points drifting in the
    // mid-distance — cheap stand-in for a nebula without any textures.
    const count = 500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const purple = new THREE.Color(0xa86bff);
    const cyan = new THREE.Color(0x4de3ff);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 80 + Math.random() * 260;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 120 - 20;
      positions[i * 3 + 2] = -60 - Math.random() * 400;

      const c = purple.clone().lerp(cyan, Math.random());
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 5,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  _buildDistantHole() {
    // A small, silent black hole far off in the distance — foreshadows
    // Level 1 without competing with the HUD/menu text for attention.
    const group = new THREE.Group();
    group.position.set(30, -6, -140);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(6, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    group.add(core);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(6.5, 11, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    glow.rotation.x = Math.PI / 2.4;
    group.add(glow);

    return group;
  }

  _buildAsteroidDrift(assetManager) {
    // Cosmetic asteroid cluster drifting behind the menu — uses the same
    // procedural geometry/material factories Level 1 uses, but with no
    // collision, damage, or storm logic attached; purely for atmosphere.
    const group = new THREE.Group();
    const geo = assetManager.createAsteroidGeometry();
    const mat = assetManager.createAsteroidMaterial();

    const count = 14;
    for (let i = 0; i < count; i++) {
      const rock = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 90;
      rock.position.set(
        Math.cos(angle) * r,
        (Math.random() - 0.5) * 30 - 5,
        -60 - Math.random() * 200
      );
      const s = 1 + Math.random() * 3;
      rock.scale.setScalar(s);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      group.add(rock);
    }
    return group;
  }

  update(delta) {
    this._t += delta;

    this.starfield.rotation.y += delta * 0.008;
    this.nebula.rotation.y -= delta * 0.012;
    this.distantHole.rotation.z += delta * 0.05;

    this.asteroids.children.forEach((rock) => {
      rock.rotation.x += delta * 0.05;
      rock.rotation.y += delta * 0.03;
    });

    // Slow, breathing camera drift so the background never looks static.
    this.camera.position.x = Math.sin(this._t * 0.12) * 4;
    this.camera.position.y = 3 + Math.sin(this._t * 0.08) * 1.2;
    this.camera.lookAt(0, -1, -80);
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}