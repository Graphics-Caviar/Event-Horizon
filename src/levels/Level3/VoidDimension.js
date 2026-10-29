import * as THREE from 'three'
import { VoidSpaceBackdrop } from './VoidSpaceBackdrop.js'
import { VoidDrifters } from './VoidDrifters.js'

/** A separate, explorable zero-gravity space beyond the Matter wormhole. */
export class VoidDimension {
	constructor(level) {
		this.level = level
		this.time = 0
		this.resources = []
		this.hidden = []
		const scene = level.sceneManager.scene
		this.previous = {
			background: scene.background,
			fog: scene.fog,
			environment: scene.environment,
		}
		for (const object of scene.children) {
			if (
				object === level.playerRoot ||
				object.isLight ||
				object.isCamera
			)
				continue
			this.hidden.push([object, object.visible])
			object.visible = false
		}
		this.previousFar = level.sceneManager.camera.far
		level.sceneManager.camera.far = Math.max(this.previousFar, 8000)
		level.sceneManager.camera.updateProjectionMatrix()
		scene.background = new THREE.Color(0x000003)
		scene.fog = null
		scene.environment = null
		this.group = new THREE.Group()
		this.group.name = 'void-dimension-zero-gravity'
		scene.add(this.group)
		const own = (r) => {
			this.resources.push(r)
			return r
		}
		const violet = own(
			new THREE.MeshStandardMaterial({
				color: 0x17102b,
				emissive: 0x24105b,
				emissiveIntensity: 0.6,
				metalness: 0.7,
				roughness: 0.35,
			})
		)
		const glow = own(
			new THREE.MeshBasicMaterial({ color: 0x79eeff })
		)
		const stone = own(new THREE.IcosahedronGeometry(1, 0))
		this.shards = []
		for (let i = 0; i < 95; i++) {
			const a = i * 2.39996,
				radius = 55 + (i % 9) * 16
			const mesh = new THREE.Mesh(stone, violet)
			mesh.position.set(
				Math.cos(a) * radius,
				Math.sin(a) * radius,
				100 - i * 7
			)
			mesh.scale.set(6 + (i % 13), 12 + (i % 23), 5 + (i % 7))
			mesh.rotation.set(i, i * 0.7, i * 0.3)
			this.group.add(mesh)
			this.shards.push(mesh)
		}
		const stars = new Float32Array(4800 * 3)
		for (let i = 0; i < 4800; i++) {
			const a = i * 2.39996,
				y = 1 - (2 * (i + 0.5)) / 4800,
				r = Math.sqrt(1 - y * y)
			stars.set(
				[
					Math.cos(a) * r * 6000,
					y * 6000,
					Math.sin(a) * r * 6000 - 200,
				],
				i * 3
			)
		}
		const starGeometry = own(new THREE.BufferGeometry())
		starGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(stars, 3)
		)
		this.group.add(
			new THREE.Points(
				starGeometry,
				own(
					new THREE.PointsMaterial({
						color: 0xc4d5ff,
						size: 3,
						sizeAttenuation: true,
					})
				)
			)
		)
		this.rings = []
		const ringGeometry = own(
			new THREE.TorusGeometry(14, 0.18, 8, 96)
		)
		for (let i = 0; i < 6; i++) {
			const ring = new THREE.Mesh(ringGeometry, glow)
			ring.position.set(0, 8, -45 - i * 65)
			this.group.add(ring)
			this.rings.push(ring)
		}
		this.spaceBackdrop = new VoidSpaceBackdrop(level, this.group)
		this.drifters = new VoidDrifters(level, this.group)
		this.exit = this.rings.at(-1).position
		level.playerRoot.position.set(0, 8, 15)
		level.playerRoot.visible = true
		// First-person mode hides the model itself, not just its gameplay root.
		// The void owns a third-person camera and must clear both visibility states.
		level.firstPerson = false
		level.boarded = false
		if (level.pilotModel) level.pilotModel.visible = true
		if (level.flightPivot) level.flightPivot.rotation.set(0, 0, 0)
		if (level.flightOffset) level.flightOffset.scale.setScalar(1)
		this.pilotLight = new THREE.PointLight(0xc6e4ff, 24, 18, 2)
		this.pilotLight.name = 'void-pilot-fill-light'
		this.group.add(this.pilotLight)
		level.velocity.set(0, 0, 0)
		level.keys.clear()
		level.radio?.stop()
		level.survivalHudEl &&
			(level.survivalHudEl.textContent =
				'ZERO GRAVITY // MATTER SIGNAL LOST')
		level.enemyStatusEl && (level.enemyStatusEl.textContent = '')
		level.levelHudEl.firstElementChild.textContent =
			'LEVEL 03 // VOID DIMENSION'
		level.sceneManager.camera.position.set(0, 12, 27)
		level.sceneManager.camera.lookAt(0, 9.5, 15)
		this.direction = new THREE.Vector3()
		this.cameraTarget = new THREE.Vector3()
	}
	update(delta) {
		const l = this.level,
			dt = Math.min(delta, 0.05)
		this.time += dt
		this.spaceBackdrop.update(this.time)
		this.drifters.update(dt)
		l.playerRoot.visible = true
		if (l.pilotModel) l.pilotModel.visible = true
		this.pilotLight.position
			.copy(l.playerRoot.position)
			.add(new THREE.Vector3(2, 4, 4))
		if (!l.completed) {
			l.elapsedPlayTime += dt
			if (l.survivalHudEl)
				l.survivalHudEl.textContent =
					'ZERO GRAVITY // MATTER SIGNAL LOST'
			if (l.enemyStatusEl) l.enemyStatusEl.textContent = ''
			this.direction.set(
				Number(l.keys.has('KeyD')) -
					Number(l.keys.has('KeyA')),
				Number(l.keys.has('Space')) -
					Number(l.keys.has('KeyC')),
				Number(l.keys.has('KeyS')) -
					Number(l.keys.has('KeyW'))
			)
			if (this.direction.lengthSq())
				this.direction.normalize()
			const speed = l.keys.has('ShiftLeft') ? 36 : 22
			l.velocity.lerp(
				this.direction.multiplyScalar(speed),
				1 - Math.exp(-dt * 3)
			)
			l.playerRoot.position.addScaledVector(l.velocity, dt)
			l.playerRoot.position.clamp(
				new THREE.Vector3(-250, -240, -480),
				new THREE.Vector3(250, 260, 140)
			)
			l.pilotWalk?.update(dt, 0, true)
			l.objectiveEl.innerHTML =
				'<strong>VOID DIMENSION // BEYOND MATTER</strong><br>WASD drift · Space rise · C descend · Shift boost<br>Avoid the three guardians. Follow the cyan rings to the far gate.'
			if (l.playerRoot.position.distanceTo(this.exit) < 12)
				l._completeMission()
		}
		for (const shard of this.shards) {
			shard.rotation.x += dt * 0.06
			shard.rotation.z += dt * 0.035
		}
		for (let i = 0; i < this.rings.length; i++)
			this.rings[i].scale.setScalar(
				1 + Math.sin(this.time * 1.5 + i) * 0.035
			)
		this.cameraTarget
			.copy(l.playerRoot.position)
			.add(new THREE.Vector3(0, 4, 12))
		l.sceneManager.camera.position.lerp(
			this.cameraTarget,
			1 - Math.exp(-dt * 5)
		)
		this.cameraTarget
			.copy(l.playerRoot.position)
			.add(new THREE.Vector3(0, 1.5, 0))
		l.sceneManager.camera.lookAt(this.cameraTarget)
	}
	dispose() {
		this.drifters.dispose()
		this.spaceBackdrop.dispose()
		this.level.sceneManager.camera.far = this.previousFar
		this.level.sceneManager.camera.updateProjectionMatrix()
		this.group.removeFromParent()
		for (const r of this.resources) r.dispose()
		for (const [object, visible] of this.hidden)
			object.visible = visible
		Object.assign(this.level.sceneManager.scene, this.previous)
	}
}
