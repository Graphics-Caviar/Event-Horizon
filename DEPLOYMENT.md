# University deployment

Build from the Event-Horizon directory:

```sh
npm ci
npm run build
npm run test:deployment
```

Upload **the contents of `dist/`** into the server's `students/sgroup3898/` directory. The result must be:

```text
students/sgroup3898/index.html
students/sgroup3898/style.css
students/sgroup3898/assets/index-<hash>.js
students/sgroup3898/assets/models/aliens/alien-predator-web.glb
students/sgroup3898/assets/models/rover/sci-fi-exploration-rover-web.glb
...all other files in dist/assets/
```

Upload assets before index.html, then hard-refresh the browser. Uploading only index.html or putting the whole dist folder inside sgroup3898 will not update the game correctly. Source files, node_modules and .env are not deployment files.

Vite uses a relative base. Model loaders resolve local asset paths relative to the application folder, rather than requesting `/assets/` at the university domain root. Matching letter case and filenames matters on the server.

## Browser model copies

The original models remain in public/assets/models for editing. Pilots use the existing `-gameplay.glb` variants in both the hangar and gameplay, sharing one cache entry. Ships, aliens and the rover use `-web.glb` variants. Their original UVs, embedded textures, material settings and coordinates are retained. Asteroid geometry is unchanged; its deployment URL is fixed.

To regenerate copies after changing source models:

```sh
npm run optimize:pilots
npm run optimize:web
npm run build
```

The postbuild step excludes superseded high-detail models from dist only. Generated GLBs require no additional decoder downloads.

Measured geometry: aliens approximately 20,000 triangles each, ships/rover approximately 80,000, pilots approximately 120,000. This is substantially lower than the original approximately 1.5 million per model. Textures are preserved, so texture memory still needs measurement on the marking machine.

## Verification

```sh
npm run test:pilots
npm run test:level2
npm run test:deployment
npm run preview:subpath
```

Open http://127.0.0.1:4173/students/sgroup3898/index.html for a strict nested-folder preview. It returns 404 for requests outside that folder instead of masking broken paths with an HTML fallback.

Before submission, use the lab browser's Network panel with cache disabled: check that all models return 200, that their responses are GLB data, and that there are no requests to the domain-root /assets/models/. Check all pilots and ships, Level 1 asteroids, Level 2 aliens and the detailed rover with steering wheels. Play through level transitions while monitoring frame rate and GPU memory. Automated checks verify model parsing and paths; they do not certify visual fidelity or performance on lab hardware.
