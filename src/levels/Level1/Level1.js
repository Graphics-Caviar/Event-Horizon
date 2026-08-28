import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'

import { Level, clearScene } from '../../core/Level.js'

export class Level1 extends Level {
	constructor(game) {
		super(game, 1)
		this.clearStartMenu()

		this.addLights()
		this.populateAsteroids()

		this.sceneManager.camera.position.set(0, 0, 500)

		this.asteroids = new Set()
	}

	clearStartMenu() {
		document.body.querySelector('#screen-start.screen').style.display = 'none'
		//document.body.querySelector('#screen-start.screen').remove()
		clearScene(this.game.sceneManager.scene)
		this.game.menuBackground = null
	}

	addLights() {
		const rim = new THREE.DirectionalLight(0x88bbff, 3)
		rim.position.set(0, 0, 0)
		this.sceneManager.scene.add(rim)
		const ambientLight = new THREE.AmbientLight(0xffffff)
		this.sceneManager.scene.add(ambientLight)

	}

	populateAsteroids(no = 0) {
		for (let i = 0; i < no; i++) {
			const { asteroid, geometry, material } =
				this.createBasicAsteroid(50, 4)
			this.own(geometry)
			this.own(material)
			this.asteroids.add(this.addObject(asteroid))
		}
		console.log(this.asteroids)
	}

	createBasicAsteroid(radius, detail = 0, seed = 1001) {
		const perlin = new ImprovedNoise()
		const geometry = new THREE.IcosahedronGeometry(radius, detail)
		const pos = geometry.attributes.position
		const vertex = new THREE.Vector3()
		for (let i = 0; i < pos.count; i++) {
			vertex.fromBufferAttribute(pos, i)
			const noiseScale = 0.5
			const noiseImpact = 0.4
			const noise = perlin.noise(
				vertex.x * noiseScale,
				vertex.y * noiseScale,
				vertex.z * noiseScale
			)
			vertex.addScaledVector(
				vertex.clone().normalize(),
				noise * noiseImpact
			)
			pos.setXYZ(i, vertex.x, vertex.y, vertex.z)
		}
		geometry.computeVertexNormals()
		const material = new THREE.MeshStandardMaterial({
			color: 0x555555,
			roughness: 0.6,
			metalness: 0.4,
			flatShading: true,
		})
		const asteroid = new THREE.Mesh(geometry, material)
		return { asteroid, geometry, material }
	}
}
