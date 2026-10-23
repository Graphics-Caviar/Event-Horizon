# Level 3 combat and arrival implementation

## Inspection findings

Level3 extends Level2 and already uses its pilot movement, collision, HUD, damage flash, defeat callback, and level retry flow. The inherited constructor created the Level 2 wreck, wreck effects, rover and rover guidance. CrystalPlanet already provided a separate heightfield with safe objective paths; it did not use Level 2's heightmap. MatterDimension and MatterDebris already supplied floating platforms, route beacons, core, pooled falling debris and warning rings. These working systems were retained.

Level2ToLevel3Cutscene uses CinematicShip with the anomaly manifest entry, independent of the selected player craft. It already measured hull crossing but subsequently made the ship visible at wormhole_exit and transferred it to Level3. VoidMonuments also spawned an independent hovering anomalyShip. Both appearances were removed.

VoidEnemy already had per-instance HP, ground and aerial state machines, collision avoidance, separation through Level2, procedural pose updates, hit flash, death handling, and transient health bars. Health was measured in small blade-hit units and all incoming strikes were converted into one point of player damage. An undefined this.fit also bypassed the configured model sizing.

The existing alien-flying-predator-web.glb and armored-alien-brute-web.glb were inspected directly: both contain zero skins and zero animation clips. The additional alien-predator model also contains no clips. Existing void combatants use procedural choreography, not skeletal animation.

## Implemented behavior

- The ship fades only while crossing the portal using its projected hull extent. It becomes invisible after the entire hull passes the plane. Fade materials are instance-owned and disposed normally.
- The destination camera reveals the dimension, then the pilot materializes at the established spawn. There is no ship emergence, landing, ramp or disembark sequence. Handoff and skip flows retain their existing ownership and cleanup.
- Level3 receives the cinematic environment backdrop without receiving the ship. The separate monument ship is no longer spawned.
- Level3 suppresses wreck model/effect loading, detaches the empty inherited wreck root and disables its collider. The inherited rover remains allocated for controller compatibility but is hidden, unboardable and excluded from collisions. Rover guidance is inactive; portal guidance remains available. Level 2 retains its wreck, rover, scenery and driving flow.
- Darker violet fog, violet/cyan terrain tones and inverted suspended formations reinforce the existing floating architecture, broken spans, gravity rift, debris and energy core. Existing terrain collision and objective routes remain authoritative.
- Player HP starts at 100 on each Level3 construction, including retries. The existing HUD displays HP and its maximum; the existing flash and 0.8-second invulnerability handle damage feedback. Damage is clamped at zero and uses the existing defeat/results/retry callbacks. Results use actual remaining player HP.
- Each enemy owns its HP. Nearby HUD text identifies the closest loaded living enemy within 35 units. Existing world health bars appear briefly after damage and remain hidden beyond that range.
- Blade damage is 30; rover ram damage is 75. Enemy balance lives in VOID_STYLES. Player and encounter settings can be passed through Level3's combatConfig options.

| Enemy           |  HP |  Damage | Role                                                                     |
| --------------- | --: | ------: | ------------------------------------------------------------------------ |
| Rift stalker    |  50 |       8 | Fast ground melee                                                        |
| Flying predator |  60 |      10 | Telegraph, dive, recover, orbit; 2-second cooldown                       |
| Alien brute     | 180 | 20 / 30 | Alternating basic/heavy melee, longer heavy windup and recovery cooldown |
| Void sentinel   | 180 | 20 / 30 | Existing heavy guardian                                                  |
| Void entity     |  60 |      10 | Existing ranged aerial combatant                                         |
| Void colossus   | 350 |      25 | Existing multi-phase boss                                                |
| Falling debris  |   � |      15 | Existing warning/impact event                                            |

Brute basic cooldown is 2.5 seconds, heavy cooldown 5 seconds, plus its recovery window. Enemy movement retains exponential acceleration/turning, banking, stride, windup, strike and recovery choreography. Predators now telegraph before descending and climb during the recovery portion of the dive. Ground strikes require vertical proximity; incidental rover contact no longer inflicts untelegraphed damage. Steep ground steps stop and deflect ground movement. Flyers ignore ground prop collisions when above their clearance.

Enemy defeat clears pending strikes, disables the collider and cancels remaining projectiles. Enemy health textures are disposed with the enemy. The active attack budget is checked when an enemy requests an attack state.

The existing nine roster positions remain, with one ranged entity replaced by the existing predator model and one sentinel by the existing brute model. Models activate progressively within 130 units, at least 22 units from the player, with a 0.6-second gap between load requests. At most three enemies may wind up or attack concurrently. No encounter loads during arrival or after defeat. combatConfig supports bladeDamage, playerHP, encounterRange and maxAttackers.

## Files changed for this request

- src/cutscenes/CinematicShip.js
- src/cutscenes/Level2ToLevel3Cutscene.js
- src/levels/Level2/Level2.js
- src/levels/Level3/Level3.js
- src/levels/Level3/CrystalPlanet.js
- src/levels/Level3/MatterDimension.js
- src/levels/Level3/MatterDebris.js
- src/levels/Level3/VoidEnemy.js
- src/levels/Level3/VoidMonuments.js
- src/levels/Level3/voidAssets.js
- src/levels/Level3/EnergyBlade.js
- scripts/check-level3-combat.mjs
- scripts/check-void-cutscene.mjs
- package.json
- docs/level3-combat.md

Several files already contained uncommitted contributor changes before this request. Those changes were preserved. No shared asset or source file was deleted.

## Validation and limitations

Passed: production build; focused combat regression; Level3 flight and pose checks at 30/60/120 FPS; debris and platform checks at 30/60/120 FPS; terrain mesh/collision and objective-route checks; Level2 rover, terrain, camera and disposal regression.

The cutscene integration suite exercises full journeys at 30/60/120 FPS, skip points, ownership, radio, failure, cancellation and cleanup. Its old assertions requiring a landed spacecraft were replaced with assertions requiring its absence.

No interactive browser playthrough or GPU visual capture was performed. Timing, route navigation and balancing still need human playtesting. The models have no authored animation clips, so movement uses procedural whole-body poses. The retained terrain is a continuous collision surface beneath the dimensional scenery; this change does not replace it with an islands-only traversal system. Navigation uses local collision avoidance, slope rejection and existing separation rather than a navmesh. The hidden inherited rover still allocates its normal resources until level disposal. The build retains the existing large-chunk warning.

## Suggested pull request

Title: Fix Level 3 wormhole arrival and integrate configurable alien combat

Description: Consume the anomaly ship at the wormhole boundary and replace its destination landing with pilot dimensional arrival. Remove Level 2 wreck/rover appearances and the duplicate monument spacecraft from Level 3 while preserving Level 2 gameplay. Extend the existing combat architecture with 100-HP player health, enemy-specific damage and independent HP, predator/brute encounters, progressive activation, telegraphed attacks, nearby enemy HUD feedback and shared debris damage. Preserve terrain routes, jetpack, blade, monuments and the existing defeat/retry flow.

Validation: production build, combat, flight, terrain, debris/platform and Level 2 rover checks; cutscene integration coverage. Procedural animation and human balance/visual review remain documented limitations.
