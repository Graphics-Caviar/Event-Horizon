import * as THREE from 'three'

/**
 * Small world-space particle pool for footfall and landing dust.
 *
 * One THREE.Points draw call; particles are allocated round-robin from a
 * fixed pool so nothing allocates during play. Lifetimes and velocities live
 * on the CPU side; the GPU only sees position, remaining life, size and a
 * seed. Dead particles are collapsed off-screen in the vertex shader.
 */

const VERTEX = `
attribute float aLife;
attribute float aSize;
attribute float aSeed;
varying float vLife;
varying float vSeed;
void main() {
	vLife = aLife;
	vSeed = aSeed;
	if (aLife <= 0.0) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 0.0;
		return;
	}
	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
	// Dust puffs expand as they fade.
	gl_PointSize =
		aSize *
		(1.0 + (1.0 - aLife) * 1.8) *
		(420.0 / max(0.1, -mvPosition.z));
	gl_Position = projectionMatrix * mvPosition;
}
`

const FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
varying float vSeed;
void main() {
	float dist = length(gl_PointCoord - vec2(0.5));
	float sprite = smoothstep(0.5, 0.12, dist);
	float alpha = sprite * vLife * uOpacity;
	if (alpha < 0.01) discard;
	// Cheap shading so puffs do not read as flat dots.
	float shade = 0.85 + 0.15 * vSeed;
	gl_FragColor = vec4(uColor * shade, alpha);
}
`

export class DustParticles {
	constructor(level, { max = 140 } = {}) {
		this.max = max
		this._positions = new Float32Array(max * 3)
		this._velocity = new Float32Array(max * 3)
		this._life = new Float32Array(max)
		this._lifeSpan = new Float32Array(max)
		this._size = new Float32Array(max)
		this._seed = new Float32Array(max)
		this._cursor = 0

		this.geometry = new THREE.BufferGeometry()
		this.geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this._positions, 3)
		)
		this.geometry.setAttribute(
			'aLife',
			new THREE.BufferAttribute(this._life, 1)
		)
		this.geometry.setAttribute(
			'aSize',

			new THREE.BufferAttribute(this._size, 1)
		)
		this.geometry.setAttribute(
			'aSeed',
			new THREE.BufferAttribute(this._seed, 1)
		)
		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uColor: { value: new THREE.Color(0xc79b72) },
				uOpacity: { value: 0.7 },
			},
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			transparent: true,
			depthWrite: false,
		})

		this.points = new THREE.Points(this.geometry, this.material)
		this.points.name = 'level2-dust'
		this.points.frustumCulled = false
		this.points.renderOrder = 5
		level.addObject(this.points)
		level.own(this.geometry)
		level.own(this.material)
	}

	/** A tight, low puff at a foot plant. `origin` should be ground level. */
	spawnFoot(origin, { ratio = 0.5 } = {}) {
		const count = 4 + Math.round(ratio * 4)
		for (let i = 0; i < count; i++) {
			this._spawnOne(
				origin,
				1.2 + ratio * 1.5,
				0.5,
				0.62 + ratio * 0.3,
				0.55
			)
		}
	}

	/** A wider burst, e.g. a heavy landing. */
	spawnBurst(
		origin,
		{
			count = 10,
			strength = 1.2,
			spread = 1.4,
			size = 0.9,
			upBias = 0.5,
		} = {}
	) {
		for (let i = 0; i < count; i++) {
			this._spawnOne(origin, strength, spread, size, upBias)
		}
	}

	_spawnOne(origin, strength, spread, size, upBias) {
		const i = this._cursor
		this._cursor = (this._cursor + 1) % this.max
		const p = i * 3
		const angle = Math.random() * Math.PI * 2
		const radius = Math.random() * spread
		this._positions[p] = origin.x + Math.cos(angle) * radius
		this._positions[p + 1] = origin.y + 0.15 + Math.random() * 0.3
		this._positions[p + 2] = origin.z + Math.sin(angle) * radius
		this._velocity[p] =
			Math.cos(angle) *
			strength *
			(0.35 + Math.random() * 0.5)
		this._velocity[p + 1] =
			strength * (upBias + Math.random() * 0.5)
		this._velocity[p + 2] =
			Math.sin(angle) *
			strength *
			(0.35 + Math.random() * 0.5)
		this._lifeSpan[i] = 0.45 + Math.random() * 0.5
		this._life[i] = 1
		this._size[i] = size * (0.7 + Math.random() * 0.7)
		this._seed[i] = Math.random()
	}

	update(delta) {
		let dirty = false
		const drag = Math.exp(-2.4 * delta)
		for (let i = 0; i < this.max; i++) {
			if (this._life[i] <= 0) continue
			dirty = true
			this._life[i] -= delta / this._lifeSpan[i]
			if (this._life[i] <= 0) {
				this._life[i] = 0
				continue
			}
			const p = i * 3
			this._velocity[p + 1] -= 3.2 * delta
			this._velocity[p] *= drag
			this._velocity[p + 1] *= drag
			this._velocity[p + 2] *= drag
			this._positions[p] += this._velocity[p] * delta
			this._positions[p + 1] += this._velocity[p + 1] * delta
			this._positions[p + 2] += this._velocity[p + 2] * delta
		}
		if (!dirty) return
		const attrs = this.geometry.attributes
		attrs.position.needsUpdate = true
		attrs.aLife.needsUpdate = true
		attrs.aSize.needsUpdate = true
		attrs.aSeed.needsUpdate = true
	}
}
