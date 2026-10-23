import * as THREE from 'three'

const jitter = (n) => {
	const v = Math.sin(n * 79.31 + 12.9) * 43758.54
	return v - Math.floor(v)
}

/** Fixed pool of detached terrain slabs; collapse collision remains in MatterSurvival. */
export class TerrainCrumble {
	constructor(survival) {
		this.survival = survival
		this.level = survival.level
		this.geometry = new THREE.CylinderGeometry(1, 0.75, 1, 5, 1)
		const pos = this.geometry.attributes.position
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i),
				z = pos.getZ(i)
			const scale = 0.8 + Math.sin(x * 4 + z * 7) * 0.16
			pos.setXYZ(i, x * scale, pos.getY(i), z * scale)
		}
		this.geometry.computeVertexNormals()
		this.material = new THREE.MeshStandardMaterial({
			color: 0x383047,
			roughness: 0.92,
			emissive: 0x401833,
			emissiveIntensity: 0.4,
			flatShading: true,
		})
		this.mesh = new THREE.InstancedMesh(
			this.geometry,
			this.material,
			192
		)
		this.mesh.name = 'detached-crumbling-terrain'
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.mesh.frustumCulled = false
		survival.group.add(this.mesh)
		this.slabs = Array.from({ length: 192 }, () => ({
			age: 10,
			origin: new THREE.Vector3(),
		}))
		this.pose = new THREE.Object3D()
		this.side = new THREE.Vector3(
			-survival.direction.z,
			0,
			survival.direction.x
		)
		this.serial = 0
		this.nextRow = -35
		this.update(0)
	}
	update(delta) {
		const s = this.survival
		if (!Number.isFinite(s.edge) && this.serial === 0) {
			this.mesh.visible = false
			return
		}
		this.mesh.visible = true
		if (
			Number.isFinite(s.edge) &&
			s.edge <= s.length + 35 &&
			s.edge >= this.nextRow
		) {
			// Catch up visually at the live boundary, without allocating a backlog after a stall.
			this.nextRow = Math.max(this.nextRow, s.edge - 24)
			let rows = 0
			while (this.nextRow <= s.edge && rows++ < 3) {
				const player = this.level.playerRoot.position
				const lateral = player
					.clone()
					.sub(s.start)
					.dot(this.side)
				for (let i = -6; i <= 6; i++) {
					const seed = this.serial++
					const slab =
						this.slabs[
							seed % this.slabs.length
						]
					slab.origin
						.copy(s.start)
						.addScaledVector(
							s.direction,
							this.nextRow - 3
						)
						.addScaledVector(
							this.side,
							lateral + i * 11
						)
					if (
						Math.hypot(
							slab.origin.x - s.end.x,
							slab.origin.z - s.end.z
						) < 32
					)
						continue
					slab.origin.y =
						this.level.planet.heightAt(
							slab.origin.x,
							slab.origin.z
						) - 1.5
					slab.age = 0
					slab.seed = seed
				}
				const point = s.start
					.clone()
					.addScaledVector(
						s.direction,
						this.nextRow
					)
					.addScaledVector(this.side, lateral)
				point.y = this.level.planet.heightAt(
					point.x,
					point.z
				)
				if (point.distanceTo(player) < 90) {
					this.level.dust?.spawnBurst(point, {
						count: 14,
						strength: 2,
						spread: 9,
						size: 1.8,
						upBias: 0.4,
					})
					this.level.voidAudio?.play(
						'shock',
						point,
						0.35
					)
				}
				this.nextRow += 12
			}
		}
		for (let i = 0; i < this.slabs.length; i++) {
			const slab = this.slabs[i]
			slab.age += delta
			if (slab.age > 5) {
				this.pose.scale.setScalar(0)
			} else {
				const t = slab.age,
					seed = slab.seed
				this.pose.position
					.copy(slab.origin)
					.addScaledVector(
						this.side,
						(jitter(seed) - 0.5) * t * 4
					)
				this.pose.position.y -= 1.5 * t + 4.9 * t * t
				this.pose.rotation.set(
					t * (jitter(seed + 10) - 0.5),
					seed,
					t * (jitter(seed + 20) - 0.5)
				)
				const fade = Math.min(1, (5 - t) * 1.5)
				this.pose.scale.set(
					(5 + jitter(seed + 1) * 3) * fade,
					(2.5 + jitter(seed + 2) * 3) * fade,
					(5 + jitter(seed + 3) * 3) * fade
				)
			}
			this.pose.updateMatrix()
			this.mesh.setMatrixAt(i, this.pose.matrix)
		}
		this.mesh.instanceMatrix.needsUpdate = true
	}
	dispose() {
		this.mesh.removeFromParent()
		this.mesh.dispose()
		this.geometry.dispose()
		this.material.dispose()
	}
}
