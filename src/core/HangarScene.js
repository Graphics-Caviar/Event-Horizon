import * as THREE from 'three'
import { Spaceship } from '../models/Spaceship.js'
import { CharacterManager, CHARACTERS } from '../systems/CharacterManager.js'
import { SHIPS } from '../systems/ShipManager.js'

/** World-space length a ship is fitted to when its stage has room. */
const SHIP_SIZE = 5
/** Camera-to-ship distance in the ship pose (camera (0,2.4,8) -> origin). */
const SHIP_CAMERA_DISTANCE = 8.2
/** Camera-to-lineup distance in the pilot overview pose (camera z = 6.7). */
const OVERVIEW_CAMERA_DISTANCE = 6.7

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

		// The ship sits inside a pivot centred on its bounding box. Rotating
		// or scaling the model itself happens about its authored origin, which
		// is not its visual centre — so resizing it to fit the stage made it
		// drift sideways. The pivot rotates and scales about the true centre.
		this.shipPivot = new THREE.Group()
		this.group.add(this.shipPivot)
		this._shipStage = null
		this._pilotAnchor = null

		this.characterManager = new CharacterManager(
			this.group,
			assetManager
		)
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
				configs.map((config) =>
					this.assetManager.loadModel(
						config.model
					)
				)
			)
			if (
				requestId !== this._overviewRequestId ||
				this._mode !== 'character-overview'
			) {
				return
			}

			models.forEach((model, index) => {
				this._prepareCharacter(model, 2.55)
				model.position.x = positions[index]
				model.position.z = index === 1 ? 0.05 : 0
				model.rotation.y =
					index === 0
						? 0.06
						: index === 2
							? -0.06
							: 0
				this.group.add(model)
				this.overviewCharacters.set(
					configs[index].key,
					model
				)
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
			if (
				requestId !== this._characterRequestId ||
				this._mode !== 'character-detail'
			) {
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
			const model = await this.assetManager.loadModel(
				config.model
			)
			if (
				requestId !== this._shipRequestId ||
				this._mode !== 'ship'
			)
				return
			this._prepareShip(model)
			this.shipPivot.add(model)
			this.ship = model
		} catch (error) {
			console.error(
				`Unable to display ${config.name}:`,
				error
			)
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
		this._fitAndCenter(model, SHIP_SIZE)
		// _fitAndCenter re-centres x/z after scaling but not y; finish the job
		// so the pivot sits exactly on the hull's visual centre.
		const box = new THREE.Box3().setFromObject(model)
		model.position.y -= box.getCenter(new THREE.Vector3()).y
	}

	_fitAndCenter(model, targetSize) {
		let box = new THREE.Box3().setFromObject(model)
		const center = box.getCenter(new THREE.Vector3())
		model.position.sub(center)
		box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const largestDimension = Math.max(size.x, size.y, size.z)
		if (largestDimension > 0)
			model.scale.setScalar(targetSize / largestDimension)
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
		this.ship.parent?.remove(this.ship)
		this.ship = null
	}

	/**
	 * Tell the scene which on-screen box the ship should appear in. The ship
	 * select UI keeps its text in a left sidebar and leaves this element
	 * empty on the right; framing against the element's real position (read
	 * every frame) keeps the ship there at any window size and breakpoint,
	 * instead of relying on hardcoded offsets that only suit one aspect ratio.
	 * @param {HTMLElement|null} element
	 */
	setShipStage(element) {
		this._shipStage = element || null
	}

	/**
	 * Tell the scene where each pilot's name card is, so the lineup can stand
	 * each 3D pilot directly above its card.
	 *
	 * The models used to sit at hardcoded x positions and only lined up with
	 * the cards by coincidence, so widening the card row in CSS would have
	 * left the pilots behind. Anchoring to the cards makes the CSS the single
	 * source of truth for pilot spacing, at every screen size.
	 * @param {(key: string) => HTMLElement|null} lookup
	 */
	setPilotAnchor(lookup) {
		this._pilotAnchor = typeof lookup === 'function' ? lookup : null
	}

	/** Move each overview pilot to sit above its card's horizontal centre. */
	_alignOverview() {
		if (!this._pilotAnchor) return
		const cam = this.camera
		const halfW =
			Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) *
			OVERVIEW_CAMERA_DISTANCE *
			cam.aspect
		const vw = window.innerWidth
		for (const [key, model] of this.overviewCharacters) {
			const rect =
				this._pilotAnchor(key)?.getBoundingClientRect()
			if (!rect || rect.width === 0) continue
			const ndcX = ((rect.left + rect.width / 2) / vw) * 2 - 1
			model.position.x = ndcX * halfW
		}
	}

	/**
	 * Centre the ship in the stage box and size it to fit.
	 *
	 * The camera slides sideways rather than turning, so the ship keeps the
	 * same straight-on three-quarter view — it simply lands in the stage
	 * instead of the middle of the screen, where it used to sit behind the
	 * ship cards and stat table.
	 */
	_frameShip() {
		const cam = this.camera
		const halfH =
			Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) *
			SHIP_CAMERA_DISTANCE
		const halfW = halfH * cam.aspect

		let ndcX = 0
		let ndcY = 0
		let fracW = 1
		let fracH = 1
		const rect = this._shipStage?.getBoundingClientRect()
		if (rect && rect.width > 0 && rect.height > 0) {
			const vw = window.innerWidth
			const vh = window.innerHeight
			ndcX = ((rect.left + rect.width / 2) / vw) * 2 - 1
			ndcY = -(((rect.top + rect.height / 2) / vh) * 2 - 1)
			fracW = rect.width / vw
			fracH = rect.height / vh
		}

		// Same downward viewing angle as the original pose (a 1.9 drop over
		// 8 units), but aimed at the hull's centre rather than 0.5 above it,
		// which left the ship sitting low in the stage.
		const offX = -ndcX * halfW
		const offY = -ndcY * halfH
		cam.position.set(offX, 1.9 + offY, 8)
		cam.lookAt(offX, offY, 0)

		// Full size when the stage has room; smaller on narrow stages, with
		// margin because the hull's width changes as it rotates.
		const stageW = fracW * halfW * 2
		const stageH = fracH * halfH * 2
		const target = Math.max(
			1.5,
			Math.min(SHIP_SIZE, stageW * 0.7, stageH * 0.85)
		)
		this.shipPivot.scale.setScalar(target / SHIP_SIZE)
	}

	update(delta) {
		this._time += delta
		if (
			this._mode === 'character-overview' &&
			this.overviewCharacters.size
		) {
			let i = 0
			for (const model of this.overviewCharacters.values()) {
				model.position.y +=
					Math.sin(this._time * 1.15 + i * 1.8) *
					0.0007
				i++
			}
			this.camera.position.set(0, 1.55, 6.7)
			this.camera.lookAt(0, 1.18, 0)
			this._alignOverview()
		} else if (
			this._mode === 'character-detail' &&
			this.characterManager.currentModel
		) {
			const model = this.characterManager.currentModel
			model.rotation.y = Math.sin(this._time * 0.45) * 0.08
			this.camera.position.set(-0.25, 1.6, 4.35)
			this.camera.lookAt(-0.62, 1.28, 0)
		} else if (this._mode === 'ship' && this.ship) {
			this.shipPivot.rotation.y += delta * 0.25
			this.shipPivot.position.y =
				Math.sin(this._time * 0.8) * 0.08
			this._frameShip()
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
