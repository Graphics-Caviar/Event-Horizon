import * as THREE from 'three'

// Level 1 finish portal. +z is away from the black hole. The portal is
// intentionally built from procedural Three.js geometry/shaders so it stays
// lightweight, remains visible from spawn, and can animate the actual ship
// through it before the Level 1 -> Level 2 cinematic begins.

const DEFAULT_POSITION = new THREE.Vector3(0, 0, 2500)

export class Endpoint {
	constructor(level, position = DEFAULT_POSITION) {
		this.level = level
		this.position = position.clone()
		this.triggerRadius = 135
		this.reached = false
		this.entering = false
		this.entryProgress = 0
		this._t = 0

		this.group = new THREE.Group()
		this.group.name = 'level1-escape-portal'
		this.group.position.copy(this.position)
		this.level.addObject(this.group)

		// Bright structural rings around the portal mouth.
		const ringGeo = new THREE.TorusGeometry(90, 5.5, 20, 96)
		this.level.own(ringGeo)
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x78f2ff,
			fog: false,
			toneMapped: false,
		})
		this.level.own(ringMat)
		this.ring = new THREE.Mesh(ringGeo, ringMat)
		this.group.add(this.ring)

		const glowGeo = new THREE.TorusGeometry(90, 17, 20, 96)
		this.level.own(glowGeo)
		const glowMat = new THREE.MeshBasicMaterial({
			color: 0x3edfff,
			transparent: true,
			opacity: 0.25,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			toneMapped: false,
		})
		this.level.own(glowMat)
		this.glow = new THREE.Mesh(glowGeo, glowMat)
		this.group.add(this.glow)

		const outerGeo = new THREE.TorusGeometry(106, 2.2, 12, 96)
		this.level.own(outerGeo)
		const outerMat = new THREE.MeshBasicMaterial({
			color: 0xb087ff,
			transparent: true,
			opacity: 0.58,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			toneMapped: false,
		})
		this.level.own(outerMat)
		this.outerRing = new THREE.Mesh(outerGeo, outerMat)
		this.group.add(this.outerRing)

		// Swirling energy surface. The mesh lies in the XY plane, so a ship
		// travelling along +z flies directly through it.
		const portalGeo = new THREE.CircleGeometry(84, 96)
		this.level.own(portalGeo)
		this.portalUniforms = {
			uTime: { value: 0 },
			uIntensity: { value: 1 },
		}
		const portalMat = new THREE.ShaderMaterial({
			uniforms: this.portalUniforms,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				precision highp float;
				uniform float uTime;
				uniform float uIntensity;
				varying vec2 vUv;

				void main() {
					vec2 p = vUv - 0.5;
					float r = length(p) * 2.0;
					if (r > 1.0) discard;

					float a = atan(p.y, p.x);
					float swirlA = sin(a * 7.0 - uTime * 3.1 + r * 15.0);
					float swirlB = sin(a * 11.0 + uTime * 2.2 - r * 20.0);
					float energy = 0.5 + 0.5 * (swirlA * 0.58 + swirlB * 0.42);
					float rim = smoothstep(0.48, 1.0, r);
					float core = 1.0 - smoothstep(0.0, 0.72, r);
					float pulse = 0.84 + 0.16 * sin(uTime * 4.0 - r * 10.0);

					vec3 deep = vec3(0.025, 0.12, 0.30);
					vec3 cyan = vec3(0.10, 0.82, 1.0);
					vec3 violet = vec3(0.48, 0.20, 1.0);
					vec3 col = mix(deep, cyan, energy);
					col = mix(col, violet, rim * 0.55);
					col += vec3(0.55, 0.9, 1.0) * core * 0.42;

					float alpha = (0.34 + energy * 0.25 + rim * 0.30) * pulse * uIntensity;
					gl_FragColor = vec4(col * (0.9 + uIntensity * 0.35), alpha);
				}
			`,
		})
		this.level.own(portalMat)
		this.portalSurface = new THREE.Mesh(portalGeo, portalMat)
		this.portalSurface.position.z = 0.8
		this.group.add(this.portalSurface)

		// Concentric ripples make the opening read as depth rather than a flat
		// finish-line ring.
		this.ripples = []
		for (let i = 0; i < 4; i++) {
			const geo = new THREE.TorusGeometry(
				24 + i * 17,
				1.5,
				10,
				72
			)
			this.level.own(geo)
			const mat = new THREE.MeshBasicMaterial({
				color: i % 2 ? 0x8f72ff : 0x75efff,
				transparent: true,
				opacity: 0.25,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				fog: false,
				toneMapped: false,
			})
			this.level.own(mat)
			const ripple = new THREE.Mesh(geo, mat)
			ripple.position.z = 1.2 + i * 0.12
			this.group.add(ripple)
			this.ripples.push(ripple)
		}

		// Orbiting sparks/particles around the portal rim.
		const sparkPositions = []
		for (let i = 0; i < 150; i++) {
			const angle = Math.random() * Math.PI * 2
			const radius = 92 + (Math.random() - 0.5) * 38
			sparkPositions.push(
				Math.cos(angle) * radius,
				Math.sin(angle) * radius,
				(Math.random() - 0.5) * 24
			)
		}
		const sparkGeo = new THREE.BufferGeometry()
		sparkGeo.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(sparkPositions, 3)
		)
		this.level.own(sparkGeo)
		const sparkMat = new THREE.PointsMaterial({
			color: 0x9af7ff,
			size: 2.8,
			transparent: true,
			opacity: 0.82,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			toneMapped: false,
		})
		this.level.own(sparkMat)
		this.sparks = new THREE.Points(sparkGeo, sparkMat)
		this.group.add(this.sparks)

		this.light = new THREE.PointLight(0x66eaff, 3.5, 1050, 1.35)
		this.group.add(this.light)
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

	beginEntry() {
		this.entering = true
		this.entryProgress = 0
	}

	setEntryProgress(value) {
		this.entryProgress = THREE.MathUtils.clamp(value, 0, 1)
	}

	update(delta) {
		this._t += delta
		const entry = this.entering ? this.entryProgress : 0

		this.ring.rotation.z += delta * (0.42 + entry * 1.3)
		this.glow.rotation.z -= delta * (0.28 + entry * 1.8)
		this.outerRing.rotation.z -= delta * (0.16 + entry * 0.7)
		this.sparks.rotation.z += delta * (0.11 + entry * 1.4)
		this.sparks.rotation.x = Math.sin(this._t * 0.35) * 0.08

		for (let i = 0; i < this.ripples.length; i++) {
			const ripple = this.ripples[i]
			ripple.rotation.z +=
				delta * (0.18 + i * 0.07) * (i % 2 ? -1 : 1)
			const wave =
				1 + Math.sin(this._t * 2.3 - i * 0.8) * 0.045
			ripple.scale.setScalar(wave * (1 + entry * 0.08))
			ripple.material.opacity =
				0.2 +
				entry * 0.28 +
				Math.sin(this._t * 3 + i) * 0.05
		}

		const pulse = 1 + Math.sin(this._t * 2.5) * 0.035 + entry * 0.11
		this.group.scale.setScalar(pulse)
		this.portalUniforms.uTime.value = this._t
		this.portalUniforms.uIntensity.value = 1 + entry * 1.65
		this.glow.material.opacity = 0.24 + entry * 0.48
		this.outerRing.material.opacity = 0.52 + entry * 0.38
		this.sparks.material.opacity = Math.min(1, 0.72 + entry * 0.5)
		this.light.intensity = 3.5 + entry * 9
	}
}
