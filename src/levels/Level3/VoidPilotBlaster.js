import * as THREE from 'three'

/** Visually tracks the real right-hand joint, with a safe fallback for unrigged pilots. */
export class VoidPilotBlaster {
	constructor(level, parent) {
		this.level = level
		this.root = new THREE.Group()
		this.root.name = 'void-pilot-cyan-blaster'
		parent.add(this.root)
		this.resources = []
		const own = (r) => (this.resources.push(r), r)
		const dark = own(
			new THREE.MeshStandardMaterial({
				color: 0x172537,
				metalness: 0.5,
				roughness: 0.38,
			})
		)
		const cyan = own(
			new THREE.MeshBasicMaterial({ color: 0x5cfbff })
		)
		const shape = own(new THREE.BoxGeometry(0.32, 0.3, 1.45))
		const barrel = new THREE.Mesh(shape, dark)
		barrel.position.z = 0.35
		this.root.add(barrel)
		const grip = new THREE.Mesh(
			own(new THREE.BoxGeometry(0.23, 0.65, 0.32)),
			dark
		)
		grip.position.set(0, -0.35, 0.12)
		grip.rotation.x = 0.25
		this.root.add(grip)
		this.muzzle = new THREE.Mesh(
			own(new THREE.SphereGeometry(0.18, 8, 6)),
			cyan
		)
		this.muzzle.position.z = 1.2
		this.root.add(this.muzzle)
		this.flash = 0
		this.time = 0
		this.tracer = new THREE.Mesh(
			own(new THREE.TorusGeometry(1, 0.04, 4, 36)),
			own(
				new THREE.MeshBasicMaterial({
					color: 0x65faff,
					transparent: true,
					opacity: 0.72,
					depthWrite: false,
				})
			)
		)
		this.tracer.visible = false
		parent.add(this.tracer)
		this._model = null
		this._hand = null
		this._handWorld = new THREE.Vector3()
		this._targetWorld = new THREE.Vector3()
		this._scratch = new THREE.Vector3()
	}
	_findHand() {
		const model = this.level.pilotModel
		if (model === this._model) return
		this._model = model
		this._hand = null
		model?.traverse((node) => {
			if (
				node.isBone &&
				/^(hand_r|righthand|right_hand|hand\.r)$/i.test(
					node.name
				)
			)
				this._hand = node
		})
	}
	update(dt, target = null) {
		this.time += dt
		this._findHand()
		const p = this.level.playerRoot.position
		if (this._hand) {
			this._hand.getWorldPosition(this._handWorld)
			this.root.position.copy(this._handWorld)
		} else {
			this.root.position.set(
				p.x + 0.65,
				p.y + 0.2,
				p.z - 0.25
			)
		}
		this._targetWorld.copy(target?.position || p)
		if (!target) this._targetWorld.z -= 60
		this.root.lookAt(this._targetWorld)
		this.flash = Math.max(0, this.flash - dt)
		this.muzzle.scale.setScalar(1 + this.flash * 2)
		this.tracer.visible = Boolean(target?.position && !target.dead)
		if (this.tracer.visible) {
			this.tracer.position.copy(target.position)
			this.tracer.lookAt(
				this.level.sceneManager.camera.position
			)
			this.tracer.scale.setScalar(
				3 + 0.3 * Math.sin(this.time * 6)
			)
		}
	}
	fireOrigin(out) {
		this.muzzle.getWorldPosition(out)
		this.flash = 0.22
		return out
	}
	dispose() {
		this.root.removeFromParent()
		this.tracer.removeFromParent()
		for (const r of this.resources) r.dispose()
	}
}
