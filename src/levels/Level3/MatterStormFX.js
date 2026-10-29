import * as THREE from 'three'

/** Bounded, gameplay-independent storm and suction visuals.
 * A pair of short-lived lightning bolts plus one small particle vortex are
 * reused; nothing is allocated during the normal animation update. */
export class MatterStormFX {
	constructor(level) {
		this.level = level
		this.group = new THREE.Group()
		this.group.name = 'matter-storm-lightning-and-void-current'
		this.time = 0
		this.seed = 13
		this.nextFlash = 2.5
		this.flashRemaining = 0
		this.flashLength = 0.22

		this.bolts = []
		for (let k = 0; k < 2; k++) {
			const geometry = new THREE.BufferGeometry()
			geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3))
			const material = new THREE.LineBasicMaterial({
				color: k ? 0xba75ff : 0x97edff,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			})
			const line = new THREE.LineSegments(geometry, material)
			line.frustumCulled = false // bounds move when a new bolt is generated
			line.visible = false
			this.bolts.push({ line, geometry, material })
			this.group.add(line)
		}
		this.flashLight = new THREE.PointLight(0xa57aff, 0, 210, 2)
		this.group.add(this.flashLight)

		this.vortexGeometry = new THREE.BufferGeometry()
		this.vortexPositions = new Float32Array(96 * 3)
		this.vortexGeometry.setAttribute('position', new THREE.BufferAttribute(this.vortexPositions, 3))
		this.vortexMaterial = new THREE.PointsMaterial({
			color: 0xb980ff,
			size: 1.5,
			sizeAttenuation: true,
			transparent: true,
			opacity: 0.7,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		this.vortex = new THREE.Points(this.vortexGeometry, this.vortexMaterial)
		this.vortex.frustumCulled = false
		this.vortex.visible = false
		this.group.add(this.vortex)
	}

	_rand() {
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
		return this.seed / 4294967296
	}

	_strike() {
		const player = this.level.playerRoot.position
		for (let k = 0; k < this.bolts.length; k++) {
			const bolt = this.bolts[k]
			const angle = this._rand() * Math.PI * 2
			const radius = 60 + this._rand() * 85
			const x = player.x + Math.cos(angle) * radius
			const z = player.z + Math.sin(angle) * radius
			const ground = this.level.planet.heightAt(x, z) + 3
			const height = 105 + this._rand() * 85
			const a = bolt.geometry.attributes.position
			let px = x, py = ground + height, pz = z
			for (let i = 0; i < 12; i++) {
				const t = (i + 1) / 12
				const nx = x + (this._rand() - 0.5) * 23 * (1 - t * 0.7)
				const nz = z + (this._rand() - 0.5) * 23 * (1 - t * 0.7)
				const ny = ground + height * (1 - t)
				a.setXYZ(i * 2, px, py, pz)
				a.setXYZ(i * 2 + 1, nx, ny, nz)
				px = nx; py = ny; pz = nz
			}
			for (let j = 0; j < 4; j++) {
				const index = j * 3 + 1
				const bx = a.getX(index * 2 + 1)
				const by = a.getY(index * 2 + 1)
				const bz = a.getZ(index * 2 + 1)
				a.setXYZ(24 + j * 2, bx, by, bz)
				a.setXYZ(25 + j * 2, bx + (this._rand() - 0.5) * 30, by - 14 - this._rand() * 15, bz + (this._rand() - 0.5) * 30)
			}
			a.needsUpdate = true
			bolt.line.visible = true
			if (k === 0) this.flashLight.position.set(x, ground + 45, z)
		}
		this.flashRemaining = this.flashLength
	}

	_updateVortex() {
		const survival = this.level.survival
		if (!survival?.collapseAnnounced || this.level.completed || this.level.transitionHeld) {
			this.vortex.visible = false
			return
		}
		const player = this.level.playerRoot.position
		const sideX = -survival.direction.z
		const sideZ = survival.direction.x
		const lateral = (player.x - survival.start.x) * sideX + (player.z - survival.start.z) * sideZ
		const cx = survival.start.x + survival.direction.x * (survival.edge + 12) + sideX * lateral
		const cz = survival.start.z + survival.direction.z * (survival.edge + 12) + sideZ * lateral
		const cy = this.level.planet.heightAt(cx, cz) + 3
		for (let i = 0; i < 96; i++) {
			const height = (i % 24) / 23 * 30
			const angle = (i / 24) * Math.PI * 2 + height * 0.35 + this.time * 1.7
			const radius = 2.5 + height * 0.42
			this.vortexPositions[i * 3] = cx + Math.cos(angle) * radius
			this.vortexPositions[i * 3 + 1] = cy + height
			this.vortexPositions[i * 3 + 2] = cz + Math.sin(angle) * radius
		}
		this.vortexGeometry.attributes.position.needsUpdate = true
		this.vortex.visible = true
	}

	update(delta, cinematic = false) {
		if (this.disposed || !Number.isFinite(delta) || delta <= 0) return
		this.time += Math.min(delta, 0.1)
		const active = !cinematic && !this.level.completed && !this.level.transitionHeld
		if (active && this.time >= this.nextFlash) {
			this._strike()
			this.nextFlash = this.time + (this.level.survival?.collapseAnnounced ? 2.3 : 4.3) + this._rand() * 2
		}
		this.flashRemaining = Math.max(0, this.flashRemaining - delta)
		const flash = active ? this.flashRemaining / this.flashLength : 0
		this.flashLight.intensity = flash * 9
		for (const bolt of this.bolts) {
			bolt.material.opacity = flash
			bolt.line.visible = flash > 0
		}
		this._updateVortex()
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.group.removeFromParent()
		for (const bolt of this.bolts) {
			bolt.geometry.dispose()
			bolt.material.dispose()
		}
		this.vortexGeometry.dispose()
		this.vortexMaterial.dispose()
		this.group.clear()
	}
}
