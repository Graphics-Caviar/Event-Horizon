# Escape to the Void: Level 2 → Level 3

The final Level 2 rover approach now starts a controlled missile escape. The pilot leaves the disabled rover, visibly runs to the existing alien `anomaly-ship.glb`, boards behind its static hull, and takes off through the **same surface wormhole visible during gameplay**. The sequence then shows the ship emerging over the existing Level 3 environment, landing and returning to its established on-foot gameplay. The selected player ship remains saved.

## Inspection and integration

- `Game._onLevelEnd` already guards successful Level 2 completion and persists one completed run. That routing remains the entry point; defeat, menu exit, Level 1 and retry behavior remain intact.
- `Level2` owns movement, the Rapier rover, shared collision validation, procedural pilot gait, surface portal, audio and camera. Its new approach route is enabled only for `scriptSet === 2`. `Level3` still inherits the original sites and independent `CrystalPlanet`; its objectives, jetpack, blade, monuments and nine-enemy roster are unchanged.
- The rover and all three pilot GLBs contain static geometry with **no skins or authored animation clips**. The existing `PilotWalk` GPU gait already adjusts stride length to actual distance and speed. It supplies the run, body movement and foot contact; no skeletal clips are fabricated.
- Both anomaly GLBs contain `world → geometry_0`, one primitive, one double-sided textured `PrincipledMaterial`, no skins, no animations and no separate cockpit or door. The existing orientation maps its measured nose axis to local −Z. The optimized cached model fits to approximately **9.37 × 6.01 × 18 metres**. Its material, source geometry and shared cache ownership are preserved.
- No missile asset exists in the repository. `CinematicMissileStrike` uses small procedural geometry, fixed particle buffers and instanced debris.

## Playable approach

Level 2 keeps the rover's Rapier physics and terrain-following route, while extending the actual terrain rectangle from 1100 to 2400 metres. Terrain sampling increases only for this expanded Level 2 surface; Level 3 retains its existing terrain resolution. Sites and models keep their world-space scale.

Relative to the landing site, the driving corridor runs from the rover at `(95, -55)` through `(300, 150)`, `(220, 340)`, `(420, 490)`, `(650, 420)`, `(880, 560)`, `(830, 800)`, `(1010, 900)` and ends at the hub approach `(960, 1100)`. This is approximately **1910 metres**, around **2.4 times** the previous ~790-metre route. A sequential waypoint gate prevents driving directly to the endpoint from triggering the cinematic early. The gate is at `(700, 1300)` and the ship pad is at `(1000, 1135)`. The existing guide and the missile/escape/boarding/takeoff/wormhole sequence remain in use.

The Level 2-only lava hazards occupy the initial approach, rocky passage, volcanic valley and hub approach. Animated molten pools and streams use a flowing emissive shader, ember particles, pulsing lights, bubbling surfaces and collidable volcanic rocks. Player and rover contact applies configurable periodic damage rather than frame-by-frame damage. Ground-alien spawns and movement avoid the pools; the route retains clear paths around every hazard.

Five route-triggered encounter zones contain 30 main-wave aliens, with 6 additional hub reinforcements after four hub defenders are defeated: **36 planned encounters total**. The roster uses the existing optimized flying-predator, predator and armored-brute GLBs. Regular waves cap at 8 active aliens and the hub defense at 10. Spawns are staggered and queued against that cap; encounter loaded/defeated/completed counts are tracked. Brutes have 180 HP with 20 basic / 30 heavy damage, flyers have 60 HP and 10-damage diving strikes, and ground runners have 60 HP. Their existing procedural movement now adds distinct flanking approaches and lava avoidance.

The trigger is a 24-metre radius around the final waypoint and requires the pilot to be aboard the rover and to have progressed through the preceding route waypoints. It latches once before completion; walking to the old portal position or bypassing the route cannot trigger it. The rover keeps its captured momentum during the establishing/threat shots and brakes decisively on impact through its existing rigid body, gravity and suspension.

## State machine and camera

`ROVER_APPROACH → MISSILE_DETECTED → MISSILE_IMPACT → ROVER_DISABLED → ASTRONAUT_EXIT → RUN_TO_SPACEFIGHTER → BOARD_SPACEFIGHTER → ENGINE_START → TAKEOFF → WORMHOLE_ENTRY → LEVEL3_LOADING → WORMHOLE_EXIT → ARRIVAL → DISEMBARK → HANDOFF → COMPLETE`

Runtime names use lower-case equivalents; `CUTSCENE_DURATIONS` configures the timed beats. Running, boarding, readiness and actual portal crossing also have event guards. Failed boarding or assets use bounded recovery/skip behavior.

| Beat             | Movement and framing                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approach         | Wide shot frames the rover and distant surface gate. Input listeners are removed while the live world remains visible.                                                                                                                                                                                  |
| Incoming missile | A deterministic curved dive follows the rover's predicted coast. The camera blends toward the threat and opens toward the near miss.                                                                                                                                                                    |
| Impact           | One latched impact produces dust, terrain-following fragments, a ground-conforming shockwave, a brief light and decaying deterministic camera shake. The rover brakes and loses its engine.                                                                                                             |
| Exit             | The real rover footprint supplies a grounded lateral exit. A roof/far-side composition hides the missing door/exit clip before revealing the astronaut beside the rover.                                                                                                                                |
| Run              | The camera tracks beside and behind the running pilot. Existing slope, bounds and circle collisions validate movement; measured travel drives gait, footsteps and dust. Turning and speed ease into and out of the run.                                                                                 |
| Boarding/startup | A short exterior ramp leads to the static cockpit area. The far-side hull masks the final visibility handoff. A low camera orbit accompanies engine startup.                                                                                                                                            |
| Takeoff/entry    | One distance-parameterized spline and one continuous flight clock provide lift, acceleration and bounded banking/rotation. A wide gate shot shows the entire hull entering. The original portal keeps its torus and beacon; a depth-writing aperture inside it conceals the craft at the real boundary. |
| Exit             | After all eight hull-bounds corners clear the entry plane, the existing Level 3 is constructed under held controls. A destination-side shot shows the same craft travel from behind the exit plane into view and continue forward.                                                                      |
| Landing/handoff  | The established Level 3 spawn remains the destination. The pilot disembarks, walks clear and receives the existing gameplay camera/HUD/input. The same craft remains parked, owned and disposed by Level 3.                                                                                             |

Terrain-constrained surface/arrival cameras blend position, look target and field of view with frame-independent damping. The exit shot is a motivated transition between the two environments while the departing ship is fully occluded. Normal playback uses the portal rather than a black loading overlay; skipping uses a brief cover.

Fast missile and takeoff shots track the subject with a quicker look response than camera translation so the actor stays in frame. The ship lifts with a level hull before blending pitch/bank at safe terrain clearance. Hull meshes cast and receive shadows; the existing Level 2 sunlight and shadow camera are retargeted to the escape area during the cinematic for visible ground contact.

Completed Level 2 hazards stop rolling and existing gravity storms use their normal teardown on cinematic entry. This keeps random gameplay gravity from moving the disabled rover and removes cloud volumes/telegraphs that could obscure the staged shots. Hazard behavior before completion and in the new Level 3 instance remains intact.

## Audio and subtitles

All sounds use `AudioManager` and its existing SFX/settings/ducking buses. The rover loop follows real motion until disabled. New synthesized warning, incoming missile, impact and wormhole exit cues supplement the existing footsteps, hatch, thruster startup, launch/escape and portal noise. Incoming and finite cinematic voices have explicit cancellation and normal audio-node cleanup on end. They stop on skip, failure, quit and handoff.

The existing ElevenLabs **`audio/voice/level3_intro.mp3`** (`l3.opening`) plays on arrival through `RadioDialogue`, retaining its measured recording-clock subtitles. Existing Level 2 surface/rover dialogue remains in gameplay. The calm survey acknowledgement and unrelated Level 1 failure/ejection recordings are not replayed over the missile strike. No invented audio filenames are referenced. Optional new exchanges are supplied separately in [level2-level3-dialogue-proposal.md](level2-level3-dialogue-proposal.md), ready for recording with the existing voices; they are not registered as nonexistent runtime audio.

## Ownership and performance

`Level2ToLevel3Cutscene` owns the state machine, camera, actors and arrival preparation. `CinematicMissileStrike` owns only its visual resources and impact latch; it neither damages gameplay nor schedules timers. `CinematicShip` retains the existing shared asset loader, measured bounds, fallback and late-load lock. `CinematicWormhole` retains its bounded shader/motes. `VoidTransitEnvironment` remains a decorative Level 3 arrival backdrop.

There are no new dependencies or binary assets. Missile effects use 28 exhaust points, 72 dust points, 20 instanced fragments and a short-lived ring/light; buffers are reused. Shared GLB geometry/materials/textures are never disposed by cinematic actors. Late asset promises cannot attach to disposed or appearance-locked actors. Skip and failure preserve actual Level 3 construction and exactly-once control transfer. Gameplay cannot process movement, combat or pickup input while arrival is held.

## Validation

`npm run test:cutscene` bundles real game modules using the existing esbuild dependency. It checks the route and once-only boarded trigger, deterministic missile at 30/60/120 FPS, ground-aligned visible running, geometric entry, visible exit, audio event order, skips at each stage, failures, cancellation, late assets and existing Level 3 gameplay restoration. GPU performance and the audible mix still require playtesting on target hardware.

Other repository checks are `npm run test:level2`, `npm run test:pilots`, `node scripts/check-level3.mjs`, `node scripts/check-level3-terrain.mjs`, `npm run build` and `npm run test:deployment`. The generated `.tmp-cutscene-test/` bundle and any isolated local browser review artifacts remain ignored by Git.

Results for the Level 2 route update: the bundled cutscene regression passed **437/437** checks, including the 2.4× route-length assertion, seven lava pools across four regions, configurable pilot/rover contact damage, 36 planned aliens, actual outskirts spawns, eight simultaneously loaded combatants, route-gated arrival, full-hull launch clearance, and the existing Level 3 arrival. `npm run test:level2`, `npm run test:combat`, `npm run test:survival` and `npm run build` also passed. The build retains the existing large-bundle warning. Automated tests verify route geometry and encounter activation; target-hardware gameplay/performance still needs playtesting.

Real-model browser captures were inspected for the missile, impact, running, boarding, takeoff, portal entry/exit, landing and disembark. A headless software-WebGL watchdog lost its context during an initial Level 3 capture; that white capture was rejected. Fresh captures with the watchdog disabled had a valid context and showed the actual arrival and pilot on terrain without JavaScript exceptions. These captures verify composition, not target-hardware GPU performance or an audible mix.

## Cleanup and modified files

The former discovery/ascent/signal/interference/presence/space-flight timeline, synthetic planet and separate deep-space entry path were replaced **inside** `Level2ToLevel3Cutscene.js`. The shared ship, portal, backdrop, models, animation and audio systems remain in use. No source files or shared assets have been removed, and no source-file deletion is proposed. Local generated bundles, review pages/screenshots and isolated browser profiles are the only disposable artifacts; any additional file removals will be proposed before deletion.

Files changed for the Level 2 route update (excluding pre-existing Level 3 work in the worktree):

- `src/levels/Level2/Level2.js`
- `src/levels/Level2/Level2LavaHazards.js` (new)
- `src/levels/Level2/Alien.js`
- `src/levels/Level2/AlienPlanet.js`
- `src/cutscenes/Level2ToLevel3Cutscene.js`
- `scripts/check-void-cutscene.mjs`
- `docs/level2-level3-cinematic.md`

## Pull request draft

**Title:** Extend Level 2 with lava hazards and route-based alien encounters

**Description:** Extend the traversable Level 2 rover route to approximately 2.4 times its former length, add four lava regions with configurable contact damage, and introduce five progression-based alien encounters with staggered waves and a 10-enemy hub-defense cap. Preserve the existing missile escape, boarding, takeoff and wormhole transition, and keep Level 3 gameplay unchanged.

Validation: bundled cinematic and route regression, Level 2 rover test, Level 3 combat and survival regressions, and production build.
