import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'
import { assetUrl } from '../../core/assetUrl.js'

/**
 * Central manifest for every Level 3 "Void of Gods" GLB. Enemies,
 * monuments, the blade and the projectiles all resolve their assets here,
 * so no model path is hard-coded anywhere else.
 *
 * fit      — gameplay size of the longest bbox axis, in metres (the raw
 *            GLBs are authored at ~2 units; see Level2._fit).
 * simplify — meshopt decimation ratio applied once to the cached source
 *            geometry when the full-detail original is served. Browsers
 *            normally get the pre-simplified -web.glb variants from
 *            optimize-void-models.mjs (80k/20k tris) via assetUrl, for
 *            which this pass is skipped entirely.
 */
export const VOID_ASSETS = {
	flyingPredator: {
		path: '/assets/models/aliens/alien-flying-predator.glb',
		fit: 6.6,
		simplify: 0.2,
	},
	alienBrute: {
		path: '/assets/models/aliens/armored-alien-brute.glb',
		fit: 7.2,
		simplify: 0.2,
	},
	riftStalker: {
		path: '/assets/models/void/rift-stalker.glb',
		role: 'enemy · fast melee',
		fit: 5.4,
		simplify: 0.24,
	},
	voidSentinel: {
		path: '/assets/models/void/void-sentinel-web-rigged.glb',
		rigged: true,
		role: 'enemy · heavy',
		fit: 7.2,
		simplify: 0.2,
	},
	voidEntity: {
		path: '/assets/models/void/void-entity-web-rigged.glb',
		rigged: true,
		role: 'enemy · ranged flyer',
		fit: 6.6,
		simplify: 0.2,
	},
	voidColossus: {
		path: '/assets/models/void/void-colossus-web-rigged.glb',
		rigged: true,
		role: 'boss',
		fit: 9.5,
		simplify: 0.22,
	},
	bossArena: {
		path: '/assets/models/void/boss-arena.glb',
		role: 'monument · colossus arena',
		fit: 96,
		simplify: 0.12,
	},
	brokenBridge: {
		path: '/assets/models/void/broken-bridge.glb',
		role: 'monument · collapsed span',
		fit: 62,
		simplify: 0.12,
	},
	ancientReactor: {
		path: '/assets/models/void/ancient-reactor.glb',
		role: 'monument · energy core',
		fit: 26,
		simplify: 0.14,
	},
	gravRift: {
		path: '/assets/models/void/grav-rift.glb',
		role: 'portal - Matter dimension exit',
		fit: 30,
		simplify: 0.14,
	},
	anomalyShip: {
		path: '/assets/models/void/anomaly-ship.glb',
		role: 'debris · doomed vessel',
		fit: 30,
		simplify: 0.12,
	},
	energyBlade: {
		path: '/assets/models/void/energy-blade.glb',
		role: 'player weapon',
		fit: 2.8,
		simplify: 0.3,
	},
	energyBolt: {
		path: '/assets/models/void/energy-bolt.glb',
		role: 'enemy projectile',
		fit: 2.2,
		simplify: 0.3,
	},
	energyBoltHeavy: {
		path: '/assets/models/void/energy-bolt-heavy.glb',
		role: 'enemy projectile · heavy',
		fit: 2.8,
		simplify: 0.3,
	},
}

const _prepped = new Set()

/**
 * Loads a void asset through the shared AssetManager cache and returns a
 * fresh clone — or null when the GLB is missing/unreadable, logged but
 * never fatal (a missing monument beats a crashed level). The first call
 * also decimates and compacts the cached source geometry — unless assetUrl
 * resolves to a pre-optimized -web.glb variant, which is already light —
 * so this clone and every later one share the lightened buffers.
 */
export async function loadVoidModel(assetManager, key) {
	const def = VOID_ASSETS[key]
	if (!def) {
		console.warn(`[Level3] Unknown void asset "${key}".`)
		return null
	}
	try {
		await assetManager.preloadModel(def.path)
		if (!_prepped.has(key)) {
			if (
				!def.rigged &&
				!assetUrl(def.path).endsWith('-web.glb')
			) {
				const raw = assetManager.getRawModel(def.path)
				if (raw) {
					await decimateModel(
						raw.scene,
						def.simplify
					)
				}
			}
			_prepped.add(key)
		}
		return await assetManager.loadModel(def.path)
	} catch (error) {
		console.warn(
			`[Level3] Void asset "${key}" (${def.path}) failed to load:`,
			error?.message
		)
		return null
	}
}

/**
 * One-time per asset: meshopt-decimate every mesh down to `ratio` of its
 * triangles (position-only error metric, borders locked so the silhouette
 * keeps no holes), then rebuild the buffers holding only the vertices the
 * surviving index still references. Runs before any clone exists, so the
 * whole game shares the result. Fallback for the full-detail originals —
 * -web.glb variants arrive already simplified and skip this pass.
 */
export async function decimateModel(root, ratio) {
	await MeshoptSimplifier.ready
	root.traverse((child) => {
		if (!child.isMesh || !child.geometry?.index) return
		const geometry = child.geometry
		const position = geometry.attributes.position
		if (!position) return
		const index = geometry.index.array
		const indices =
			index instanceof Uint32Array
				? index
				: new Uint32Array(index)
		const targetCount = Math.max(
			3,
			Math.round((indices.length * ratio) / 3) * 3
		)
		const [decimated] = MeshoptSimplifier.simplify(
			indices,
			position.array,
			3,
			targetCount,
			0.2,
			['LockBorder']
		)
		compactGeometry(geometry, decimated)
		geometry.computeBoundingBox()
		geometry.computeBoundingSphere()
	})
}

/**
 * Drop unreferenced vertices after decimation. The simplifier shrinks the
 * index, but the 4.5M-vertex attribute buffers would still upload whole;
 * re-packing to the used subset is where the real memory win comes from.
 */
function compactGeometry(geometry, newIndex) {
	for (const attribute of Object.values(geometry.attributes)) {
		if (attribute.isInterleavedBufferAttribute) {
			// Interleaved buffers cannot be cheaply re-packed; the
			// decimated index is still valid, only the memory win is lost.
			geometry.setIndex(
				new THREE.BufferAttribute(newIndex, 1)
			)
			return
		}
	}
	const oldToNew = new Int32Array(
		geometry.attributes.position.count
	).fill(-1)
	const used = []
	for (let i = 0; i < newIndex.length; i++) {
		const old = newIndex[i]
		if (oldToNew[old] === -1) {
			oldToNew[old] = used.length
			used.push(old)
		}
		newIndex[i] = oldToNew[old]
	}
	for (const [name, attribute] of Object.entries(geometry.attributes)) {
		const itemSize = attribute.itemSize
		const source = attribute.array
		const packed = new source.constructor(used.length * itemSize)
		for (let v = 0; v < used.length; v++) {
			const from = used[v] * itemSize
			const to = v * itemSize
			for (let c = 0; c < itemSize; c++) {
				packed[to + c] = source[from + c]
			}
		}
		geometry.setAttribute(
			name,
			new THREE.BufferAttribute(
				packed,
				itemSize,
				attribute.normalized
			)
		)
	}
	geometry.setIndex(new THREE.BufferAttribute(newIndex, 1))
}
