import * as THREE from 'three'

const DUST_COUNT = 72
const DEBRIS_COUNT = 20
const TRAIL_COUNT = 28
const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)
const clamp = (value) =>
	Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0

const PARTICLE_VERTEX = `
attribute float particleSize;
varying vec3 vColor;
void main() {
	vColor = color;
	vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = clamp(particleSize * 260.0 / max(1.0, -viewPosition.z), 1.0, 110.0);
	gl_Position = projectionMatrix * viewPosition;
}
`
const PARTICLE_FRAGMENT = `
uniform float opacity;
varying vec3 vColor;
void main() {
	float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
	float alpha = (1.0 - smoothstep(0.15, 1.0, radius)) * opacity;
	if (alpha < 0.008) discard;
	gl_FragColor = vec4(vColor, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`

/**
 * A controlled near miss, rather than a gameplay projectile. The host sets
 * flight progress and the single impact instant; this class never moves the
 * rover, controls a camera, damages the player, or schedules a timer.
 * All visuals use owned procedural resources; no missile asset exists in
 * the repository. The impact and particles are deterministic at every time.
 */
export class CinematicMissileStrike {
	constructor({
		start,
		impact,
		heightAt = () => impact.y,
		onImpact = null,
	} = {}) {
		if (!start?.isVector3 || !impact?.isVector3)
			throw new TypeError(
				'Missile start and impact must be Vector3 positions'
			)
		this.group = new THREE.Group()
		this.group.name = 'cinematic-missile-strike'
		this.impactPosition = impact.clone()
		this.missilePosition = start.clone()
		this.flightProgress = 0
		this.impacted = false
		this.impactTime = 0
		this._disposed = false
		this._heightAt = heightAt
		this._onImpact = onImpact
		this._owned = new Set()
		this._tangent = new THREE.Vector3()
		this._sample = new THREE.Vector3()
		this._dummy = new THREE.Object3D()
		const control = start.clone().lerp(impact, 0.52)
		control.y += 12
		this.path = new THREE.QuadraticBezierCurve3(
			start.clone(),
			control,
			impact.clone()
		)
		this._buildMissile()
		this._buildTrail()
		this._buildImpact()
		this.setFlightProgress(0)
	}

	_own(resource) {
		this._owned.add(resource)
		return resource
	}

	_mesh(geometry, material) {
		return new THREE.Mesh(this._own(geometry), material)
	}

	_buildMissile() {
		this.missile = new THREE.Group()
		this.missile.name = 'incoming-missile'
		const bodyMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x565966,
				metalness: 0.65,
				roughness: 0.48,
			})
		)
		const noseMaterial = this._own(
			new THREE.MeshStandardMaterial({
				color: 0x251e27,
				metalness: 0.45,
				roughness: 0.38,
				emissive: 0x5d1420,
				emissiveIntensity: 0.55,
			})
		)
		const body = this._mesh(
			new THREE.CylinderGeometry(0.35, 0.45, 3.9, 10),
			bodyMaterial
		)
		body.castShadow = true
		this.missile.add(body)
		const nose = this._mesh(
			new THREE.ConeGeometry(0.35, 1.3, 10),
			noseMaterial
		)
		nose.position.y = 2.6
		this.missile.add(nose)
		const finGeometry = this._own(
			new THREE.BoxGeometry(0.1, 1.25, 1.1)
		)
		for (let i = 0; i < 4; i++) {
			const fin = new THREE.Mesh(finGeometry, bodyMaterial)
			fin.rotation.y = (i * Math.PI) / 2
			fin.position.set(
				Math.sin(fin.rotation.y) * 0.7,
				-1.5,
				Math.cos(fin.rotation.y) * 0.7
			)
			this.missile.add(fin)
		}
		this.flameMaterial = this._own(
			new THREE.MeshBasicMaterial({
				color: 0xff9f5b,
				transparent: true,
				opacity: 0.9,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			})
		)
		this.flame = this._mesh(
			new THREE.ConeGeometry(0.46, 3.8, 8),
			this.flameMaterial
		)
		this.flame.rotation.z = Math.PI
		this.flame.position.y = -3.75
		this.missile.add(this.flame)
		this.group.add(this.missile)
	}

	_particles(count, color, size) {
		const positions = new Float32Array(count * 3)
		const sizes = new Float32Array(count)
		const colors = new Float32Array(count * 3)
		const base = new THREE.Color(color)
		for (let i = 0; i < count; i++) {
			sizes[i] = size
			const shade = 0.74 + (i % 7) * 0.045
			colors[i * 3] = base.r * shade
			colors[i * 3 + 1] = base.g * shade
			colors[i * 3 + 2] = base.b * shade
		}
		const geometry = this._own(new THREE.BufferGeometry())
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3).setUsage(
				THREE.DynamicDrawUsage
			)
		)
		geometry.setAttribute(
			'particleSize',
			new THREE.BufferAttribute(sizes, 1).setUsage(
				THREE.DynamicDrawUsage
			)
		)
		geometry.setAttribute(
			'color',
			new THREE.BufferAttribute(colors, 3)
		)
		const material = this._own(
			new THREE.ShaderMaterial({
				uniforms: { opacity: { value: 0 } },
				vertexShader: PARTICLE_VERTEX,
				fragmentShader: PARTICLE_FRAGMENT,
				vertexColors: true,
				transparent: true,
				depthWrite: false,
			})
		)
		const points = new THREE.Points(geometry, material)
		points.frustumCulled = false
		this.group.add(points)
		return { points, geometry, material, positions, sizes }
	}

	_buildTrail() {
		this.trail = this._particles(TRAIL_COUNT, 0xc1b2ae, 1.1)
		this.trail.points.name = 'missile-exhaust-trail'
	}

	_buildImpact() {
		this.dust = this._particles(DUST_COUNT, 0xb67e61, 3)
		this.dust.points.name = 'missile-impact-dust'
		this.dust.points.visible = false
		this.debris = new THREE.InstancedMesh(
			this._own(new THREE.IcosahedronGeometry(0.22, 0)),
			this._own(
				new THREE.MeshStandardMaterial({
					color: 0x644637,
					roughness: 1,
				})
			),
			DEBRIS_COUNT
		)
		this.debris.name = 'missile-impact-debris'
		this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.debris.frustumCulled = false
		this.debris.visible = false
		this.group.add(this.debris)
		this.shockMaterial = this._own(
			new THREE.MeshBasicMaterial({
				color: 0xd7ac7c,
				transparent: true,
				opacity: 0,
				side: THREE.DoubleSide,
				depthWrite: false,
			})
		)
		this.shockwave = this._mesh(
			new THREE.RingGeometry(0.86, 1, 64),
			this.shockMaterial
		)
		this.shockwave.name = 'missile-impact-shockwave'
		this.shockwave.geometry.rotateX(-Math.PI / 2)
		this.shockwave.geometry.attributes.position.setUsage(
			THREE.DynamicDrawUsage
		)
		this._shockUnitPositions =
			this.shockwave.geometry.attributes.position.array.slice()
		this.shockwave.frustumCulled = false
		this.shockwave.position.copy(this.impactPosition)
		this.shockwave.position.y += 0.15
		this.shockwave.visible = false
		this.group.add(this.shockwave)
		this.flash = new THREE.PointLight(0xffaa62, 0, 90, 2)
		this.flash.position.copy(this.impactPosition)
		this.flash.position.y += 2.5
		this.group.add(this.flash)
	}

	/** Absolute progress makes the approach identical at any rendering rate. */
	setFlightProgress(progress) {
		if (this._disposed || this.impacted) return
		this.flightProgress = clamp(progress)
		this.path.getPoint(this.flightProgress, this.missilePosition)
		this.missile.position.copy(this.missilePosition)
		this.path
			.getTangent(this.flightProgress, this._tangent)
			.normalize()
		this.missile.quaternion.setFromUnitVectors(UP, this._tangent)
		this.flame.scale.y =
			0.92 + Math.sin(this.flightProgress * 83) * 0.08
		for (let i = 0; i < TRAIL_COUNT; i++) {
			const age = i / (TRAIL_COUNT - 1)
			const t = Math.max(0, this.flightProgress - age * 0.17)
			this.path.getPoint(t, this._sample)
			this.trail.positions[i * 3] = this._sample.x
			this.trail.positions[i * 3 + 1] = this._sample.y
			this.trail.positions[i * 3 + 2] = this._sample.z
			this.trail.sizes[i] = 0.75 + age * 2.2
		}
		this.trail.geometry.attributes.position.needsUpdate = true
		this.trail.geometry.attributes.particleSize.needsUpdate = true
		this.trail.material.uniforms.opacity.value = Math.min(
			0.3,
			this.flightProgress * 2
		)
	}

	/** Returns true only for the first impact, for the host's audio latch. */
	impact() {
		if (this._disposed || this.impacted) return false
		this.setFlightProgress(1)
		this.impacted = true
		this._onImpact?.(this.impactPosition)
		this.impactTime = 0
		this.missile.visible = false
		this.dust.points.visible =
			this.debris.visible =
			this.shockwave.visible =
				true
		this.update(0)
		return true
	}

	update(delta) {
		if (this._disposed || !this.impacted) return
		this.impactTime += Number.isFinite(delta)
			? Math.max(0, delta)
			: 0
		const t = this.impactTime
		const dustLife = Math.max(0, 1 - t / 8)
		this.dust.points.visible = dustLife > 0
		this.dust.material.uniforms.opacity.value =
			dustLife * Math.min(0.56, 0.18 + t * 1.2)
		this.trail.material.uniforms.opacity.value = Math.max(
			0,
			0.3 - t * 0.12
		)
		this.trail.points.visible = t < 2.5
		this.flash.intensity = 160 * Math.exp(-t * 11)
		this.shockwave.visible = t < 1.8
		if (this.shockwave.visible) {
			const radius = 1 + 32 * (1 - Math.exp(-t * 2.1))
			const vertices =
				this.shockwave.geometry.attributes.position
			for (let i = 0; i < vertices.count; i++) {
				const x =
					this._shockUnitPositions[i * 3] * radius
				const z =
					this._shockUnitPositions[i * 3 + 2] *
					radius
				const terrain = this._heightAt(
					this.impactPosition.x + x,
					this.impactPosition.z + z
				)
				const y = Number.isFinite(terrain)
					? terrain - this.impactPosition.y
					: 0
				vertices.setXYZ(i, x, y, z)
			}
			vertices.needsUpdate = true
		}
		this.shockMaterial.opacity = Math.max(0, (1 - t / 1.8) * 0.5)
		this.debris.visible = t < 3.5
		if (t >= 8) return
		for (let i = 0; i < DUST_COUNT; i++) {
			const angle = i * 2.39996323
			const layer = (i % 9) / 8
			const expansion =
				1 - Math.exp(-t * (0.65 + layer * 0.5))
			const radius = (3 + layer * 18) * expansion
			const x =
				this.impactPosition.x +
				Math.cos(angle) * radius +
				t * 0.45
			const z =
				this.impactPosition.z + Math.sin(angle) * radius
			const terrain = this._heightAt(x, z)
			const floor = Number.isFinite(terrain)
				? terrain
				: this.impactPosition.y
			this.dust.positions[i * 3] = x
			this.dust.positions[i * 3 + 1] =
				floor +
				0.45 +
				Math.sin(layer * Math.PI) * 8 * expansion +
				t * (0.15 + layer * 0.22)
			this.dust.positions[i * 3 + 2] = z
			this.dust.sizes[i] = 2.6 + layer * 3 + expansion * 4.2
		}
		this.dust.geometry.attributes.position.needsUpdate = true
		this.dust.geometry.attributes.particleSize.needsUpdate = true
		if (!this.debris.visible) return
		for (let i = 0; i < DEBRIS_COUNT; i++) {
			const angle = (i * TAU) / DEBRIS_COUNT + 0.37
			const speed = 4 + (i % 5) * 1.25
			const x =
				this.impactPosition.x +
				Math.cos(angle) * speed * t
			const z =
				this.impactPosition.z +
				Math.sin(angle) * speed * t
			const terrain = this._heightAt(x, z)
			const floor = Number.isFinite(terrain)
				? terrain
				: this.impactPosition.y
			const y = Math.max(
				floor + 0.18,
				this.impactPosition.y +
					0.3 +
					(5 + (i % 4)) * t -
					4.5 * t * t
			)
			this._dummy.position.set(x, y, z)
			this._dummy.rotation.set(i + t * 2, t * 1.7, angle)
			this._dummy.scale.setScalar(
				(0.6 + (i % 3) * 0.4) *
					Math.min(1, (3.5 - t) * 2)
			)
			this._dummy.updateMatrix()
			this.debris.setMatrixAt(i, this._dummy.matrix)
		}
		this.debris.instanceMatrix.needsUpdate = true
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		this.group.removeFromParent()
		this.group.clear()
		this.debris.dispose()
		for (const resource of this._owned) resource.dispose()
		this._owned.clear()
	}
}
