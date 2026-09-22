import * as THREE from 'three'

export class BlackHole {
	constructor(level) {
		this.level = level

		this.blackHoleGroup = new THREE.Group()
		this.blackHoleGroup.name = 'blackhole'
		this.createBlackHole(100, 500)
		this.addObject(this.blackHoleGroup)

		this.planePosition = new THREE.Vector3(0, 0, 0)
		this.planeNormal = new THREE.Vector3(0, 0, 1).normalize()
		this.gravityStrength = 60
		this.captureDistance = -20
	}

	addObject(object) {
		this.level.addObject(object)
	}

	own(resource) {
		this.level.own(resource)
	}

	getSignedDistance(position) {
		return position
			.clone()
			.sub(this.planePosition)
			.dot(this.planeNormal)
	}
	isBeyondEventHorizon(position) {
		return this.getSignedDistance(position) < this.captureDistance
	}

	getGravityDirection() {
		return this.planeNormal.clone().negate()
	}
	getGravityStrength() {
		return this.gravityStrength
	}

	createBlackHole(singularityRadius, diskRadius) {
		const singularityGeo = new THREE.SphereGeometry(
			singularityRadius,
			32,
			32
		)
		this.own(singularityGeo)
		const singularityMat = new THREE.MeshBasicMaterial({
			color: 0x000000,
		})
		this.own(singularityMat)
		const singularity = new THREE.Mesh(
			singularityGeo,
			singularityMat
		)
		this.blackHoleGroup.add(singularity)

		const diskGeo = new THREE.RingGeometry(
			singularityRadius + singularityRadius * 0.1,
			diskRadius,
			64
		)
		this.own(diskGeo)
		const diskMat = new THREE.MeshBasicMaterial({
			color: 0xffcc66,
			emissive: 0xffcc66,
			emissiveIntensity: 1.5,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.8,
			blending: THREE.AdditiveBlending,
		})
		this.own(diskMat)
		this.blackHoleDisk = new THREE.Mesh(diskGeo, diskMat)
		this.blackHoleGroup.add(this.blackHoleDisk)

		console.log(this.blackHoleGroup)
	}

	rampDifficulty(elapsedPlayTime, rampRate = 4) {
		this.gravityStrength = 60 + rampRate * elapsedPlayTime
	}

	updateBlackHoleDisk(delta, timeScale) {
		if (this.blackHoleDisk) {
			this.blackHoleDisk.rotation.z += 0.005 * timeScale
			this.blackHoleDisk.rotation.x += 0.005 * timeScale
			this.blackHoleDisk.rotation.y += 0.005 * timeScale
		}
	}
}
