import * as THREE from 'three'

/**
 * Level 2 waypoint guidance.
 *
 * Gives the player a readable target instead of aimless roaming:
 * - an optional tall yellow beacon beam + ground ring sits on the target
 *   (visible across the valley);
 * - a dashed yellow line hugs the terrain from the pilot's feet to the
 *   target, with the dashes streaming toward the destination.
 *
 * The target is supplied as a getter so one guide can track a moving
 * object (the rover) while another pins a fixed landmark (the escape
 * portal).
 *
 * The line rebuilds its vertices only when the player or the target
 * actually moved, so the per-frame cost while standing still is zero.
 */

const GUIDE_COLOR = 0xffd23f
const UP = new THREE.Vector3(0, 1, 0)
const HEIGHT_OFFSET = 0.45
const SEGMENT_LENGTH = 6
const MAX_SAMPLES = 96
const LINE_WIDTH = 1.5
const DASH_PERIOD = 7

const makeDashTexture = () => {
	const canvas = document.createElement('canvas')
	canvas.width = 32
	canvas.height = 128
	const ctx = canvas.getContext('2d')
	// One bright dash per period, soft along both axes.
	const vertical = ctx.createLinearGradient(0, 0, 0, 128)
	vertical.addColorStop(0.0, 'rgba(255,255,255,0)')
	vertical.addColorStop(0.12, 'rgba(255,255,255,1)')
	vertical.addColorStop(0.45, 'rgba(255,255,255,1)')
	vertical.addColorStop(0.58, 'rgba(255,255,255,0)')
	vertical.addColorStop(1.0, 'rgba(255,255,255,0)')
	ctx.fillStyle = vertical
	ctx.fillRect(0, 0, 32, 128)
	const horizontal = ctx.createLinearGradient(0, 0, 32, 0)
	horizontal.addColorStop(0.0, 'rgba(255,255,255,0)')
	horizontal.addColorStop(0.3, 'rgba(255,255,255,1)')
	horizontal.addColorStop(0.7, 'rgba(255,255,255,1)')
	horizontal.addColorStop(1.0, 'rgba(255,255,255,0)')
	ctx.globalCompositeOperation = 'destination-in'
	ctx.fillStyle = horizontal
	ctx.fillRect(0, 0, 32, 128)
	const texture = new THREE.CanvasTexture(canvas)
	texture.wrapT = THREE.RepeatWrapping
	texture.wrapS = THREE.ClampToEdgeWrapping
	return texture
}

export class WaypointGuide {
	/**
	 * @param {object} level
	 * @param {object} options
	 * @param {() => (THREE.Vector3|null)} options.getTarget destination position (ground level)
	 * @param {boolean} [options.beacon] attach the beam + ring beacon to the target
	 * @param {number} [options.arriveDistance] hide the line this close to the target
	 * @param {string} [options.name] base name for the guide objects
	 */
	constructor(
		level,
		{
			getTarget,
			beacon = true,
			arriveDistance = 6,
			name = 'waypoint',
		} = {}
	) {
		this.level = level
		this.getTarget = getTarget
		this.arriveDistance = arriveDistance
		this.time = 0

		this.dashTexture = level.own(makeDashTexture())
		this._anchor = new THREE.Vector3(Infinity, 0, Infinity)

		// --- Beacon (sits on the target) -------------------------------
		this.group = null
		if (beacon) {
			this.group = new THREE.Group()
			this.group.name = `${name}-guide-beacon`
			level.addObject(this.group)

			this.outerMaterial = level.own(
				new THREE.MeshBasicMaterial({
					color: GUIDE_COLOR,
					transparent: true,
					opacity: 0.16,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
					depthWrite: false,
				})
			)
			const outerBeam = new THREE.Mesh(
				level.own(
					new THREE.CylinderGeometry(
						0.8,
						2.6,
						170,
						14,
						1,
						true
					)
				),
				this.outerMaterial
			)
			outerBeam.position.y = 85
			outerBeam.renderOrder = 4
			this.group.add(outerBeam)

			this.coreMaterial = level.own(
				new THREE.MeshBasicMaterial({
					color: 0xffe9a3,
					transparent: true,
					opacity: 0.42,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
					depthWrite: false,
				})
			)
			const coreBeam = new THREE.Mesh(
				level.own(
					new THREE.CylinderGeometry(
						0.18,
						0.55,
						170,
						10,
						1,
						true
					)
				),
				this.coreMaterial
			)
			coreBeam.position.y = 85
			coreBeam.renderOrder = 4
			this.group.add(coreBeam)

			this.ringMaterial = level.own(
				new THREE.MeshBasicMaterial({
					color: GUIDE_COLOR,
					transparent: true,
					opacity: 0.5,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
					depthWrite: false,
				})
			)
			this.ring = new THREE.Mesh(
				level.own(new THREE.RingGeometry(3.6, 5.0, 48)),
				this.ringMaterial
			)
			this.ring.rotation.x = -Math.PI / 2
			this.ring.position.y = 0.35
			this.ring.renderOrder = 4
			this.group.add(this.ring)

			this.light = new THREE.PointLight(GUIDE_COLOR, 3, 60, 2)
			this.light.position.y = 7
			this.group.add(this.light)

			this._normal = new THREE.Vector3(0, 1, 0)
			this._ringQuat = new THREE.Quaternion()
			this._flattenQuat =
				new THREE.Quaternion().setFromAxisAngle(
					new THREE.Vector3(1, 0, 0),
					-Math.PI / 2
				)
		}

		// --- Terrain-hugging guide line --------------------------------
		this._positions = new Float32Array(MAX_SAMPLES * 2 * 3)
		this._uvs = new Float32Array(MAX_SAMPLES * 2 * 2)
		this._colors = new Float32Array(MAX_SAMPLES * 2 * 4)
		const indices = []
		for (let i = 0; i < MAX_SAMPLES - 1; i++) {
			const a = i * 2
			const b = a + 1
			const c = a + 2
			const d = a + 3
			indices.push(a, b, c, b, d, c)
		}
		this.lineGeometry = level.own(new THREE.BufferGeometry())
		this.lineGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this._positions, 3)
		)
		this.lineGeometry.setAttribute(
			'uv',
			new THREE.BufferAttribute(this._uvs, 2)
		)
		this.lineGeometry.setAttribute(
			'color',
			new THREE.BufferAttribute(this._colors, 4)
		)
		this.lineGeometry.setIndex(indices)
		this.lineGeometry.setDrawRange(0, 0)

		this.lineMaterial = level.own(
			new THREE.MeshBasicMaterial({
				color: GUIDE_COLOR,
				map: this.dashTexture,
				transparent: true,
				vertexColors: true,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				depthWrite: false,
			})
		)
		this.ribbon = new THREE.Mesh(
			this.lineGeometry,
			this.lineMaterial
		)
		this.ribbon.name = `${name}-guide-line`
		this.ribbon.frustumCulled = false
		this.ribbon.renderOrder = 4
		level.addObject(this.ribbon)

		this._lastFrom = new THREE.Vector3(Infinity, 0, Infinity)
		this._lastTo = new THREE.Vector3(Infinity, 0, Infinity)
		this._samples = 0
	}

	/**
	 * @param {number} delta seconds
	 * @param {THREE.Vector3} playerPos pilot position (world)
	 * @param {object} options
	 * @param {boolean} options.active show the guide at all
	 */
	update(delta, playerPos, { active = true } = {}) {
		this.time += delta
		const target = active ? this.getTarget?.() : null
		const visible = Boolean(target)
		if (this.group) this.group.visible = visible
		this.ribbon.visible = visible
		if (!visible) return

		const planet = this.level.planet
		const anchor = this._anchor.copy(target)

		if (this.group) {
			// Beacon hugs the terrain under the target.
			this.group.position.set(
				anchor.x,
				planet.heightAt(anchor.x, anchor.z),
				anchor.z
			)
			planet.normalAt(anchor.x, anchor.z, 3, this._normal)
			this._ringQuat.setFromUnitVectors(UP, this._normal)
			this.ring.quaternion
				.copy(this._ringQuat)
				.multiply(this._flattenQuat)
			this.outerMaterial.opacity =
				0.14 + Math.sin(this.time * 1.8) * 0.05
			this.coreMaterial.opacity =
				0.4 + Math.sin(this.time * 2.3) * 0.12
			this.ring.scale.setScalar(
				1 + Math.sin(this.time * 2.1) * 0.06
			)
		}
		// Dashes stream along the line.
		this.dashTexture.offset.y -= delta * 0.35

		const dx = anchor.x - playerPos.x
		const dz = anchor.z - playerPos.z
		const distance = Math.hypot(dx, dz)
		if (distance < this.arriveDistance) {
			this.ribbon.visible = false
			return
		}
		this.ribbon.visible = true

		// Only rebuild when either end actually moved.
		const moved =
			this._lastFrom.distanceToSquared(playerPos) > 0.5 ||
			this._lastTo.distanceToSquared(anchor) > 0.25
		if (!moved && this._samples > 0) return
		this._lastFrom.copy(playerPos)
		this._lastTo.copy(anchor)

		const samples = THREE.MathUtils.clamp(
			Math.ceil(distance / SEGMENT_LENGTH) + 2,
			6,
			MAX_SAMPLES
		)
		this._samples = samples
		const halfWidth = LINE_WIDTH / 2
		const invLength = 1 / Math.max(distance, 1e-4)
		// Straight route in XZ: the perpendicular is constant.
		const perpX = -dz * invLength
		const perpZ = dx * invLength

		for (let i = 0; i < samples; i++) {
			const t = i / (samples - 1)
			const x = THREE.MathUtils.lerp(playerPos.x, anchor.x, t)
			const z = THREE.MathUtils.lerp(playerPos.z, anchor.z, t)
			const y = planet.heightAt(x, z) + HEIGHT_OFFSET
			const p = i * 6
			this._positions[p] = x + perpX * halfWidth
			this._positions[p + 1] = y
			this._positions[p + 2] = z + perpZ * halfWidth
			this._positions[p + 3] = x - perpX * halfWidth
			this._positions[p + 4] = y
			this._positions[p + 5] = z - perpZ * halfWidth

			const u = i * 4
			const v = (t * distance) / DASH_PERIOD
			this._uvs[u] = 0
			this._uvs[u + 1] = v
			this._uvs[u + 2] = 1
			this._uvs[u + 3] = v

			// Fade in from the pilot's position and out into the beacon.
			const fadeIn = THREE.MathUtils.clamp(
				(t * distance) / 8,
				0,
				1
			)
			const fadeOut = THREE.MathUtils.clamp(
				((1 - t) * distance) / 8,
				0,
				1
			)
			const alpha = 0.9 * fadeIn * fadeOut
			this._colors[u] = 1
			this._colors[u + 1] = 1
			this._colors[u + 2] = 1
			this._colors[u + 3] = alpha
			this._colors[u + 4] = 1
			this._colors[u + 5] = 1
			this._colors[u + 6] = 1
			this._colors[u + 7] = alpha
		}

		this.lineGeometry.setDrawRange(0, (samples - 1) * 6)
		const attrs = this.lineGeometry.attributes
		attrs.position.needsUpdate = true
		attrs.uv.needsUpdate = true
		attrs.color.needsUpdate = true
	}
}
