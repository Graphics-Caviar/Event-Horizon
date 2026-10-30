import * as THREE from 'three'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { AlienPlanet } from '../Level2/AlienPlanet.js'

const noise = new ImprovedNoise()
const sample = (x, z, scale) =>
	noise.noise(x / scale - 73.4, z / scale + 28.6, 19.8)

export const CRYSTAL_MOUNTAINS = Object.freeze([
	{ x: -285, z: -185, height: 165, rx: 130, rz: 155 },
	{ x: -160, z: -320, height: 130, rx: 125, rz: 105 },
	{ x: 230, z: -270, height: 155, rx: 140, rz: 120 },
	{ x: 390, z: -60, height: 140, rx: 105, rz: 165 },
	{ x: 305, z: 310, height: 160, rx: 150, rz: 130 },
	{ x: -275, z: 340, height: 135, rx: 120, rz: 115 },
])

// Level 3 has its own landform: winding mineral valleys and folded ridges.
// It shares triangle sampling/collision infrastructure, not Level 2's heightmap.
export function crystalTerrainHeight(x, z, baseY = -140) {
	let mountains = 0
	for (const peak of CRYSTAL_MOUNTAINS) {
		const dx = (x - peak.x) / peak.rx
		const dz = (z - peak.z) / peak.rz
		const radius = Math.hypot(dx, dz)
		// Broad foothills rise to a craggy summit; all relief is part of the
		// real terrain mesh and its physics collider, not background decoration.
		const envelope = Math.exp(-radius * radius * 2)
		const summit = Math.exp(-radius * radius * 6)
		const ridges =
			Math.sin(Math.atan2(dz, dx) * 5 + radius * 4) *
			Math.min(radius, 0.5)
		mountains +=
			peak.height *
			(envelope * 0.7 + summit * 0.3) *
			(1 + ridges * 0.22)
	}
	const river = x - Math.sin(z / 130) * 105 - 75
	const valley = Math.exp(-Math.pow(river / 65, 2))
	const folds = Math.pow(
		Math.abs(Math.sin((x + z * 0.38) / 125 + sample(x, z, 170))),
		2
	)
	return (
		baseY +
		mountains +
		22 +
		folds * 43 +
		sample(x, z, 155) * 28 -
		valley * 29 +
		sample(x, z, 42) * 5 +
		sample(x, z, 12) * 3.6 +
		sample(x, z, 4) * 0.9
	)
}

export class CrystalPlanet extends AlienPlanet {
	_heightFunction(x, z) {
		const height = crystalTerrainHeight(x, z, this.baseY)
		let safe = 0
		for (const zone of this.clearZones) {
			const distance = Math.hypot(x - zone.x, z - zone.z)
			safe = Math.max(
				safe,
				1 -
					THREE.MathUtils.smoothstep(
						distance,
						zone.radius,
						zone.radius + 55
					)
			)
		}
		// Wide paths connect the landing shelf to each objective.
		const start = this.clearZones[0]
		if (start)
			for (const end of this.clearZones.slice(1)) {
				const dx = end.x - start.x,
					dz = end.z - start.z
				const t = THREE.MathUtils.clamp(
					((x - start.x) * dx +
						(z - start.z) * dz) /
						(dx * dx + dz * dz || 1),
					0,
					1
				)
				const distance = Math.hypot(
					x - start.x - dx * t,
					z - start.z - dz * t
				)
				safe = Math.max(
					safe,
					1 -
						THREE.MathUtils.smoothstep(
							distance,
							13,
							42
						)
				)
			}
		const routeDistance = this._drivingRouteDistance(x, z)
		safe = Math.max(
			safe,
			1 - THREE.MathUtils.smoothstep(routeDistance, 12, 46)
		)
		return THREE.MathUtils.lerp(
			height,
			this.baseY +
				14 +
				sample(x, z, 25) * 0.6 +
				sample(x, z, 5) * 0.25,
			safe
		)
	}

	_buildTerrain() {
		super._buildTerrain()
		const geometry = this.terrain.geometry
		const positions = geometry.attributes.position
		const colors = geometry.attributes.color
		const normal = geometry.attributes.normal
		const rock = new THREE.Color('#171429')
		const moss = new THREE.Color('#22213e')
		const mineral = new THREE.Color('#64318a')
		const ochre = new THREE.Color('#183b50')
		const summitStone = new THREE.Color('#41335c')
		const color = new THREE.Color()
		for (let i = 0; i < positions.count; i++) {
			const x = positions.getX(i) + this.center.x
			const z = positions.getZ(i) + this.center.z
			const slope = 1 - normal.getY(i)
			const vein =
				1 -
				THREE.MathUtils.smoothstep(
					Math.abs(
						x - Math.sin(z / 130) * 105 - 75
					),
					18,
					85
				)
			color.copy(moss).lerp(
				rock,
				THREE.MathUtils.clamp(slope * 4.5, 0, 1)
			)
			color.lerp(mineral, vein * 0.7)
			color.lerp(
				ochre,
				THREE.MathUtils.smoothstep(
					sample(x, z, 75),
					0.05,
					0.55
				) * 0.7
			)
			const altitude = positions.getY(i)
			color.lerp(
				rock,
				THREE.MathUtils.smoothstep(altitude, 65, 115) *
					0.85
			)
			color.lerp(
				summitStone,
				THREE.MathUtils.smoothstep(
					altitude + sample(x, z, 18) * 12,
					130,
					195
				) * 0.8
			)
			color.multiplyScalar(0.88 + sample(x, z, 9) * 0.18)
			colors.setXYZ(i, color.r, color.g, color.b)
		}
		colors.needsUpdate = true
		this.terrain.material = this.level.own(
			new THREE.MeshPhysicalMaterial({
				color: 0xffffff,
				vertexColors: true,
				map: this.surfaceTexture,
				bumpMap: this.surfaceTexture,
				bumpScale: 0.8,
				roughness: 1,
				metalness: 0,
				clearcoat: 0,
				specularIntensity: 0,
				envMapIntensity: 0,
			})
		)
		this.terrain.name = 'level3-folded-mineral-valleys'
	}

	_buildHorizon() {
		super._buildHorizon()
		this.root.children.at(-1).material.color.set('#292e3a')
	}

	_isSpawnClear(x, z, radius) {
		if (!this.isInsideBounds(x, z, radius)) return false
		for (const zone of this.clearZones) {
			if (
				Math.hypot(x - zone.x, z - zone.z) <
				zone.radius + radius + 8
			)
				return false
		}
		// Keep the same connecting paths free of scenery as well as steep slopes.
		const start = this.clearZones[0]
		if (start)
			for (const end of this.clearZones.slice(1)) {
				const dx = end.x - start.x,
					dz = end.z - start.z
				const t = THREE.MathUtils.clamp(
					((x - start.x) * dx +
						(z - start.z) * dz) /
						(dx * dx + dz * dz || 1),
					0,
					1
				)
				if (
					Math.hypot(
						x - start.x - dx * t,
						z - start.z - dz * t
					) <
					16 + radius
				)
					return false
			}
		return true
	}

	// Rocks and gravel are removed; crystals alone occupy the terrain.
	_buildRocks() {}
	_buildOutcrops() {}
	_buildGravel() {}
	_buildLava() {
		return { update() {} }
	}
}
