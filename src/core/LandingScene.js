import * as THREE from 'three'
import { Spaceship } from '../models/Spaceship.js'
import { SHIPS } from '../systems/ShipManager.js'
import { CHARACTERS } from '../systems/CharacterManager.js'

/**
 * LandingScene — 3D planetary descent and touchdown cinematic sequence.
 * Renders an alien planetary landing site, dynamically loads the selected
 * starfighter, choreographs atmospheric entry, deceleration, landing gear
 * deployment, dust blast VFX, touchdown, and engine shutdown.
 */
export class LandingScene {
	constructor(
		sceneManager,
		assetManager,
		{
			shipKey = 'raven',
			pilotKey = 'zara',
			onComplete = () => {},
		} = {}
	) {
		this.sceneManager = sceneManager
		this.camera = sceneManager.camera
		this.assetManager = assetManager
		this.shipKey = shipKey
		this.pilotKey = pilotKey
		this.onComplete = onComplete

		this.shipConfig = SHIPS[shipKey] || SHIPS.raven
		this.pilotConfig = CHARACTERS[pilotKey] || CHARACTERS.zara

		this.group = new THREE.Group()
		this.group.name = 'LandingScene'

		this._time = 0
		this._completedNotified = false
		this._geometries = []
		this._materials = []

		// Save previous scene fog
		this._originalFog = this.sceneManager.scene.fog
		this.sceneManager.scene.fog = new THREE.FogExp2(0x060c18, 0.015)

		this._buildEnvironment()
		this._buildLandingPad()
		this._buildSpaceship()
		this._buildParticles()
		this._buildLights()

		this.sceneManager.scene.add(this.group)
	}

	_buildEnvironment() {
		// Starfield in the distance
		this.starfield = this.assetManager.createStarfield(1600, 450)
		this.group.add(this.starfield)

		// Distant Alien Moon in the sky
		const moonGeo = new THREE.SphereGeometry(14, 32, 32)
		this._geometries.push(moonGeo)
		const moonMat = new THREE.MeshBasicMaterial({
			color: 0x9fb4d8,
			transparent: true,
			opacity: 0.75,
		})
		this._materials.push(moonMat)
		const moon = new THREE.Mesh(moonGeo, moonMat)
		moon.position.set(-80, 55, -220)
		this.group.add(moon)

		// Distant moon atmospheric glow ring
		const glowGeo = new THREE.RingGeometry(14.2, 17.5, 32)
		this._geometries.push(glowGeo)
		const glowMat = new THREE.MeshBasicMaterial({
			color: 0x4de3ff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.25,
			blending: THREE.AdditiveBlending,
		})
		this._materials.push(glowMat)
		const moonGlow = new THREE.Mesh(glowGeo, glowMat)
		moonGlow.position.copy(moon.position)
		moonGlow.position.z += 1
		this.group.add(moonGlow)

		// Alien Terrain Surface (undulating dunes and craters)
		const terrainGeo = new THREE.PlaneGeometry(300, 300, 64, 64)
		terrainGeo.rotateX(-Math.PI / 2)
		const pos = terrainGeo.attributes.position
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i)
			const z = pos.getZ(i)
			const distFromCenter = Math.sqrt(x * x + z * z)
			// Keep landing zone flat, add alien hills and ridges in the distance
			if (distFromCenter > 14) {
				const height =
					Math.sin(x * 0.08) *
						Math.cos(z * 0.08) *
						3.5 +
					Math.sin(x * 0.03 + z * 0.04) * 5.0 +
					Math.sin(distFromCenter * 0.1) * 2.0
				pos.setY(i, height - 1.2)
			} else {
				// Smooth transition to flat pad at center
				const blend = distFromCenter / 14
				pos.setY(i, -1.2 * (1 - blend))
			}
		}
		terrainGeo.computeVertexNormals()
		this._geometries.push(terrainGeo)

		const terrainMat = new THREE.MeshStandardMaterial({
			color: 0x0f1624,
			roughness: 0.85,
			metalness: 0.25,
			flatShading: true,
		})
		this._materials.push(terrainMat)
		this.terrain = new THREE.Mesh(terrainGeo, terrainMat)
		this.terrain.position.y = -0.2
		this.terrain.receiveShadow = true
		this.group.add(this.terrain)
	}

	_buildLandingPad() {
		this.landingPadGroup = new THREE.Group()

		// Main octagonal landing platform
		const padGeo = new THREE.CylinderGeometry(11, 12, 0.4, 8)
		this._geometries.push(padGeo)
		const padMat = new THREE.MeshStandardMaterial({
			color: 0x141c2b,
			metalness: 0.7,
			roughness: 0.35,
		})
		this._materials.push(padMat)
		const pad = new THREE.Mesh(padGeo, padMat)
		pad.position.y = 0.05
		pad.receiveShadow = true
		this.landingPadGroup.add(pad)

		// Inner Target Ring
		const innerRingGeo = new THREE.RingGeometry(4.5, 5.0, 32)
		innerRingGeo.rotateX(-Math.PI / 2)
		this._geometries.push(innerRingGeo)
		const innerRingMat = new THREE.MeshBasicMaterial({
			color: 0x4de3ff,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.85,
		})
		this._materials.push(innerRingMat)
		const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat)
		innerRing.position.y = 0.26
		this.landingPadGroup.add(innerRing)

		// Central Landing Target Crosshair / Hexagon
		const hexGeo = new THREE.RingGeometry(1.2, 1.6, 6)
		hexGeo.rotateX(-Math.PI / 2)
		this._geometries.push(hexGeo)
		const hexMat = new THREE.MeshBasicMaterial({
			color: 0x52ffa8,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.9,
		})
		this._materials.push(hexMat)
		const hex = new THREE.Mesh(hexGeo, hexMat)
		hex.position.y = 0.26
		this.landingPadGroup.add(hex)

		// Perimeter Warning Beacons
		this.beacons = []
		const beaconCount = 8
		const radius = 10.2
		const beaconGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 8)
		this._geometries.push(beaconGeo)

		for (let i = 0; i < beaconCount; i++) {
			const angle =
				(i / beaconCount) * Math.PI * 2 + Math.PI / 8
			const bx = Math.cos(angle) * radius
			const bz = Math.sin(angle) * radius

			const beaconMat = new THREE.MeshStandardMaterial({
				color: 0x222d3d,
				emissive: 0x4de3ff,
				emissiveIntensity: 0.8,
			})
			this._materials.push(beaconMat)
			const beacon = new THREE.Mesh(beaconGeo, beaconMat)
			beacon.position.set(bx, 0.35, bz)
			this.landingPadGroup.add(beacon)

			const beaconLight = new THREE.PointLight(
				0x4de3ff,
				0.6,
				4
			)
			beaconLight.position.set(bx, 0.7, bz)
			this.landingPadGroup.add(beaconLight)

			this.beacons.push({
				mesh: beacon,
				light: beaconLight,
				material: beaconMat,
				offset: i * 0.4,
			})
		}

		this.group.add(this.landingPadGroup)
	}

	_buildSpaceship() {
		this.ship = new Spaceship(this.group, {
			colors: this.shipConfig.colors,
		})
		this.ship.group.scale.setScalar(0.7)

		// Initial position: High atmosphere approach
		this.ship.group.position.set(0, 22, -45)
		this.ship.group.rotation.set(0.18, 0, 0) // Slight pitch forward on descent
	}

	_buildParticles() {
		// Ground Dust Rings / Smoke Particles
		const dustCount = 60
		const dustGeo = new THREE.BufferGeometry()
		const dustPositions = new Float32Array(dustCount * 3)
		const dustScales = new Float32Array(dustCount)

		this.dustData = []
		for (let i = 0; i < dustCount; i++) {
			const angle = Math.random() * Math.PI * 2
			const r = 1.0 + Math.random() * 2.5
			dustPositions[i * 3] = Math.cos(angle) * r
			dustPositions[i * 3 + 1] = 0.1 + Math.random() * 0.3
			dustPositions[i * 3 + 2] = Math.sin(angle) * r
			dustScales[i] = Math.random()

			this.dustData.push({
				angle,
				speed: 1.5 + Math.random() * 2.5,
				radius: r,
				maxRadius: 6.0 + Math.random() * 4.0,
				height: 0.1 + Math.random() * 0.5,
				life: Math.random(),
			})
		}

		dustGeo.setAttribute(
			'position',
			new THREE.BufferAttribute(dustPositions, 3)
		)
		this._geometries.push(dustGeo)

		const glowColor = this.shipConfig.colors?.engineGlow || 0x4de3ff
		const dustMat = new THREE.PointsMaterial({
			color: glowColor,
			size: 0.35,
			transparent: true,
			opacity: 0.0,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		})
		this._materials.push(dustMat)

		this.dustParticles = new THREE.Points(dustGeo, dustMat)
		this.dustParticles.position.y = 0.2
		this.group.add(this.dustParticles)
	}

	_buildLights() {
		// Alien Sun / Directional Key Light
		this.sunLight = new THREE.DirectionalLight(0xaad4ff, 1.8)
		this.sunLight.position.set(40, 60, -30)
		this.sunLight.castShadow = true
		this.group.add(this.sunLight)

		// Warm Atmospheric Rim Light
		this.rimLight = new THREE.DirectionalLight(0xff7744, 0.75)
		this.rimLight.position.set(-50, 20, 40)
		this.group.add(this.rimLight)

		// Ambient Fill
		this.ambientLight = new THREE.AmbientLight(0x182438, 0.6)
		this.group.add(this.ambientLight)

		// Ground Touchdown Uplight
		this.padLight = new THREE.PointLight(0x4de3ff, 2.0, 16)
		this.padLight.position.set(0, 1.2, 0)
		this.group.add(this.padLight)
	}

	update(delta) {
		this._time += delta
		const t = this._time

		// Pulse beacon lights
		for (const b of this.beacons) {
			const pulse = (Math.sin(t * 3.5 + b.offset) + 1) * 0.5
			b.material.emissiveIntensity = 0.3 + pulse * 1.2
			b.light.intensity = 0.2 + pulse * 1.0
		}

		// Atmospheric & Planetary Landing Animation Sequence
		if (t < 3.2) {
			// -------------------------------------------------------------
			// Phase 1: High Atmosphere Entry & Fast Approach (0s - 3.2s)
			// -------------------------------------------------------------
			const progress = t / 3.2
			const ease = progress * progress * (3 - 2 * progress) // smoothstep

			// Ship position
			const startX = 0,
				startY = 24,
				startZ = -50
			const midX = 0,
				midY = 7.5,
				midZ = -14

			this.ship.group.position.x = THREE.MathUtils.lerp(
				startX,
				midX,
				ease
			)
			this.ship.group.position.y = THREE.MathUtils.lerp(
				startY,
				midY,
				ease
			)
			this.ship.group.position.z = THREE.MathUtils.lerp(
				startZ,
				midZ,
				ease
			)

			// Pitch / Attitude
			const pitch = THREE.MathUtils.lerp(0.22, 0.12, ease)
			const roll = Math.sin(t * 1.2) * 0.06
			this.ship.group.rotation.set(pitch, 0, roll)

			// Full throttle burn
			this.ship.update(delta, {
				throttle: 0.95,
				turnInput: 0,
			})

			// Camera: Chases from high-rear-left angle with subtle entry shudder
			const shake = Math.sin(t * 30) * 0.03 * (1 - ease)
			this.camera.position.set(
				-3.5 + Math.sin(t * 0.8) * 0.5 + shake,
				this.ship.group.position.y + 2.8 + shake,
				this.ship.group.position.z - 9.0
			)
			this.camera.lookAt(
				this.ship.group.position.x,
				this.ship.group.position.y - 0.5,
				this.ship.group.position.z + 5
			)

			this.dustParticles.material.opacity = 0
		} else if (t < 6.5) {
			// -------------------------------------------------------------
			// Phase 2: Deceleration, Alignment & Landing Gear Extension (3.2s - 6.5s)
			// -------------------------------------------------------------
			const progress = (t - 3.2) / 3.3
			const ease = Math.sin((progress * Math.PI) / 2) // ease out

			const midX = 0,
				midY = 7.5,
				midZ = -14
			const landX = 0,
				landY = 1.4,
				landZ = 0

			this.ship.group.position.x = THREE.MathUtils.lerp(
				midX,
				landX,
				ease
			)
			this.ship.group.position.y = THREE.MathUtils.lerp(
				midY,
				landY,
				ease
			)
			this.ship.group.position.z = THREE.MathUtils.lerp(
				midZ,
				landZ,
				ease
			)

			// Level out attitude
			const pitch = THREE.MathUtils.lerp(0.12, 0.0, ease)
			this.ship.group.rotation.set(pitch, 0, 0)

			// Deploy Landing Gear!
			this.ship.setGearDeployed(true)

			// Throttle ramps down as descent slows
			const throttle = THREE.MathUtils.lerp(
				0.85,
				0.45,
				progress
			)
			this.ship.update(delta, { throttle, turnInput: 0 })

			// Camera sweeps to dramatic low ground angle
			const camProg = progress
			const camX = THREE.MathUtils.lerp(-4.0, 5.2, camProg)
			const camY = THREE.MathUtils.lerp(8.0, 1.4, camProg)
			const camZ = THREE.MathUtils.lerp(-18.0, 7.5, camProg)

			this.camera.position.set(camX, camY, camZ)
			this.camera.lookAt(
				this.ship.group.position.x,
				this.ship.group.position.y + 0.3,
				this.ship.group.position.z
			)

			// Dust starts kicking up as altitude drops
			this._updateDustParticles(delta, progress * 0.7)
		} else if (t < 8.2) {
			// -------------------------------------------------------------
			// Phase 3: Final Touchdown & Landing Shock (6.5s - 8.2s)
			// -------------------------------------------------------------
			const progress = (t - 6.5) / 1.7
			const ease = progress * progress * (3 - 2 * progress)

			// Soft touchdown bounce
			const startY = 1.4
			const finalY = 0.58 // rest on landing pad with gear down
			const bounce =
				Math.sin(progress * Math.PI) *
				0.08 *
				(1 - progress)

			this.ship.group.position.set(
				0,
				THREE.MathUtils.lerp(startY, finalY, ease) +
					bounce,
				0
			)
			this.ship.group.rotation.set(0, 0, 0)

			// Retro-thrusters wind down
			const throttle = THREE.MathUtils.lerp(
				0.4,
				0.05,
				progress
			)
			this.ship.update(delta, { throttle, turnInput: 0 })

			// Camera locks into stable ground viewing distance
			this.camera.position.set(4.8, 1.5, 6.2)
			this.camera.lookAt(0, 0.7, 0)

			// Max dust blast expanding outward
			this._updateDustParticles(delta, 1.0 - progress * 0.5)
		} else {
			// -------------------------------------------------------------
			// Phase 4: Landed, Engines Powered Down & Hero Orbit (8.2s+)
			// -------------------------------------------------------------
			this.ship.group.position.set(0, 0.58, 0)
			this.ship.group.rotation.set(0, 0, 0)

			// Idle state: throttle 0, strobe lights blinking
			this.ship.update(delta, { throttle: 0, turnInput: 0 })

			// Smooth cinematic 360 hero orbit around the vessel
			const orbitTime = t - 8.2
			const orbitRadius = 6.2
			const camX = Math.sin(orbitTime * 0.22) * orbitRadius
			const camZ = Math.cos(orbitTime * 0.22) * orbitRadius
			const camY = 1.6 + Math.sin(orbitTime * 0.15) * 0.35

			this.camera.position.set(camX, camY, camZ)
			this.camera.lookAt(0, 0.7, 0)

			// Fade out dust
			if (this.dustParticles.material.opacity > 0.01) {
				this.dustParticles.material.opacity = Math.max(
					0,
					this.dustParticles.material.opacity -
						delta * 0.5
				)
			}

			// Notify completion once
			if (!this._completedNotified) {
				this._completedNotified = true
				this.onComplete()
			}
		}
	}

	_updateDustParticles(delta, intensity) {
		const pos = this.dustParticles.geometry.attributes.position
		this.dustParticles.material.opacity = Math.min(
			0.65,
			intensity * 0.7
		)

		for (let i = 0; i < this.dustData.length; i++) {
			const d = this.dustData[i]
			d.radius += d.speed * delta * (1.0 + intensity)
			if (d.radius > d.maxRadius) {
				d.radius = 0.8 + Math.random() * 1.5
				d.angle = Math.random() * Math.PI * 2
			}
			const px = Math.cos(d.angle) * d.radius
			const pz = Math.sin(d.angle) * d.radius
			const py = 0.1 + Math.sin(d.radius * 0.5) * d.height

			pos.setXYZ(i, px, py, pz)
		}
		pos.needsUpdate = true
	}

	/** Skips the descent animation and goes straight to the landed state */
	skip() {
		this._time = 8.5
		this.ship.setGearDeployed(true)
		this.ship.group.position.set(0, 0.58, 0)
		this.ship.group.rotation.set(0, 0, 0)
		this.camera.position.set(4.8, 1.5, 6.2)
		this.camera.lookAt(0, 0.7, 0)
		if (!this._completedNotified) {
			this._completedNotified = true
			this.onComplete()
		}
	}

	/** Restarts the descent cinematic from the beginning */
	restart() {
		this._time = 0
		this._completedNotified = false
		this.ship.setGearDeployed(false)
		this.ship.group.position.set(0, 22, -45)
		this.ship.group.rotation.set(0.18, 0, 0)
	}

	dispose() {
		// Restore fog
		this.sceneManager.scene.fog = this._originalFog

		if (this.ship) {
			this.ship.dispose()
			this.ship = null
		}

		for (const geo of this._geometries) geo.dispose()
		for (const mat of this._materials) mat.dispose()

		if (this.group.parent) {
			this.group.parent.remove(this.group)
		}
	}
}
