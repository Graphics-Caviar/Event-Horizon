# Level 2 pilot assets

Run `npm run optimize:pilots` after updating the original pilot GLBs. Commit
the generated `public/assets/models/pilots/*-gameplay.glb` files alongside
the sources. The generator uses the dev-only meshoptimizer dependency;
no runtime decoder or new browser dependency is required.

Rigged pilots and aliens use a separate offline pass because the gameplay
copies above do not contain a skeleton. Run `npm run optimize:rigged-assets`
to produce `*-web-rigged.glb` variants that preserve original skins, joint
weights, bones and textures while reducing pilots to at most 60,000 triangles
and aliens to 40,000. `assetUrl` serves these variants for rigged paths. The
full-resolution source models remain available in `public/` for editing.

The final boss model has its own offline pass. Run
`npm run optimize:void-boss` to regenerate `public/assets/models/void/void_god-web.glb`
from the provided `void-god-web.glb` source. It keeps the embedded WebP
textures and reduces the mesh for the final encounter.

The generator targets 120,000 triangles per pilot with UV-aware simplification
and a maximum relative error of 0.003. It preserves embedded textures and
materials and writes separate gameplay assets. Originals remain available to
the hangar and cinematic. The input contract is one static indexed mesh with
float positions/UVs and uint32 indices; update the generator for other formats.

| Pilot | Original MB | Gameplay MB | Gameplay triangles |
| ----- | ----------: | ----------: | -----------------: |
| Zara  |       40.95 |        6.10 |            119,994 |
| Kai   |       43.34 |        6.97 |            120,000 |
| Nyx   |       40.26 |        5.65 |            119,992 |

The game preloads the selected gameplay pilot from the menu, on selection and
at Level 1 entry. Level 2 installs a cached model synchronously, avoiding the
temporary procedural pilot when preloading has completed. On a cold connection
or failed request, the existing fallback stays playable while loading finishes.

Run `npm run test:pilots` for request sharing, synchronous cache reuse, retry,
late-load disposal, and parsing/fitting/animation checks for all three generated
models. Run `npm run build` and `npm run test:level2` for integration checks.
