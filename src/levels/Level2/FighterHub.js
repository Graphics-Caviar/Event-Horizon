import * as THREE from 'three'
import { CinematicShip } from '../../cutscenes/CinematicShip.js'

/** Persistent surface landmark; the cinematic launches the fleet seen in gameplay. */
export class FighterHub {
	constructor(level) {
		this.level = level
		this.group = new THREE.Group()
		this.group.name = 'alien-fighter-hub'
		level.addObject(this.group)
		this.ships = []
		const site = level.roverApproach.shipSite
		const ground = (x, z) => level.planet.heightAt(x, z)
		const metal = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x172938,
				metalness: 0.8,
				roughness: 0.35,
			})
		)
		const trim = level.own(
			new THREE.MeshStandardMaterial({
				color: 0x567687,
				metalness: 0.75,
				roughness: 0.4,
			})
		)
		const cyan = level.own(
			new THREE.MeshBasicMaterial({
				color: 0x4af4ed,
				toneMapped: false,
			})
		)
		const amber = level.own(
			new THREE.MeshBasicMaterial({
				color: 0xffaa51,
				toneMapped: false,
			})
		)
		const mesh = (geometry, material, x, y, z) => {
			const node = new THREE.Mesh(
				level.own(geometry),
				material
			)
			node.position.set(x, y, z)
			node.castShadow = node.receiveShadow = true
			this.group.add(node)
			return node
		}
		this.rings = []
		for (let i = 0; i < 6; i++) {
			const x = site.x + ((i % 3) - 1) * 37
			const z = site.z + 34 + Math.floor(i / 3) * 38
			const y = ground(x, z)
			mesh(
				new THREE.CylinderGeometry(15, 17, 1.2, 6),
				metal,
				x,
				y + 0.1,
				z
			)
			const ring = mesh(
				new THREE.TorusGeometry(13, 0.16, 5, 48),
				cyan,
				x,
				y + 0.8,
				z
			)
			ring.rotation.x = -Math.PI / 2
			this.rings.push(ring)
			// Open front and swept roof preserve the parked fighter silhouette.
			const roof = mesh(
				new THREE.ConeGeometry(23, 8, 3),
				metal,
				x,
				y + 17,
				z + 4
			)
			roof.scale.set(1, 0.5, 0.85)
			roof.rotation.y = Math.PI
			for (const side of [-1, 1]) {
				const rib = mesh(
					new THREE.BoxGeometry(1.8, 16, 2.4),
					trim,
					x + side * 15,
					y + 8,
					z + 9
				)
				rib.rotation.z = side * 0.18
				mesh(
					new THREE.BoxGeometry(0.4, 13, 0.4),
					cyan,
					x + side * 14,
					y + 8,
					z + 7.5
				)
				level._registerGameplayCollider(
					x + side * 15,
					z + 9,
					2.5,
					'hub-support',
					rib
				)
			}
			for (let j = 0; j < 3; j++) {
				mesh(
					new THREE.BoxGeometry(3.5, 0.12, 0.5),
					amber,
					x + (j - 1) * 5,
					y + 0.9,
					z - 12
				)
			}
			this._park(x, z, y + 0.8)
		}
		// Stolen fighter sits on the open forecourt, clear of the run and ramp.
		this.hero = this._park(
			site.x,
			site.z,
			ground(site.x, site.z) + 0.3
		)
		const towerX = site.x + 73,
			towerZ = site.z + 65
		const towerY = ground(towerX, towerZ)
		const tower = mesh(
			new THREE.CylinderGeometry(5, 11, 52, 6),
			metal,
			towerX,
			towerY + 26,
			towerZ
		)
		level._registerGameplayCollider(
			towerX,
			towerZ,
			12,
			'hub-command',
			tower
		)
		mesh(
			new THREE.OctahedronGeometry(9),
			trim,
			towerX,
			towerY + 54,
			towerZ
		)
		this.crown = mesh(
			new THREE.TorusGeometry(13, 0.5, 6, 64),
			cyan,
			towerX,
			towerY + 54,
			towerZ
		)
		this.crown.rotation.x = Math.PI / 2.5
		mesh(
			new THREE.CylinderGeometry(0.4, 1.2, 28, 6),
			cyan,
			towerX,
			towerY + 72,
			towerZ
		)
		for (let i = 0; i < 5; i++) {
			const x = site.x + (i % 2 ? -9 : 9),
				z = site.z - 15 - i * 6
			mesh(
				new THREE.BoxGeometry(1, 0.25, 2),
				cyan,
				x,
				ground(x, z) + 0.5,
				z
			)
		}
		this.fleet = this.ships.slice(0, 6).map((ship) => ship.group)
	}
	_park(x, z, floor) {
		const ship = new CinematicShip({
			assetManager: this.level.assetManager,
			craft: 'anomaly',
		})
		ship.group.position.set(x, floor - ship.hullBottom, z)
		ship.group.quaternion.copy(this.level.portal.group.quaternion)
		this.group.add(ship.group)
		this.ships.push(ship)
		ship.ready.then(() => {
			if (this.disposed) return
			ship.group.position.y = floor - ship.hullBottom
			ship.lockAppearance()
		})
		return ship
	}
	update(dt) {
		this.crown.rotation.z += dt * 0.16
		for (const ship of this.ships) ship.update(dt, { thrust: 0 })
	}
	dispose() {
		this.disposed = true
		for (const ship of this.ships) ship.dispose()
		this.group.removeFromParent()
	}
}
