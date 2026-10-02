import * as THREE from 'three'

// Purely decorative — sits behind the start screen so the menu doesn't open
// on a dead black canvas. Owns its own group so it can be cleanly removed
// the moment the player launches into Level 1, without touching lights or
// anything Level1.js adds to the same scene/camera afterwards.
export class MenuBackground {
	constructor(sceneManager, assetManager) {
		this.camera = sceneManager.camera
		this.group = new THREE.Group()

		this.starfield = assetManager.createStarfield(3500, 1000)
		this.group.add(this.starfield)

		this.nebula = this._buildNebula()
		this.group.add(this.nebula)

		this.holeGroup = this._buildBlackHole()
		this.group.add(this.holeGroup)

		this.ship = this._buildDriftingShip()
		this.group.add(this.ship)

		sceneManager.scene.add(this.group)

		this.camera.position.set(0, 3, 26)
		this.camera.lookAt(4, -2, -60)

		this._t = 0
	}

	_buildNebula() {
		// A loose haze of large, soft, colour-tinted points drifting in the
		// mid-distance — cheap stand-in for a nebula without any textures.
		const count = 500
		const positions = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)
		const purple = new THREE.Color(0xa86bff)
		const cyan = new THREE.Color(0x4de3ff)

		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2
			const r = 80 + Math.random() * 260
			positions[i * 3] = Math.cos(angle) * r
			positions[i * 3 + 1] = (Math.random() - 0.5) * 120 - 20
			positions[i * 3 + 2] = -60 - Math.random() * 400

			const c = purple.clone().lerp(cyan, Math.random())
			colors[i * 3] = c.r
			colors[i * 3 + 1] = c.g
			colors[i * 3 + 2] = c.b
		}

		const geo = new THREE.BufferGeometry()
		geo.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
		const mat = new THREE.PointsMaterial({
			size: 5,
			vertexColors: true,
			transparent: true,
			opacity: 0.35,
			sizeAttenuation: true,
			depthWrite: false,
		})
		return new THREE.Points(geo, mat)
	}

	_buildBlackHole() {
		// A large, dramatic swirling accretion disk as the focal point of the
		// composition — echoes the reference art's centrepiece without needing
		// any image assets.
		const group = new THREE.Group()
		group.position.set(10, -1, -70)
		group.rotation.x = -0.15
		group.rotation.z = 0.1

		const core = new THREE.Mesh(
			new THREE.SphereGeometry(9, 32, 32),
			new THREE.MeshBasicMaterial({ color: 0x000000 })
		)
		group.add(core)

		const glow = new THREE.Mesh(
			new THREE.SphereGeometry(12, 24, 24),
			new THREE.MeshBasicMaterial({
				color: 0xff9a55,
				transparent: true,
				opacity: 0.1,
			})
		)
		group.add(glow)

		const diskCount = 4000
		const positions = new Float32Array(diskCount * 3)
		const colors = new Float32Array(diskCount * 3)
		const warm = new THREE.Color(0xffb066)
		const hot = new THREE.Color(0xfff2d8)

		for (let i = 0; i < diskCount; i++) {
			const r = 9.5 * (1 + Math.random() * 3.2)
			const angle = Math.random() * Math.PI * 2
			const spiral = angle + r * 0.05 // gentle spiral bias, not a perfect ring
			const height =
				(Math.random() - 0.5) *
				1.4 *
				(1 - Math.min(r / 40, 1))

			positions[i * 3] = Math.cos(spiral) * r
			positions[i * 3 + 1] = height
			positions[i * 3 + 2] = Math.sin(spiral) * r

			const c = warm.clone().lerp(hot, Math.random())
			colors[i * 3] = c.r
			colors[i * 3 + 1] = c.g
			colors[i * 3 + 2] = c.b
		}

		const geo = new THREE.BufferGeometry()
		geo.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
		const mat = new THREE.PointsMaterial({
			size: 0.7,
			vertexColors: true,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		})
		this.disk = new THREE.Points(geo, mat)
		group.add(this.disk)

		return group
	}

	_buildDriftingShip() {
		// A small, simple silhouette (no game logic here — Spaceship.js owns
		// the real player ship) that drifts across the menu for a bit of life.
		const group = new THREE.Group()

		const hullMat = new THREE.MeshBasicMaterial({ color: 0x9fb3c8 })
		const body = new THREE.Mesh(
			new THREE.ConeGeometry(0.6, 2.4, 6),
			hullMat
		)
		body.rotation.x = Math.PI / 2
		group.add(body)

		const glowMat = new THREE.MeshBasicMaterial({
			color: 0x4de3ff,
			transparent: true,
			opacity: 0.9,
		})
		const trail = new THREE.Mesh(
			new THREE.ConeGeometry(0.22, 3.2, 8),
			glowMat
		)
		trail.rotation.x = -Math.PI / 2
		trail.position.z = 1.6
		group.add(trail)

		const light = new THREE.PointLight(0x4de3ff, 1.8, 14)
		light.position.z = 1.8
		group.add(light)

		group.position.set(-14, -3, -18)
		group.rotation.y = 2.6
		return group
	}

	update(delta) {
		this._t += delta

		this.starfield.rotation.y += delta * 0.008
		this.nebula.rotation.y -= delta * 0.012
		this.disk.rotation.y += delta * 0.05
		this.holeGroup.rotation.z += delta * 0.01

		// Ship drifts slowly left-to-right across the scene and loops.
		this.ship.position.x += delta * 1.4
		this.ship.position.y = -3 + Math.sin(this._t * 0.5) * 0.4
		if (this.ship.position.x > 20) this.ship.position.x = -20

		// Slow, breathing camera drift so the background never looks static.
		this.camera.position.x = Math.sin(this._t * 0.1) * 3
		this.camera.position.y = 3 + Math.sin(this._t * 0.07) * 1
		this.camera.lookAt(4, -2, -60)
	}

	dispose() {
		if (this.group.parent) this.group.parent.remove(this.group)
	}
}
