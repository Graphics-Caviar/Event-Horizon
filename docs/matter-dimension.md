# Matter Dimension integration

This revision extends the escape cinematic already present in the working tree. It preserves that work, the blade, jetpack, terrain, reactor and portal completion while expanding the playable route and combat progression. See [the existing cinematic notes](level2-level3-cinematic.md) for the route, GLB inspection, animation limitations and full camera/state-machine timeline.

## Environment and traversal

`MatterDimension` belongs to each Level 3 instance, including direct starts and retries. The Level 3 corridor now follows a bent, approximately 990-metre route to the existing rift—more than twice the former 467-metre straight-line distance. The terrain bounds expand for this route, and the terrain generator blends a walkable corridor along its bends. A dark violet background, 34 floating architecture slabs, paired cyan/violet route lights and a rotating energy core dress the route. The core accents the existing reactor site; it adds no objective or completion condition. Existing cached bridge, reactor, arena, rift and enemy GLBs remain managed by `VoidMonuments`.

The 28-enemy roster is divided into five progression-triggered encounters of 4, 5, 6, 6 and 7 enemies. Encounters unlock as the pilot advances along the route, then load enemies in staggered groups subject to nearby-enemy and attacker limits. The final wave includes the colossus. Reaching the final rift remains the existing completion condition.

The existing terrain route remains traversable by rover and on foot. Jetpack users can land on the rectangular slab tops. These are one-way character landing surfaces using the existing height-based movement system: approaching from below does not snap the player onto a platform, and walking off starts jetpack descent. These elevated surfaces do not alter the shared terrain heightmap or rover Rapier collider. They have no solid underside or side walls. The architecture bobs slowly, and standing characters follow its top height. Procedural slabs use shared geometry/materials and no shadows.

## Shared falling debris

`MatterDebris` supplies both arrival and exploration. Small decorative fragments use one dynamic instanced mesh. Medium pieces tumble and make environmental impacts without damage. Large rocks and periodic architectural sections use a fixed eight-slot pool. Analytic accelerated fall paths and angular velocities depend on elapsed seconds and stable seeds. No meshes, materials or particle buffers are allocated per frame. Dust reuses the level's existing pool. Collision uses a single horizontal radius and vertical distance test on impact, rather than creating transient Rapier rigid bodies.

Gameplay hazards use three fixed locations along the established route, chosen only while the player is within 150 units. Hazards never pursue the player. Amber rings and an existing positional charge cue warn for three seconds, followed by a 2.4-second fall. The warning radius matches the hazard footprint; damage includes the pilot's 0.9-unit radius. An impact applies one existing `_applyAlienHit` call, respects the shared damage cooldown, and cannot damage completed levels or cinematic actors. Flying more than seven units above the impact avoids it. Medium debris is harmless. Moving outside the ring avoids the hazard.

Eight animated, terrain-conforming lava pools add persistent ground hazards along the route, with volcanic rocks, rising sparks and four flickering lights. Walking into a pool applies configurable damage through `_applyAlienHit`; flight above the ground-contact threshold avoids it. Ground enemies have their targets nudged outside pool footprints. Lava damage is configured with `lavaDamagePerSecond` (8 by default) and `lavaDamageInterval` (1 second by default).

Configuration is exported as `MATTER_DEBRIS_DEFAULTS`, with constructor overrides: `fragments` (64, capped at 256), `poolSize` (8, capped at 24), `warningSeconds` (3, minimum 2.5), `fallSeconds` (2.4, minimum 1), `interval` (11, minimum 5), `damage` (1), and `radius` (5). Major pieces multiply the radius by 1.6. Pool exhaustion rejects new events instead of allocating more objects. All resources dispose with Level 3; no event listeners or timers are added.

## Arrival timeline and audio

The surface attack now includes four missiles: the original rover-disabling strike plus three companion near misses managed by `CinematicMissileSalvo`. Companion launches are staggered by 0.12, 0.3 and 0.5 seconds, with distinct curved approaches and terrain-sampled impact targets 24–62 metres to the side of the main strike. They reuse bounded missile dust/debris/shockwave effects, leave the primary warning/impact audio and camera sequence in charge, and cannot damage actors or delay escape. Skip, failure and normal teardown dispose the entire salvo. `node scripts/check-missile-salvo.mjs` verifies deterministic trajectories at 30/60/120 FPS, distinct ground targets, latched impacts, effect expiry and early cancellation.

The existing rover approach, curved missile attack, disabled rover, pilot run, hull-concealed boarding, engine startup, takeoff and geometric portal crossing remain. The four-second exit shot starts exactly three seeded debris events once; they are staggered by 0, 0.8 and 1.6 seconds, beside the central flight corridor. Their warning/fall lifetimes continue into the existing eight-second landing reveal. Cinematic events never damage the pilot. The same controller remains alive after disembark and handoff; gameplay selects warned events in the authored ground zones.

`VoidAudio` supplies its existing positional `charge` and `shock` voices through the current audio manager. Cinematic airborne fragments do not emit ground dust. The pre-existing recorded `l3.opening` dialogue, subtitles, engine/missile/portal cues and optional ElevenLabs script remain unchanged. No new recording paths or browser speech synthesis are introduced.

## Files and ownership

Added: `src/levels/Level3/MatterDimension.js`, `src/levels/Level3/MatterDebris.js`, `scripts/check-matter-debris.mjs`, and this document. Modified: `src/levels/Level3/Level3.js` for ownership, update/dispose, lighting and platform support; `src/cutscenes/Level2ToLevel3Cutscene.js` for the shared controller update and once-only arrival event hook. Other modified/untracked cinematic, Level 2, audio and documentation files existed when this task began and were retained.

Asset paths verified by the production deployment checker include `public/assets/models/void/anomaly-ship-web.glb`, `broken-bridge-web.glb`, `ancient-reactor-web.glb`, `boss-arena-web.glb`, `grav-rift-web.glb` and all current enemy/pilot/rover models. The original `anomaly-ship.glb` also exists; the existing loader uses the optimized cache alias. No binary assets were added.

## Validation and remaining review

Run `node scripts/check-matter-debris.mjs` for warning windows, single-hit impacts at 30/60/120 FPS, avoidance, shared cooldown, cinematic immunity, bounded pools, recycling, platform top/underside behavior, arrival latching and idempotent disposal. `npm run test:survival` also checks the longer route, lava contact damage, flight safety, and ground navigation. Existing checks: `npm run test:combat`, `npm run test:cutscene`, `npm run test:level2`, `npm run test:pilots`, `node scripts/check-level3.mjs`, `node scripts/check-level3-terrain.mjs`, `npm run build`, and `npm run test:deployment`.

Executed results: focused Matter checks passed, including terrain-conforming warning rings, harmless medium debris and the actual Level 3 flight method landing on platforms and returning to terrain at 30/60/120 FPS. The cinematic suite passed 403/403 checks. Rover, pilot-loading, Level 3 flight/pose/terrain, production build and deployment validation passed. The production build retains its existing large-bundle warning. PowerShell's script policy blocks `npm.ps1`; commands used `npm.cmd`. Node regression processes required normal filesystem access because sandboxed parent-directory resolution returned `EPERM`.

Browser playtesting is still required for final camera composition, warning visibility on slopes, airborne platform feel, audible mix and GPU performance. This revision does not claim a fully art-directed replacement of the established landscape, destructible architecture, rigid-body debris piles, or solid platform undersides. Large architectural debris tumbles through a controlled event; it does not remove an existing landmark. No deletion is proposed or performed.

Suggested PR title: **Connect the rover escape to a playable Matter Dimension with shared debris hazards**.

Suggested description: Extend the existing Level 2 escape cinematic into Level 3 using one bounded debris controller for deterministic arrival choreography and warned exploration hazards. Add violet/cyan architecture, jetpack landing platforms and core accents while preserving the current terrain, enemies, objectives, audio buses and completion flow. Include frame-rate, safety, pooling and lifecycle checks; retain manual visual/audio/performance review as outstanding validation.
