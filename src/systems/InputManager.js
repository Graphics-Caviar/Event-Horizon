/**
 * InputManager — reusable keyboard state tracker. Takes a keyMap
 * (physical key -> logical action name) so the same class serves ship
 * controls, character controls, or a remapped scheme (e.g. Level 2's
 * gravity-shift control swap) without rewriting listener code.
 */
export class InputManager {
	constructor(keyMap = InputManager.DEFAULT_KEY_MAP) {
		this.keyMap = keyMap
		this._down = new Set()
		this._justPressed = new Set() // cleared every endFrame() call

		this._onKeyDown = (e) => {
			const action = this.keyMap[e.code]
			if (!action) return
			if (!this._down.has(action))
				this._justPressed.add(action)
			this._down.add(action)
		}
		this._onKeyUp = (e) => {
			const action = this.keyMap[e.code]
			if (action) this._down.delete(action)
		}
		this._onBlur = () => this._down.clear()

		window.addEventListener('keydown', this._onKeyDown)
		window.addEventListener('keyup', this._onKeyUp)
		window.addEventListener('blur', this._onBlur)
	}

	setKeyMap(keyMap) {
		this.keyMap = keyMap
		this._down.clear()
	}

	isDown(action) {
		return this._down.has(action)
	}

	/** True once, the frame an action key was first pressed — use for
	 * one-shot triggers like abilities/jump rather than held movement. */
	wasJustPressed(action) {
		return this._justPressed.has(action)
	}

	/** Call once per frame, after reading wasJustPressed() for every
	 * action you care about, to clear the one-shot flags. */
	endFrame() {
		this._justPressed.clear()
	}

	dispose() {
		window.removeEventListener('keydown', this._onKeyDown)
		window.removeEventListener('keyup', this._onKeyUp)
		window.removeEventListener('blur', this._onBlur)
	}
}

InputManager.DEFAULT_KEY_MAP = {
	KeyW: 'forward',
	ArrowUp: 'forward',
	KeyS: 'backward',
	ArrowDown: 'backward',
	KeyA: 'left',
	ArrowLeft: 'left',
	KeyD: 'right',
	ArrowRight: 'right',
	ShiftLeft: 'run',
	ShiftRight: 'run',
	Space: 'jump',
	KeyE: 'ability',
	Digit1: 'select1',
	Digit2: 'select2',
	Digit3: 'select3',
	Tab: 'toggleMode',
}
