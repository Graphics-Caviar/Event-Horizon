/**
 * src/launchbay/LaunchBayScene.js
 *
 * Replaces src/core/HangarScene.js. Shown after a pilot is chosen in
 * CharacterSelectFlow: displays the real spaceship.glb model (tinted per
 * selected ship, since it's one shared mesh rather than three distinct
 * models) with a ship-picker/LAUNCH panel, then hands off to Game.js's
 * Level1 flow.
 *
 * Unlike CharacterSelectFlow (which owns its own renderer/canvas — see
 * that file's header comment), this reuses the main game's shared
 * SceneManager/canvas, same as the HangarScene it replaces: it's a
 * single static-mesh model with no orbit-camera choreography of its own,
 * so there's no reason to pay for a second WebGL context here.
 */

import * as THREE from 'three'
import { Spaceship } from '../models/Spaceship.js'
import { SHIPS } from '../systems/ShipManager.js'
import './styles/character-select.css'
import './styles/launch-bay.css'

const SHIP_ORDER = ['raven', 'phantom', 'interceptor']
const SHIP_MODEL_PATH = '/assets/models/spaceship/spaceship.glb'
const TARGET_LENGTH = 6 // world units, matches roughly the procedural ship's scale

export class LaunchBayScene {
	/**
	 * @param {import('../core/SceneManager.js').SceneManager} sceneManager
	 * @param {import('../core/AssetManager.js').AssetManager} assetManager
	 * @param {object} options
	 * @param {string} [options.initialShip]
	 * @param {string} [options.pilotName]
	 * @param {(shipKey: string) => void} options.onLaunch
	 * @param {() => void} options.onBack
	 */
	constructor(sceneManager, assetManager, { initialShip, pilotName, onLaunch, onBack } = {}) {
		this.sceneManager = sceneManager
		this.assetManager = assetManager
		this.camera = sceneManager.camera
		this.group = new THREE.Group()

		this._onLaunch = onLaunch
		this._onBack = onBack
		this._pilotName = pilotName || ''
		this._shipKey = SHIPS[initialShip] ? initialShip : 'raven'

		this.starfield = assetManager.createStarfield(2000, 500)
		this.group.add(this.starfield)

		this.lightingRig = Spaceship.createLightingRig()
		this.group.add(this.lightingRig)

		this.shipModel = null
		this._shipTemplate = null
		this._loadError = false
		this._time = 0

		sceneManager.scene.add(this.group)

		this._buildPanel()
		this._loadShipModel()
	}

	async _loadShipModel() {
		try {
			this._shipTemplate = await this.assetManager.loadModel(SHIP_MODEL_PATH)
			this._loadingEl.remove()
			this._applyShip(this._shipKey)
		} catch (err) {
			console.error('[LaunchBayScene] failed to load spaceship.glb:', err)
			this._loadError = true
			this._loadingEl.textContent = 'SHIP MODEL UNAVAILABLE'
		}
	}

	_applyShip(key) {
		this._shipKey = key
		const config = SHIPS[key] || SHIPS.raven

		if (this.shipModel) {
			this.group.remove(this.shipModel)
			this.shipModel.traverse((node) => {
				if (node.isMesh) {
					node.geometry?.dispose()
					node.material?.dispose()
				}
			})
			this.shipModel = null
		}

		if (!this._shipTemplate) return // still loading; _loadShipModel() calls back in once ready

		const model = this._shipTemplate.clone(true)
		model.traverse((node) => {
			if (node.isMesh) {
				// Clone the material per-instance so tinting one ship variant
				// never bleeds into another (they'd otherwise share the glTF's
				// single "PrincipledMaterial").
				node.material = node.material.clone()
				node.material.color?.set(config.colors.hull)
				node.castShadow = true
				node.receiveShadow = true
			}
		})

		// Real GLBs are rarely authored at a scene-ready scale/origin — same
		// normalize-to-target-size-then-ground approach as CharacterModel
		// uses for the pilots.
		const box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const longestAxis = Math.max(size.x, size.y, size.z) || 1
		model.scale.setScalar(TARGET_LENGTH / longestAxis)

		const scaledBox = new THREE.Box3().setFromObject(model)
		const center = scaledBox.getCenter(new THREE.Vector3())
		model.position.x -= center.x
		model.position.y -= scaledBox.min.y
		model.position.z -= center.z

		this.shipModel = model
		this.group.add(model)

		this._updatePanelText(config)
	}

	_buildPanel() {
		this._panel = document.createElement('div')
		this._panel.className = 'launchbay-panel'
		this._panel.innerHTML = `
			<div class="launchbay-panel__ship">
				<button class="launchbay-panel__nav-btn" data-dir="-1" aria-label="Previous ship">&lsaquo;</button>
				<div class="launchbay-panel__ship-info">
					<div class="launchbay-panel__ship-name"></div>
					<div class="launchbay-panel__ship-role"></div>
					<div class="launchbay-panel__pilot"></div>
				</div>
				<button class="launchbay-panel__nav-btn" data-dir="1" aria-label="Next ship">&rsaquo;</button>
			</div>
			<div class="launchbay-panel__actions">
				<button class="launchbay-panel__back-btn">BACK</button>
				<button class="launchbay-panel__launch-btn">LAUNCH</button>
			</div>
		`
		document.body.appendChild(this._panel)

		this._loadingEl = document.createElement('div')
		this._loadingEl.className = 'launchbay-loading'
		this._loadingEl.textContent = 'LOADING SHIP MODEL…'
		document.body.appendChild(this._loadingEl)

		this._panel.querySelectorAll('.launchbay-panel__nav-btn').forEach((btn) => {
			btn.addEventListener('click', () => {
				const dir = Number(btn.dataset.dir)
				const idx = SHIP_ORDER.indexOf(this._shipKey)
				const next = SHIP_ORDER[(idx + dir + SHIP_ORDER.length) % SHIP_ORDER.length]
				this._applyShip(next)
			})
		})

		this._panel.querySelector('.launchbay-panel__back-btn').addEventListener('click', () => {
			this._onBack?.()
		})
		this._panel.querySelector('.launchbay-panel__launch-btn').addEventListener('click', () => {
			this._onLaunch?.(this._shipKey)
		})

		this._updatePanelText(SHIPS[this._shipKey] || SHIPS.raven)
	}

	_updatePanelText(config) {
		this._panel.querySelector('.launchbay-panel__ship-name').textContent = config.name
		this._panel.querySelector('.launchbay-panel__ship-role').textContent =
			`${config.mark} · ${config.role}`
		this._panel.querySelector('.launchbay-panel__pilot').textContent = this._pilotName
			? `PILOT: `
			: ''
		if (this._pilotName) {
			const strong = document.createElement('strong')
			strong.textContent = this._pilotName.toUpperCase()
			this._panel.querySelector('.launchbay-panel__pilot').appendChild(strong)
		}
	}

	update(delta) {
		this._time += delta
		if (this.shipModel) {
			this.shipModel.rotation.y = this._time * 0.25
		}
		this.camera.position.set(0, 2, 8)
		this.camera.lookAt(0, 0.5, 0)
	}

	dispose() {
		if (this.shipModel) {
			this.shipModel.traverse((node) => {
				if (node.isMesh) {
					node.geometry?.dispose()
					node.material?.dispose()
				}
			})
		}
		if (this.group.parent) this.group.parent.remove(this.group)
		this._panel?.remove()
		this._loadingEl?.remove()
	}
}
