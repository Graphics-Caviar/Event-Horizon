/**
 * src/scenes/CharacterSelectScene.js
 *
 * Everything Three.js-specific for the character-select screen: renderer,
 * camera, lighting, fog, the space environment (via ParticleSystem), a
 * handful of decorative floating shapes, and the render loop itself.
 *
 * Deliberately owns its own requestAnimationFrame loop (start on mount(),
 * cancel on dispose()) so main.js only ever calls mount()/dispose() and
 * never has to know about clocks or render order.
 *
 * STAGE 2 scope: scene/camera/renderer/lighting/environment/post-processing.
 * STAGE 4 populated `characterSlots` with real GLB models via CharacterSystem.
 * STAGE 5 (this update) added `setEmphasis(id, multiplier)` so CharacterSystem
 * can brighten/dim a pilot's rim light on hover/selection without owning
 * the light-pulse loop itself.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { CameraSystem } from '../systems/CameraSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { damp } from '../utils/animations.js';

const MAX_PIXEL_RATIO = 2; // performance guard on high-DPI displays

// Where the three pilots will stand once CharacterSystem (Stage 4) loads
// their GLBs. Defined here — rather than in CharacterSystem — because the
// scene owns spatial layout; CharacterSystem will just ask for these slots.
const SLOT_LAYOUT = [
  { id: 'zara', position: [-2.6, 0, 0] },
  { id: 'kai', position: [0, 0, 0.4] },
  { id: 'nyx', position: [2.6, 0, 0] },
];

export class CharacterSelectScene {
  /** @param {HTMLElement} container element the canvas mounts into */
  constructor(container) {
    this.container = container;
    this._clock = new THREE.Clock();
    this._rafId = null;

    this._initRenderer();
    this._initSceneAndCamera();
    this._initLighting();
    this._initEnvironment();
    this._initCharacterSlots();
    this._initComposer();

    // External systems (e.g. CharacterSystem, added in Stage 4) register
    // here so the scene owns a single render loop instead of every system
    // running its own requestAnimationFrame.
    this._updatables = new Set();

    this._onResize = this._onResize.bind(this);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.container);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x05070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initSceneAndCamera() {
    this.scene = new THREE.Scene();
    // Exponential fog reads better than linear for a deep-space feel — it
    // thickens gently with distance instead of cutting off at a hard plane.
    this.scene.fog = new THREE.FogExp2(0x05070a, 0.032);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 100);
    this.camera.position.set(0, 1.6, 6.2);

    this.cameraSystem = new CameraSystem(this.camera);
  }

  _initLighting() {
    // Cool, dim ambient so nothing reads as fully unlit, without flattening
    // the scene's contrast.
    const ambient = new THREE.AmbientLight(0x1a2430, 0.7);

    // Key light: a soft cool-white from above-front, the "cinematic" workhorse.
    const key = new THREE.DirectionalLight(0xdfeeff, 1.1);
    key.position.set(2, 5, 4);

    // Rim lights near where each pilot will stand, tinted with their accent
    // color — this is the "dynamic lights" requirement, and it also
    // foreshadows the roster before any models exist.
    this._rimLights = [
      new THREE.PointLight(0x00bfff, 3.2, 9, 2), // Zara — cyan
      new THREE.PointLight(0x3ddc84, 3.2, 9, 2), // Kai — green
      new THREE.PointLight(0x9b5cff, 3.2, 9, 2), // Nyx — purple
    ];
    this._rimLights[0].position.set(-2.6, 1.8, 1.5);
    this._rimLights[1].position.set(0, 1.8, 1.9);
    this._rimLights[2].position.set(2.6, 1.8, 1.5);

    // Maps pilot id -> its rim light, and tracks a damped "emphasis"
    // multiplier per pilot so CharacterSystem (Stage 5) can request a
    // stronger/dimmer glow on selection/hover without needing to know
    // anything about how the lights are pulsed each frame.
    this._rimLightsById = {
      zara: this._rimLights[0],
      kai: this._rimLights[1],
      nyx: this._rimLights[2],
    };
    this._emphasis = { zara: 1, kai: 1, nyx: 1 };
    this._emphasisTarget = { zara: 1, kai: 1, nyx: 1 };

    this.scene.add(ambient, key, ...this._rimLights);
  }

  /**
   * Request a glow multiplier for a pilot's rim light (1 = normal,
   * >1 = brighter/selected, <1 = dimmed). Changes ease in via damping
   * rather than snapping, so hover/select transitions read as smooth
   * lighting shifts rather than instant swaps.
   * @param {string} id
   * @param {number} multiplier
   */
  setEmphasis(id, multiplier) {
    if (id in this._emphasisTarget) this._emphasisTarget[id] = multiplier;
  }

  _initEnvironment() {
    this.particleSystem = new ParticleSystem();
    this.scene.add(this.particleSystem.group);

    // A few slowly-tumbling angular shapes catch the rim lighting and read
    // as distant station/debris silhouettes — decoration only, never used
    // to represent the pilots themselves.
    this._decor = new THREE.Group();
    this._decor.name = 'FloatingDecor';

    const decorMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c2733,
      metalness: 0.8,
      roughness: 0.35,
      emissive: 0x0a1520,
      emissiveIntensity: 0.4,
    });

    const shapes = [
      { geo: new THREE.TorusGeometry(1.1, 0.05, 8, 48), position: [-6.5, 2.5, -8], rotSpeed: 0.05 },
      { geo: new THREE.IcosahedronGeometry(0.6, 0), position: [7, -1.5, -9], rotSpeed: -0.08 },
      { geo: new THREE.OctahedronGeometry(0.5, 0), position: [4.5, 3.2, -11], rotSpeed: 0.1 },
    ];

    this._decorMeshes = shapes.map(({ geo, position, rotSpeed }) => {
      const mesh = new THREE.Mesh(geo, decorMaterial);
      mesh.position.set(...position);
      mesh.userData.rotSpeed = rotSpeed;
      this._decor.add(mesh);
      return mesh;
    });

    this._decorMaterial = decorMaterial;
    this.scene.add(this._decor);
  }

  _initCharacterSlots() {
    // Empty anchor groups CharacterSystem will parent GLB models to in
    // Stage 4. Created now so the scene's spatial layout is fixed early.
    this.characterSlots = {};
    for (const { id, position } of SLOT_LAYOUT) {
      const slot = new THREE.Group();
      slot.name = `slot-${id}`;
      slot.position.set(...position);
      this.scene.add(slot);
      this.characterSlots[id] = slot;
    }
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // A single, subtle bloom pass. Chromatic aberration was deliberately
    // left out for now — with three animated characters + particles this
    // keeps the post pipeline light; it's a one-line addition later if
    // still wanted once real content is on screen.
    this._bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
      0.55, // strength
      0.4,  // radius
      0.82  // threshold — only genuinely bright elements (rim lights, nebula) bloom
    );
    this.composer.addPass(this._bloomPass);
  }

  /**
   * Register an object with an `update(dt, elapsed)` method to be called
   * every frame. Returns an unregister function.
   */
  addUpdatable(updatable) {
    this._updatables.add(updatable);
    return () => this._updatables.delete(updatable);
  }

  mount() {
    this._clock.start();
    this._tick();
  }

  _tick() {
    this._rafId = requestAnimationFrame(() => this._tick());

    const dt = Math.min(this._clock.getDelta(), 0.1); // guard against tab-switch spikes
    const elapsed = this._clock.getElapsedTime();

    this.cameraSystem.update(dt, elapsed);
    this.particleSystem.update(dt, elapsed);

    for (const updatable of this._updatables) {
      updatable.update(dt, elapsed);
    }

    for (const mesh of this._decorMeshes) {
      mesh.rotation.x += mesh.userData.rotSpeed * dt;
      mesh.rotation.y += mesh.userData.rotSpeed * dt * 0.6;
    }

    // Slow pulse on the rim lights, scaled by each pilot's damped
    // emphasis multiplier so selection/hover can brighten or dim a
    // specific light without touching the base pulse animation.
    let i = 0;
    for (const id in this._rimLightsById) {
      this._emphasis[id] = damp(this._emphasis[id], this._emphasisTarget[id], 4, dt);
      const phase = elapsed * 0.6 + i * 2.1;
      const basePulse = 2.6 + Math.sin(phase) * 0.6;
      this._rimLightsById[id].intensity = basePulse * this._emphasis[id];
      i++;
    }

    this.composer.render();
  }

  _onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this._bloomPass.setSize(width, height);
  }

  dispose() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._resizeObserver.disconnect();
    this._updatables.clear();

    this.particleSystem.dispose();

    for (const mesh of this._decorMeshes) mesh.geometry.dispose();
    this._decorMaterial.dispose();

    for (const light of this._rimLights) light.dispose?.();

    this.renderer.dispose();
    this.composer.dispose?.();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
