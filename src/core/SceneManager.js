import * as THREE from 'three';

export class SceneManager {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.0016);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.camera.position.set(0, 6, 20);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.addLights();

    window.addEventListener('resize', () => this._onResize());
  }

  // Public so a level can call this again after clearing the scene
  // (Level1.dispose() wipes every child, lights included, on restart).
  addLights() {
    const ambient = new THREE.AmbientLight(0x223355, 1.1);
    this.scene.add(ambient);

    // Cold rim light, as if lit by the accretion disk behind the player.
    const rim = new THREE.DirectionalLight(0x88bbff, 1.4);
    rim.position.set(-40, 30, -60);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffaa66, 0.6, 400);
    warm.position.set(0, 20, 40);
    this.scene.add(warm);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
