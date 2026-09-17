/**
 * LeaderboardScreen.js
 * Reads the top runs per level out of Firestore and renders them.
 *
 * Every state is handled explicitly, because on this project all of them
 * are reachable today: not signed in, backend unprovisioned, index not
 * deployed, and simply empty. A leaderboard that renders a blank table
 * when the composite index is missing is indistinguishable from one with
 * no scores, so the message says which it is.
 */

const BOARDS = [
	{ id: 'global', label: 'ALL LEVELS' },
	{ id: 'level_1', label: 'LEVEL 1' },
	{ id: 'level_2', label: 'LEVEL 2' },
	{ id: 'level_3', label: 'LEVEL 3' },
]

const ROW_LIMIT = 25

/** 63.4 -> "1:03.4" — a run time reads better as minutes and seconds. */
export function formatTime(seconds) {
	const total = Math.max(0, Number(seconds) || 0)
	const minutes = Math.floor(total / 60)
	const remainder = total - minutes * 60
	if (minutes === 0) return `${remainder.toFixed(1)}s`
	return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
}

export class LeaderboardScreen {
	/**
	 * @param {object} options
	 * @param {import('../services/FirebaseService.js').FirebaseService} options.backend
	 * @param {() => void} options.onBack
	 */
	constructor({ backend, onBack }) {
		this.backend = backend
		this.onBack = onBack || (() => {})
		this.activeBoard = 'global'
		this._requestId = 0

		this.screen = document.getElementById('screen-leaderboard')
		this.tabsEl = document.getElementById('lb-tabs')
		this.rowsEl = document.getElementById('lb-rows')
		this.messageEl = document.getElementById('lb-message')
		this.refreshEl = document.getElementById('lb-refresh')
		this.backEl = document.getElementById('lb-back')

		this._renderTabs()
		this.refreshEl.addEventListener('click', () => this.load())
		this.backEl.addEventListener('click', () => {
			this.hide()
			this.onBack()
		})
	}

	_renderTabs() {
		this.tabsEl.innerHTML = BOARDS.map(
			(board) =>
				`<button class="lb-tab${board.id === this.activeBoard ? ' active' : ''}" data-board="${board.id}" type="button">${board.label}</button>`
		).join('')

		for (const button of this.tabsEl.querySelectorAll('.lb-tab')) {
			button.addEventListener('click', () => {
				this.activeBoard = button.dataset.board
				this._renderTabs()
				this.load()
			})
		}
	}

	show() {
		this.screen.classList.remove('hidden')
		this.load()
	}

	hide() {
		this.screen.classList.add('hidden')
		// Abandon any in-flight read so a slow response cannot paint over
		// the screen after the player has already left it.
		this._requestId++
	}

	isVisible() {
		return !this.screen.classList.contains('hidden')
	}

	async load() {
		const requestId = ++this._requestId
		this._setMessage('Loading…')
		this.rowsEl.innerHTML = ''

		const backend = this.backend
		if (!backend) {
			this._setMessage(
				'Leaderboards are unavailable — the backend did not load.',
				true
			)
			return
		}

		const status = backend.status()
		if (!status.configured) {
			this._setMessage(
				'Leaderboards need Firebase. Copy .env.example to .env and fill in the VITE_FIREBASE_* values.',
				true
			)
			return
		}

		let rows = []
		try {
			rows = await backend.leaderboard.getTopScores(
				this.activeBoard,
				ROW_LIMIT
			)
		} catch (error) {
			if (requestId !== this._requestId) return
			this._setMessage(
				`Could not load scores: ${error?.message || error}`,
				true
			)
			return
		}

		if (requestId !== this._requestId) return

		if (rows.length === 0) {
			// getTopScores() swallows its errors and returns [], so tell the
			// player which empty this is rather than just "no scores".
			if (!status.ready) {
				this._setMessage(
					'Could not reach Firestore. Check that the database has been created for this project.',
					true
				)
			} else {
				this._setMessage(
					'No runs recorded yet. Be the first to escape the singularity.'
				)
			}
			return
		}

		this._setMessage('')
		this._renderRows(rows, status.uid)
	}

	_renderRows(rows, currentUid) {
		this.rowsEl.innerHTML = rows
			.map((row) => {
				const rank = row.rank || 0
				const isSelf =
					currentUid && row.userId === currentUid
				const classes = [
					'lb-row',
					rank <= 3 ? `lb-row-${rank}` : '',
					isSelf ? 'lb-row-self' : '',
				]
					.filter(Boolean)
					.join(' ')

				return `
				<div class="${classes}">
					<span class="lb-rank">${rank}</span>
					<span class="lb-pilot">${escapeHtml(row.displayName || 'Unknown')}</span>
					<span class="lb-score">${Number(row.score || 0).toLocaleString()}</span>
					<span class="lb-time">${formatTime(row.timeElapsed)}</span>
					<span class="lb-nitro">${Number(row.nitrogenCollected || 0)}</span>
				</div>`
			})
			.join('')
	}

	_setMessage(text, isError = false) {
		this.messageEl.textContent = text
		this.messageEl.classList.toggle('lb-message-error', isError)
		this.messageEl.classList.toggle('hidden', !text)
	}
}

/** Display names come from other players' accounts, so they are untrusted
 * input — never interpolate them into innerHTML raw. */
function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[character]
	)
}
