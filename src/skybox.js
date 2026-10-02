import * as THREE from 'three'

// Inverted box that follows the camera so the player can never leave it.
// The half size stays inside SceneManager's camera far plane (3000), which
// means every pixel of the frustum is covered by the box — nothing is ever
// rendered outside of it. fog is disabled on the material because the
// scene's FogExp2 would otherwise fog the walls out completely at this
// distance.

function mulberry32(seed) {
	let a = seed >>> 0
	return function () {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function createStarTexture(seed, size = 1024) {
	const rand = mulberry32(seed * 1000 + 7)
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d')

	// Base matches the scene fog colour so distant fogged geometry
	// dissolves into the sky instead of a different background.
	const gradient = ctx.createLinearGradient(0, 0, 0, size)
	gradient.addColorStop(0, '#05060c')
	gradient.addColorStop(0.5, '#0a0e1c')
	gradient.addColorStop(1, '#05060c')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, size, size)

	// Faint nebula tint blobs, echoing the menu background palette.
	const tints = ['168, 107, 255', '77, 227, 255', '255, 150, 85']
	for (let i = 0; i < 6; i++) {
		const x = rand() * size
		const y = rand() * size
		const r = 120 + rand() * 320
		const tint = tints[Math.floor(rand() * tints.length)]
		const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
		blob.addColorStop(0, `rgba(${tint}, 0.045)`)
		blob.addColorStop(1, 'rgba(0, 0, 0, 0)')
		ctx.fillStyle = blob
		ctx.fillRect(0, 0, size, size)
	}

	// Star field: mostly dim stars, a few bright ones with a soft halo.
	for (let i = 0; i < 650; i++) {
		const x = rand() * size
		const y = rand() * size
		const bright = rand() > 0.92
		const radius = bright ? 1.4 + rand() * 1.2 : 0.3 + rand() * 0.9
		const alpha = bright
			? 0.85 + rand() * 0.15
			: 0.25 + rand() * 0.5

		if (bright) {
			const halo = ctx.createRadialGradient(
				x,
				y,
				0,
				x,
				y,
				radius * 5
			)
			halo.addColorStop(
				0,
				`rgba(255, 255, 255, ${alpha * 0.35})`
			)
			halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
			ctx.fillStyle = halo
			ctx.fillRect(
				x - radius * 5,
				y - radius * 5,
				radius * 10,
				radius * 10
			)
		}

		ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
		ctx.beginPath()
		ctx.arc(x, y, radius, 0, Math.PI * 2)
		ctx.fill()
	}

	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

export class Skybox {
	constructor(level, halfSize = 2800) {
		this.level = level
		this.camera = level.sceneManager.camera

		const geometry = new THREE.BoxGeometry(
			halfSize * 2,
			halfSize * 2,
			halfSize * 2
		)
		this.level.own(geometry)

		// One texture per face so the star pattern doesn't repeat.
		const materials = []
		for (let i = 0; i < 6; i++) {
			const texture = createStarTexture(i + 1)
			this.level.own(texture)
			const material = new THREE.MeshBasicMaterial({
				map: texture,
				side: THREE.BackSide,
				fog: false,
				depthWrite: false,
			})
			this.level.own(material)
			materials.push(material)
		}

		this.mesh = new THREE.Mesh(geometry, materials)
		this.mesh.name = 'skybox'
		this.mesh.renderOrder = -1
		this.mesh.frustumCulled = false
		this.level.addObject(this.mesh)

		this.update()
	}

	update() {
		this.mesh.position.copy(this.camera.position)
	}
}
