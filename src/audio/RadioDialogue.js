import {
	RADIO_SCRIPTS,
	RADIO_BAND,
	SPEAKERS,
	cueAt,
	scriptsForLevel,
} from './dialogue/radioScripts.js'
import { SubtitleOverlay } from './SubtitleOverlay.js'

/**
 * RadioDialogue.js
 *
 * The two-way radio between Horizon One and Mission Control.
 *
 * Responsibilities
 * - play one prerecorded conversation at a time (the pilot and Control are
 *   already mixed onto a single ElevenLabs MP3 — this never splits it);
 * - keep subtitles on the spoken words by reading the file's playback
 *   position, so pauses, resumes and seeks cannot drift;
 * - own beeps, squelch, music ducking and teardown in one place, so levels
 *   only contain trigger points.
 *
 * Timing
 * - The audio clock is the source of truth: elapsed = offset + (ctx.currentTime
 *   - startedAt). Nothing accumulates frame deltas, so a slow frame or a
 *   throttled tab cannot desynchronise the subtitles. A suspended context
 *   stops ctx.currentTime, which freezes the conversation exactly where it
 *   was.
 * - update() only mirrors that clock into the subtitle overlay. Game calls it
 *   once per frame; if the loop stops the audio is paused with it by
 *   setPaused().
 *
 * Failure handling
 * - A missing or undecodable file ends the conversation immediately and logs
 *   once. There is no synthetic speech fallback: silence is better than a
 *   robot pretending to be the pilot.
 * - Autoplay policy: the context is created/resumed on the same user gesture
 *   that started the level (AudioManager.ensureContext). If it is still
 *   suspended when a conversation is cued, the start is deferred to update()
 *   until the context is running; nothing runs ahead of the audio.
 */

/** Short gain ramps so starting/stopping a file never clicks. */
const FADE_SECONDS = 0.06
const MUSIC_DUCK = 0.35

/** Deployed-root-relative clip URL (works from / and from a subdirectory). */
export function resolveVoiceUrl(path) {
	if (!path) return null
	const base = import.meta.env?.BASE_URL || './'
	const prefix = base.endsWith('/') ? base : `${base}/`
	return `${prefix}${path.replace(/^\.?\//, '')}`
}

export class RadioDialogue {
	/**
	 * @param {import('./AudioManager.js').AudioManager} audio
	 * @param {{subtitles?: boolean}} [options]
	 */
	constructor(audio, { subtitles = true } = {}) {
		this.audio = audio
		this.subtitles = new SubtitleOverlay()
		this.subtitles.setEnabled(subtitles)

		this._level = 0
		// Conversations already accepted in this level run (one-shot guard).
		this._played = new Set()
		this._conversation = null
		this._paused = false
		this._ducked = false

		// Decoded recordings, keyed by resolved URL. null = known bad file.
		this._buffers = new Map()
		this._requests = new Map()

		this._handleVisibility = () => {
			// A hidden tab freezes the game loop; without this the radio
			// would keep talking to an empty room.
			if (document.hidden) this.setPaused(true)
		}
		document.addEventListener(
			'visibilitychange',
			this._handleVisibility
		)
	}

	// ---------------- level lifecycle ----------------

	/**
	 * Reset for a new level: cut any traffic still in flight, forget what
	 * already played (so a restart replays the intro) and decode that
	 * level's recordings in the background.
	 */
	beginLevel(level) {
		this.stop()
		this._level = Number(level) || 0
		this._played.clear()
		this.subtitles.setVariant('gameplay')
		this._prefetchLevel(this._level)
	}

	/** Cinematic audio gaps: the crash sequence lifts subtitles over captions. */
	setCinematic(cinematic) {
		this.subtitles.setVariant(cinematic ? 'cinematic' : 'gameplay')
	}

	// ---------------- playback ----------------

	/**
	 * Start a conversation.
	 *
	 * @param {string} scriptId key in RADIO_SCRIPTS
	 * @param {{interrupt?: boolean}} [options] interrupt cuts whatever is on
	 *        air so a stage pinned to a real event starts on that event.
	 *        Without it, a cue that arrives while the radio is busy is
	 *        dropped (not queued): a whole conversation playing minutes late
	 *        is worse than one skipped beat.
	 * @returns {boolean} true when the conversation was accepted
	 */
	play(scriptId, { interrupt = false } = {}) {
		// Levels that have no cue for a given beat pass null; that is not an
		// error, it just means silence.
		if (!scriptId) return false
		const script = RADIO_SCRIPTS[scriptId]
		if (!script) {
			console.warn(`[Radio] Unknown script "${scriptId}"`)
			return false
		}
		if (this._played.has(scriptId)) return false
		if (this._conversation) {
			if (!interrupt) return false
			this._stopConversation({ keyDown: false })
		}
		const ctx = this.audio?.ensureContext?.()
		if (!ctx) return false

		this._played.add(scriptId)
		const state = {
			id: scriptId,
			script,
			url: resolveVoiceUrl(script.audio),
			buffer: null,
			source: null,
			chain: null,
			offset: 0,
			startedAt: 0,
			started: false,
			pending: false,
			cueKey: null,
		}
		this._conversation = state
		this._duckMusic()
		this._keyUp(script.cues?.[0]?.speaker)
		void this._load(state)
		return true
	}

	/** Hard stop: level exit, skip and teardown. */
	stop() {
		this._stopConversation({ keyDown: true })
		this._paused = false
		this.subtitles.hide()
		this._unduckMusic()
	}

	/** Skip the rest of the current conversation. */
	skip() {
		this.stop()
	}

	/**
	 * Freeze/resume with the level. The file is actually stopped and
	 * restarted from the stored offset, so no audio is lost behind a pause
	 * overlay and the subtitle stays on the line it was reading.
	 */
	setPaused(paused) {
		const next = Boolean(paused)
		if (next === this._paused) return
		this._paused = next
		const state = this._conversation
		if (!state) return
		if (next) {
			state.offset = this._playbackTime(state)
			this._suspendSource(state)
		} else if (state.buffer) {
			this._startSource(state, state.offset)
		}
	}

	isPlaying() {
		return Boolean(this._conversation)
	}

	/** Id of the conversation on air, or null. */
	get currentId() {
		return this._conversation?.id || null
	}

	/** Seconds of the current conversation already played (0 when idle). */
	get playbackTime() {
		return this._playbackTime(this._conversation)
	}

	/**
	 * True once the conversation has passed a named marker (see
	 * radioScripts `markers`). A conversation that already finished counts
	 * as past every marker, so a cinematic can never wait forever.
	 */
	hasReachedMarker(scriptId, marker) {
		const state = this._conversation
		if (!state || state.id !== scriptId) {
			return this._played.has(scriptId)
		}
		const at = state.script.markers?.[marker]
		if (at === undefined) return false
		return this._playbackTime(state) >= at
	}

	setSubtitlesEnabled(enabled) {
		this.subtitles.setEnabled(enabled)
		// Turning subtitles back on mid-conversation should not wait for the
		// next speaker turn.
		const state = this._conversation
		if (enabled && state) {
			state.cueKey = null
			this._syncSubtitle(state)
		}
	}

	// ---------------- frame step ----------------

	update() {
		const state = this._conversation
		if (!state || this._paused) return
		if (state.pending) {
			// Listening for the context to leave 'suspended' (autoplay).
			if (this.audio?.ctx?.state === 'running') {
				this._startSource(state, state.offset)
			}
			return
		}
		this._syncSubtitle(state)
	}

	// ---------------- conversation machinery ----------------

	async _load(state) {
		const buffer = await this._loadBuffer(state.url)
		// Superseded by a newer conversation (or stopped) while decoding.
		if (this._conversation !== state) return
		if (!buffer) {
			console.warn(
				`[Radio] "${state.id}" could not be played (${state.url}); skipping it.`
			)
			this._stopConversation({ keyDown: false })
			this.subtitles.hide()
			this._unduckMusic()
			return
		}
		state.buffer = buffer
		this._syncSubtitle(state)
		this._startSource(state, 0)
	}

	_startSource(state, offset) {
		if (this._paused || !state.buffer) {
			state.pending = true
			return
		}
		const ctx = this.audio?.ctx
		if (!ctx) return
		if (ctx.state !== 'running') {
			// Autoplay policy. Retried from update() once the context runs,
			// which the next user gesture triggers.
			state.pending = true
			void ctx.resume?.().catch(() => {})
			return
		}
		const duration = state.buffer.duration
		const at = Math.max(
			0,
			Math.min(offset, Math.max(0, duration - 0.02))
		)
		if (at >= duration - 0.02) {
			this._stopConversation({ keyDown: true })
			this.subtitles.hide()
			this._unduckMusic()
			return
		}

		const source = ctx.createBufferSource()
		source.buffer = state.buffer
		const highpass = ctx.createBiquadFilter()
		highpass.type = 'highpass'
		highpass.frequency.value = RADIO_BAND.highpass
		const lowpass = ctx.createBiquadFilter()
		lowpass.type = 'lowpass'
		lowpass.frequency.value = RADIO_BAND.lowpass
		const gain = ctx.createGain()
		gain.gain.setValueAtTime(0.0001, ctx.currentTime)
		gain.gain.exponentialRampToValueAtTime(
			1,
			ctx.currentTime + FADE_SECONDS
		)
		source.connect(highpass).connect(lowpass).connect(gain)
		const bus =
			this.audio?.buses?.dialogue || this.audio?.masterGain
		if (!bus) return
		gain.connect(bus)

		source.onended = () => {
			// Fires for a natural end and for our own stop(); only the
			// natural end still owns the state slot.
			if (state.source !== source) return
			state.source = null
			this._finish(state)
		}

		source.start(0, at)
		state.source = source
		state.chain = { source, highpass, lowpass, gain }
		state.offset = at
		state.startedAt = ctx.currentTime
		state.started = true
		state.pending = false
		this._syncSubtitle(state, true)
	}

	/** Natural end of the file: key down, restore music, clear the slot. */
	_finish(state) {
		if (this._conversation !== state) return
		this._conversation = null
		const last = state.script.cues?.[state.script.cues.length - 1]
		this._keyDown(last?.speaker)
		this.subtitles.hide()
		this._unduckMusic()
		this._disconnectChain(state)
	}

	_stopConversation({ keyDown }) {
		const state = this._conversation
		if (!state) return
		this._conversation = null
		this._releaseSource(state)
		this._disconnectChain(state)
		if (keyDown) {
			const last =
				state.script.cues?.[
					state.script.cues.length - 1
				]
			this._keyDown(last?.speaker)
		}
	}

	_releaseSource(state) {
		const source = state.source
		if (!source) return
		// Cleared first so the onended handler treats this as our stop.
		state.source = null
		try {
			source.stop()
		} catch {
			// Already ended on its own; nothing to do.
		}
	}

	/**
	 * Pause: fade the clip out, stop it, then drop its node chain. A bare
	 * stop() clicks, and the chain would otherwise stay connected to the
	 * dialogue bus for the rest of the run.
	 */
	_suspendSource(state) {
		const source = state.source
		const chain = state.chain
		state.source = null
		state.chain = null
		state.started = false
		if (!source || !chain) return
		const now = this.audio?.ctx?.currentTime ?? 0
		try {
			const gain = chain.gain.gain
			gain.cancelScheduledValues(now)
			gain.setValueAtTime(Math.max(gain.value, 0.0001), now)
			gain.exponentialRampToValueAtTime(
				0.0001,
				now + FADE_SECONDS
			)
			// Detach only once the fade has finished, so the tail is kept.
			source.onended = () => this._disconnectNodes(chain)
			source.stop(now + FADE_SECONDS)
		} catch {
			this._disconnectNodes(chain)
		}
	}

	_disconnectChain(state) {
		const chain = state.chain
		if (!chain) return
		state.chain = null
		chain.source.onended = null
		this._disconnectNodes(chain)
	}

	_disconnectNodes(chain) {
		try {
			chain.source.disconnect()
			chain.highpass.disconnect()
			chain.lowpass.disconnect()
			chain.gain.disconnect()
		} catch {
			// Nodes already detached by the context teardown.
		}
	}

	/** Seconds of this conversation played so far. */
	_playbackTime(state) {
		if (!state) return 0
		const ctx = this.audio?.ctx
		if (!state.started || !state.source || !ctx) return state.offset
		const elapsed = ctx.currentTime - state.startedAt
		const duration =
			state.buffer?.duration ?? Number.POSITIVE_INFINITY
		return Math.min(state.offset + Math.max(0, elapsed), duration)
	}

	/** Mirror the audio clock into the subtitle overlay (once per turn). */
	_syncSubtitle(state, force = false) {
		const cue = cueAt(state.script, this._playbackTime(state))
		const key = cue ? String(cue.start) : null
		if (!force && key === state.cueKey) return
		state.cueKey = key
		if (!cue) {
			this.subtitles.hide()
			return
		}
		const speaker = SPEAKERS[cue.speaker] || SPEAKERS.pilot
		this.subtitles.show(speaker, cue.text, {
			urgency: state.script.urgency ?? 0.35,
		})
	}

	// ---------------- radio texture ----------------

	_keyUp(speakerId) {
		const speaker = SPEAKERS[speakerId] || SPEAKERS.pilot
		this.audio?.playRadioTone?.(speaker.beep)
		this.audio?.playRadioNoise?.(0.16, 0.25)
	}

	_keyDown(speakerId) {
		const speaker = SPEAKERS[speakerId] || SPEAKERS.pilot
		this.audio?.playRadioTone?.(speaker.closeBeep)
		this.audio?.playRadioNoise?.(0.2, 0.2)
	}

	// ---------------- decoding ----------------

	/**
	 * Decode every recording this level can play, once, in the background.
	 * Missing files resolve to null and stay null, so a build without a
	 * recording pays one 404 and then stays quiet for that beat.
	 */
	_prefetchLevel(level) {
		const ctx = this.audio?.ensureContext?.()
		if (!ctx) return
		for (const scriptId of scriptsForLevel(level)) {
			const script = RADIO_SCRIPTS[scriptId]
			if (!script.audio) continue
			void this._loadBuffer(resolveVoiceUrl(script.audio))
		}
	}

	_loadBuffer(url) {
		if (!url) return Promise.resolve(null)
		if (this._buffers.has(url))
			return Promise.resolve(this._buffers.get(url))
		const existing = this._requests.get(url)
		if (existing) return existing

		const request = (async () => {
			try {
				const response = await fetch(url)
				if (!response.ok)
					throw new Error(
						`HTTP ${response.status}`
					)
				const data = await response.arrayBuffer()
				const buffer =
					await this.audio.ctx.decodeAudioData(
						data
					)
				this._buffers.set(url, buffer)
				return buffer
			} catch (error) {
				this._buffers.set(url, null)
				console.warn(
					`[Radio] Could not decode ${url}:`,
					error?.message || error
				)
				return null
			} finally {
				this._requests.delete(url)
			}
		})()

		this._requests.set(url, request)
		return request
	}

	// ---------------- music ducking ----------------

	_duckMusic() {
		if (this._ducked) return
		this._ducked = true
		this.audio?.setMusicDuck?.(MUSIC_DUCK)
	}

	_unduckMusic() {
		if (!this._ducked) return
		this._ducked = false
		this.audio?.setMusicDuck?.(1)
	}

	dispose() {
		document.removeEventListener(
			'visibilitychange',
			this._handleVisibility
		)
		this.stop()
		this._buffers.clear()
		this._requests.clear()
		this.subtitles.dispose()
		this.audio = null
	}
}
