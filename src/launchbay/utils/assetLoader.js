/**
 * src/utils/assetLoader.js
 *
 * Single shared GLTFLoader (+ optional Draco decompression) for the whole
 * app. Centralized here rather than instantiated per-component so:
 *   - the Draco decoder is only ever set up once
 *   - identical URLs are never fetched twice (in-flight promises are cached)
 *   - every caller gets the same error shape to handle
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// Draco only activates for meshes actually compressed with it — harmless
// (and unused) for plain GLBs, but lets compressed assets work without
// each caller having to think about it.
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath(
	'https://www.gstatic.com/draco/versioned/decoders/1.5.6/'
)

const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

/** url -> in-flight/resolved Promise<GLTF>, so repeat requests share one load. */
const inFlight = new Map()

/**
 * Load a GLB/GLTF file.
 *
 * @param {string} url
 * @param {(ratio: number) => void} [onProgress] called with 0..1 when the
 *        server reports Content-Length; not all servers do, so this may
 *        never fire even on a successful load — callers should not depend
 *        on it for correctness, only for an optional progress bar.
 * @returns {Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>}
 */
export function loadGLTF(url, onProgress) {
	if (inFlight.has(url)) return inFlight.get(url)

	const promise = new Promise((resolve, reject) => {
		gltfLoader.load(
			url,
			(gltf) => resolve(gltf),
			(event) => {
				if (
					onProgress &&
					event.lengthComputable &&
					event.total > 0
				) {
					onProgress(event.loaded / event.total)
				}
			},
			(error) => {
				// Let a failed load be retried later instead of caching a rejection.
				inFlight.delete(url)
				const message =
					error?.message ||
					error?.type ||
					'unknown error'
				reject(
					new Error(
						`Failed to load model "${url}": ${message}`
					)
				)
			}
		)
	})

	inFlight.set(url, promise)
	return promise
}

/** Release the Draco decoder's worker pool. Call on full app teardown. */
export function disposeAssetLoader() {
	dracoLoader.dispose()
}
