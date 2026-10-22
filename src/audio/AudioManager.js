// public/assets/sounds only has a placeholder file right now, so rather than
// silently failing to load missing .mp3s, every effect here is synthesised
// with the Web Audio API. Swap these for real samples later without
// touching call sites — same method names, just play a buffer instead.

/** The spaceship thruster: lighter and whinier than the rover's drive. */
const THRUSTER_PROFILE = {
	base: 52, // idle pitch of the grind layer (Hz)
	detune: 14, // cents between the two saws
	grind: 0.5, // saw-layer gain
	rumble: 0.65, // sine sub-octave gain
	air: 0.09, // noise (wind) gain at full throttle
	airTone: 900, // band-pass centre for the noise
	baseFilter: 320, // lowpass across the saws, idle
	filterRange: 1100, // ... and how far it opens at full throttle
	rev: 2.4, // pitch multiplier at full throttle
	idle: 0, // gain while ticking over
	range: 0.16, // gain added at full throttle
}

/** The rover: deeper, rougher, with more rumble under it. */
const ROVER_PROFILE = {
	base: 44,
	detune: 18,
	grind: 0.55,
	rumble: 0.9,
	air: 0.12,
	airTone: 650,
	baseFilter: 260,
	filterRange: 900,
	rev: 2.8,
	idle: 0.02,
	range: 0.13,
}

/** Launch-bay pad: one chord per bar, four bars looping. */
const HANGAR_CHORD_MS = 7200
const HANGAR_PROGRESSION = [
	[45, 57, 64, 69], // A minor
	[41, 53, 60, 65], // F major
	[48, 55, 64, 67], // C major
	[43, 50, 59, 67], // G major
]

const midiToFreq = (note) => 440 * Math.pow(2, (note - 69) / 12)

/** Channel names for the three independent volume sliders. */
export const AUDIO_CHANNELS = Object.freeze({
	MUSIC: 'music',
	SFX: 'sfx',
	DIALOGUE: 'dialogue',
})

const DEFAULT_VOLUMES = Object.freeze({
	music: 0.8,
	sfx: 0.9,
	dialogue: 1,
})

/**
 * Environmental beds, one per level. Each file is a short ElevenLabs
 * render (3-5 s), so it is turned into a seamless loop at load time (the
 * tail is crossfaded into the head) instead of being looped raw. Levels are
 * deliberately quieter than the dialogue bus: these are air, not score.
 */
export const AMBIENCE_TRACKS = Object.freeze({
	level1: Object.freeze({
		path: 'audio/ambience/level1_cockpit.mp3',
		volume: 0.34,
	}),
	level2: Object.freeze({
		path: 'audio/ambience/level2_surface.mp3',
		volume: 0.26,
	}),
	level3: Object.freeze({
		path: 'audio/ambience/level3_atmosphere.mp3',
		volume: 0.28,
	}),
})

/** Crossfade baked into each loop, so the seam is never audible. */
const AMBIENCE_LOOP_CROSSFADE = 1.1
const AMBIENCE_FADE_SECONDS = 2.4

const clampVolume = (value, fallback) => {
	const number = Number(value)
	if (!Number.isFinite(number)) return fallback
	return Math.max(0, Math.min(1, number))
}

export class AudioManager {
	constructor() {
		this.ctx = null // created lazily on first user gesture (browser autoplay policy)
		this.masterGain = null
		// Sub-buses hung off masterGain so music, effects and radio dialogue
		// have independent level controls. Everything is created with the
		// context in _ensureContext().
		this.buses = null
		this._muted = false
		this._volumes = { ...DEFAULT_VOLUMES }
		// Multiplier applied to the music bus while dialogue is transmitting.
		this._musicDuck = 1
		this._engines = new Map() // key -> live engine voice (see _startEngine)
		this._noiseBuffer = null
		this._music = null
		// Live environmental bed: { id, source, gain, volume } | null.
		this._ambience = null
		this._ambienceBuffers = new Map()
		this._ambienceRequests = new Map()
		// Bumped on every start/stop so a slow decode cannot start stale audio.
		this._ambienceToken = 0
		this._ambiencePausedId = null
	}

	_ensureContext() {
		if (!this.ctx) {
			this.ctx = new (
				window.AudioContext || window.webkitAudioContext
			)()
			this.masterGain = this.ctx.createGain()
			this.masterGain.gain.value = this._muted ? 0 : 1
			this.masterGain.connect(this.ctx.destination)
			this.buses = {
				music: this.ctx.createGain(),
				sfx: this.ctx.createGain(),
				dialogue: this.ctx.createGain(),
			}
			for (const [channel, bus] of Object.entries(
				this.buses
			)) {
				bus.gain.value = this._channelGain(channel)
				bus.connect(this.masterGain)
			}
		}
		if (this.ctx.state === 'suspended') this.ctx.resume()
	}

	/** Public wrapper: the radio layer unlocks the context on level start. */
	ensureContext() {
		this._ensureContext()
		return this.ctx
	}

	/** The bus a channel's voices should connect to (falls back to master). */
	_getBus(channel) {
		return this.buses?.[channel] || this.masterGain
	}

	_channelGain(channel) {
		const volume =
			this._volumes[channel] ?? DEFAULT_VOLUMES[channel] ?? 1
		return channel === AUDIO_CHANNELS.MUSIC
			? volume * this._musicDuck
			: volume
	}

	setMuted(muted) {
		this._muted = muted
		if (this.masterGain) {
			this.masterGain.gain.setTargetAtTime(
				muted ? 0 : 1,
				this.ctx.currentTime,
				0.05
			)
		}
	}

	isMuted() {
		return this._muted
	}

	/**
	 * Set one channel's level, 0..1. Dialogue stays intelligible when the
	 * player turns the music down; nothing here touches the mute toggle.
	 */
	setChannelVolume(channel, value) {
		if (!(channel in DEFAULT_VOLUMES)) return
		this._volumes[channel] = clampVolume(
			value,
			DEFAULT_VOLUMES[channel]
		)
		const bus = this.buses?.[channel]
		if (bus) {
			bus.gain.setTargetAtTime(
				this._channelGain(channel),
				this.ctx.currentTime,
				0.08
			)
		}
	}

	getChannelVolume(channel) {
		return this._volumes[channel] ?? DEFAULT_VOLUMES[channel] ?? 1
	}

	getChannelVolumes() {
		return { ...this._volumes }
	}

	/** Apply a settings object ({ music, sfx, dialogue }) in one pass. */
	setChannelVolumes(volumes = {}) {
		for (const channel of Object.keys(DEFAULT_VOLUMES)) {
			if (volumes[channel] === undefined) continue
			this.setChannelVolume(channel, volumes[channel])
		}
	}

	/**
	 * Duck the music under dialogue. factor 1 restores the slider level;
	 * 0.35 leaves a bed under the transmission without masking it.
	 */
	setMusicDuck(factor) {
		this._musicDuck = Math.max(
			0,
			Math.min(1, Number.isFinite(factor) ? factor : 1)
		)
		const bus = this.buses?.[AUDIO_CHANNELS.MUSIC]
		if (bus) {
			bus.gain.setTargetAtTime(
				this._channelGain(AUDIO_CHANNELS.MUSIC),
				this.ctx.currentTime,
				0.25
			)
		}
	}

	/** Shared white-noise buffer for engine air and impact texture. */
	_noise() {
		if (!this._noiseBuffer) {
			const length = Math.floor(this.ctx.sampleRate * 1.5)
			this._noiseBuffer = this.ctx.createBuffer(
				1,
				length,
				this.ctx.sampleRate
			)
			const data = this._noiseBuffer.getChannelData(0)
			for (let i = 0; i < length; i++) {
				data[i] = Math.random() * 2 - 1
			}
		}
		return this._noiseBuffer
	}

	/**
	 * Layered engine loop: two detuned saws through a lowpass give the
	 * mechanical grind, band-passed noise adds air, and a sine sub-octave
	 * supplies weight. _setEngineLevel drives gain *and* pitch together,
	 * so opening the throttle reads as a rev, not just more volume.
	 */
	_startEngine(key, profile) {
		if (this._engines.has(key)) return
		this._ensureContext()

		const out = this.ctx.createGain()
		out.gain.value = 0
		out.connect(this._getBus(AUDIO_CHANNELS.SFX))

		const grind = this.ctx.createGain()
		grind.gain.value = profile.grind
		const filter = this.ctx.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.value = profile.baseFilter
		filter.Q.value = 1.2
		grind.connect(filter).connect(out)

		const oscA = this.ctx.createOscillator()
		oscA.type = 'sawtooth'
		oscA.frequency.value = profile.base
		oscA.connect(grind)

		const oscB = this.ctx.createOscillator()
		oscB.type = 'sawtooth'
		oscB.frequency.value = profile.base * 1.02
		oscB.detune.value = profile.detune
		oscB.connect(grind)

		const sub = this.ctx.createOscillator()
		sub.type = 'sine'
		sub.frequency.value = profile.base * 0.5
		const subGain = this.ctx.createGain()
		subGain.gain.value = profile.rumble
		sub.connect(subGain).connect(out)

		const air = this.ctx.createBufferSource()
		air.buffer = this._noise()
		air.loop = true
		const airFilter = this.ctx.createBiquadFilter()
		airFilter.type = 'bandpass'
		airFilter.frequency.value = profile.airTone
		airFilter.Q.value = 0.7
		const airGain = this.ctx.createGain()
		airGain.gain.value = 0
		air.connect(airFilter).connect(airGain).connect(out)

		oscA.start()
		oscB.start()
		sub.start()
		air.start()

		this._engines.set(key, {
			profile,
			out,
			oscA,
			oscB,
			sub,
			air,
			airGain,
			filter,
		})
	}

	/** level01: 0 ticking over -> 1 full throttle. */
	_setEngineLevel(key, level01) {
		const engine = this._engines.get(key)
		if (!engine) return
		const level = Math.max(0, Math.min(1, level01))
		const now = this.ctx.currentTime
		const { profile, oscA, oscB, sub, airGain, filter, out } =
			engine
		const revs = 1 + level * profile.rev
		out.gain.setTargetAtTime(
			profile.idle + level * profile.range,
			now,
			0.09
		)
		oscA.frequency.setTargetAtTime(profile.base * revs, now, 0.07)
		oscB.frequency.setTargetAtTime(
			profile.base * 1.02 * revs,
			now,
			0.07
		)
		sub.frequency.setTargetAtTime(
			profile.base * 0.5 * revs,
			now,
			0.07
		)
		filter.frequency.setTargetAtTime(
			profile.baseFilter + level * profile.filterRange,
			now,
			0.12
		)
		airGain.gain.setTargetAtTime(level * profile.air, now, 0.15)
	}

	/** Fade fast (no click), then tear the voice down after the fade. */
	_stopEngine(key) {
		const engine = this._engines.get(key)
		if (!engine) return
		this._engines.delete(key)
		const { out, oscA, oscB, sub, air } = engine
		const stopAt = this.ctx.currentTime + 0.45
		out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06)
		for (const node of [oscA, oscB, sub, air]) node.stop(stopAt)
		setTimeout(() => out.disconnect(), 900)
	}

	startThrusterHum() {
		this._startEngine('ship', THRUSTER_PROFILE)
	}

	setThrusterLevel(level01) {
		this._setEngineLevel('ship', level01)
	}

	stopThrusterHum() {
		this._stopEngine('ship')
	}

	/** Cinematic gravity texture; same effects bus and lifecycle as engines. */
	setCinematicDrone(amount) {
		if (amount <= 0.001 && !this._engines.has('cinematicVoid'))
			return
		this._startEngine('cinematicVoid', {
			...THRUSTER_PROFILE,
			base: 27,
			detune: 7,
			grind: 0.08,
			rumble: 1,
			air: 0.025,
			airTone: 150,
			baseFilter: 95,
			filterRange: 70,
			rev: 0.15,
			idle: 0,
			range: 0.13,
		})
		this._setEngineLevel(
			'cinematicVoid',
			Math.max(0, Math.min(1, amount))
		)
	}
	stopCinematicDrone() {
		this._stopEngine('cinematicVoid')
	}

	/** The rover's drive loop (deeper and rougher than the thruster). */
	startRoverEngine() {
		this._startEngine('rover', ROVER_PROFILE)
	}

	setRoverEngineLevel(level01) {
		this._setEngineLevel('rover', level01)
	}

	stopRoverEngine() {
		this._stopEngine('rover')
	}

	/**
	 * Slow ambient pad for the launch bay. Chords are sequenced ahead on
	 * the audio clock (not on frame timing) and their long releases
	 * overlap the next chord's attack, so the loop breathes without
	 * seams. Idempotent: safe to call on every hangar show.
	 */
	startHangarMusic() {
		if (this._music) return
		this._ensureContext()
		const out = this.ctx.createGain()
		out.gain.value = 0
		out.connect(this._getBus(AUDIO_CHANNELS.MUSIC))
		this._music = { out, timer: null, step: 0 }
		out.gain.setTargetAtTime(0.55, this.ctx.currentTime, 1.6)
		this._queueHangarChord()
		this._music.timer = setInterval(
			() => this._queueHangarChord(),
			HANGAR_CHORD_MS
		)
	}

	_queueHangarChord() {
		if (!this._music) return
		const chord =
			HANGAR_PROGRESSION[
				this._music.step % HANGAR_PROGRESSION.length
			]
		this._music.step += 1
		const start = this.ctx.currentTime + 0.06
		const bar = HANGAR_CHORD_MS / 1000
		for (const note of chord) {
			this._padVoice(midiToFreq(note), start, bar)
		}
	}

	/** One soft pad note: two detuned triangles through a lowpass. */
	_padVoice(freq, start, bar) {
		const attack = 1.9
		const end = start + bar + 2.6
		const osc = this.ctx.createOscillator()
		osc.type = 'triangle'
		osc.frequency.value = freq
		const layer = this.ctx.createOscillator()
		layer.type = 'triangle'
		layer.frequency.value = freq
		layer.detune.value = 7
		const filter = this.ctx.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.value = 1200
		const gain = this.ctx.createGain()
		gain.gain.setValueAtTime(0, start)
		gain.gain.linearRampToValueAtTime(0.055, start + attack)
		gain.gain.setValueAtTime(0.055, start + bar)
		gain.gain.linearRampToValueAtTime(0, end)
		osc.connect(filter)
		layer.connect(filter)
		filter.connect(gain).connect(this._music.out)
		osc.start(start)
		layer.start(start)
		osc.stop(end + 0.05)
		layer.stop(end + 0.05)
	}

	stopHangarMusic() {
		if (!this._music) return
		clearInterval(this._music.timer)
		const { out } = this._music
		this._music = null
		out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5)
		// Let the fade finish before detaching the bus. Scheduled
		// voices stop themselves on their own release times.
		setTimeout(() => out.disconnect(), 4000)
	}

	// ---------------- environmental ambience ----------------

	/**
	 * Start (or replace) a level's ambience bed. The previous bed fades out
	 * over the same window, so level changes crossfade instead of cutting.
	 * Idempotent for the level already playing: calling it twice cannot
	 * stack two copies of the same loop.
	 *
	 * @param {'level1'|'level2'|'level3'} id
	 * @param {{fade?: number, volume?: number}} [options]
	 */
	startAmbience(id, { fade = AMBIENCE_FADE_SECONDS, volume } = {}) {
		const track = AMBIENCE_TRACKS[id]
		if (!track) {
			console.warn(`[Audio] Unknown ambience "${id}"`)
			return
		}
		this._ensureContext()
		if (this._ambience?.id === id) return

		this._ambiencePausedId = null
		const token = ++this._ambienceToken
		if (this._ambience) {
			this._fadeOutAmbience(this._ambience, fade)
			this._ambience = null
		}

		const ctx = this.ctx
		const gain = ctx.createGain()
		gain.gain.value = 0.0001
		gain.connect(this._getBus(AUDIO_CHANNELS.MUSIC))
		const bed = {
			id,
			source: null,
			gain,
			volume: volume ?? track.volume,
		}
		this._ambience = bed

		void this._loadAmbience(track.path).then((buffer) => {
			// A newer level (or a stop) owns the bed by now.
			if (!buffer || token !== this._ambienceToken) {
				if (this._ambience === bed)
					this._ambience = null
				this._disposeAmbienceNodes(bed)
				return
			}
			const loop = this._buildLoopBuffer(buffer)
			const source = ctx.createBufferSource()
			source.buffer = loop
			source.loop = true
			source.connect(gain)
			source.start()
			bed.source = source
			const now = ctx.currentTime
			gain.gain.setValueAtTime(0.0001, now)
			gain.gain.exponentialRampToValueAtTime(
				Math.max(0.0001, bed.volume),
				now + fade
			)
		})
	}

	/** Fade the bed out and release it (level exit, results, menu). */
	stopAmbience({ fade = AMBIENCE_FADE_SECONDS } = {}) {
		this._ambiencePausedId = null
		this._ambienceToken += 1
		const bed = this._ambience
		if (!bed) return
		this._ambience = null
		this._fadeOutAmbience(bed, fade)
	}

	/** True while a bed is running (not counting a fade-out). */
	isAmbiencePlaying() {
		return Boolean(this._ambience?.source)
	}

	/**
	 * Freeze the bed with the level. The loop is stopped and remembered by
	 * id; resuming starts a fresh copy with a short fade, which is
	 * inaudible for a bed and avoids leaving a silent source running.
	 */
	setAmbiencePaused(paused) {
		if (paused) {
			const bed = this._ambience
			if (!bed) return
			this._ambiencePausedId = bed.id
			this._ambience = null
			this._ambienceToken += 1
			this._fadeOutAmbience(bed, 0.4)
			return
		}
		const id = this._ambiencePausedId
		if (!id) return
		this._ambiencePausedId = null
		this.startAmbience(id, { fade: 0.9 })
	}

	_fadeOutAmbience(bed, seconds) {
		const ctx = this.ctx
		if (!ctx) return
		const fade = Math.max(0.05, seconds)
		const now = ctx.currentTime
		bed.gain.gain.cancelScheduledValues(now)
		bed.gain.gain.setValueAtTime(
			Math.max(0.0001, bed.gain.gain.value),
			now
		)
		bed.gain.gain.setTargetAtTime(0.0001, now, fade / 3)
		const stopAt = now + fade
		if (bed.source) {
			try {
				bed.source.stop(stopAt)
			} catch {
				// Already stopped.
			}
		}
		setTimeout(
			() => this._disposeAmbienceNodes(bed),
			Math.ceil((fade + 0.6) * 1000)
		)
	}

	_disposeAmbienceNodes(bed) {
		try {
			bed.source?.disconnect()
			bed.gain.disconnect()
		} catch {
			// Context already torn down.
		}
		bed.source = null
	}

	/**
	 * Blend the tail of the file into its head so a looped source has no
	 * click or gap: out[i] = head[i] * t + tail[i] * (1 - t).
	 */
	_buildLoopBuffer(buffer) {
		const fade = Math.min(
			AMBIENCE_LOOP_CROSSFADE,
			buffer.duration * 0.4
		)
		const overlap = Math.max(
			1,
			Math.floor(fade * buffer.sampleRate)
		)
		const length = Math.max(1, buffer.length - overlap)
		const loop = this.ctx.createBuffer(
			buffer.numberOfChannels,
			length,
			buffer.sampleRate
		)
		for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
			const src = buffer.getChannelData(ch)
			const dst = loop.getChannelData(ch)
			dst.set(src.subarray(0, length))
			for (let i = 0; i < overlap; i++) {
				const t = i / overlap
				dst[i] = src[i] * t + src[length + i] * (1 - t)
			}
		}
		return loop
	}

	_loadAmbience(path) {
		const url = this._resolveUrl(path)
		if (this._ambienceBuffers.has(url))
			return Promise.resolve(this._ambienceBuffers.get(url))
		const existing = this._ambienceRequests.get(url)
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
					await this.ctx.decodeAudioData(data)
				this._ambienceBuffers.set(url, buffer)
				return buffer
			} catch (error) {
				this._ambienceBuffers.set(url, null)
				console.warn(
					`[Audio] Ambience could not be loaded (${url}):`,
					error?.message || error
				)
				return null
			} finally {
				this._ambienceRequests.delete(url)
			}
		})()

		this._ambienceRequests.set(url, request)
		return request
	}

	/** Deployed-root-relative URL (works from / and from a subdirectory). */
	_resolveUrl(path) {
		const base = import.meta.env?.BASE_URL || './'
		const prefix = base.endsWith('/') ? base : `${base}/`
		return `${prefix}${path.replace(/^\.?\//, '')}`
	}

	_blip(freqStart, freqEnd, duration, type = 'sine', volume = 0.2) {
		this._ensureContext()
		const osc = this.ctx.createOscillator()
		const gain = this.ctx.createGain()
		osc.type = type
		osc.frequency.setValueAtTime(freqStart, this.ctx.currentTime)
		osc.frequency.exponentialRampToValueAtTime(
			Math.max(freqEnd, 1),
			this.ctx.currentTime + duration
		)
		gain.gain.setValueAtTime(volume, this.ctx.currentTime)
		gain.gain.exponentialRampToValueAtTime(
			0.001,
			this.ctx.currentTime + duration
		)
		osc.connect(gain).connect(this._getBus(AUDIO_CHANNELS.SFX))
		osc.start()
		osc.stop(this.ctx.currentTime + duration)
	}

	// ---------------- radio transmission texture ----------------
	// Beeps, squelch and interference share the dialogue bus, so the dialogue
	// slider also governs how loud the radio itself is.

	/** Short transmission chirp: the "key up / key down" of a radio.
	 * @param {{freq?: number, duration?: number, volume?: number,
	 *          type?: string, delay?: number}} [options] */
	playRadioTone({
		freq = 1200,
		duration = 0.07,
		volume = 0.05,
		type = 'sine',
		delay = 0,
	} = {}) {
		this._ensureContext()
		const start = this.ctx.currentTime + Math.max(0, delay)
		const end = start + duration
		const osc = this.ctx.createOscillator()
		const gain = this.ctx.createGain()
		osc.type = type
		osc.frequency.setValueAtTime(Math.max(20, freq), start)
		gain.gain.setValueAtTime(0.0001, start)
		gain.gain.exponentialRampToValueAtTime(
			Math.max(0.0002, volume),
			start + Math.min(0.012, duration * 0.3)
		)
		gain.gain.exponentialRampToValueAtTime(0.0001, end)
		osc.connect(gain).connect(this._getBus(AUDIO_CHANNELS.DIALOGUE))
		osc.start(start)
		osc.stop(end + 0.05)
	}

	/**
	 * Band-limited noise: a squelch tail or a crackle of interference.
	 * amount 0..1 scales both level and length.
	 */
	playRadioNoise(duration = 0.25, amount = 0.5, delay = 0) {
		this._ensureContext()
		const level = Math.max(0, Math.min(1, amount))
		if (level <= 0.001) return
		const start = this.ctx.currentTime + Math.max(0, delay)
		const end = start + Math.max(0.03, duration)
		const source = this.ctx.createBufferSource()
		source.buffer = this._noise()
		source.loop = true
		const filter = this.ctx.createBiquadFilter()
		filter.type = 'bandpass'
		filter.frequency.setValueAtTime(1900, start)
		filter.frequency.exponentialRampToValueAtTime(900, end)
		filter.Q.value = 1.1
		const gain = this.ctx.createGain()
		gain.gain.setValueAtTime(0.0001, start)
		gain.gain.exponentialRampToValueAtTime(
			0.004 + level * 0.075,
			start + 0.014
		)
		gain.gain.exponentialRampToValueAtTime(0.0001, end)
		source.connect(filter).connect(gain)
		gain.connect(this._getBus(AUDIO_CHANNELS.DIALOGUE))
		source.start(start)
		source.stop(end + 0.05)
	}

	playCollect() {
		this._blip(500, 1100, 0.18, 'triangle', 0.18)
	}
	playImpact() {
		this._blip(180, 40, 0.3, 'square', 0.25)
	}
	playWarning() {
		this._blip(220, 220, 0.15, 'square', 0.12)
	}
	playEscape() {
		this._blip(300, 900, 1.1, 'sine', 0.2)
	}
	playCrash() {
		this._blip(150, 20, 1.4, 'sawtooth', 0.3)
	}
	playBoost() {
		this._blip(200, 2000, 2, 'square', 0.4)
		this._blip(400, 2000, 2, 'sine', 0.4)
	}
	/** Soft boot contact through the existing effects bus. */
	playFootstep() {
		this._blip(95, 38, 0.09, 'triangle', 0.055)
	}

	/** Rover hatch: a body thud with a small latch click on top. */
	playHatch() {
		this._blip(150, 55, 0.16, 'square', 0.2)
		this._blip(950, 320, 0.06, 'triangle', 0.12)
	}
}
