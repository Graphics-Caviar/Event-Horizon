import * as THREE from 'three'
import { Character } from './Character.js'

export class Kai extends Character {
	_createMaterials() {
		const base = super._createMaterials()
		return Object.assign(base, {
			suit: new THREE.MeshStandardMaterial({
				color: 0x3a4536,
				roughness: 0.85,
				metalness: 0.05,
			}),
			vest: new THREE.MeshStandardMaterial({
				color: 0x51483c,
				roughness: 0.8,
			}),
			accent: new THREE.MeshStandardMaterial({
				color: 0x7dffa0,
				emissive: 0x1f6b34,
				emissiveIntensity: 1.1,
				roughness: 0.35,
			}),
			hair: new THREE.MeshStandardMaterial({
				color: 0x241a12,
				roughness: 0.8,
			}),
			metal: new THREE.MeshStandardMaterial({
				color: 0x6b6d6a,
				roughness: 0.5,
				metalness: 0.6,
			}),
		})
	}

	_addHeadDetails(head) {
		const hairGeo = new THREE.SphereGeometry(
			0.17,
			12,
			12,
			0,
			Math.PI * 2,
			0,
			Math.PI * 0.5
		)
		this._geometries.push(hairGeo)
		const hair = new THREE.Mesh(hairGeo, this.materials.hair)
		hair.position.y = 0.02
		head.add(hair)
	}

	_addTorsoDetails(torso) {
		// Utility vest over the base suit.
		const vestGeo = new THREE.CylinderGeometry(
			0.28,
			0.24,
			0.42,
			8,
			1,
			true
		)
		this._geometries.push(vestGeo)
		const vest = new THREE.Mesh(vestGeo, this.materials.vest)
		vest.position.y = 0.4
		torso.add(vest)

		// A row of small pouches — "small technology devices" from the brief.
		const pouchGeo = new THREE.BoxGeometry(0.08, 0.1, 0.06)
		this._geometries.push(pouchGeo)
		for (const x of [-0.15, 0, 0.15]) {
			const pouch = new THREE.Mesh(
				pouchGeo,
				this.materials.metal
			)
			pouch.position.set(x, 0.28, 0.24)
			torso.add(pouch)
		}
	}

	_addEquipment(equipment, backpack) {
		// Tool belt.
		const beltGeo = new THREE.TorusGeometry(0.27, 0.03, 8, 16)
		this._geometries.push(beltGeo)
		const belt = new THREE.Mesh(beltGeo, this.materials.dark)
		belt.rotation.x = Math.PI / 2
		belt.position.y = 0.02
		equipment.add(belt)

		// A wrench-like tool hanging off the belt.
		const toolGeo = new THREE.CylinderGeometry(
			0.015,
			0.015,
			0.22,
			6
		)
		this._geometries.push(toolGeo)
		const tool = new THREE.Mesh(toolGeo, this.materials.metal)
		tool.rotation.z = 0.3
		tool.position.set(0.24, -0.1, 0.1)
		equipment.add(tool)

		// Backpack.
		const packGeo = new THREE.BoxGeometry(0.24, 0.32, 0.14)
		this._geometries.push(packGeo)
		const pack = new THREE.Mesh(packGeo, this.materials.vest)
		pack.position.set(0, 0.35, -0.22)
		backpack.add(pack)

		this.leftHand.material = this.materials.dark
		this.rightHand.material = this.materials.dark
		this.leftFoot.material = this.materials.metal
		this.rightFoot.material = this.materials.metal
	}

	/** Repair Drone — deploys a small hovering drone with green
	 * electrical-repair sparks. The drone is driven by this class's own
	 * update(delta) below, not an independent requestAnimationFrame loop,
	 * so it respects the same lifecycle (and gets cleaned up correctly)
	 * as everything else. */
	playAbility() {
		if (!this._droneGeometry) {
			this._droneGeometry = new THREE.OctahedronGeometry(
				0.09,
				0
			)
		}
		const material = new THREE.MeshStandardMaterial({
			color: 0x1a2318,
			emissive: 0x2fbf5a,
			emissiveIntensity: 1.4,
			roughness: 0.4,
		})
		const drone = new THREE.Mesh(this._droneGeometry, material)
		drone.position.set(0.4, 1.5, 0.1)
		this.effects.add(drone)
		this._drones = this._drones || []
		this._drones.push({
			mesh: drone,
			material,
			life: 2.2,
			baseY: 1.5,
		})

		for (let i = 0; i < 10; i++) {
			const sparkMaterial = new THREE.MeshBasicMaterial({
				color: 0x7dffa0,
				transparent: true,
				opacity: 0.9,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			})
			const position = new THREE.Vector3(
				0.4 + (Math.random() - 0.5) * 0.2,
				1.4 + Math.random() * 0.3,
				0.1
			)
			const velocity = new THREE.Vector3(
				(Math.random() - 0.5) * 1.2,
				(Math.random() - 0.3) * 1.0,
				(Math.random() - 0.5) * 1.2
			)
			this._spawnEffectParticle({
				position,
				velocity,
				life: 0.3 + Math.random() * 0.3,
				material: sparkMaterial,
				scale: 0.06,
			})
		}
	}

	update(delta, options) {
		super.update(delta, options)

		if (this._drones && this._drones.length) {
			for (let i = this._drones.length - 1; i >= 0; i--) {
				const d = this._drones[i]
				d.mesh.rotation.y += delta * 2.4
				d.time = (d.time || 0) + delta
				d.mesh.position.y =
					d.baseY + Math.sin(d.time * 3) * 0.08
				d.life -= delta
				if (d.life <= 0) {
					this.effects.remove(d.mesh)
					d.material.dispose()
					this._drones.splice(i, 1)
				}
			}
		}
	}

	dispose() {
		if (this._drones) {
			for (const d of this._drones) {
				this.effects.remove(d.mesh)
				d.material.dispose()
			}
			this._drones.length = 0
		}
		if (this._droneGeometry) this._droneGeometry.dispose()
		super.dispose()
	}
}
