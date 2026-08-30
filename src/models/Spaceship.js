import * as THREE from 'three';
import { createEngineCoreMaterial } from '../shaders/engineShader.js';

/**
 * Spaceship — procedural, hierarchical fighter model.
 *
 * Hierarchy (matches the brief, plus one extra pivot explained below):
 *
 *   group (root — world position + heading)
 *   └── bankPivot (roll-only visual pivot — see note below)
 *       ├── hull            (LatheGeometry fuselage + spine detail)
 *       ├── cockpit         (hand-authored custom BufferGeometry canopy)
 *       ├── leftWing / rightWing   (ExtrudeGeometry)
 *       ├── leftFin  / rightFin    (ExtrudeGeometry)
 *       ├── leftEngine / rightEngine
 *       │     ├── housing   (CylinderGeometry)
 *       │     ├── core      (SphereGeometry + custom ShaderMaterial)
 *       │     └── exhaust   (ConeGeometry, additive-blended)
 *       ├── navLightLeft / navLightRight / strobeLight
 *       └── landingGear (noseGear / leftGear / rightGear)
 *
 * Why `bankPivot` exists: the brief's hierarchy attaches everything
 * straight to the root group. We add one extra group in between so that
 * "banking" (visual roll on turns) is a pure rotation of the *visual*
 * hull, completely separate from whatever a flight controller does to
 * `group.position` / `group.rotation.y` (heading). Rotating the root
 * directly would mean bank angle and heading fight over the same
 * transform; splitting them is what "the hierarchy must be meaningful"
 * is really asking for.
 */
export class Spaceship {
  constructor(scene, options = {}) {
    this.options = options;
    this.colors = Object.assign(
      {
        hull: 0xd7dde4,
        panel: 0x565f6b,
        cockpit: 0x08131c,
        engineHousing: 0x2b2f36,
        engineGlow: 0x4de3ff,
        gearMetal: 0x3a3f47,
      },
      options.colors || {}
    );

    this.group = new THREE.Group();
    this.bankPivot = new THREE.Group();
    this.group.add(this.bankPivot);

    this.materials = this._createMaterials();
    this._geometries = []; // tracked so dispose() can free every geometry we create

    this._buildHull();
    this._buildCockpit();
    this._buildWings();
    this._buildFins();
    this._buildEngines();
    this._buildLights();
    this._buildLandingGear();

    this._time = 0;
    this._bankAngle = 0;
    this._targetBank = 0;
    this._gearDeployed = false;
    this._gearProgress = 0; // 0 = fully retracted, 1 = fully deployed
    this._strobeTimer = 0;

    if (scene) scene.add(this.group);
  }

  // ------------------------------------------------------------------
  // Materials — see the CGV write-up below for what metalness/roughness/
  // transparency are doing here.
  // ------------------------------------------------------------------
  _createMaterials() {
    return {
      hull: new THREE.MeshStandardMaterial({
        color: this.colors.hull,
        metalness: 0.85,
        roughness: 0.32,
      }),
      // DoubleSide on panels: extruded + mirrored geometry (wings/fins)
      // can end up with reversed winding on the mirrored side — DoubleSide
      // is a simple, cheap guard against that rather than hand-fixing
      // triangle winding for a handful of small flat panels.
      panel: new THREE.MeshStandardMaterial({
        color: this.colors.panel,
        metalness: 0.6,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
      cockpit: new THREE.MeshPhysicalMaterial({
        color: this.colors.cockpit,
        metalness: 0.1,
        roughness: 0.08,
        transmission: 0.55,
        transparent: true,
        opacity: 0.9,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        side: THREE.DoubleSide,
      }),
      engineHousing: new THREE.MeshStandardMaterial({
        color: this.colors.engineHousing,
        metalness: 0.75,
        roughness: 0.4,
      }),
      exhaust: new THREE.MeshBasicMaterial({
        color: this.colors.engineGlow,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      navLightRed: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
      navLightGreen: new THREE.MeshBasicMaterial({ color: 0x3bff6a }),
      navLightWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      gearMetal: new THREE.MeshStandardMaterial({
        color: this.colors.gearMetal,
        metalness: 0.7,
        roughness: 0.45,
      }),
    };
  }

  // ------------------------------------------------------------------
  // Hull — LatheGeometry revolves a 2D profile around an axis, which is
  // how we get a smooth, tapered fuselage without hand-placing dozens of
  // vertices. See the write-up for why Lathe was chosen over a stack of
  // boxes/cylinders.
  // ------------------------------------------------------------------
  _buildHull() {
    const profile = [
      new THREE.Vector2(0.04, 0),
      new THREE.Vector2(0.55, 0.5),
      new THREE.Vector2(0.85, 1.6),
      new THREE.Vector2(0.95, 2.8),
      new THREE.Vector2(0.8, 4.0),
      new THREE.Vector2(0.5, 5.0),
      new THREE.Vector2(0.18, 5.7),
      new THREE.Vector2(0.0, 6.0),
    ];
    const hullGeo = new THREE.LatheGeometry(profile, 14);
    hullGeo.rotateX(Math.PI / 2); // revolution axis Y -> ship's forward axis Z
    hullGeo.translate(0, 0, -3.0); // centre on the group origin (nose at -Z, tail at +Z)
    hullGeo.scale(0.82, 1, 1); // flatten slightly — reads as a blade, not a rocket
    hullGeo.computeVertexNormals();
    this._geometries.push(hullGeo);

    this.hull = new THREE.Mesh(hullGeo, this.materials.hull);
    this.hull.castShadow = true;
    this.hull.receiveShadow = true;
    this.bankPivot.add(this.hull);

    // Spine panel: a thin raised strip so the silhouette isn't a perfectly
    // smooth body-of-revolution — small detail, disproportionate payoff.
    const spineGeo = new THREE.BoxGeometry(0.22, 0.16, 4.2);
    this._geometries.push(spineGeo);
    const spine = new THREE.Mesh(spineGeo, this.materials.panel);
    spine.position.set(0, 0.5, -1.2);
    this.hull.add(spine);
  }

  // ------------------------------------------------------------------
  // Cockpit — a hand-authored custom BufferGeometry (not a primitive):
  // a 4-vertex, 4-face faceted "gem" shape. This is the one part of the
  // model built directly from a position/index buffer rather than a
  // THREE.*Geometry helper, per the brief's "custom BufferGeometry where
  // useful" requirement.
  // ------------------------------------------------------------------
  _buildCockpit() {
    const w = 0.9, len = 2.2, baseH = 0.15, apexH = 0.85;
    const positions = new Float32Array([
      -w / 2, baseH, -len * 0.35, //  0: rear-left base
       w / 2, baseH, -len * 0.35, //  1: rear-right base
       0,     baseH,  len * 0.65, //  2: front tip (nose-ward)
       0,     apexH, -len * 0.15, //  3: apex (canopy peak)
    ]);
    const indices = [
      0, 1, 2, // base
      0, 3, 1,
      1, 3, 2,
      2, 3, 0,
    ];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals(); // required for any lighting — we didn't author normals by hand
    this._geometries.push(geo);

    this.cockpit = new THREE.Mesh(geo, this.materials.cockpit);
    this.cockpit.position.set(0, 0.6, -1.6);
    this.bankPivot.add(this.cockpit);
  }

  // ------------------------------------------------------------------
  // Wings — ExtrudeGeometry turns a flat 2D outline into a solid panel
  // with real thickness and bevelled edges, which is what makes them
  // read as angular metal rather than a paper cutout.
  // ------------------------------------------------------------------
  _buildWingGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(0.15, 0.6);
    shape.lineTo(2.7, -0.5);
    shape.lineTo(2.35, -1.15);
    shape.lineTo(0.1, -0.55);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2); // extrude's default plane is vertical; lay the wing flat
    return geo;
  }

  _buildWings() {
    const rightGeo = this._buildWingGeometry();
    this._geometries.push(rightGeo);
    this.rightWing = new THREE.Mesh(rightGeo, this.materials.panel);
    this.rightWing.position.set(0.5, -0.05, 0.4);
    this.bankPivot.add(this.rightWing);

    // Mirror via negative scale rather than re-authoring the shape —
    // this is why the panel material is DoubleSide (see _createMaterials).
    const leftGeo = this._buildWingGeometry();
    leftGeo.scale(-1, 1, 1);
    this._geometries.push(leftGeo);
    this.leftWing = new THREE.Mesh(leftGeo, this.materials.panel);
    this.leftWing.position.set(-0.5, -0.05, 0.4);
    this.bankPivot.add(this.leftWing);
  }

  // ------------------------------------------------------------------
  // Fins — same ExtrudeGeometry technique as the wings, but left
  // standing upright (no rotateX) and canted outward on mount.
  // ------------------------------------------------------------------
  _buildFinGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.2, 1.4);
    shape.lineTo(0.75, 1.15);
    shape.lineTo(0.55, -0.15);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.09, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1,
    });
    geo.translate(0, 0, -0.045); // centre the thin extrusion on its own pivot
    return geo;
  }

  _buildFins() {
    const rightGeo = this._buildFinGeometry();
    this._geometries.push(rightGeo);
    this.rightFin = new THREE.Mesh(rightGeo, this.materials.panel);
    this.rightFin.position.set(0.45, 0.35, 2.1);
    this.rightFin.rotation.set(0, -0.35, -0.15);
    this.bankPivot.add(this.rightFin);

    const leftGeo = this._buildFinGeometry();
    leftGeo.scale(-1, 1, 1);
    this._geometries.push(leftGeo);
    this.leftFin = new THREE.Mesh(leftGeo, this.materials.panel);
    this.leftFin.position.set(-0.45, 0.35, 2.1);
    this.leftFin.rotation.set(0, 0.35, 0.15);
    this.bankPivot.add(this.leftFin);
  }

  // ------------------------------------------------------------------
  // Engines — this is where the custom shader lives. Each engine is its
  // own little hierarchy: housing (static geometry) -> core (shader-lit
  // "energy") -> exhaust (throttle-reactive glow), plus a real PointLight
  // so the core actually casts light onto the hull behind it.
  // ------------------------------------------------------------------
  _buildEngine(mirror) {
    const group = new THREE.Group();
    const side = mirror ? -1 : 1;

    const housingGeo = new THREE.CylinderGeometry(0.5, 0.58, 1.7, 16, 1, true);
    this._geometries.push(housingGeo);
    const housing = new THREE.Mesh(housingGeo, this.materials.engineHousing);
    housing.rotation.x = Math.PI / 2;
    group.add(housing);

    const coreGeo = new THREE.SphereGeometry(0.36, 20, 20);
    this._geometries.push(coreGeo);
    const glowColor = this.colors.engineGlow || 0x4de3ff;
    const coreMaterial = createEngineCoreMaterial(glowColor);
    const core = new THREE.Mesh(coreGeo, coreMaterial);
    core.position.z = 0.75; // toward the rear opening (tail is +Z)
    group.add(core);

    const engineLight = new THREE.PointLight(glowColor, 1.4, 9);
    engineLight.position.copy(core.position);
    group.add(engineLight);

    const exhaustGeo = new THREE.ConeGeometry(0.32, 1.6, 16, 1, true);
    this._geometries.push(exhaustGeo);
    const exhaustMaterial = this.materials.exhaust.clone();
    const exhaust = new THREE.Mesh(exhaustGeo, exhaustMaterial);
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.z = core.position.z + 0.9;
    group.add(exhaust);

    group.position.set(side * 0.85, -0.05, 1.3);
    return { group, coreMaterial, exhaust, light: engineLight };
  }

  _buildEngines() {
    const right = this._buildEngine(false);
    const left = this._buildEngine(true);
    this.bankPivot.add(right.group, left.group);
    this.engines = [right, left];
  }

  // ------------------------------------------------------------------
  // Navigation lights — standard aviation colour convention (red = left/
  // port, green = right/starboard), plus a white tail strobe. Blinking is
  // a cheap time-based visibility toggle, not an animated material.
  // ------------------------------------------------------------------
  _buildLights() {
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    this._geometries.push(geo);

    this.navLightRight = new THREE.Mesh(geo, this.materials.navLightGreen);
    this.navLightRight.position.set(2.55, -0.1, 0.35);
    this.bankPivot.add(this.navLightRight);

    this.navLightLeft = new THREE.Mesh(geo, this.materials.navLightRed);
    this.navLightLeft.position.set(-2.55, -0.1, 0.35);
    this.bankPivot.add(this.navLightLeft);

    this.strobeLight = new THREE.Mesh(geo, this.materials.navLightWhite);
    this.strobeLight.position.set(0, 0.9, 2.3);
    this.bankPivot.add(this.strobeLight);
  }

  // ------------------------------------------------------------------
  // Landing gear — simple strut+pad legs, hidden by default (scale.y
  // ~0) and eased open/closed via setGearDeployed()/update().
  // ------------------------------------------------------------------
  _buildLandingGear() {
    const strutGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8);
    const padGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.06, 10);
    this._geometries.push(strutGeo, padGeo);

    const makeLeg = (x, z) => {
      const leg = new THREE.Group();
      const strut = new THREE.Mesh(strutGeo, this.materials.gearMetal);
      strut.position.y = -0.45;
      leg.add(strut);
      const pad = new THREE.Mesh(padGeo, this.materials.gearMetal);
      pad.position.y = -0.9;
      leg.add(pad);
      leg.position.set(x, -0.3, z);
      leg.scale.y = 0.001; // start fully retracted
      return leg;
    };

    this.noseGear = makeLeg(0, -2.2);
    this.leftGear = makeLeg(-0.9, 1.0);
    this.rightGear = makeLeg(0.9, 1.0);

    this.landingGear = new THREE.Group();
    this.landingGear.add(this.noseGear, this.leftGear, this.rightGear);
    this.bankPivot.add(this.landingGear);
  }

  setGearDeployed(deployed) {
    this._gearDeployed = deployed;
  }

  // ------------------------------------------------------------------
  // Convenience accessors so this can slot into a camera/controller the
  // same way any other "flyable" object would.
  // ------------------------------------------------------------------
  get position() { return this.group.position; }
  get quaternion() { return this.group.quaternion; }

  /**
   * @param delta seconds since last frame
   * @param throttle 0..1, drives exhaust length/opacity and engine glow
   * @param turnInput -1..1, drives the smoothed banking roll
   */
  update(delta, { throttle = 0, turnInput = 0 } = {}) {
    this._time += delta;

    // --- Banking: exponential smoothing toward a target roll, so it never
    // snaps instantly even if turnInput changes abruptly frame to frame.
    const maxBank = THREE.MathUtils.degToRad(35);
    this._targetBank = -turnInput * maxBank;
    const bankSmoothing = 1 - Math.pow(0.0001, delta);
    this._bankAngle = THREE.MathUtils.lerp(this._bankAngle, this._targetBank, bankSmoothing);
    this.bankPivot.rotation.z = this._bankAngle;

    // --- Engine core shader + exhaust, driven by throttle.
    const intensity = 0.6 + throttle * 1.4;
    for (const engine of this.engines) {
      engine.coreMaterial.uniforms.uTime.value = this._time;
      engine.coreMaterial.uniforms.uIntensity.value = intensity;
      engine.exhaust.material.opacity = 0.15 + throttle * 0.6;
      engine.exhaust.scale.z = 0.5 + throttle * 1.1;
      engine.light.intensity = 1.0 + throttle * 2.2;
    }

    // --- Landing gear deploy/retract animation.
    const gearTarget = this._gearDeployed ? 1 : 0;
    const gearSmoothing = 1 - Math.pow(0.0005, delta);
    this._gearProgress = THREE.MathUtils.lerp(this._gearProgress, gearTarget, gearSmoothing);
    const gearScale = Math.max(0.001, this._gearProgress);
    this.noseGear.scale.y = gearScale;
    this.leftGear.scale.y = gearScale;
    this.rightGear.scale.y = gearScale;

    // --- Blinking nav lights.
    this.navLightLeft.visible = Math.floor(this._time * 2) % 2 === 0;
    this.navLightRight.visible = Math.floor(this._time * 2) % 2 === 0;
    this._strobeTimer += delta;
    this.strobeLight.visible = (this._strobeTimer % 2.0) < 0.08;
  }

  /** Frees every geometry/material this instance created. Call this
   * before dropping the last reference, or WebGL will leak GPU memory. */
  dispose() {
    for (const geo of this._geometries) geo.dispose();
    for (const mat of Object.values(this.materials)) mat.dispose();
    for (const engine of this.engines) {
      engine.coreMaterial.dispose();
      engine.exhaust.material.dispose();
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /**
   * Builds a key/fill/rim three-point lighting rig suitable for showing
   * off the ship. Returned as a Group so the caller can add/remove it
   * from a scene as one unit. Engine lighting is per-instance (see
   * `engines[i].light` above) since it needs to move with the ship.
   */
  static createLightingRig() {
    const rig = new THREE.Group();

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 8, 4);
    key.castShadow = true;
    rig.add(key);

    const fill = new THREE.DirectionalLight(0x89aaff, 0.5);
    fill.position.set(-6, 2, 3);
    rig.add(fill);

    const rim = new THREE.DirectionalLight(0xff9a55, 0.6);
    rim.position.set(0, 3, -8);
    rig.add(rim);

    const ambient = new THREE.AmbientLight(0x223344, 0.5);
    rig.add(ambient);

    return rig;
  }
}
