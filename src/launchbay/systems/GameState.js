/**
 * src/systems/GameState.js
 *
 * The single mutable source of truth for cross-cutting app state:
 *   - selectedCharacter : string|null   id of the currently selected pilot
 *   - currentScene       : 'character-select' | 'launch-bay'
 *   - isLoading          : boolean      true while assets/scene are initializing
 *   - isReady            : boolean      true once a character is selected
 *
 * Deliberately framework-free: a tiny pub/sub so both the Three.js side
 * (CameraSystem, CharacterSystem) and the DOM/UI side (HUD, ReadyButton)
 * can react to the same state without importing each other directly.
 *
 * Usage:
 *   import { gameState } from '../systems/GameState.js';
 *   gameState.subscribe((state, changedKeys) => { ... });
 *   gameState.set({ selectedCharacter: 'zara' });
 */

const DEFAULT_STATE = {
	selectedCharacter: null,
	currentScene: 'character-select',
	isLoading: true,
	isReady: false,
}

class GameState {
	constructor(initial = DEFAULT_STATE) {
		this._state = { ...initial }
		this._listeners = new Set()
	}

	get state() {
		return this._state
	}

	/** Read a single field. */
	get(key) {
		return this._state[key]
	}

	/**
	 * Shallow-merge a patch into state and notify listeners with the
	 * resulting state plus the list of keys that actually changed value.
	 */
	set(patch) {
		const changedKeys = Object.keys(patch).filter(
			(key) => this._state[key] !== patch[key]
		)

		if (changedKeys.length === 0) return

		this._state = { ...this._state, ...patch }
		for (const listener of this._listeners) {
			listener(this._state, changedKeys)
		}
	}

	/** Subscribe to state changes. Returns an unsubscribe function. */
	subscribe(listener) {
		this._listeners.add(listener)
		return () => this._listeners.delete(listener)
	}

	reset() {
		this.set({ ...DEFAULT_STATE })
	}
}

// Singleton — the whole app shares one GameState instance.
export const gameState = new GameState()
