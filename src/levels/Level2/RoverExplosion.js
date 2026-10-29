import * as THREE from 'three'

/** Lightweight, single-use rover destruction effect (no external textures). */
export class RoverExplosion {
	constructor(level, worldPosition) {
		this.age = 0
		this.duration = 2.2
		this.disposed = false
		this.group = new THREE.Group()
		this.group.name = 'rover-destruction'
		this.group.position.copy(worldPosition)
		this.group.position.y += 2.4
		this.resources = []

		const geometry = new THREE.SphereGeometry(1, 12, 8)
		const innerMaterial = new THREE.MeshBasicMaterial({
			color: 0xffe6a0,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		const outerMaterial = new THREE.MeshBasicMaterial({
			color: 0xff4d16,
			transparent: true,
			opacity: 0.8,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		this.resources.push(geometry, innerMaterial, outerMaterial)
		this.inner = new THREE.Mesh(geometry, innerMaterial)
		this.outer = new THREE.Mesh(geometry, outerMaterial)
		this.group.add(this.inner, this.outer)

		const ringGeometry = new THREE.TorusGeometry(1, 0.09, 6, 40)
		const ringMaterial = new THREE.MeshBasicMaterial({
			color: 0xffac45,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		this.resources.push(ringGeometry, ringMaterial)
		this.ring = new THREE.Mesh(ringGeometry, ringMaterial)
		this.ring.rotation.x = Math.PI / 2
		this.group.add(this.ring)

		const fragmentGeometry = new THREE.TetrahedronGeometry(0.55)
		const fragmentMaterial = new THREE.MeshStandardMaterial({
			color: 0x49454c,
			emissive: 0x9a3510,
			roughness: 0.65,
		})
		this.resources.push(fragmentGeometry, fragmentMaterial)
		this.fragments = []
		for (let i = 0; i < 16; i++) {
			const mesh = new THREE.Mesh(
				fragmentGeometry,
				fragmentMaterial
			)
			const angle = (i / 16) * Math.PI * 2
			const speed = 6 + (i % 4) * 1.8
			const velocity = new THREE.Vector3(
				Math.cos(angle) * speed,
				6 + (i % 5) * 1.3,
				Math.sin(angle) * speed
			)
			this.fragments.push({ mesh, velocity })
			this.group.add(mesh)
		}
		this.light = new THREE.PointLight(0xff7a30, 8, 60, 2)
		this.group.add(this.light)
		level.addObject(this.group)
	}

	update(delta) {
		if (this.disposed) return
		const dt = Math.max(0, Math.min(delta, 0.1))
		this.age += dt
		const t = Math.min(1, this.age / this.duration)
		const flash = Math.max(0, 1 - this.age / 1.15)
		this.inner.scale.setScalar(1.8 + this.age * 11)
		this.outer.scale.setScalar(2.6 + this.age * 13)
		this.inner.material.opacity = flash * 0.95
		this.outer.material.opacity = flash * 0.78
		this.ring.scale.setScalar(1 + this.age * 18)
		this.ring.material.opacity = Math.max(0, 0.85 * (1 - t * 1.8))
		this.light.intensity = 8 * flash
		for (const fragment of this.fragments) {
			fragment.mesh.position.addScaledVector(
				fragment.velocity,
				dt
			)
			fragment.velocity.y -= 17 * dt
			fragment.mesh.rotation.x += dt * 4
			fragment.mesh.rotation.y += dt * 6
		}
		if (this.age >= this.duration) this.dispose()
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.group.removeFromParent()
		for (const resource of this.resources) resource.dispose()
	}
}
