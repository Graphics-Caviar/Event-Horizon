# Event Horizon: Escape from Singularity

A browser-based 3D action game built with **Three.js** and **Vite**, developed for the Computer Graphics & Visualization assignment.

> Pulled through a black hole into deep space, you must fight its ever-strengthening grip across three worlds — an asteroid field, a hostile alien planet, and the mind of the cosmic entity known as **The Devourer** — to finally escape the singularity.

---

## Table of Contents

1. [Game Overview](#game-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Level Design Summary](#level-design-summary)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Controls](#controls)
7. [Getting Started](#getting-started)
8. [Asset Conventions](#asset-conventions)

---

## Game Overview

- **Genre:** 3D action / survival with vehicle and platforming segments
- **Perspective:** Third-person
- **Core loop:** Survive escalating hazards → collect Nitrogen energy → progress through the level → face a set-piece finale
- **Objective:** Escape the black hole's gravitational pull across 3 levels and destroy The Devourer

| Level | Name | Setting | Signature Mechanic |
|-------|------|---------|--------------------|
| 1 | The Singularity Run | Damaged spaceship in an asteroid field near the black hole | Black hole gravity pull that strengthens over time |
| 2 | Alien Planet Exodus | Hostile alien planet (on foot → rover) | Gravity manipulation that **remaps player controls** |
| 3 | The Void of Gods | Inside the mind of The Devourer | **Reality Shift** — switching between Matter/Energy/Void dimensions |

---

## Tech Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Rendering | [Three.js](https://threejs.org/) (ES modules) | WebGL renderer, scene graph, materials, lighting |
| Build tooling | [Vite](https://vitejs.dev/) | Dev server with hot reload; `npm run dev`, `npm run build` |
| Language | Vanilla JavaScript (ES2020+ modules) | No framework required |
| Physics | Custom (`src/physics/`) | Lightweight, purpose-built forces/collisions — no heavy physics engine needed |
| Audio | Web Audio API via `AudioManager.js` | SFX + ambient loops |
| Assets | `public/assets/` | GLTF models, textures, sounds loaded by `AssetManager.js` |

---

## Project Structure

```
Event-Horizon/
├── Event Horizon-Escape from Singularity.pdf   # Original design document
├── index.html                                  # (P0) Vite entry page, HUD overlay root
├── package.json                                # (P0) Three.js + Vite dependencies/scripts
├── public/
│   └── assets/
│       ├── images/                             # Skyboxes, UI art, sprites
│       ├── models/
│       │   ├── asteroids/                      # Asteroid meshes (Level 1)
│       │   ├── aliens/                         # Alien creature models (Level 2)
│       │   ├── boss/                           # The Devourer + anchors (Level 3)
│       │   ├── player/                         # On-foot character model (Level 2)
│       │   ├── rover/                          # Rover vehicle model (Level 2)
│       │   └── spaceship/                      # Spaceship model (Level 1)
│       ├── sounds/                             # SFX + music
│       └── textures/                           # Materials/surfaces
└── src/
    ├── main.js                                 # Entry point — boots the Game instance
    ├── core/
    │   ├── Game.js                             # Renderer, master update/render loop
    │   ├── SceneManager.js                     # Scene registration & transitions per level/state
    │   ├── GameState.js                        # Global state machine (menu, playing, paused, win/lose)
    │   └── AssetManager.js                     # Async GLTF/texture/audio loading + cache
    ├── physics/
    │   ├── Gravity.js                          # Radial attraction force (black hole, anchors, void zones)
    │   ├── Movement.js                         # Velocity/acceleration integration helpers
    │   └── Collision.js                        # Sphere/AABB broad-phase collision checks
    ├── player/
    │   ├── PlayerController.js                 # Keyboard input abstraction w/ REMAPPABLE bindings
    │   ├── Player.js                           # Shared health/status container used by both forms
    │   ├── Spaceship.js                        # L1 flight model (thrust, turn, drag)
    │   ├── Character.js                        # L2 on-foot third-person controller (sprint/jump)
    │   └── Rover.js                            # L2 driving controller
    ├── camera/
    │   └── CameraController.js                 # Chase cam, third-person cam, shake/rotation events
    ├── ui/
    │   ├── HUD.js                              # In-game overlay: speed, gravity strength, dimension
    │   ├── Menu.js                             # Main menu, pause, level-complete screens
    │   └── Score.js                            # Nitrogen score tracking & persistence
    ├── audio/
    │   └── AudioManager.js                     # Sound playback, volume, event hooks
    └── levels/
        ├── Level1/
        │   ├── Level1.js                       # Scene assembly, spawn logic, completion trigger
        │   ├── BlackHole.js                    # Visual disc + growing pull-force emitter
        │   ├── AsteroidField.js                # Moving asteroids, rotating belts, debris storms
        │   ├── GravityWaves.js                 # Periodic push waves that shove the ship off-course
        │   └── Nitrogen.js                     # Collectible canisters (boost + score)
        ├── Level2/
        │   ├── Level2.js                       # On-foot phase → rover phase orchestration
        │   ├── AlienPlanet.js                  # Terrain, obstacles, planetary hazards
        │   ├── Alien.js                        # Pursuing alien AI
        │   ├── Rover.js                        # Rover gameplay object (vehicle form of the player)
        │   └── GravitySystem.js                # Gravity events + control-mapping corruption
        └── Level3/
            ├── Level3.js                       # Dimension system + boss encounter flow
            ├── Dimensions.js                   # Matter/Energy/Void state modifiers
            ├── Devourer.js                     # Boss entity, attack patterns, core weak point
            ├── GravityAnchors.js               # Destructible shields protecting the boss (Stage 2)
            └── QuantumOverdrive.js             # Ultimate ability (slow-mo, immunity, speed)
```

---

## Level Design Summary

### Level 1 — The Singularity Run

**Description:** The player emerges from a black hole inside a damaged spaceship. The black hole continuously attempts to pull the ship back while the player navigates a dangerous asteroid field.

**Objective:** Escape the black hole and reach a safe planetary system.

**Mechanics**

| System | Behaviour |
|--------|-----------|
| Ship controls | `W/↑` accelerate · `S/↓` decelerate · `A/←` turn left · `D/→` turn right |
| Black hole gravity | Constant backward pull; **scales up over time**; ship pulled into the hole = game over |
| Nitrogen canisters | Temporary speed boost · increased manoeuvrability · reduced gravity pull · score increase |
| Hazards | Moving asteroids · rotating asteroid belts · gravity waves · debris storms |

**Completion:** Cross the asteroid field threshold → scripted loss-of-control → crash onto the alien planet (transition to Level 2).

### Level 2 — Alien Planet Exodus

**Description:** The spaceship crashes and explodes. The player exits the wreckage onto a hostile alien world whose creatures begin hunting them.

| Phase | Gameplay |
|-------|----------|
| **Phase 1 — On Foot** | Third-person character controller · sprint & jump · avoid alien attacks · navigate terrain obstacles |
| **Phase 2 — Rover Escape** | Reach the abandoned rover and drive across the planet while pursued |

**Gravity Manipulation (signature mechanic):** An alien planetary defense system destabilises gravity and **corrupts the control mappings**:

| Normal | Gravity-shifted |
|--------|-----------------|
| `W` = Forward | `S` = Forward |
| `S` = Backward | `W` = Backward |
| `A` = Left | `D` = Left |
| `D` = Right | `A` = Right |

**Extreme gravity events:** camera rotation · temporary zero-gravity · floating terrain · upside-down driving sections.

**Hazards:** alien pursuit · floating rocks · gravity storms · planetary hazards.

**Completion:** Reach the ancient alien structure and activate the portal (transition to Level 3).

### Level 3 — The Void of Gods

**Description:** The black hole is revealed to be a living cosmic entity — **The Devourer**. The portal sends the player into its mind, where reality no longer follows normal rules.

**Reality Shift** — the player can switch between three dimensions at any time:

| Dimension | Properties |
|-----------|------------|
| **Matter** | Normal physics · standard environment |
| **Energy** | Hidden pathways appear · energy bridges become visible · new enemy weaknesses revealed |
| **Void** | Reduced gravity · temporary flight · access to hidden areas |

Progression requires constantly switching between dimensions.

**Final Boss — The Devourer**

| Stage | Challenge |
|-------|-----------|
| 1 | Navigate collapsing space while avoiding attacks |
| 2 | Destroy the gravitational anchors protecting the boss |
| 3 | Enter the creature's core and destroy its energy source |

**Ultimate Ability — Quantum Overdrive:** collected Nitrogen energy evolves into a final power: slow-motion gameplay · increased speed · enhanced mobility · temporary immunity to gravitational attacks.

---

## Implementation Roadmap

Implementation is phased so each milestone produces a runnable build.

### Phase 0 — Bootstrap
- Scaffold `index.html`, `package.json` (Three.js + Vite scripts), canvas + HUD overlay containers.
- `main.js`: instantiate `Game`; `Game.js`: WebGLRenderer, resize handling, fixed-timestep update loop calling the active scene's `update(dt)`.

### Phase 1 — Core Systems
- `SceneManager.js`: register level scenes; handle load/unload and transitions (L1→L2 crash cinematic, L2→L3 portal).
- `GameState.js`: `MENU | PLAYING | PAUSED | GAME_OVER | VICTORY` with event emission for UI/audio hooks.
- `AssetManager.js`: promise-based GLTF/texture/audio loading with progress reporting.
- `PlayerController.js`: central key-state map so bindings can be **swapped at runtime** (required by Level 2).

### Phase 2 — Level 1: The Singularity Run
- `Gravity.js`: radial force toward black-hole origin, magnitude increasing with elapsed time; kill condition inside event horizon radius.
- `Spaceship.js` + `Movement.js`: thrust/deceleration along facing vector, yaw/pitch turning, drag.
- `AsteroidField.js` + `Collision.js`: instanced asteroid meshes orbiting on belts; sphere collision vs. ship hull.
- `GravityWaves.js`: timed impulse waves displacing the ship.
- `Nitrogen.js`: pickup triggers boost timers (speed ↑, manoeuvrability ↑, gravity ↓) and adds score via `Score.js`.
- `HUD.js`: speed, distance-from-black-hole meter, boost status, score.

### Phase 3 — Level 2: Alien Planet Exodus
- `Character.js`: third-person movement, sprint, jump; `CameraController.js` follows behind the player.
- `Alien.js`: simple pursue-and-attack steering behaviour; damage on contact.
- `Rover.js`: arcade driving model over terrain heightfield.
- `GravitySystem.js`: scheduled events — invert/remap `PlayerController` bindings, rotate camera, toggle zero-g float zones and upside-down driving stretches.
- Completion: proximity trigger at the alien structure opens the portal.

### Phase 4 — Level 3: The Void of Gods
- `Dimensions.js`: dimension enum applying global modifiers — Matter (default), Energy (reveal bridge/pathway meshes, expose enemy weak points), Void (gravity ×0.25, hold-to-fly).
- `Devourer.js`: staged state machine — Stage 1 dodging patterns in collapsing geometry; Stage 2 `GravityAnchors.js` destructibles that must be cleared; Stage 3 interior run to destroy the core.
- `QuantumOverdrive.js`: charged by Nitrogen score; activates time-scale slowdown, speed/mobility multipliers, and gravitational-damage immunity for a short window.

### Phase 5 — Polish & Flow
- `Menu.js` main menu/pause/game-over/victory screens; `AudioManager.js` wiring for all events; particle effects (black hole accretion, debris, portal); performance pass (instancing, draw-call budget); final playtest of difficulty ramp.

---

## Controls

| Input | Action (Normal) | Action (Gravity Shift, L2) |
|-------|-----------------|----------------------------|
| `W` / `↑` | Accelerate / Forward | Backward |
| `S` / `↓` | Decelerate / Backward | Forward |
| `A` / `←` | Turn left / Left | Right |
| `D` / `→` | Turn right / Right | Left |
| `Shift` | Sprint (on foot) | Sprint |
| `Space` | Jump / Boost | Jump / Boost |
| `Q`/`E` or `1–3` | Switch dimension (L3) | Switch dimension |
| `F` | Quantum Overdrive (charged) | Quantum Overdrive |
| `Esc` | Pause | Pause |

*(Exact ability keys finalised during Phases 2–4.)*

---

## Getting Started

```bash
cd Event-Horizon
npm install      # installs three + vite
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
```

Requires Node.js 18+. No other native dependencies.

## Asset Conventions

- Models: `.glb` (GLTF binary), Y-up, real-world scale, placed under `public/assets/models/<category>/`.
- Textures: `.jpg/.png/.webp` under `public/assets/textures/`.
- Audio: `.mp3/.ogg` under `public/assets/sounds/`.
- All assets are referenced by path through `AssetManager.js` — never hardcoded into scene files.
