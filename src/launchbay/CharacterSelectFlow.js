/**
 * src/launchbay/CharacterSelectFlow.js
 *
 * Wraps the ported character-select prototype (scenes/CharacterSelectScene,
 * systems/CharacterSystem+CameraSystem, components/HUD+CharacterCard+
 * PilotInfoPanel) into something Game.js can mount()/dispose() the same
 * way it used to mount CharacterSelect.js + HangarScene.
 *
 * The prototype owned its own <canvas> (via CharacterSelectScene's own
 * WebGLRenderer) rather than the main game's shared SceneManager canvas.
 * That's kept as-is here rather than rewired onto the shared renderer:
 * CameraSystem's orbit/focus math and ParticleSystem's environment are
 * built around owning their own camera/render loop, and only one of
 * {this screen, the main game canvas} is ever visible at a time, so a
 * second WebGL context for the duration of character-select is a small,
 * contained cost rather than an architectural problem.
 *
 * Everything below (DOM scaffold, grid-building, HUD wiring) is the
 * prototype's main.js, moved into a class so it can be constructed and
 * torn down per visit instead of running once at page load. The one real
 * behavior change: Stage 8 was a stub ("READY clicked — Launch Bay
 * transition arrives in Stage 8") — `onReady` below is that transition,
 * now wired to Game.js's Launch Bay instead of a console.log.
 */

import * as THREE from 'three'
import { CHARACTERS, getCharacterById } from './data/characters.js'
import { gameState } from './systems/GameState.js'
import { CharacterSelectScene } from './scenes/CharacterSelectScene.js'
import { CharacterSystem } from './systems/CharacterSystem.js'
import CharacterCard from './components/CharacterCard/CharacterCard.js'
import PilotInfoPanel from './components/PilotInfoPanel/PilotInfoPanel.js'
import HUD from './components/HUD/HUD.js'
import './styles/character-select.css'

export class CharacterSelectFlow {
	/**
	 * @param {object} options
	 * @param {string} [options.initialPilot] pilot id to preselect (e.g. from a saved profile)
	 * @param {string} [options.playerName]
	 * @param {(pilotId: string) => void} options.onReady called once with the
	 *        chosen pilot id when the player presses READY.
	 * @param {() => void} options.onBack called when the player backs out to the main menu.
	 */
	constructor({ initialPilot, playerName, onReady, onBack }) {
		this._onReady = onReady
		this._onBack = onBack
		this._playerName = playerName || 'PILOT'

		gameState.reset()
		if (
			initialPilot &&
			CHARACTERS.some((c) => c.id === initialPilot)
		) {
			gameState.set({ selectedCharacter: initialPilot })
		}

		this._root = document.createElement('div')
		this._root.id = 'launchbay-character-select'
		this._root.innerHTML = `
			<div id="scene-root"></div>
			<div id="ui-root"></div>
			<div id="loading-screen">
				<div class="loading-inner">
					<div class="loading-title">EVENT HORIZON</div>
					<div class="loading-bar"><div class="loading-bar-fill"></div></div>
					<div class="loading-status">INITIALIZING SYSTEMS&hellip;</div>
				</div>
			</div>
		`
		document.body.appendChild(this._root)

		this._sceneRoot = this._root.querySelector('#scene-root')
		this._uiRoot = this._root.querySelector('#ui-root')
		this._loadingScreen =
			this._root.querySelector('#loading-screen')
		this._loadingStatus =
			this._loadingScreen.querySelector('.loading-status')

		this._unsubscribers = []
		this._init()
	}

	_setLoadingStatus(text) {
		if (this._loadingStatus) this._loadingStatus.textContent = text
	}

	_init() {
		try {
			this._setLoadingStatus('LOADING PILOT DATA…')

			if (
				!Array.isArray(CHARACTERS) ||
				CHARACTERS.length !== 3
			) {
				throw new Error(
					`Expected 3 characters in data/characters.js, found ${CHARACTERS?.length ?? 0}`
				)
			}
			if (!THREE.Scene) {
				throw new Error(
					'three.js failed to load correctly — check node_modules/three'
				)
			}

			this._setLoadingStatus(
				'INITIALIZING SPACE ENVIRONMENT…'
			)
			this.scene = new CharacterSelectScene(this._sceneRoot)
			this.scene.mount()

			this._setLoadingStatus('LOADING PILOT MODELS…')
			this.characterSystem = new CharacterSystem(this.scene)
			this.scene.addUpdatable(this.characterSystem)

			this._setLoadingStatus('BUILDING PILOT ROSTER…')
			this._mountHUD()

			gameState.set({ isLoading: false })
			this._setLoadingStatus('READY')
			this._loadingScreen.classList.add('is-hidden')
		} catch (err) {
			this._setLoadingStatus(`INIT FAILED: ${err.message}`)
			console.error(err)
		}
	}

	_buildCharacterGrid() {
		const grid = document.createElement('div')
		grid.className = 'character-grid interactive'

		let hoveredId = null

		const cards = CHARACTERS.map(
			(character) =>
				new CharacterCard(character, {
					onHover: (id) => {
						hoveredId = id
						this.characterSystem.setHovered(
							id
						)
						refreshCardStates()
					},
					onHoverEnd: () => {
						hoveredId = null
						this.characterSystem.setHovered(
							null
						)
						refreshCardStates()
					},
					onSelect: (id) => {
						gameState.set({
							selectedCharacter: id,
							isReady: true,
						})

						const character =
							getCharacterById(id)
						const slot =
							this.scene
								.characterSlots[
								id
							]
						this.characterSystem.setSelected(
							id
						)
						if (character && slot) {
							this.scene.cameraSystem.focusOn(
								slot.position,
								character.cameraFraming
							)
						}
					},
				})
		)

		const refreshCardStates = () => {
			const { selectedCharacter } = gameState.state
			grid.classList.toggle(
				'has-selection',
				Boolean(selectedCharacter)
			)
			for (const card of cards) {
				const id = card.character.id
				card.setState({
					isSelected: selectedCharacter === id,
					isHovered:
						hoveredId === id &&
						selectedCharacter !== id,
					isDimmed:
						Boolean(selectedCharacter) &&
						selectedCharacter !== id &&
						hoveredId !== id,
				})
			}
		}

		for (const card of cards) grid.appendChild(card.element)

		this._unsubscribers.push(
			gameState.subscribe((state, changedKeys) => {
				if (changedKeys.includes('selectedCharacter'))
					refreshCardStates()
			})
		)

		refreshCardStates()

		// Pre-selected pilot (e.g. returning from Launch Bay via BACK) doesn't
		// go through a card click, so the grid/scene need one manual sync.
		if (gameState.state.selectedCharacter) refreshCardStates()

		return grid
	}

	_mountHUD() {
		this.hud = new HUD({
			playerName: this._playerName,
			playerLevel: 12,
			onBack: () => {
				gameState.set({
					selectedCharacter: null,
					isReady: false,
				})
				this.characterSystem.setSelected(null)
				this.scene.cameraSystem.release()
				this._onBack?.()
			},
			onSettings: () => {
				console.log(
					'[HUD] SETTINGS clicked — no settings screen exists yet'
				)
			},
			onReady: () => {
				const pilotId =
					gameState.state.selectedCharacter
				if (!pilotId) return
				this._onReady?.(pilotId)
			},
		})

		this.infoPanel = new PilotInfoPanel({
			onSelect: (id) => {
				gameState.set({
					selectedCharacter: id,
					isReady: true,
				})
			},
		})

		const grid = this._buildCharacterGrid()

		this.hud.mountCenterContent(grid)
		this._uiRoot.appendChild(this.infoPanel.element)
		this._uiRoot.appendChild(this.hud.element)

		this._unsubscribers.push(
			gameState.subscribe((state, changedKeys) => {
				if (!changedKeys.includes('selectedCharacter'))
					return
				const character = getCharacterById(
					state.selectedCharacter
				)
				this.hud.setAccentColor(
					character?.themeColor ?? null
				)
				this.hud.setReadyEnabled(
					Boolean(state.selectedCharacter)
				)
				this.infoPanel.setCharacter(character ?? null)
			})
		)
	}

	/** Currently-selected pilot id, or null. */
	getSelectedPilotId() {
		return gameState.state.selectedCharacter
	}

	dispose() {
		for (const unsub of this._unsubscribers) unsub()
		this._unsubscribers = []
		this.scene?.dispose()
		this._root.remove()
	}
}
