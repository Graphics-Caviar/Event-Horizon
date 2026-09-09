import * as THREE from 'three'
import { Spaceship } from '../models/Spaceship.js'
import { CharacterManager, CHARACTERS } from '../systems/CharacterManager.js'
import { SHIPS } from '../systems/ShipManager.js'

/** 3D content behind the pilot / ship selection screen. */
export class HangarScene {
	constructor(sceneManager, assetManager) {
		this.sceneManager = sceneManager
		this.assetManager = assetManager
		this.camera = sceneManager.camera
		this.group = new THREE.Group()

		this.starfield = assetManager.createStarfield(2000, 500)
		this.group.add(this.starfield)

		this.lightingRig = Spaceship.createLightingRig()
		this.group.add(this.lightingRig)

		const podiumGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.3, 24)
		const podiumMat = new THREE.MeshStandardMaterial({
			color: 0x11151f,
			metalness: 0.6,
			roughness: 0.4,
			emissive: 0x0b3a44,
			emissiveIntensity: 0.4,
		})
		this.podium = new THREE.Mesh(podiumGeo, podiumMat)
		this.podium.position.y = -0.15
		this.group.add(this.podium)

		this.characterManager = new CharacterManager(this.group, assetManager)
		this.overviewCharacters = new Map()
		this.ship = null
		this._currentCharacterKey = null
		this._currentShipKey = null
		this._characterRequestId = 0
		this._overviewRequestId = 0
		this._shipRequestId = 0
		this._time = 0
		this._mode = 'character-overview'
		sceneManager.scene.add(this.group)
	}

	async showCharacterOverview() {
		this._mode = 'character-overview'
		this._characterRequestId++
		this._shipRequestId++
		this.characterManager.dispose()
		this._removeShip()
		this._removeOverviewCharacters()
		this.podium.visible = false

		const requestId = ++this._overviewRequestId
		const configs = Object.values(CHARACTERS)
		const positions = [-2.05, 0, 2.05]

		try {
			const models = await Promise.all(
				configs.map((config) => this.assetManager.loadModel(config.model))
			)
			if (requestId !== this._overviewRequestId || this._mode !== 'character-overview') {
				return
			}

			models.forEach((model, index) => {
				this._prepareCharacter(model, 2.55)
				model.position.x = positions[index]
				model.position.z = index === 1 ? 0.05 : 0
				model.rotation.y = index === 0 ? 0.06 : index === 2 ? -0.06 : 0
				this.group.add(model)
				this.overviewCharacters.set(configs[index].key, model)
			})
		} catch (error) {
			console.error('Unable to display pilot lineup:', error)
		}
	}

	async showCharacter(key = 'zara') {
		this._mode = 'character-detail'
		this._overviewRequestId++
		this._shipRequestId++
		this._removeOverviewCharacters()
		this._removeShip()
		this.podium.visible = true

		const requestId = ++this._characterRequestId
		this._currentCharacterKey = key
		try {
			const model = await this.characterManager.select(key)
			if (requestId !== this._characterRequestId || this._mode !== 'character-detail') {
				if (model?.parent) model.parent.remove(model)
				return
			}
			this._prepareCharacter(model, 3.15)
			// Leave room for the dossier on the right.
			model.position.x = -0.72
		} catch (error) {
			console.error(`Unable to display pilot ${key}:`, error)
		}
	}

	async showShip(shipKey = 'starfighter') {
		this._mode = 'ship'
		this._characterRequestId++
		this._overviewRequestId++
		this.characterManager.dispose()
		this._removeOverviewCharacters()
		this.podium.visible = false
		if (this.ship && this._currentShipKey === shipKey) return

		const config = SHIPS[shipKey] || SHIPS.starfighter
		const requestId = ++this._shipRequestId
		this._currentShipKey = shipKey
		this._removeShip()

		try {
			const model = await this.assetManager.loadModel(config.model)
			if (requestId !== this._shipRequestId || this._mode !== 'ship') return
			this._prepareShip(model)
			this.group.add(model)
			this.ship = model
		} catch (error) {
			console.error(`Unable to display ${config.name}:`, error)
		}
	}

	_prepareCharacter(model, targetSize = 2.8) {
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true
				child.receiveShadow = true
			}
		})
		this._fitAndCenter(model, targetSize)
		const box = new THREE.Box3().setFromObject(model)
		model.position.y += -box.min.y + 0.02
	}

	_prepareShip(model) {
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true
				child.receiveShadow = true
			}
		})
		this._fitAndCenter(model, 5)
	}

	_fitAndCenter(model, targetSize) {
		let box = new THREE.Box3().setFromObject(model)
		const center = box.getCenter(new THREE.Vector3())
		model.position.sub(center)
		box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const largestDimension = Math.max(size.x, size.y, size.z)
		if (largestDimension > 0) model.scale.setScalar(targetSize / largestDimension)
		box = new THREE.Box3().setFromObject(model)
		const newCenter = box.getCenter(new THREE.Vector3())
		model.position.x -= newCenter.x
		model.position.z -= newCenter.z
	}

	_removeOverviewCharacters() {
		for (const model of this.overviewCharacters.values()) {
			if (model.parent) model.parent.remove(model)
		}
		this.overviewCharacters.clear()
	}

	_removeShip() {
		if (!this.ship) return
		this.group.remove(this.ship)
		this.ship = null
	}

	update(delta) {
		this._time += delta
		if (this._mode === 'character-overview' && this.overviewCharacters.size) {
			let i = 0
			for (const model of this.overviewCharacters.values()) {
				model.position.y += Math.sin(this._time * 1.15 + i * 1.8) * 0.0007
				i++
			}
			this.camera.position.set(0, 1.55, 6.7)
			this.camera.lookAt(0, 1.18, 0)
		} else if (this._mode === 'character-detail' && this.characterManager.currentModel) {
			const model = this.characterManager.currentModel
			model.rotation.y = Math.sin(this._time * 0.45) * 0.08
			this.camera.position.set(-0.25, 1.6, 4.35)
			this.camera.lookAt(-0.62, 1.28, 0)
		} else if (this._mode === 'ship' && this.ship) {
			this.ship.rotation.y += delta * 0.25
			this.ship.position.y = Math.sin(this._time * 0.8) * 0.08
			this.camera.position.set(0, 2.4, 8)
			this.camera.lookAt(0, 0.5, 0)
		}
	}

	dispose() {
		this._characterRequestId++
		this._overviewRequestId++
		this._shipRequestId++
		this.characterManager.dispose()
		this._removeOverviewCharacters()
		this._removeShip()
		if (this.group.parent) this.group.parent.remove(this.group)
	}
}
