import * as THREE from 'three'
import { loadVoidModel } from './voidAssets.js'

const planetFragment = `
varying vec3 surface, worldNormal;
uniform vec3 lowColor, highColor;
uniform float gas, cloudiness;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise(vec3 p) {
 vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main() {
 vec3 p=normalize(surface);
 float n=noise(p*5.0)*0.6+noise(p*13.0)*0.28+noise(p*37.0)*0.12;
 float bands=0.5+0.5*sin(p.y*48.0+n*8.0);
 float pattern=mix(smoothstep(0.40,0.62,n),bands,gas);
 vec3 color=mix(lowColor,highColor,mix(pattern,0.25+pattern*0.5,gas));
 float cloud=smoothstep(0.60,0.76,noise(p*8.0+vec3(17.0))+noise(p*23.0)*0.17);
 color=mix(color,vec3(0.83,0.9,1.0),cloud*cloudiness);
 float day=smoothstep(-0.18,0.8,dot(normalize(worldNormal),normalize(vec3(-0.8,0.5,1.0))));
 gl_FragColor=vec4(color*(0.025+day*0.975),1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`

/** Distant celestial bodies and a cached Level 3 ship; no gameplay colliders. */
export class VoidSpaceBackdrop {
	constructor(level, parent) {
		this.level = level
		this.resources = []
		this.group = new THREE.Group()
		this.group.name = 'void-outer-space'
		parent.add(this.group)
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const sphere = own(new THREE.SphereGeometry(1, 64, 32))
		this.planets = []
		const definitions = [
			{
				position: [-1800, 850, -3000],
				radius: 210,
				low: 0x103968,
				high: 0x5f9176,
				gas: 0,
			},
			{
				position: [1800, 950, -3400],
				radius: 250,
				low: 0x72513f,
				high: 0xdbc49b,
				gas: 1,
			},
			{
				position: [1450, -800, -2700],
				radius: 130,
				low: 0x643525,
				high: 0xb86d48,
				gas: 0,
			},
			{
				position: [-1700, -900, -3600],
				radius: 150,
				low: 0x254b69,
				high: 0x9fc9d9,
				gas: 0.75,
			},
		]
		for (const [i, def] of definitions.entries()) {
			const material = own(
				new THREE.ShaderMaterial({
					uniforms: {
						lowColor: {
							value: new THREE.Color(
								def.low
							),
						},
						highColor: {
							value: new THREE.Color(
								def.high
							),
						},
						gas: { value: def.gas },
						cloudiness: {
							value:
								i === 0
									? 0.65
									: i ===
										  3
										? 0.15
										: 0,
						},
					},
					vertexShader:
						'varying vec3 surface, worldNormal; void main() { surface=position; worldNormal=mat3(modelMatrix)*normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
					fragmentShader: planetFragment,
				})
			)
			const planet = new THREE.Mesh(sphere, material)
			planet.name = `distant-planet-${i + 1}`
			planet.position.fromArray(def.position)
			planet.scale.setScalar(def.radius)
			this.group.add(planet)
			this.planets.push(planet)
		}
		const ringGeometry = own(
			new THREE.RingGeometry(330, 470, 128, 8)
		)
		const colors = []
		const pos = ringGeometry.attributes.position
		for (let i = 0; i < pos.count; i++) {
			const radius = Math.hypot(pos.getX(i), pos.getY(i))
			const brightness =
				0.38 +
				0.32 * (0.5 + 0.5 * Math.sin(radius * 0.35))
			colors.push(
				brightness,
				brightness * 0.82,
				brightness * 0.62
			)
		}
		ringGeometry.setAttribute(
			'color',
			new THREE.Float32BufferAttribute(colors, 3)
		)
		const rings = new THREE.Mesh(
			ringGeometry,
			own(
				new THREE.MeshBasicMaterial({
					vertexColors: true,
					side: THREE.DoubleSide,
				})
			)
		)
		rings.position.copy(this.planets[1].position)
		rings.rotation.set(1.12, 0.24, 0.32)
		this.group.add(rings)
		// A recognisable foil bus, twin solar arrays, antenna and navigation light.
		this.satellite = new THREE.Group()
		this.satellite.name = 'orbiting-satellite'
		const gold = own(
			new THREE.MeshStandardMaterial({
				color: 0xb89446,
				metalness: 0.75,
				roughness: 0.4,
			})
		)
		const blue = own(
			new THREE.MeshStandardMaterial({
				color: 0x173e79,
				emissive: 0x102552,
				emissiveIntensity: 0.6,
				metalness: 0.65,
				roughness: 0.3,
			})
		)
		const silver = own(
			new THREE.MeshStandardMaterial({
				color: 0xbfcbd5,
				metalness: 0.7,
				roughness: 0.35,
			})
		)
		const body = new THREE.Mesh(
			own(new THREE.BoxGeometry(16, 15, 16)),
			gold
		)
		this.satellite.add(body)
		const cell = own(new THREE.BoxGeometry(7, 18, 0.7))
		for (const side of [-1, 1]) {
			for (let i = 0; i < 4; i++) {
				const panel = new THREE.Mesh(cell, blue)
				panel.position.x = side * (14 + i * 7.5)
				this.satellite.add(panel)
			}
		}
		const dish = new THREE.Mesh(
			own(
				new THREE.SphereGeometry(
					9,
					20,
					12,
					0,
					Math.PI * 2,
					0,
					0.65
				)
			),
			silver
		)
		dish.position.y = 10
		this.satellite.add(dish)
		const antenna = new THREE.Mesh(
			own(new THREE.CylinderGeometry(0.4, 0.4, 23, 6)),
			silver
		)
		antenna.position.y = 17
		this.satellite.add(antenna)
		this.group.add(this.satellite)
		this.update(0)
		this.shipReady = level.assetManager
			? this._loadShip()
			: Promise.resolve()
	}
	async _loadShip() {
		const ship = await loadVoidModel(
			this.level.assetManager,
			'anomalyShip'
		)
		if (!ship || this.disposed) return
		const bounds = new THREE.Box3().setFromObject(ship)
		const size = bounds.getSize(new THREE.Vector3())
		if (size.y > size.x && size.y > size.z) {
			ship.rotation.z = -Math.PI / 2
			ship.updateMatrixWorld(true)
			bounds.setFromObject(ship)
			bounds.getSize(size)
		}
		const scale = 52 / Math.max(size.x, size.y, size.z, 0.001)
		ship.scale.multiplyScalar(scale)
		ship.position.sub(
			bounds
				.getCenter(new THREE.Vector3())
				.multiplyScalar(scale)
		)
		this.ship = new THREE.Group()
		this.ship.name = 'void-level3-anomaly-ship'
		this.ship.add(ship)
		this.ship.position.set(-65, 28, -110)
		this.ship.rotation.set(0.12, 0.7, -0.14)
		this.group.add(this.ship)
		// Source buffers belong to AssetManager and must survive a level restart.
	}
	update(time) {
		const angle = time * 0.045
		this.satellite.position
			.copy(this.planets[2].position)
			.add(
				new THREE.Vector3(
					Math.cos(angle) * 310,
					Math.sin(angle) * 110,
					Math.sin(angle) * 310
				)
			)
		this.satellite.rotation.set(0.2, -angle, -0.2)
		for (const planet of this.planets)
			planet.rotation.y = time * 0.008
		if (this.ship) {
			this.ship.position.y = 28 + Math.sin(time * 0.18) * 2
			this.ship.rotation.z =
				-0.14 + Math.sin(time * 0.12) * 0.035
		}
	}
	dispose() {
		this.disposed = true
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}
