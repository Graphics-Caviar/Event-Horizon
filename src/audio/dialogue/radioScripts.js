/*
 * radioScripts.js
 *
 * The voice script for the Horizon One <-> Mission Control loop.
 *
 * This file is DATA ONLY. Playback lives in src/audio/RadioDialogue.js, so
 * writing new traffic never means touching the audio engine: add a
 * conversation below with a stable id, reference that id from a gameplay
 * event, done.
 *
 * ── One file per conversation ───────────────────────────────────────────
 * Every recording is a COMPLETE exchange: the pilot and Mission Control are
 * already mixed onto one ElevenLabs MP3. There are no per-speaker clips and
 * nothing is split at runtime — the controller plays the file start to finish
 * and uses `cues` only to choose which subtitle is on screen.
 *
 * `start`/`end` are the measured word boundaries of each speaker turn
 * (Whisper word timestamps over the decoded file), rounded to 10 ms. The
 * final cue of each conversation ends on the file duration because the
 * transcriber extrapolates the last word's release. Text is the transcript
 * with punctuation/capitalisation cleaned up; nothing is paraphrased.
 *
 * `markers` are named instants inside a conversation that gameplay may key
 * off. They exist so a cinematic can wait for the actual spoken word instead
 * of guessing a delay: the crash sequence ejects on
 * l1.crash.emergency.markers.eject (the start of "Ejecting.").
 *
 * ── Asset names ─────────────────────────────────────────────────────────
 * Original ElevenLabs file                         -> public/audio/voice/
 *   23_06_00_Radio_..._v4.mp3  level1_intro.mp3
 *   23_11_00_Radio_..._v4.mp3  level1_warning.mp3
 *   23_12_54_Radio_..._v4.mp3  level1_critical.mp3
 *   23_14_46_Radio_..._v4.mp3  level1_ejection.mp3
 *   23_16_16_Radio_..._v4.mp3  level1_descent.mp3
 *   23_18_02_Radio_..._v4.mp3  level2_intro.mp3
 *   23_19_32_Radio_..._v4.mp3  level2_rover.mp3
 *   23_21_07_Radio_..._v4.mp3  level2_survey_ack.mp3
 *   23_23_33_Radio_..._v4.mp3  level3_intro.mp3
 *   23_25_09_Radio_..._v4.mp3  level3_activity.mp3
 *   23_27_20_Radio_..._v4.mp3  level3_complete.mp3
 *
 * Paths are relative to the deployed application root (Vite's BASE_URL is
 * prepended at runtime), so the same build works from "/" and from a LAMP
 * subdirectory.
 */

export const SPEAKERS = Object.freeze({
	pilot: Object.freeze({
		id: 'pilot',
		name: 'PILOT',
		callsign: 'HORIZON ONE',
		// Helmet mic key-up: bright chirp, lower key-down.
		beep: { freq: 1180, duration: 0.07, volume: 0.055 },
		closeBeep: { freq: 640, duration: 0.09, volume: 0.045 },
	}),
	control: Object.freeze({
		id: 'control',
		name: 'MISSION CONTROL',
		callsign: 'CONTROL',
		beep: { freq: 1560, duration: 0.06, volume: 0.05 },
		closeBeep: { freq: 470, duration: 0.11, volume: 0.05 },
	}),
})

/**
 * Radio band for recorded voice. The MP3 already contains both speakers, so
 * one band has to serve both: wide enough to keep Mission Control's low end
 * and the pilot's consonants, tight enough to sit like a downlink.
 */
export const RADIO_BAND = Object.freeze({ highpass: 150, lowpass: 5600 })

const PILOT = SPEAKERS.pilot.id
const CONTROL = SPEAKERS.control.id

export const RADIO_SCRIPTS = Object.freeze({
	// ── Level 1: the singularity run ────────────────────────────────────
	// "Mission Control, Horizon One. Beginning approach sequence. All
	// systems nominal. Over." / "Horizon One, Control. Telemetry received.
	// You're cleared to proceed. Maintain your current heading."
	'l1.opening': {
		level: 1,
		audio: 'audio/voice/level1_intro.mp3',
		duration: 12.434,
		urgency: 0.25,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 6.28,
				text: 'Mission Control, Horizon One. Beginning approach sequence. All systems nominal. Over.',
			},
			{
				speaker: CONTROL,
				start: 6.28,
				end: 12.434,
				text: "Horizon One, Control. Telemetry received. You're cleared to proceed. Maintain your current heading.",
			},
		],
	},

	// ── Level 1 -> Level 2 cinematic: the crash ─────────────────────────
	// Guidance malfunction: the pilot notices the drift, Control confirms
	// the anomaly and calls for backup guidance.
	'l1.crash.warning': {
		level: 1,
		audio: 'audio/voice/level1_warning.mp3',
		duration: 12.669,
		urgency: 0.5,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 6.66,
				text: "Control, I'm detecting abnormal fluctuations in the guidance system. Attempting to stabilize. Stand by.",
			},
			{
				speaker: CONTROL,
				start: 6.66,
				end: 12.669,
				text: "Copy, Horizon One. We're seeing the same anomalies. Switch to backup guidance and report your status.",
			},
		],
	},

	// Critical loss of control: attitude control is gone, the vehicle is
	// rolling, manual correction fails, thrusters are offline.
	'l1.crash.control': {
		level: 1,
		audio: 'audio/voice/level1_critical.mp3',
		duration: 20.506,
		urgency: 0.85,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 6.84,
				text: "Control, I've lost attitude control. The ship is rolling uncontrollably. Manual correction is not responding.",
			},
			{
				speaker: CONTROL,
				start: 6.84,
				end: 14.36,
				text: 'Horizon One, we confirm critical flight control failure. Attempt emergency recovery. Report altitude and velocity.',
			},
			{
				speaker: PILOT,
				start: 14.36,
				end: 20.506,
				text: "Negative control. Thrusters are offline. Altitude dropping rapidly. I can't recover the vehicle.",
			},
		],
	},

	// Emergency escape: Control orders the abort twice, the pilot runs the
	// countdown and ejects. `eject` is the start of the spoken word.
	'l1.crash.emergency': {
		level: 1,
		audio: 'audio/voice/level1_ejection.mp3',
		duration: 13.558,
		urgency: 0.95,
		markers: { eject: 12.66 },
		cues: [
			{
				speaker: CONTROL,
				start: 0,
				end: 6.96,
				text: 'Horizon One, abort the mission. Initiate emergency escape immediately. Repeat. Initiate emergency escape.',
			},
			{
				speaker: PILOT,
				start: 6.96,
				end: 13.558,
				text: 'Copy, Control. Initiating escape sequence. Three… two… one… Ejecting.',
			},
		],
	},

	// Descent under canopy: the pilot confirms the chute, Control's downlink
	// starts breaking up as the ship descends into the atmosphere.
	'l1.crash.chute': {
		level: 1,
		audio: 'audio/voice/level1_descent.mp3',
		duration: 15.882,
		urgency: 0.35,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 8.32,
				text: 'Control, Horizon One. Escape successful. Parachute deployed. Descending toward the surface.',
			},
			{
				speaker: CONTROL,
				start: 8.32,
				end: 15.882,
				text: 'Horizon One, your signal is breaking up. We are losing telemetry. Confirm your status. Horizon One, do you copy?',
			},
		],
	},

	// ── Level 2: surface survival ───────────────────────────────────────
	'l2.opening': {
		level: 2,
		audio: 'audio/voice/level2_intro.mp3',
		duration: 18.521,
		urgency: 0.3,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 9.02,
				text: "Mission Control, Horizon One. I'm on the surface. Escape successful. The spacecraft is gone. Attempting to determine my location.",
			},
			{
				speaker: CONTROL,
				start: 9.02,
				end: 18.521,
				text: "Horizon One, we read you. Your signal is weak, but we're receiving. First priority is assessing your surroundings and locating a stable communications point.",
			},
		],
	},

	// Boarding the rover and moving out across the surface.
	'l2.rover': {
		level: 2,
		audio: 'audio/voice/level2_rover.mp3',
		duration: 14.028,
		urgency: 0.3,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 7.6,
				text: "Control, I'm moving through the terrain now. Visibility is limited. I'll proceed carefully and report anything unusual.",
			},
			{
				speaker: CONTROL,
				start: 7.6,
				end: 14.028,
				text: 'Understood, Horizon One. Maintain awareness of your surroundings. We have limited information about this region.',
			},
		],
	},

	// Level 2 complete: Mission Control signs off the survey while the
	// pilot discovers the parked alien vessel (Level 2 -> Level 3 cinematic).
	// This is the separately recorded take of l2.rover's Control reply — its
	// first 7.16 s repeat that line verbatim, then it adds the sign-off that
	// leads into the next sector.
	'l2.transit': {
		level: 2,
		audio: 'audio/voice/level2_survey_ack.mp3',
		duration: 13.244,
		urgency: 0.25,
		cues: [
			{
				speaker: CONTROL,
				start: 0,
				end: 7.16,
				text: 'Understood, Horizon One. Maintain awareness of your surroundings. We have limited information about this region.',
			},
			{
				speaker: CONTROL,
				start: 7.16,
				end: 13.244,
				text: "Copy, Horizon One. Good work. Proceed carefully. We're still analyzing the environment ahead.",
			},
		],
	},

	// ── Level 3: the void of gods ───────────────────────────────────────
	'l3.opening': {
		level: 3,
		audio: 'audio/voice/level3_intro.mp3',
		duration: 14.211,
		urgency: 0.3,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 7.1,
				text: "Mission Control, Horizon One. I've entered the next sector. Continuing mission assessment. Standing by for instructions.",
			},
			{
				speaker: CONTROL,
				start: 7.1,
				end: 14.211,
				text: "Copy, Horizon One. We're receiving your signal. Proceed with caution and report any changes in environmental conditions.",
			},
		],
	},

	// First void construct closes in: the pilot reports activity, Control
	// orders observation instead of contact.
	'l3.activity': {
		level: 3,
		audio: 'audio/voice/level3_activity.mp3',
		duration: 12.042,
		urgency: 0.55,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 5.76,
				text: "Control, something isn't right here. I'm picking up unusual activity in the surrounding area.",
			},
			{
				speaker: CONTROL,
				start: 5.76,
				end: 12.042,
				text: 'Understood. Maintain a safe position and continue observing. Do not make unnecessary contact.',
			},
		],
	},

	// Colossus down, mission objective complete.
	'l3.complete': {
		level: 3,
		audio: 'audio/voice/level3_complete.mp3',
		duration: 11.964,
		urgency: 0.3,
		cues: [
			{
				speaker: PILOT,
				start: 0,
				end: 6.16,
				text: 'Control, Horizon One. Mission objective confirmed complete. Awaiting further instructions.',
			},
			{
				speaker: CONTROL,
				start: 6.16,
				end: 11.964,
				text: 'Excellent work, Horizon One. Telemetry received. Stand by for the next phase of the mission.',
			},
		],
	},
})

/**
 * Recordings that were verified but deliberately left out of the cue table.
 * Kept on disk so nothing is lost, never triggered by the game.
 *
 * Currently empty: level2_survey_ack.mp3 — a second take of l2.rover's
 * Control reply whose back half adds "Copy, Horizon One. Good work. Proceed
 * carefully. We're still analyzing the environment ahead." — found its
 * event in the Level 2 -> Level 3 transit cinematic and now plays as
 * 'l2.transit'.
 */
export const UNUSED_RECORDINGS = Object.freeze([])

/** Every script id whose `level` matches, in declaration order. */
export function scriptsForLevel(level) {
	return Object.entries(RADIO_SCRIPTS)
		.filter(([, script]) => script.level === level)
		.map(([id]) => id)
}

/**
 * The cue that should be on screen at `time` seconds of a conversation.
 * Boundaries belong to the cue that starts on them, so a turn change flips
 * the subtitle on the first frame of the new speaker.
 */
export function cueAt(script, time) {
	const cues = script?.cues
	if (!cues?.length) return null
	for (let i = 0; i < cues.length; i++) {
		const cue = cues[i]
		if (time >= cue.start && time < cue.end) return cue
	}
	return cues[cues.length - 1]
}
