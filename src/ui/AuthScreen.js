/**
 * AuthScreen.js
 * The pilot registry: sign in to an existing callsign, or create a new one.
 *
 * This is a thin DOM layer. Every rule about what makes a valid callsign or
 * password, and every mapping from a Firebase error code to a readable
 * message, lives in AuthService — so the same rules apply whether a call
 * comes from this form or from a script.
 *
 * The form deliberately uses a real <form> with a submit button: that gives
 * Enter-to-submit and password-manager support for free, which a div-and-
 * click-handler version would have to reimplement badly.
 */

import { validateUsername, validatePassword } from '../services/authRules.js'

export class AuthScreen {
	/**
	 * @param {object} options
	 * @param {(username: string, password: string) => Promise<{ok: boolean, error?: string}>} options.onSignIn
	 * @param {(username: string, password: string) => Promise<{ok: boolean, error?: string}>} options.onSignUp
	 * @param {() => Promise<{ok: boolean, error?: string}>} options.onGuest
	 * @param {() => void} options.onBack
	 * @param {() => void} options.onAuthenticated called after a successful sign-in/up/guest
	 */
	constructor({ onSignIn, onSignUp, onGuest, onBack, onAuthenticated }) {
		this.onSignIn = onSignIn
		this.onSignUp = onSignUp
		this.onGuest = onGuest
		this.onBack = onBack || (() => {})
		this.onAuthenticated = onAuthenticated || (() => {})

		this.mode = 'signin'
		this._busy = false

		this.screen = document.getElementById('screen-auth')
		this.form = document.getElementById('auth-form')
		this.tabSignIn = document.getElementById('auth-tab-signin')
		this.tabSignUp = document.getElementById('auth-tab-signup')
		this.usernameEl = document.getElementById('auth-username')
		this.passwordEl = document.getElementById('auth-password')
		this.confirmRow = document.getElementById('auth-confirm-row')
		this.confirmEl = document.getElementById('auth-confirm')
		this.errorEl = document.getElementById('auth-error')
		this.submitEl = document.getElementById('auth-submit')
		this.guestEl = document.getElementById('auth-guest')
		this.backEl = document.getElementById('auth-back')
		this.noticeEl = document.getElementById('auth-notice')

		this.tabSignIn.addEventListener('click', () =>
			this.setMode('signin')
		)
		this.tabSignUp.addEventListener('click', () =>
			this.setMode('signup')
		)
		this.form.addEventListener('submit', (event) => {
			event.preventDefault()
			this._submit()
		})
		this.guestEl.addEventListener('click', () => this._guest())
		this.backEl.addEventListener('click', () => {
			this.hide()
			this.onBack()
		})

		for (const input of [
			this.usernameEl,
			this.passwordEl,
			this.confirmEl,
		]) {
			input.addEventListener('input', () =>
				this._clearError()
			)
		}
	}

	setMode(mode) {
		this.mode = mode === 'signup' ? 'signup' : 'signin'
		const isSignUp = this.mode === 'signup'

		this.tabSignIn.classList.toggle('active', !isSignUp)
		this.tabSignUp.classList.toggle('active', isSignUp)
		this.confirmRow.classList.toggle('hidden', !isSignUp)
		this.submitEl.textContent = isSignUp
			? 'CREATE ACCOUNT'
			: 'SIGN IN'
		this.passwordEl.setAttribute(
			'autocomplete',
			isSignUp ? 'new-password' : 'current-password'
		)
		this.passwordEl.placeholder = isSignUp
			? 'At least 8 characters'
			: 'Your password'

		this._clearError()
		this.usernameEl.focus()
	}

	/**
	 * @param {{available: boolean, reason?: string}} backendState
	 *        When the backend is unavailable the form is disabled and the
	 *        player is pointed at the offline path instead of being left to
	 *        guess why sign-in keeps failing.
	 */
	show(backendState = { available: true }) {
		this.screen.classList.remove('hidden')
		this.setMode('signin')
		this.passwordEl.value = ''
		this.confirmEl.value = ''

		const available = backendState.available !== false
		this.submitEl.disabled = !available
		this.usernameEl.disabled = !available
		this.passwordEl.disabled = !available
		this.confirmEl.disabled = !available

		if (available) {
			this.noticeEl.classList.add('hidden')
			this.noticeEl.textContent = ''
			this.guestEl.textContent = 'Continue as guest'
		} else {
			this.noticeEl.textContent =
				backendState.reason ||
				'Accounts are unavailable right now. You can still play offline — progress is saved in this browser only.'
			this.noticeEl.classList.remove('hidden')
			this.guestEl.textContent = 'Play offline'
		}
	}

	hide() {
		this.screen.classList.add('hidden')
		this.passwordEl.value = ''
		this.confirmEl.value = ''
		this._clearError()
	}

	isVisible() {
		return !this.screen.classList.contains('hidden')
	}

	async _submit() {
		if (this._busy) return

		const username = this.usernameEl.value.trim()
		const password = this.passwordEl.value

		// Validate locally first so obvious mistakes never cost a round trip
		// (and, on sign-up, so a typo cannot create an account you did not
		// mean to create).
		const nameCheck = validateUsername(username)
		if (!nameCheck.ok) return this._showError(nameCheck.error)

		if (this.mode === 'signup') {
			const passCheck = validatePassword(password)
			if (!passCheck.ok)
				return this._showError(passCheck.error)
			if (password !== this.confirmEl.value) {
				return this._showError(
					'Passwords do not match.'
				)
			}
		} else if (!password) {
			return this._showError('Enter your password.')
		}

		this._setBusy(
			true,
			this.mode === 'signup' ? 'CREATING…' : 'SIGNING IN…'
		)
		try {
			const result =
				this.mode === 'signup'
					? await this.onSignUp(
							username,
							password
						)
					: await this.onSignIn(
							username,
							password
						)

			if (!result?.ok) {
				this._showError(
					result?.error || 'Something went wrong.'
				)
				return
			}
			this.hide()
			this.onAuthenticated(result)
		} finally {
			this._setBusy(false)
		}
	}

	async _guest() {
		if (this._busy) return
		this._setBusy(true)
		try {
			// If they typed a callsign before choosing guest, keep it for
			// display — a guest still wants a name on the scoreboard. It is
			// only a label here: no account is created for it.
			const typed = this.usernameEl.value.trim()
			const result = await this.onGuest(
				validateUsername(typed).ok ? typed : ''
			)
			if (!result?.ok) {
				this._showError(
					result?.error ||
						'Could not start a guest session.'
				)
				return
			}
			this.hide()
			this.onAuthenticated(result)
		} finally {
			this._setBusy(false)
		}
	}

	_setBusy(busy, label) {
		this._busy = busy
		this.submitEl.disabled = busy
		this.guestEl.disabled = busy
		if (busy && label) {
			this.submitEl.textContent = label
		} else if (!busy) {
			this.submitEl.textContent =
				this.mode === 'signup'
					? 'CREATE ACCOUNT'
					: 'SIGN IN'
		}
	}

	_showError(message) {
		this.errorEl.textContent = message
		this.errorEl.classList.remove('hidden')
		this.usernameEl.classList.toggle(
			'input-error',
			/callsign/i.test(message)
		)
		this.passwordEl.classList.toggle(
			'input-error',
			/password/i.test(message)
		)
	}

	_clearError() {
		this.errorEl.classList.add('hidden')
		this.errorEl.textContent = ''
		this.usernameEl.classList.remove('input-error')
		this.passwordEl.classList.remove('input-error')
	}
}
