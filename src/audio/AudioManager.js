// public/assets/sounds only has a placeholder file right now, so rather than
// silently failing to load missing .mp3s, every effect here is synthesised
// with the Web Audio API. Swap these for real samples later without
// touching call sites — same method names, just play a buffer instead.

export class AudioManager {
	constructor() {
		this.ctx = null // created lazily on first user gesture (browser autoplay policy)
		this.masterGain = null
		this._muted = false
		this._thrustGain = null
		this._thrustOsc = null
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

	startThrusterHum() {
		this._ensureContext()
		if (this._thrustOsc) return
		const osc = this.ctx.createOscillator()
		const gain = this.ctx.createGain()
		osc.type = 'sawtooth'
		osc.frequency.value = 60
		gain.gain.value = 0
		osc.connect(gain).connect(this.masterGain)
		osc.start()
		this._thrustOsc = osc
		this._thrustGain = gain
	}

	setThrusterLevel(level01) {
		if (!this._thrustGain) return
		this._thrustGain.gain.setTargetAtTime(
			level01 * 0.05,
			this.ctx.currentTime,
			0.08
		)
	}

	stopThrusterHum() {
		if (!this._thrustOsc) return
		this._thrustOsc.stop()
		this._thrustOsc.disconnect()
		this._thrustGain.disconnect()
		this._thrustOsc = null
		this._thrustGain = null
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
}
