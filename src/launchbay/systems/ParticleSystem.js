/**
 * src/systems/ParticleSystem.js
 *
 * Builds the passive space environment behind the UI: a distant starfield,
 * a couple of soft nebula color fields, and a small layer of drifting dust
 * closer to camera for parallax depth. Everything here is cheap on purpose —
 * this runs continuously alongside three animated character models, so it
 * favors a few thousand simple points over anything shader-heavy.
 *
 * All textures are generated at runtime via canvas (radial gradients)
 * rather than loaded from disk, so Stage 2 has zero external asset
 * dependencies.
 */

import * as THREE from 'three'

function makeRadialTexture({
	inner = 'rgba(255,255,255,1)',
	outer = 'rgba(255,255,255,0)',
} = {}) {
	const size = 128
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d')

	const gradient = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	)
	gradient.addColorStop(0, inner)
	gradient.addColorStop(1, outer)

	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, size, size)

	const texture = new THREE.CanvasTexture(canvas)
	texture.needsUpdate = true
	return texture
}

export class ParticleSystem {
	constructor() {
		this.group = new THREE.Group()
		this.group.name = 'ParticleSystem'

		this._dotTexture = makeRadialTexture({
			inner: 'rgba(255,255,255,1)',
			outer: 'rgba(255,255,255,0)',
		})

		this._disposables = [this._dotTexture]

		this._buildStarfield()
		this._buildNebula()
		this._buildDustMotes()
	}

	_buildStarfield() {
		const STAR_COUNT = 3200
		const positions = new Float32Array(STAR_COUNT * 3)
		const sizes = new Float32Array(STAR_COUNT)

		for (let i = 0; i < STAR_COUNT; i++) {
			// Distribute on a large shell so stars read as "far away" and don't
			// clump near the camera regardless of orbit angle.
			const radius = 40 + Math.random() * 60
			const theta = Math.random() * Math.PI * 2
			const phi = Math.acos(
				THREE.MathUtils.lerp(-1, 1, Math.random())
			)

			positions[i * 3] =
				radius * Math.sin(phi) * Math.cos(theta)
			positions[i * 3 + 1] = radius * Math.cos(phi) * 0.6 // flatten slightly
			positions[i * 3 + 2] =
				radius * Math.sin(phi) * Math.sin(theta)

			sizes[i] = Math.random() * 1.6 + 0.4
		}

		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)
		geometry.setAttribute(
			'aSize',
			new THREE.BufferAttribute(sizes, 1)
		)

		const material = new THREE.PointsMaterial({
			size: 0.12,
			map: this._dotTexture,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			color: 0xcfe8ff,
			sizeAttenuation: true,
		})

		this._starGeometry = geometry
		this._starMaterial = material
		this._stars = new THREE.Points(geometry, material)
		this._stars.name = 'Starfield'
		this.group.add(this._stars)
		this._disposables.push(geometry, material)
	}

	_buildNebula() {
		// A couple of large, very soft billboards for color in the void.
		// Colors echo the three pilot accents so the environment feels
		// connected to the roster without being literal about it.
		const nebulaConfigs = [
			{
				color: '#1c3f66',
				position: [-14, 3, -22],
				scale: 26,
				opacity: 0.35,
			},
			{
				color: '#2a1740',
				position: [16, -2, -26],
				scale: 30,
				opacity: 0.3,
			},
			{
				color: '#0f3325',
				position: [2, 8, -30],
				scale: 22,
				opacity: 0.22,
			},
		]

		this._nebulaSprites = []

		for (const cfg of nebulaConfigs) {
			const texture = makeRadialTexture({
				inner: hexToRgba(cfg.color, 0.9),
				outer: hexToRgba(cfg.color, 0),
			})
			const material = new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				depthWrite: false,
				opacity: cfg.opacity,
				blending: THREE.AdditiveBlending,
			})
			const sprite = new THREE.Sprite(material)
			sprite.position.set(...cfg.position)
			sprite.scale.setScalar(cfg.scale)
			this.group.add(sprite)
			this._nebulaSprites.push(sprite)
			this._disposables.push(texture, material)
		}
	}

	_buildDustMotes() {
		const DUST_COUNT = 220
		const positions = new Float32Array(DUST_COUNT * 3)
		this._dustSpeeds = new Float32Array(DUST_COUNT)

		for (let i = 0; i < DUST_COUNT; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 14
			positions[i * 3 + 1] = (Math.random() - 0.5) * 8
			positions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2
			this._dustSpeeds[i] = 0.02 + Math.random() * 0.05
		}

		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3)
		)

		const material = new THREE.PointsMaterial({
			size: 0.045,
			map: this._dotTexture,
			transparent: true,
			opacity: 0.5,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			color: 0x9fd8ff,
		})

		this._dustGeometry = geometry
		this._dustMaterial = material
		this._dust = new THREE.Points(geometry, material)
		this._dust.name = 'DustMotes'
		this.group.add(this._dust)
		this._disposables.push(geometry, material)
	}

	/**
	 * @param {number} dt delta time in seconds
	 * @param {number} elapsed total elapsed time in seconds
	 */
	update(dt, elapsed) {
		// Whole starfield drifts imperceptibly so it never looks static.
		this._stars.rotation.y += dt * 0.003

		// Nebula sprites rotate very slowly (rotation2D is per-sprite in three).
		for (let i = 0; i < this._nebulaSprites.length; i++) {
			this._nebulaSprites[i].material.rotation +=
				dt * 0.01 * (i % 2 === 0 ? 1 : -1)
		}

		// Dust motes drift upward and wrap around, giving parallax near camera.
		const positions = this._dustGeometry.attributes.position.array
		for (let i = 0; i < this._dustSpeeds.length; i++) {
			const idx = i * 3 + 1
			positions[idx] += this._dustSpeeds[i] * dt
			if (positions[idx] > 4) positions[idx] = -4
		}
		this._dustGeometry.attributes.position.needsUpdate = true
	}

	dispose() {
		for (const item of this._disposables) {
			if (item && typeof item.dispose === 'function')
				item.dispose()
		}
		this.group.clear()
	}
}

function hexToRgba(hex, alpha) {
	const c = new THREE.Color(hex)
	return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`
}
