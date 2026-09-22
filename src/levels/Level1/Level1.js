import * as THREE from 'three'

import { Level, clearScene } from '../../core/Level.js'
import { AsteroidField } from './AsteroidField.js'
import { BlackHole } from './BlackHole.js'
import { Spaceship } from './Spaceship.js'

export class Level1 extends Level {
	constructor(game) {
		super(game, 1)
		this.clearStartMenu()

		this.addLights()

		this.sceneManager.camera.position.set(0, 0, 800)
		this.timeScale = 1
		this.elapsedPlayTime = 0

		this.blackHole = new BlackHole(this)
		this.spaceship = new Spaceship(this, this.blackHole)
		this.asteroidField = new AsteroidField(this, this.blackHole)
		this.spaceship.onAsteroidCollision = (asteroid) => {
			console.log('collision')
		}
	}

	clearStartMenu() {
		document.body.querySelector(
			'#screen-start.screen'
		).style.display = 'none'
		clearScene(this.game.sceneManager.scene)
		this.game.menuBackground = null
	}

	addLights() {
		const rim = new THREE.DirectionalLight(0x88bbff, 2)
		rim.position.set(300, 200, 300)
		rim.target.position.set(0, 0, 0)
		this.sceneManager.scene.add(rim)
		this.sceneManager.scene.add(rim.target)
		const ambientLight = new THREE.AmbientLight(0x334466, 0.4)
		this.sceneManager.scene.add(ambientLight)
		this.blackHoleLight = new THREE.PointLight(0xffaa44, 3, 400, 2)
		this.blackHoleLight.position.set(0, 0, 0)
		this.sceneManager.scene.add(this.blackHoleLight)
	}

	update(delta) {
		super.update(delta)
		if (this.asteroidField)
			this.asteroidField.updateAsteroidPhysics(
				delta,
				this.timeScale
			)
		if (this.blackHole)
			this.blackHole.updateBlackHoleDisk(
				delta,
				this.timeScale
			)
		if (this.spaceship) {
			this.spaceship.updatePhysics(delta, this.timeScale)
			this.spaceship.updateCamera(delta, this.timeScale)
			const hitAsteroid =
				this.asteroidField.checkShipCollision(
					this.spaceship
				)
			if (hitAsteroid)
				this.spaceship.onAsteroidCollision?.(
					hitAsteroid
				)
		}
		this.elapsedPlayTime += delta
	}
}
