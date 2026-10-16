import * as THREE from 'three'

/**
 * Positional voice layer for the void warband. public/assets/sounds only
 * ships a placeholder, so — exactly like AudioManager — every effect is
 * synthesised with the Web Audio API. Each voice has a stable name so
 * real samples can be swapped in later without touching call sites:
 *
 *   idle       (loop) low mechanical breathing for the big bodies
 *   detect     short alert burst when an enemy notices the pilot
 *   step       footfall thump, pitched by body mass
 *   charge     rising wind-up that telegraphs an incoming attack
 *   attack     committed strike roar / slam
 *   bolt       energy projectile release
 *   boltHeavy  slow heavy projectile release
 *   dive       swoop whoosh for the entity's ground pass
 *   hit        impact as a strike connects
 *   stagger    hit-reaction wobble
 *   death      long collapse
 *   swing      the pilot's energy blade
 *   shock      colossus ground shockwave
 *
 * All panners feed AudioManager.masterGain, so the existing mute toggle
 * and first-gesture context creation keep working; the listener follows
 * the game camera every frame.
 */

const PANNER_REF_DISTANCE = 26
const PANNER_ROLLOFF = 1.35
const MAX_ONESHOTS = 14

const _forward = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/** One enveloped oscillator sweep. Frequencies scale with `pitch`. */
const tone = (ctx, out, { type = 'sine', from, to, dur, gain, delay = 0 }) => {
	const osc = ctx.createOscillator()
	const env = ctx.createGain()
	const start = ctx.currentTime + delay
	const end = start + dur
	osc.type = type
	osc.frequency.setValueAtTime(Math.max(1, from), start)
	osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), end)
	env.gain.setValueAtTime(0.0001, start)
	env.gain.exponentialRampToValueAtTime(
		gain,
		start + Math.min(0.03, dur * 0.2)
	)
	env.gain.exponentialRampToValueAtTime(0.0001, end)
	osc.connect(env).connect(out)
	osc.start(start)
	osc.stop(end + 0.05)
}

/** One enveloped noise sweep through a moving band-pass. */
const burst = (
	ctx,
	noise,
	out,
	{ from, to, dur, gain, q = 0.8, delay = 0 }
) => {
	const source = ctx.createBufferSource()
	source.buffer = noise
	source.loop = true
	const filter = ctx.createBiquadFilter()
	filter.type = 'bandpass'
	filter.Q.value = q
	const start = ctx.currentTime + delay
	filter.frequency.setValueAtTime(Math.max(20, from), start)
	filter.frequency.exponentialRampToValueAtTime(
		Math.max(20, to),
		start + dur
	)
	const env = ctx.createGain()
	env.gain.setValueAtTime(0.0001, start)
	env.gain.exponentialRampToValueAtTime(gain, start + 0.02)
	env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
	source.connect(filter).connect(env).connect(out)
	source.start(start)
	source.stop(start + dur + 0.05)
}

const VOICES = {
	detect: {
		duration: 0.45,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'sawtooth',
				from: 120 * pitch,
				to: 480 * pitch,
				dur: 0.3,
				gain: 0.11,
			})
			burst(ctx, noise, out, {
				from: 500,
				to: 1600,
				dur: 0.18,
				gain: 0.05,
			})
		},
	},
	step: {
		duration: 0.18,
		build: (ctx, noise, out, pitch) => {
			burst(ctx, noise, out, {
				from: 110 * pitch,
				to: 55,
				dur: 0.14,
				gain: 0.16,
				q: 0.6,
			})
			tone(ctx, out, {
				from: 70 * pitch,
				to: 40,
				dur: 0.12,
				gain: 0.1,
			})
		},
	},
	charge: {
		// Nominal duration; the caller passes the enemy's windup length so
		// the sound and the animation telegraph finish together.
		duration: 1.4,
		build: (ctx, noise, out, pitch, duration = 1) => {
			tone(ctx, out, {
				from: 70 * pitch,
				to: 290 * pitch,
				dur: duration,
				gain: 0.1,
			})
			tone(ctx, out, {
				type: 'sawtooth',
				from: 55 * pitch,
				to: 180 * pitch,
				dur: duration,
				gain: 0.05,
			})
		},
	},
	attack: {
		duration: 0.55,
		build: (ctx, noise, out, pitch) => {
			burst(ctx, noise, out, {
				from: 900 * pitch,
				to: 110,
				dur: 0.5,
				gain: 0.17,
				q: 0.5,
			})
			tone(ctx, out, {
				type: 'sawtooth',
				from: 190 * pitch,
				to: 50,
				dur: 0.45,
				gain: 0.15,
			})
		},
	},
	bolt: {
		duration: 0.25,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'square',
				from: 740 * pitch,
				to: 150 * pitch,
				dur: 0.2,
				gain: 0.09,
			})
			tone(ctx, out, {
				from: 1500 * pitch,
				to: 320 * pitch,
				dur: 0.15,
				gain: 0.06,
			})
		},
	},
	boltHeavy: {
		duration: 0.5,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'sawtooth',
				from: 330 * pitch,
				to: 65,
				dur: 0.4,
				gain: 0.13,
			})
			burst(ctx, noise, out, {
				from: 700,
				to: 90,
				dur: 0.35,
				gain: 0.09,
			})
		},
	},
	dive: {
		duration: 0.8,
		build: (ctx, noise, out, pitch) => {
			burst(ctx, noise, out, {
				from: 260,
				to: 2100 * pitch,
				dur: 0.7,
				gain: 0.1,
			})
		},
	},
	hit: {
		duration: 0.3,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'sawtooth',
				from: 130 * pitch,
				to: 52,
				dur: 0.28,
				gain: 0.15,
			})
			burst(ctx, noise, out, {
				from: 380,
				to: 120,
				dur: 0.2,
				gain: 0.08,
			})
		},
	},
	stagger: {
		duration: 0.4,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'triangle',
				from: 330 * pitch,
				to: 160 * pitch,
				dur: 0.35,
				gain: 0.09,
			})
		},
	},
	death: {
		duration: 1.8,
		build: (ctx, noise, out, pitch) => {
			tone(ctx, out, {
				type: 'sawtooth',
				from: 170 * pitch,
				to: 26,
				dur: 1.7,
				gain: 0.15,
			})
			burst(ctx, noise, out, {
				from: 800,
				to: 55,
				dur: 1.5,
				gain: 0.11,
				q: 0.5,
			})
		},
	},
	swing: {
		duration: 0.3,
		build: (ctx, noise, out) => {
			burst(ctx, noise, out, {
				from: 2300,
				to: 320,
				dur: 0.22,
				gain: 0.08,
				q: 1.4,
			})
			tone(ctx, out, {
				type: 'triangle',
				from: 900,
				to: 240,
				dur: 0.18,
				gain: 0.05,
			})
		},
	},
	shock: {
		duration: 1.2,
		build: (ctx, noise, out, pitch) => {
			burst(ctx, noise, out, {
				from: 520,
				to: 40,
				dur: 1.1,
				gain: 0.17,
				q: 0.4,
			})
			tone(ctx, out, {
				from: 62 * pitch,
				to: 24,
				dur: 1,
				gain: 0.15,
			})
		},
	},
}

export class VoidAudio {
	constructor(audio) {
		this.audio = audio
		this._loops = new Map() // id -> { panner, osc, wobble, gain }
		this._oneshots = 0
		this._noiseBuffer = null
	}

	/** Track the camera so panned voices sit correctly in the world. */
	update(camera) {
		const ctx = this.audio?.ctx
		if (!ctx) return
		const listener = ctx.listener
		const position = camera.position
		camera.getWorldDirection(_forward)
		if (listener.positionX) {
			const t = ctx.currentTime
			listener.positionX.setTargetAtTime(position.x, t, 0.03)
			listener.positionY.setTargetAtTime(position.y, t, 0.03)
			listener.positionZ.setTargetAtTime(position.z, t, 0.03)
			listener.forwardX.setTargetAtTime(_forward.x, t, 0.03)
			listener.forwardY.setTargetAtTime(_forward.y, t, 0.03)
			listener.forwardZ.setTargetAtTime(_forward.z, t, 0.03)
			listener.upX.setTargetAtTime(_up.x, t, 0.03)
			listener.upY.setTargetAtTime(_up.y, t, 0.03)
			listener.upZ.setTargetAtTime(_up.z, t, 0.03)
		} else {
			listener.setPosition(position.x, position.y, position.z)
			listener.setOrientation(
				_forward.x,
				_forward.y,
				_forward.z,
				_up.x,
				_up.y,
				_up.z
			)
		}
	}

	/** Fire-and-forget one-shot at a world position. */
	play(name, position, pitch = 1, duration) {
		const ctx = this.audio?.ctx
		if (!ctx || this._oneshots >= MAX_ONESHOTS) return
		const voice = VOICES[name]
		if (!voice) return
		const panner = this._panner(position)
		voice.build(ctx, this._noise(), panner, pitch, duration)
		this._oneshots += 1
		// Voices schedule and tear themselves down; the timer only
		// detaches the (cheap) panner once the tail has passed.
		const life = ((duration ?? voice.duration) + 0.4) * 1000
		setTimeout(() => {
			panner.disconnect()
			this._oneshots -= 1
		}, life)
	}

	_panner(position) {
		const ctx = this.audio.ctx
		const panner = ctx.createPanner()
		panner.panningModel = 'equalpower'
		panner.distanceModel = 'inverse'
		panner.refDistance = PANNER_REF_DISTANCE
		panner.rolloffFactor = PANNER_ROLLOFF
		panner.maxDistance = 600
		this._movePanner(panner, position)
		panner.connect(this.audio.masterGain)
		return panner
	}

	_movePanner(panner, position) {
		if (panner.positionX) {
			panner.positionX.value = position.x
			panner.positionY.value = position.y
			panner.positionZ.value = position.z
		} else {
			panner.setPosition(position.x, position.y, position.z)
		}
	}

	_noise() {
		const ctx = this.audio.ctx
		if (!this._noiseBuffer) {
			const length = Math.floor(ctx.sampleRate * 1.2)
			this._noiseBuffer = ctx.createBuffer(
				1,
				length,
				ctx.sampleRate
			)
			const data = this._noiseBuffer.getChannelData(0)
			for (let i = 0; i < length; i++) {
				data[i] = Math.random() * 2 - 1
			}
		}
		return this._noiseBuffer
	}

	/** Slow breathing hum for the big bodies; id-keyed, position-tracked. */
	startLoop(id, position, pitch = 1) {
		const ctx = this.audio?.ctx
		if (!ctx || this._loops.has(id)) return
		const panner = this._panner(position)
		const osc = ctx.createOscillator()
		osc.type = 'sine'
		osc.frequency.value = 44 * pitch
		const wobble = ctx.createOscillator()
		wobble.frequency.value = 0.55
		const wobbleDepth = ctx.createGain()
		wobbleDepth.gain.value = 8
		wobble.connect(wobbleDepth).connect(osc.frequency)
		const gain = ctx.createGain()
		gain.gain.value = 0.0001
		gain.gain.setTargetAtTime(0.09, ctx.currentTime, 0.8)
		osc.connect(gain).connect(panner)
		osc.start()
		wobble.start()
		this._loops.set(id, { panner, osc, wobble, gain })
	}

	moveLoop(id, position) {
		const loop = this._loops.get(id)
		if (loop) this._movePanner(loop.panner, position)
	}

	/** level01: 0 inaudible → 1 alongside the pilot. */
	setLoopLevel(id, level01) {
		const loop = this._loops.get(id)
		if (!loop) return
		loop.gain.gain.setTargetAtTime(
			Math.max(0.0001, level01 * 0.09),
			this.audio.ctx.currentTime,
			0.25
		)
	}

	stopLoop(id) {
		const loop = this._loops.get(id)
		if (!loop) return
		this._loops.delete(id)
		const { panner, osc, wobble, gain } = loop
		const ctx = this.audio.ctx
		gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15)
		const stopAt = ctx.currentTime + 0.5
		osc.stop(stopAt)
		wobble.stop(stopAt)
		setTimeout(() => panner.disconnect(), 800)
	}

	dispose() {
		for (const id of [...this._loops.keys()]) this.stopLoop(id)
	}
}
