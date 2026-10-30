# Separate health and Level 3 survival

Pilot health is 100 HP; rover hull health is independently 200 HP. Both have separate damage cooldowns and HUD bars in Level 2. Driving attacks damage the rover; on-foot attacks damage the pilot. Slow-contact attacks on an unattended rover affect its hull rather than the pilot. Existing Level 2 one-point attacks are scaled to 20 HP, preserving its former five-hit pilot durability. Level 3 retains its configured enemy damage. The Level 3 rover remains hidden and disabled; its bar is hidden as well.

Destroying the required Level 2 rover fails that mission while preserving the pilot HP value. Restarting constructs fresh pilot and rover health. No additional player controller was introduced.

Level 3 starts a visible two-minute countdown when gameplay begins. Then a glowing collapse boundary moves from the landing area toward the exit over 45 seconds. Terrain behind the boundary is discarded by the terrain shader and stops supporting the pilot. Falling into the void defeats the player. The exit shelf, existing suspended platforms and new nitrogen station pads remain safe. Ground enemies caught in the collapsing terrain are defeated.

The jetpack has a nitrogen bar, starts at 100 fuel, and burns 5 units per second of thrust. Empty fuel prevents thrust while preserving descent and horizontal steering. Cyan canisters on stable pads roughly every 38 units along the route restore 45 fuel, clamped to capacity. Each canister becomes unavailable for 12 seconds after collection. Full tanks do not consume pickups. The countdown and fuel pickups pause during arrival and after defeat; retries restore them.

Hold Space to thrust, release to descend, and hold C to crouch on the ground. Crouching lowers the pilot's visual profile and walking speed. Targeted debris locks the pilot's current position when its warning appears, then does not home after the player moves. Amber rings indicate large impacts requiring movement away. Smaller cyan overhead fragments can also be avoided by crouching. Warnings last three seconds before the fall; impacts retain one-hit damage gating. Cinematic debris never damages the pilot.

Balance defaults live in `SURVIVAL_DEFAULTS` in `src/levels/Level3/MatterSurvival.js`. Level3 accepts `survivalConfig` overrides for countdown, collapseSeconds, maxFuel, burnRate, refill and respawn. Health maxima remain configurable through combatConfig.playerHP and combatConfig.roverHP. Debris settings remain in MATTER_DEBRIS_DEFAULTS.

Validation: `npm run test:survival` covers independent health/damage gates, rover destruction, countdown pause/reset, frame-independent fuel consumption, refill limits, warning target locking, dodging, crouching, collapsed ground support, stable pads and terrain shader wiring. Existing combat, flight, debris/platform, rover and cinematic regression suites are also used. Production build retains the existing large-chunk warning. GPU visuals and difficulty still require interactive playtesting.

## Visual refinement

Debris now uses irregular faceted stone or broken machinery with luminous edge seams, descent trails, closing warning brackets, impact shockwaves and pooled ejected shards. Cyan and amber danger cues retain their existing meaning and damage behavior. Visual effects recycle with each debris event.

During the last five countdown seconds, glowing fracture lines appear and the terrain vibrates slightly. Grounded camera tremors intensify before collapse and near the advancing break line. Detached irregular slabs tumble and fall away behind the boundary, with nearby dust and impact audio. A fixed pool of 192 instanced slabs bounds draw and memory costs. Pilot support changes at the same existing collapse boundary; the advance warning does not move collision or alter health.

Nitrogen pickups now have glowing cyan cores, metal end caps and fins, and counter-rotating orbital rings. They hover and bob about 4.5 units above the stable pads. Collection range is 5.5 units so a pilot with an empty tank can still collect a low-hovering cell. Landing pads, fuel capacity, burn rate, refill amounts and respawn timing remain unchanged.

Validation includes tremor timing, floating pickup accessibility, falling slab motion, bounded allocation, visible impact effects and cleanup, plus existing survival/debris/flight regression checks. GPU appearance still needs an interactive visual review.
