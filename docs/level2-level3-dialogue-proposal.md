# Optional ElevenLabs dialogue for the rover escape

These lines are a recording proposal. They are not runtime dialogue, audio
paths, or subtitles for audio that does not exist. The cutscene works without
new recordings, using synthesised effects through the existing SFX bus.

The repository's existing Level 2 recordings describe surface arrival, rover
travel, and a survey acknowledgement. None describes a missile strike or
commandeering a spacecraft. Do not reuse the Level 1 emergency/ejection audio:
it describes a different vehicle failure and an astronaut parachute escape.
Keep the existing `l3.opening` recording and its measured subtitle cues for
the Level 3 arrival, as the spacecraft emerges into the new sector.

| Event                                  | Speaker         | Proposed line                                                    |
| -------------------------------------- | --------------- | ---------------------------------------------------------------- |
| Missile detected                       | Mission Control | Horizon One, incoming! Break away from the rover!                |
| Rover disabled, astronaut exiting      | Pilot           | The rover's down. I'm moving on foot.                            |
| Astronaut sees the parked anomaly ship | Pilot           | There's an alien craft ahead. It's my only way out.              |
| Astronaut reaches the ship             | Mission Control | We're tracking you. Get aboard, and head for the anomaly.        |
| Engine start                           | Pilot           | Engines responding. Taking off now.                              |
| Ship approaches the wormhole           | Mission Control | Hold your heading. We'll try to reacquire you on the other side. |

Use the project's existing pilot and Mission Control voices and radio
processing. Deliver complete exchanges in the format already supported by
`RadioDialogue`; the current recordings contain both speakers mixed in a
single MP3. Keep the detection exchange short enough to finish before the
impact, and leave space after impact for the existing sound effects. The
pilot's rover line matches the near miss disabling the rover in this sequence.

After the actual files are supplied, measure the complete file durations and
speaker word boundaries, then register their real deployed paths and cues in
`src/audio/dialogue/radioScripts.js`. Drive subtitle timing from the decoded
audio clock through the existing `RadioDialogue` system. Do not estimate
subtitle boundaries from these written lines or assign filenames before
recordings exist. Recheck pause, skip, failed decode, and Level 3 handoff so
new radio traffic cannot outlive its scene.
