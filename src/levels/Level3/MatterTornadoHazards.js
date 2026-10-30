import * as THREE from 'three'
import { createLevel3Art } from './Level3VisualAssets.js'

/** Six telegraphed storms: suction/damage remains independent of art. */
export class MatterTornadoHazards {
    constructor(level) {
        this.level = level
        this.group = new THREE.Group()
        this.group.name = 'matter-jetpack-vortex-hazards'
        this.time = 0
        this.seed = 9
        this.disposed = false
        this.vortices = []
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(144 * 3), 3))
        this.material = new THREE.LineBasicMaterial({
            color: 0xb879ff, transparent: true, opacity: 0.72,
            depthWrite: false, blending: THREE.AdditiveBlending,
        })
        this.warningGeometry = new THREE.RingGeometry(15, 17.5, 40)
        this.warningMaterial = new THREE.MeshBasicMaterial({
            color: 0xffa2fa, side: THREE.DoubleSide,
            transparent: true, opacity: 0.55, depthWrite: false,
        })
        // Cheap three-dimensional funnel + individually orbiting stone debris.
        // This is the normal-quality visual; the GLB is an optional preview.
        this.funnelGeometry = new THREE.CylinderGeometry(15, 2, 54, 16, 8, true)
        this.funnelMaterial = new THREE.MeshBasicMaterial({
            color: 0x6b418e, transparent: true, opacity: 0.22,
            depthWrite: false, side: THREE.DoubleSide,
        })
        this.rockGeometry = new THREE.IcosahedronGeometry(0.75, 0)
        this.rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x61556f, emissive: 0x291840, emissiveIntensity: 0.7,
            flatShading: true, roughness: 0.88,
        })
        this.dummy = new THREE.Object3D()

        for (let i = 0; i < 6; i++) {
            const line = new THREE.Line(this.geometry.clone(), this.material)
            line.frustumCulled = false
            const warn = new THREE.Mesh(this.warningGeometry, this.warningMaterial)
            warn.rotation.x = -Math.PI / 2
            const funnel = new THREE.Mesh(this.funnelGeometry, this.funnelMaterial)
            const rocks = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, 56)
            rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            rocks.frustumCulled = false
            this.group.add(line, warn, funnel, rocks)
            // One expensive model maximum. Second vortex still has volumetric
            // cheap geometry and debris, rather than a bare line.
            const art = i === 0
                ? createLevel3Art(level, this.group, 'vortex', 60)
                : null
            this.vortices.push({
                line, warn, funnel, rocks, art,
                center: new THREE.Vector3(), phase: 'waiting',
                timer: 2 + i * 1.45, damageTimer: 0, index: i,
            })
            line.visible = warn.visible = funnel.visible = rocks.visible = false
        }
        level.addObject(this.group)
    }

    _rand() {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
        return this.seed / 4294967296
    }

    _choose(v) {
        const player = this.level.playerRoot.position
        const angle = this._rand() * Math.PI * 2
        const r = 26 + this._rand() * 45
        v.center.set(player.x + Math.cos(angle) * r, 0, player.z + Math.sin(angle) * r)
        this.level.planet.clampToBounds(v.center, 20)
        v.center.y = this.level.planet.heightAt(v.center.x, v.center.z)
        v.phase = 'warning'
        v.timer = 1.7
        v.warn.position.copy(v.center)
        v.warn.position.y += 0.25
        v.warn.visible = true
    }

    _animate(v) {
        const data = v.line.geometry.attributes.position
        for (let i = 0; i < 144; i++) {
            const h = (i / 143) * 55
            const angle = i * 0.35 + this.time * 2.4 + v.index * 2
            const radius = 3 + h * 0.31
            data.setXYZ(i,
                v.center.x + Math.cos(angle) * radius,
                v.center.y + h,
                v.center.z + Math.sin(angle) * radius)
        }
        data.needsUpdate = true
        v.funnel.position.copy(v.center)
        v.funnel.position.y += 27
        v.funnel.rotation.y = this.time * (v.index % 2 ? -0.7 : 0.7)
        for (let i = 0; i < v.rocks.count; i++) {
            const h = (i % 14) / 13 * 52 + 1.5
            const angle = i * 2.399963 + this.time * (1.9 + (i % 4) * 0.2)
            const r = 3.5 + h * 0.21 + (i % 3) * 1.2
            this.dummy.position.set(
                v.center.x + Math.cos(angle) * r,
                v.center.y + h,
                v.center.z + Math.sin(angle) * r)
            this.dummy.rotation.set(angle, angle * 0.7, angle * 0.4)
            this.dummy.scale.setScalar(0.7 + (i % 5) * 0.4)
            this.dummy.updateMatrix()
            v.rocks.setMatrixAt(i, this.dummy.matrix)
        }
        v.rocks.instanceMatrix.needsUpdate = true
        if (v.art?.ready) {
            v.art.root.position.copy(v.center)
            v.art.root.position.y += 27
            v.art.root.rotation.y = this.time * 0.65
            v.art.root.visible = true
            v.line.visible = false
        }
    }

    update(dt, cinematic = false) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return
        const step = Math.min(0.05, dt)
        this.time += step
        const paused = cinematic || this.level.completed || this.level.transitionHeld
        for (const v of this.vortices) {
            if (paused) {
                v.line.visible = v.warn.visible = v.funnel.visible = v.rocks.visible = false
                if (v.art) v.art.root.visible = false
                continue
            }
            v.timer -= dt
            if (v.phase === 'waiting' && v.timer <= 0) this._choose(v)
            if (v.phase === 'warning' && v.timer <= 0) {
                v.phase = 'active'
                v.timer = 11
                v.warn.visible = false
                v.line.visible = v.funnel.visible = v.rocks.visible = true
                v.art?.load()
            }
            if (v.phase !== 'active') continue
            if (v.timer <= 0) {
                v.phase = 'waiting'
                v.timer = 3.5 + this._rand() * 3.5
                v.line.visible = v.funnel.visible = v.rocks.visible = false
                if (v.art) v.art.root.visible = false
                continue
            }
            const p = this.level.playerRoot.position
            // Slow pursuit: no instant re-targeting, so players can dodge.
            const chaseX = p.x - v.center.x, chaseZ = p.z - v.center.z
            const chaseDistance = Math.hypot(chaseX, chaseZ)
            if (chaseDistance > 7 && chaseDistance < 125) {
                const travel = Math.min(chaseDistance - 7, step * (5 + v.index % 3 * 2))
                v.center.x += chaseX / chaseDistance * travel
                v.center.z += chaseZ / chaseDistance * travel
                this.level.planet.clampToBounds(v.center, 18)
                v.center.y = this.level.planet.heightAt(v.center.x, v.center.z)
            }
            this._animate(v)
            const dx = v.center.x - p.x, dz = v.center.z - p.z
            const dist = Math.hypot(dx, dz)
            if (dist < 36 && dist > 0.5) {
                const strength = 1 - dist / 36
                this.level.velocity.x += (dx / dist) * 22 * strength * step
                this.level.velocity.z += (dz / dist) * 22 * strength * step
                if (this.level._airborne) this.level._verticalSpeed += 6 * strength * step
                v.damageTimer -= dt
                if (dist < 9 && v.damageTimer <= 0) {
                    v.damageTimer = 1.5
                    this.level._applyAlienHit?.(9)
                }
            }
        }
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.group.removeFromParent()
        for (const v of this.vortices) {
            v.line.geometry.dispose()
            v.rocks.dispose()
            v.art?.dispose()
        }
        this.geometry.dispose()
        this.material.dispose()
        this.warningGeometry.dispose()
        this.warningMaterial.dispose()
        this.funnelGeometry.dispose()
        this.funnelMaterial.dispose()
        this.rockGeometry.dispose()
        this.rockMaterial.dispose()
    }
}
