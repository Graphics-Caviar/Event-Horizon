import * as THREE from 'three'

// Level 1 finish line: a pulsing ring beacon on the escape axis (+z is
// away from the black hole, which pulls toward -z). fog is disabled so the
// beacon stays visible from spawn and works as a steering target.

const DEFAULT_POSITION = new THREE.Vector3(0, 0, 2500)

export class Endpoint {
	constructor(level, position = DEFAULT_POSITION) {
		this.level = level
		this.position = position.clone()
		this.triggerRadius = 120
		this.reached = false
		this._t = 0

		this.group = new THREE.Group()
		this.group.name = 'endpoint'
		this.group.position.copy(this.position)
		this.level.addObject(this.group)

		const ringGeo = new THREE.TorusGeometry(90, 4, 16, 64)
		this.level.own(ringGeo)
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x4de3ff,
			fog: false,
		})
		this.level.own(ringMat)
		this.ring = new THREE.Mesh(ringGeo, ringMat)
		this.group.add(this.ring)

		const glowGeo = new THREE.TorusGeometry(90, 12, 16, 64)
		this.level.own(glowGeo)
		const glowMat = new THREE.MeshBasicMaterial({
			color: 0x4de3ff,
			transparent: true,
			opacity: 0.22,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		})
		this.level.own(glowMat)
		this.glow = new THREE.Mesh(glowGeo, glowMat)
		this.group.add(this.glow)

		const light = new THREE.PointLight(0x4de3ff, 2.5, 800, 1.5)
		this.group.add(light)
	}

	checkReached(shipPosition) {
		if (this.reached) return false
		if (
			shipPosition.distanceTo(this.position) <
			this.triggerRadius
		) {
			this.reached = true
			return true
		}
		return false
	}

	update(delta) {
		this._t += delta
		this.ring.rotation.z += delta * 0.5
		this.glow.rotation.z -= delta * 0.3
		const pulse = 1 + Math.sin(this._t * 2) * 0.05
		this.group.scale.setScalar(pulse)
	}
}
