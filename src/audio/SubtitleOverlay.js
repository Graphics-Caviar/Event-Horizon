/**
 * SubtitleOverlay.js
 *
 * One reusable DOM element for radio subtitles, shared by every level and by
 * the Level 1 -> Level 2 cinematic. Styling lives in public/style.css
 * (.radio-subtitles), so the element only owns content and timing.
 *
 * Layout notes:
 * - `pointer-events: none` and z-index 15 keep it out of the way of the HUD
 *   (z 10) while staying under the pause/results screens (z 20).
 * - The gameplay variant sits above Level 1's bottom-centre control hint and
 *   Level 2's movement feedback; the cinematic variant lifts higher so it
 *   clears the comic-book caption of the crash sequence.
 */

const VARIANT_CLASS = {
	gameplay: 'radio-subtitles-gameplay',
	cinematic: 'radio-subtitles-cinematic',
}

export class SubtitleOverlay {
	constructor() {
		this.enabled = true
		this.variant = 'gameplay'

		this.el = document.createElement('div')
		this.el.id = 'radio-subtitles'
		this.el.className = 'radio-subtitles hidden'
		this.el.setAttribute('role', 'status')
		this.el.setAttribute('aria-live', 'polite')
		// Screen readers get the speaker and the line as one announcement.
		this.el.setAttribute('aria-atomic', 'true')

		this.speakerEl = document.createElement('span')
		this.speakerEl.className = 'radio-subtitles-speaker'

		this.textEl = document.createElement('p')
		this.textEl.className = 'radio-subtitles-text'

		this.el.append(this.speakerEl, this.textEl)
		document.body.appendChild(this.el)
		this.setVariant('gameplay')
	}

	/** 'gameplay' keeps clear of the HUD, 'cinematic' of the comic caption. */
	setVariant(variant) {
		const next = VARIANT_CLASS[variant] ? variant : 'gameplay'
		if (this.el) {
			this.el.classList.remove(
				...Object.values(VARIANT_CLASS)
			)
			this.el.classList.add(VARIANT_CLASS[next])
		}
		this.variant = next
	}

	/** @param {{name: string, callsign?: string}} speaker */
	show(speaker, text, { urgency = 0 } = {}) {
		if (!this.enabled || !this.el) return
		this.speakerEl.textContent = speaker?.name || ''
		this.textEl.textContent = text || ''
		this.el.dataset.speaker = speaker?.id || ''
		this.el.dataset.urgency =
			urgency >= 0.75
				? 'high'
				: urgency >= 0.4
					? 'mid'
					: 'low'
		this.el.classList.remove('hidden')
	}

	hide() {
		if (!this.el) return
		this.el.classList.add('hidden')
		this.el.dataset.speaker = ''
		this.textEl.textContent = ''
	}

	/** Subtitles on/off (accessibility setting). Hides instantly when off. */
	setEnabled(enabled) {
		this.enabled = Boolean(enabled)
		if (!this.enabled) this.hide()
	}

	isVisible() {
		return Boolean(this.el && !this.el.classList.contains('hidden'))
	}

	dispose() {
		this.el?.remove()
		this.el = null
		this.speakerEl = null
		this.textEl = null
	}
}
