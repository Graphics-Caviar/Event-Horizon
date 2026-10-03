/**
 * LevelScreens.js
 * The two overlays shown on top of a running level: PAUSED and the
 * end-of-run results. Pure DOM — Game decides what each button does.
 */

const OUTCOMES = {
	escaped: {
		title: 'ESCAPED',
		subtitle: 'You broke free of the singularity. For now.',
		tone: 'good',
	},
	captured: {
		title: 'LOST TO THE SINGULARITY',
		subtitle: 'The pull was too strong. Keep thrusting away from the hole.',
		tone: 'bad',
	},
	destroyed: {
		title: 'HULL DESTROYED',
		subtitle: 'The asteroid field tore you apart. Steer around the rocks.',
		tone: 'bad',
	},
}

/** 63.4 -> "1:03.4" */
function formatTime(seconds) {
	const total = Math.max(0, Number(seconds) || 0)
	const minutes = Math.floor(total / 60)
	const rest = (total - minutes * 60).toFixed(1).padStart(4, '0')
	return `${minutes}:${rest}`
}

export class LevelScreens {
	/**
	 * @param {object} actions
	 * @param {() => void} actions.onResume
	 * @param {() => void} actions.onRestart
	 * @param {() => void} actions.onQuit
	 */
	constructor({ onResume, onRestart, onQuit }) {
		this.pauseEl = document.getElementById('screen-pause')
		this.resultsEl = document.getElementById('screen-results')

		this.titleEl = document.getElementById('results-title')
		this.subtitleEl = document.getElementById('results-subtitle')
		this.scoreEl = document.getElementById('results-score')
		this.timeEl = document.getElementById('results-time')
		this.hullEl = document.getElementById('results-hull')
		this.distanceEl = document.getElementById('results-distance')
		this.noteEl = document.getElementById('results-note')
		this.retryBtn = document.getElementById('btn-results-retry')
		this.resumeBtn = document.getElementById('btn-pause-resume')

		const bind = (id, handler) =>
			document
				.getElementById(id)
				.addEventListener('click', () => handler?.())

		bind('btn-pause-resume', onResume)
		bind('btn-pause-restart', onRestart)
		bind('btn-pause-quit', onQuit)
		bind('btn-results-retry', onRestart)
		bind('btn-results-menu', onQuit)
	}

	showPause() {
		this.pauseEl.classList.remove('hidden')
		this.resumeBtn.focus()
	}

	hidePause() {
		this.pauseEl.classList.add('hidden')
	}

	/**
	 * @param {{outcome: string, score: number, time: number, hull: number,
	 *          progress: number}} result
	 * @param {{text: string, tone?: string}} [note]
	 */
	showResults(result, note) {
		const copy = OUTCOMES[result.outcome] || OUTCOMES.destroyed
		this.titleEl.textContent = copy.title
		this.titleEl.dataset.tone = copy.tone
		this.subtitleEl.textContent = copy.subtitle
		this.scoreEl.textContent = Math.round(
			result.score
		).toLocaleString()
		this.timeEl.textContent = formatTime(result.time)
		this.hullEl.textContent = `${Math.max(0, Math.round(result.hull))}%`
		this.distanceEl.textContent = `${Math.round(
			Math.max(0, Math.min(1, result.progress)) * 100
		)}%`
		this.setNote(note)

		this.hidePause()
		this.resultsEl.classList.remove('hidden')
		// Enter / Space flies again without reaching for the mouse.
		this.retryBtn.focus()
	}

	/** Update the leaderboard/unlock line once the backend has answered. */
	setNote(note) {
		this.noteEl.textContent = note?.text || ''
		this.noteEl.dataset.tone = note?.tone || 'muted'
		this.noteEl.classList.toggle('hidden', !note?.text)
	}

	hideAll() {
		this.pauseEl.classList.add('hidden')
		this.resultsEl.classList.add('hidden')
	}
}
