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

export class AudioManager {
	constructor() {
		this.ctx = null // created lazily on first user gesture (browser autoplay policy)
		this.masterGain = null
		this._muted = false
		this._engines = new Map() // key -> live engine voice (see _startEngine)
		this._noiseBuffer = null
		this._music = null
	}

	_ensureContext() {
		if (!this.ctx) {
			this.ctx = new (
				window.AudioContext || window.webkitAudioContext
			)()
			this.masterGain = this.ctx.createGain()
			this.masterGain.gain.value = this._muted ? 0 : 1
			this.masterGain.connect(this.ctx.destination)
		}
		if (this.ctx.state === 'suspended') this.ctx.resume()
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
		out.connect(this.masterGain)

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
		out.connect(this.masterGain)
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
		osc.connect(gain).connect(this.masterGain)
		osc.start()
		osc.stop(this.ctx.currentTime + duration)
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
	/** Rover hatch: a body thud with a small latch click on top. */
	playHatch() {
		this._blip(150, 55, 0.16, 'square', 0.2)
		this._blip(950, 320, 0.06, 'triangle', 0.12)
	}
}
