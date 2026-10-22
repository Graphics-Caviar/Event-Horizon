# The Call of the Void

The successful Level 2 portal objective starts this cinematic once. Defeat and exit-to-menu retain their existing behavior. The astronaut remains at the real completion position, exits the rover if necessary, and discovers and commandeers the existing alien `anomaly-ship.glb`. The craft is already parked when the rover arrives; it does not fly in as a rescue. The original player ship selection remains saved. The crashed hull remains part of the Level 2 journey.

The stolen alien craft lifts off, detects an unidentified signal, approaches a vast ancient structure, experiences gravitational interference, and enters a dedicated blue/violet wormhole. Transit is confirmed only after the whole hull clears the aperture. No boss model is revealed. Scanner messages use a restrained overlay; all beats and audio triggers run from the game update loop.

Level 3 remains the existing on-foot Void of Gods / Ashen Wastes level with its rover, jetpack, blade, monuments, terrain and nine-enemy roster. The ship lands near its normal spawn, the selected astronaut disembarks while the camera blends to the gameplay framing. The same stolen craft remains parked near the arrival point, owned by Level 3 rather than cloned or removed. The distant megastructure stays visible as a decorative backdrop owned and disposed by Level 3. The distant structure adds no objectives or colliders. The parked ship uses the existing circle-collision system to keep the astronaut from walking through its hull.

## Implementation

- `Level2ToLevel3Cutscene.js`: timeline, live surface departure, boarding, camera rig, continuous flight curve, scanner, arrival and handoff.
- `CinematicShip.js`: explicit anomaly-ship variant, measured orientation and landing bounds, loading fallback and engine lights. Its existing selected-ship mode remains available without changing the saved selection.
- `CinematicWormhole.js`: animated aperture, ring, infall motes, depth-correct hull occlusion and owned-resource cleanup.
- `VoidTransitEnvironment.js`: instanced debris/monoliths, ancient rings, existing ruin models, energy channels and concealed presence lights. No boss asset or postprocessing dependency.
- `Game.js`: success-only, exactly-once routing and stale callback guard.
- `Level2.js`: immediate input hold at completion and existing cinematic locomotion hooks.
- `Level3.js`: arrival backdrop and parked ship adoption, update and disposal.
- `AudioManager.js`: existing engine and ambience systems plus a quiet synthesized gravity drone through the effects bus.

Additional changed files are `src/audio/dialogue/radioScripts.js` (departure description), `package.json` (the cutscene test command), `scripts/check-void-cutscene.mjs`, `scripts/bundle-void-cutscene.mjs`, `scripts/void-cutscene-shims.mjs`, and this report. The superseded temporary harness and local browser-review artifacts were removed during cleanup. Permanent regression scripts live under `scripts/`; the generated bundle directory `.tmp-cutscene-test/` is ignored by Git. No game source asset was deleted.

Durations are configurable per beat using the constructor's `durations` option, with defaults in `CUTSCENE_DURATIONS`. Boarding and loading are event-driven with bounded timeouts. A blocked boarding route uses the safe skip path instead of teleporting the visible astronaut into the ship.

One Catmull-Rom flight curve and accumulated flight clock drive the space approach, followed by a bounded, continuous Bezier trajectory through the wormhole. Position follows the curve; nose orientation approaches the tangent at a bounded angular speed with banking. Camera targets follow the actors and blend independently. A matched translation of the ship, camera and structure rebases the space shot into Level 3 coordinates before descent. The same wormhole aperture is carried through the origin change, keeping its depth occlusion while the camera follows the ship into the destination. Normal playback uses the aperture and atmospheric haze rather than a black loading overlay. Skip uses a brief black cover and the same actual Level 3 construction path.

Space / Enter / Escape skip after a short startup debounce. Repeated skip is idempotent. Input remains held until ownership transfers, and no Level 3 combat or player movement update runs under the cinematic. Ambient sky and opening radio can continue.

## Existing assets

The cinematic flies `assets/models/void/anomaly-ship.glb` through the existing `VOID_ASSETS` / `loadVoidModel` cache and optimized `anomaly-ship-web.glb` mapping. It uses the actual model; the original selected spaceship is not substituted or overwritten. The model is merged and static with no authored hatch, interior or boarding animation, so boarding is staged outside the measured hull using the existing pilot gait and a ramp.

The actual selected Level 2 pilot is used for boarding; Level 3 loads the same selected character through its existing system. The structure loads only these verified manifest entries through the shared `loadVoidModel` cache:

- `assets/models/void/boss-arena.glb`
- `assets/models/void/ancient-reactor.glb`
- `assets/models/void/broken-bridge.glb`

Clones retain cache-owned geometry, materials and textures. Teardown disposes only cinematic-owned procedural resources. Late loads cannot reattach disposed actors.

Recordings:

- `audio/voice/level2_survey_ack.mp3`: existing Mission Control departure acknowledgement.
- `audio/voice/level3_intro.mp3`: existing pilot and Mission Control arrival exchange, played once.
- `audio/ambience/level2_surface.mp3`, `level1_cockpit.mp3`, `level3_atmosphere.mp3`: surface, quiet spacecraft bed and destination atmosphere through the existing crossfade API.

Engine startup, footsteps, scanner chirps, radio interference and the gravity drone use the existing Web Audio buses and settings. No nonexistent recordings are referenced. Bespoke orchestral launch/void music and a spoken signal warning are optional production additions; suitable recordings do not currently exist. The scene works without them and does not invent spoken dialogue.

## Validation

`npm run test:cutscene` bundles the real game modules with the existing esbuild dependency and runs a headless browser-IO fixture. It covers the full sequence at 30/60/120 FPS, on-foot and rover completion, recording-clock subtitles, duplicate saves/triggers, bounded movement, readiness failures, keyboard skips (including wormhole entry), cancellation, constructor failure, parked-ship ownership, unchanged ship selection and Level 3 control restoration. It does not measure GPU performance or audible mix quality.

Also run `npm run test:level2`, `npm run test:pilots`, `node scripts/check-level3.mjs`, `node scripts/check-level3-terrain.mjs`, `npm run build` and `npm run test:deployment`.

The test command recreates its generated bundle under the Git-ignored `.tmp-cutscene-test/` directory. It needs no previous temporary files. Local review pages, screenshots and browser profiles are not part of the game or commit.
