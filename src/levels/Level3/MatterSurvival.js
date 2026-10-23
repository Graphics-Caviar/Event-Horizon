import * as THREE from 'three'
import { TerrainCrumble } from './TerrainCrumble.js'

export const SURVIVAL_DEFAULTS = Object.freeze({
	countdown: 30,
	collapseSeconds: 90,
	maxFuel: 100,
	burnRate: 5,
	refill: 45,
	respawn: 12,
})

/** Collapse and fuel share the playable clock; cinematics never spend either. */
export class MatterSurvival {
	constructor(level, options = {}) {
		this.level = level
		this.config = { ...SURVIVAL_DEFAULTS, ...options }
		this.time = 0
		this.fuel = this.config.maxFuel
		this.start = level.landingSite.clone()
		this.end = level.portalSite.clone()
		this.direction = this.end
			.clone()
			.sub(this.start)
			.setY(0)
			.normalize()
		this.length = Math.max(
			1,
			this.end.clone().sub(this.start).setY(0).length()
		)
		this.edge = -Infinity
		this.group = new THREE.Group()
		this.group.name = 'nitrogen-refill-stations'
		this.resources = []
		this.pickups = []
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const padGeometry = own(new THREE.CylinderGeometry(6, 5, 2, 6))
		const canGeometry = own(
			new THREE.CylinderGeometry(0.65, 0.65, 2.4, 10)
		)
		const padMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x24243d,
				emissive: 0x15334a,
				emissiveIntensity: 0.7,
			})
		)
		const fuelMaterial = own(
			new THREE.MeshStandardMaterial({
				color: 0x72ffda,
				emissive: 0x24bbae,
				emissiveIntensity: 1.4,
			})
		)
		const capGeometry = own(
			new THREE.CylinderGeometry(0.8, 0.8, 0.35, 12)
		)
		const ringGeometry = own(
			new THREE.TorusGeometry(1.6, 0.055, 6, 32)
		)
		const finGeometry = own(new THREE.BoxGeometry(0.18, 1.65, 0.4))
		const casing = own(
			new THREE.MeshStandardMaterial({
				color: 0x73899d,
				metalness: 0.85,
				roughness: 0.3,
			})
		)
		const haloMaterial = own(
			new THREE.MeshBasicMaterial({
				color: 0x68ffe7,
				transparent: true,
				opacity: 0.65,
				depthWrite: false,
			})
		)
		const count = Math.max(4, Math.ceil(this.length / 38))
		for (let i = 0; i <= count; i++) {
			const point = this.start
				.clone()
				.lerp(this.end, i / count)
			point.y = level.planet.heightAt(point.x, point.z) + 0.4
			const pad = new THREE.Mesh(padGeometry, padMaterial)
			pad.position.copy(point).y -= 1
			const can = new THREE.Group()
			can.name = 'floating-nitrogen-cell'
			const core = new THREE.Mesh(canGeometry, fuelMaterial)
			can.add(core)
			for (const sign of [-1, 1]) {
				const cap = new THREE.Mesh(capGeometry, casing)
				cap.position.y = sign * 1.35
				can.add(cap)
			}
			for (let j = 0; j < 3; j++) {
				const a = (j * Math.PI * 2) / 3
				const fin = new THREE.Mesh(finGeometry, casing)
				fin.position.set(
					Math.cos(a) * 0.85,
					0,
					Math.sin(a) * 0.85
				)
				fin.rotation.y = -a
				can.add(fin)
			}
			const halo = new THREE.Group()
			for (const angle of [0.55, -0.55]) {
				const ring = new THREE.Mesh(
					ringGeometry,
					haloMaterial
				)
				ring.rotation.set(Math.PI / 2, angle, angle)
				halo.add(ring)
			}
			can.add(halo)
			can.position.copy(point).y += 4.5
			this.group.add(pad, can)
			this.pickups.push({
				point,
				can,
				halo,
				phase: i * 1.7,
				cooldown: 0,
			})
		}
		level.addObject(this.group)
		this._installTerrainEffect()
		this.crumble = new TerrainCrumble(this)
	}

	get remaining() {
		return Math.max(0, this.config.countdown - this.time)
	}
	isGone(x, z) {
		if (Math.hypot(x - this.end.x, z - this.end.z) < 28)
			return false
		return (
			(x - this.start.x) * this.direction.x +
				(z - this.start.z) * this.direction.z <
			this.edge
		)
	}
	surfaceHeightAt(x, z) {
		return this.isGone(x, z)
			? -Infinity
			: this.level.planet.heightAt(x, z)
	}
	supportHeightAt(x, z, feet) {
		let floor = this.surfaceHeightAt(x, z)
		for (const p of this.pickups) {
			if (
				Math.hypot(x - p.point.x, z - p.point.z) <
					5.6 &&
				feet >= p.point.y - 0.8
			)
				floor = Math.max(floor, p.point.y)
		}
		return floor
	}
	burn(delta, requested) {
		if (
			this.level.transitionHeld ||
			this.level.completed ||
			!Number.isFinite(delta) ||
			delta <= 0 ||
			!requested ||
			this.fuel <= 0
		)
			return false
		this.fuel = Math.max(
			0,
			this.fuel - this.config.burnRate * delta
		)
		return true
	}
	update(delta) {
		if (
			this.level.transitionHeld ||
			this.level.completed ||
			!Number.isFinite(delta) ||
			delta <= 0
		)
			return
		this.time += delta
		this.edge =
			this.time < this.config.countdown
				? -Infinity
				: -35 +
					((this.time - this.config.countdown) /
						this.config.collapseSeconds) *
						(this.length + 70)
		this.uniform.value = Number.isFinite(this.edge)
			? this.edge
			: -100000
		this.crumble.update(delta)
		this.tremorUniform.value =
			this.remaining > 0
				? Math.max(0, 1 - this.remaining / 5)
				: 0
		this.timeUniform.value = this.time
		const player = this.level.playerRoot.position
		const ahead =
			(player.x - this.start.x) * this.direction.x +
			(player.z - this.start.z) * this.direction.z -
			this.edge
		const warning =
			this.remaining > 0 && this.remaining < 5
				? 1 - this.remaining / 5
				: ahead >= 0 && ahead < 20
					? 1 - ahead / 20
					: 0
		if (warning > 0 && !this.level._airborne)
			this.level._requestShake?.(warning * 0.22)
		for (const p of this.pickups) {
			p.cooldown = Math.max(0, p.cooldown - delta)
			p.can.visible = p.cooldown <= 0
			p.can.rotation.y += delta
			p.can.position.y =
				p.point.y +
				4.5 +
				Math.sin(this.time * 1.7 + p.phase) * 0.8
			p.can.rotation.z =
				Math.sin(this.time * 1.1 + p.phase) * 0.14
			p.halo.rotation.y -= delta * 1.8
			if (
				p.cooldown <= 0 &&
				this.fuel < this.config.maxFuel &&
				player.distanceTo(p.can.position) < 5.5
			) {
				this.fuel = Math.min(
					this.config.maxFuel,
					this.fuel + this.config.refill
				)
				p.cooldown = this.config.respawn
				p.can.visible = false
				this.level._showMovementFeedback(
					`NITROGEN +${this.config.refill} / JETPACK REFILLED`,
					1.5
				)
			}
		}
	}
	_installTerrainEffect() {
		this.uniform = { value: -100000 }
		this.tremorUniform = { value: 0 }
		this.timeUniform = { value: 0 }
		const material = this.level.planet.terrain.material
		this.previousCompile = material.onBeforeCompile
		this.previousKey = material.customProgramCacheKey
		material.onBeforeCompile = (shader) => {
			this.previousCompile.call(material, shader)
			shader.uniforms.collapseEdge = this.uniform
			shader.uniforms.collapseTremor = this.tremorUniform
			shader.uniforms.collapseTime = this.timeUniform
			shader.uniforms.collapseStart = { value: this.start }
			shader.uniforms.collapseDirection = {
				value: this.direction,
			}
			shader.uniforms.collapseExit = { value: this.end }
			shader.vertexShader =
				'varying vec3 vCollapseWorld; uniform float collapseTime; uniform float collapseTremor; uniform float collapseEdge; uniform vec3 collapseStart; uniform vec3 collapseDirection;\n' +
				shader.vertexShader
			shader.vertexShader = shader.vertexShader.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
 vCollapseWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
 float ahead = dot(vCollapseWorld.xz - collapseStart.xz, collapseDirection.xz) - collapseEdge;
 float vibration = collapseTremor * (1.0 - step(0.0, collapseEdge + 99999.0)) + (1.0 - smoothstep(0.0, 20.0, abs(ahead)));
 transformed.y += sin(collapseTime * 46.0 + floor(vCollapseWorld.x / 12.0) * 7.0 + floor(vCollapseWorld.z / 12.0) * 3.0) * vibration * 0.13;`
			)
			shader.fragmentShader =
				'varying vec3 vCollapseWorld; uniform float collapseEdge; uniform vec3 collapseStart; uniform vec3 collapseDirection; uniform vec3 collapseExit; uniform float collapseTremor; uniform float collapseTime;\n' +
				shader.fragmentShader
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <clipping_planes_fragment>',
				`#include <clipping_planes_fragment>
        float collapseDistance = dot(vCollapseWorld.xz - collapseStart.xz, collapseDirection.xz) - collapseEdge;
        if (collapseDistance < 0.0 && distance(vCollapseWorld.xz, collapseExit.xz) > 28.0) discard;`
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <opaque_fragment>',
				`vec2 fractureCell = abs(fract(vCollapseWorld.xz / 12.0) - 0.5);
 float fracture = smoothstep(0.46, 0.49, max(fractureCell.x, fractureCell.y));
 float instability = max(collapseTremor * 0.5, 1.0 - smoothstep(0.0, 22.0, abs(collapseDistance)));
 outgoingLight *= 1.0 - fracture * instability * 0.8;
 outgoingLight += vec3(0.9, 0.15, 0.45) * fracture * instability * (0.65 + 0.35 * sin(collapseTime * 12.0));
 outgoingLight += vec3(0.65, 0.08, 0.45) * (1.0 - smoothstep(0.0, 3.0, abs(collapseDistance)));
#include <opaque_fragment>`
			)
		}
		material.customProgramCacheKey = () => 'matter-collapse-v2'
		material.needsUpdate = true
	}
	dispose() {
		if (this.disposed) return
		this.disposed = true
		this.crumble?.dispose()
		const material = this.level.planet.terrain.material
		material.onBeforeCompile = this.previousCompile
		material.customProgramCacheKey = this.previousKey
		material.needsUpdate = true
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}
