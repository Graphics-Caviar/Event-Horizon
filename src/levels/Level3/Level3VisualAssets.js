import * as THREE from 'three'

/**
 * Optimized Matter / Void assets. The real optimized GLBs are enabled by
 * by default: original supplied GLBs, or optimized variants when requested. Use ?level3Art=off on a slower PC to disable
 * these decorative meshes without changing hazards or collision.
 *
 * No gameplay hitbox or collision depends on these cosmetic meshes.
 * The AssetManager owns decoded geometry; this module only owns presentation
 * materials and scene groups.
 */
const ASSETS = Object.freeze({
    vortex: '/assets/models/level3-visuals/storm-vortex.glb',
    debris: '/assets/models/level3-visuals/matter-debris.glb',
    prison: '/assets/models/level3-visuals/void-prison-bubble.glb',
    projectile: '/assets/models/level3-visuals/cyan-plasma-projectile.glb',
    arena: '/assets/models/level3-visuals/void-gods-arena.glb',
})

export function highDetailLevel3Art() {
    // Backwards-compatible name; normal mode now loads optimized art.
    return typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('level3Art') !== 'off'
}

function modelCandidates(key) {
    const raw = ASSETS[key]
    if (!raw) return []
    const name = raw.substring(raw.lastIndexOf('/') + 1)
    const optimized = `/assets/models/level3-visuals/optimized/${name}`
    const mode = new URLSearchParams(window.location.search).get('level3Art')
    // Use the original GLB when no optimized version exists. Players can
    // explicitly disable these heavy visual meshes with ?level3Art=off.
    return mode === 'optimized' ? [optimized, raw] : [raw, optimized]
}

function presentationMaterial(kind) {
    if (kind === 'vortex') {
        return new THREE.MeshBasicMaterial({
            color: 0x9b74da, transparent: true, opacity: 0.62,
            side: THREE.DoubleSide, depthWrite: false,
        })
    }
    if (kind === 'prison') {
        return new THREE.MeshBasicMaterial({
            color: 0x9a6aff, transparent: true, opacity: 0.6,
            side: THREE.DoubleSide, depthWrite: false,
        })
    }
    if (kind === 'projectile') {
        return new THREE.MeshBasicMaterial({
            color: 0x6effff, transparent: true, opacity: 0.91,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide,
        })
    }
    return new THREE.MeshStandardMaterial({
        color: kind === 'debris' ? 0x635774 : 0x34304d,
        emissive: kind === 'debris' ? 0x28143c : 0x1c0a47,
        emissiveIntensity: 0.5, roughness: 0.82, metalness: 0.1,
        side: THREE.DoubleSide,
    })
}

export function createLevel3Art(level, parent, key, maxDimension = 10) {
    const root = new THREE.Group()
    root.name = `optional-level3-${key}`
    root.visible = false
    parent.add(root)
    const materials = []
    let disposed = false
    let ready = false
    let pending = null
    // Loading remains deferred until a hazard/encounter actually needs it.
    function load() {
        if (!highDetailLevel3Art() || disposed || ready) return Promise.resolve()
        if (!ASSETS[key]) return Promise.resolve()
        if (pending) return pending
        pending = (async () => {
        try {
            let model = null
            for (const path of modelCandidates(key)) {
                try {
                    model = await level.assetManager.loadModel(path)
                    if (model) break
                } catch (error) {
                    console.debug(`[Level3] Artwork not available at ${path}:`, error?.message)
                }
            }
            if (!model || disposed) return
            model.updateMatrixWorld(true)
            const box = new THREE.Box3().setFromObject(model)
            const size = box.getSize(new THREE.Vector3())
            const longest = Math.max(size.x, size.y, size.z)
            if (!Number.isFinite(longest) || longest <= 0) return
            model.scale.multiplyScalar(maxDimension / longest)
            model.updateMatrixWorld(true)
            model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()))
            model.traverse((mesh) => {
                if (!mesh.isMesh) return
                const mat = presentationMaterial(key)
                materials.push(mat)
                mesh.material = mat
                mesh.castShadow = false
                mesh.receiveShadow = false
            })
            if (disposed) {
                for (const material of materials) material.dispose()
                return
            }
            root.add(model)
            ready = true
        } catch (error) {
            console.warn(`[Level3] ${key} art load failed:`, error?.message)
        }
        })()
        return pending
    }
    return {
        root,
        load,
        get ready() { return ready },
        dispose() {
            disposed = true
            root.removeFromParent()
            // GLB geometry and its textures belong to AssetManager's cache.
            for (const material of materials) material.dispose()
        },
    }
}
