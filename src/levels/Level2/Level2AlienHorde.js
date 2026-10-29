import * as THREE from 'three'

// The invasion uses a lightweight, STATIC version of each *actual* alien GLB.
// The three source meshes were simplified offline and packaged under public/.
// Keep high-resolution, skeleton-animated creatures in Alien.js for combat.
// Unlike the old horde, there are no block-box stand-in characters.
const DEFAULT_COUNTS = Object.freeze({ runner: 1550, brute: 750, flyer: 650 })
const SPECIES = Object.freeze([
  { kind: 'runner', path: '/assets/models/aliens/alien-predator-horde-web.glb', pace: 9, height: 5.0 },
  { kind: 'brute', path: '/assets/models/aliens/armored-alien-brute-horde-web.glb', pace: 5.1, height: 6.2 },
  { kind: 'flyer', path: '/assets/models/aliens/alien-flying-predator-horde-web.glb', pace: 14.2, height: 6.8 },
])
const STEP_SECONDS = 0.13
const SWARM_RADIUS = 145
// Keep the array of thousands for the invasion, but send only nearby bodies
// to the GPU. Updating/drawing all 2950 every frame costs too much.
const DRAW_RADIUS = 420
const MAX_PURSUERS_PER_STEP = Object.freeze({ runner: 140, brute: 80, flyer: 65 })

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (1664525 * value + 1013904223) >>> 0
    return value / 4294967296
  }
}

export class Level2AlienHorde {
  constructor(level, { counts = DEFAULT_COUNTS } = {}) {
    this.level = level
    this.disposed = false
    this.root = new THREE.Group()
    this.root.name = 'level2-real-model-alien-horde'
    level.addObject(this.root)
    this.random = seededRandom(0x0EAE002)
    this.elapsed = 0
    this.stepAccum = 0
    this.attackCooldown = 1.5
    this.members = []
    this.meshes = []
    this.matrix = new THREE.Matrix4()
    this.position = new THREE.Vector3()
    this.quaternion = new THREE.Quaternion()
    this.scale = new THREE.Vector3()
    this.tint = new THREE.Color()
    this.yAxis = new THREE.Vector3(0, 1, 0)
    this.route = [level.landingSite, ...level.roverApproach.points, level.roverApproach.shipSite]
    this._build(counts)
  }

  _build(counts) {
    for (const species of SPECIES) {
      const count = Math.max(0, Math.floor(counts[species.kind] || 0))
      if (!count) continue
      // AssetManager caches these sub-MB GLBs and handles Vite's BASE_URL.
      // Failure deliberately leaves this species hidden, NOT a box-man proxy.
      this._loadSpecies(species, count).catch((error) => {
        if (!this.disposed) console.warn(
          `[Level2] Failed to load ${species.kind} horde mesh (${species.path}). ` +
          'Install the supplied horde GLBs under public/assets/models/aliens/.', error
        )
      })
    }
  }

  async _loadSpecies(species, count) {
    const source = await this.level.assetManager.loadModel(species.path)
    if (this.disposed) return
    let originalMesh = null
    source.updateMatrixWorld(true)
    source.traverse((node) => {
      if (!originalMesh && node.isMesh && node.geometry?.attributes?.position) originalMesh = node
    })
    if (!originalMesh) throw new Error(`No renderable mesh in ${species.path}`)
    // The LOD files contain a single unskinned textured mesh. Bake any GLTF
    // transforms so instancing uses the same visible orientation as the source.
    const geometry = originalMesh.geometry.clone().applyMatrix4(originalMesh.matrixWorld)
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    const sizeY = Math.max(0.01, bounds.max.y - bounds.min.y)
    const centerX = (bounds.min.x + bounds.max.x) / 2
    const centerZ = (bounds.min.z + bounds.max.z) / 2
    geometry.translate(-centerX, -bounds.min.y, -centerZ)
    geometry.computeBoundingSphere()
    const material = (Array.isArray(originalMesh.material)
      ? originalMesh.material[0] : originalMesh.material).clone()
    material.side = THREE.DoubleSide
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = `level2-horde-${species.kind}-real-glb`
    mesh.frustumCulled = false // populated instances occupy different route sectors
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.root.add(mesh)
    this.meshes.push(mesh)

    const baseScale = species.height / sizeY
    for (let index = 0; index < count; index++) {
      // The crowd is concentrated near the landing site and continues along
      // the road all the way to the alien space hub.
      const nearStart = index % 3 === 0
      const progress = nearStart ? this.random() * 0.2 : this.random()
      const segment = Math.min(this.route.length - 2, Math.floor(progress * (this.route.length - 1)))
      const fraction = progress * (this.route.length - 1) - segment
      const a = this.route[segment], b = this.route[segment + 1]
      const dx = b.x - a.x, dz = b.z - a.z
      const length = Math.max(1, Math.hypot(dx, dz))
      const spread = (this.random() * 2 - 1) * (nearStart ? 105 : 145)
      let x = a.x + dx * fraction - dz / length * spread
      let z = a.z + dz * fraction + dx / length * spread
      const distLanding = Math.hypot(x - this.level.landingSite.x, z - this.level.landingSite.z)
      if (distLanding < 44) {
        x += (-dz / length) * (44 - distLanding + 9)
        z += (dx / length) * (44 - distLanding + 9)
      }
      if (this.level.lavaHazards?.isLavaAt?.(x, z, 4)) {
        x -= dz / length * 34
        z += dx / length * 34
      }
      const terrainY = this.level.planet.heightAt(x, z)
      const height = species.kind === 'flyer' ? 14 + this.random() * 20 : 0
      this.members.push({
        x, z, y: terrainY + height, height,
        mesh, kind: species.kind, baseScale,
        pace: species.pace * (0.7 + this.random() * 0.5),
        heading: this.random() * Math.PI * 2,
        scale: species.kind === 'brute' ? 1.15 + this.random() * 0.55 : 0.82 + this.random() * 0.48,
        phase: this.random() * Math.PI * 2,
        brightness: 0.83 + this.random() * 0.28,
        gone: false,
      })
    }
    // Populate initial visible instances as soon as the model has loaded.
    const target = this.level.boarded ? this.level.rover.group.position : this.level.playerRoot.position
    this._refreshMatrices(target)
  }

  _writeMatrix(member, slot) {
    const sway = Math.sin(this.elapsed * 5 + member.phase) * 0.045
    this.position.set(member.x,
      member.y + (member.kind === 'flyer' ? Math.sin(this.elapsed * 2 + member.phase) * 0.75 : Math.abs(sway) * 1.5),
      member.z)
    this.quaternion.setFromAxisAngle(this.yAxis, member.heading)
    this.scale.setScalar(member.baseScale * member.scale)
    if (member.kind !== 'flyer') this.scale.y *= 1 + Math.sin(this.elapsed * 7 + member.phase) * 0.025
    this.matrix.compose(this.position, this.quaternion, this.scale)
    member.mesh.setMatrixAt(slot, this.matrix)
    const tint = member.brightness
    member.mesh.setColorAt(slot, this.tint.setRGB(tint, tint, tint))
  }

  _refreshMatrices(target) {
    const radius2 = DRAW_RADIUS * DRAW_RADIUS
    const counts = new Map()
    for (const mesh of this.meshes) counts.set(mesh, 0)
    for (const member of this.members) {
      if (member.gone) continue
      const dx = target.x - member.x, dz = target.z - member.z
      if (dx * dx + dz * dz > radius2) continue
      const slot = counts.get(member.mesh)
      this._writeMatrix(member, slot)
      counts.set(member.mesh, slot + 1)
    }
    for (const mesh of this.meshes) {
      mesh.count = counts.get(mesh)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  update(delta, target) {
    if (this.disposed || this.level.completed || this.level.transitionHeld) return
    this.elapsed += delta
    this.attackCooldown = Math.max(0, this.attackCooldown - delta)
    this.stepAccum += delta
    if (this.stepAccum < STEP_SECONDS) return
    const step = Math.min(this.stepAccum, 0.3)
    this.stepAccum = 0
    const pursuers = { runner: 0, brute: 0, flyer: 0 }
    let contact = false
    const playable = !this.level.cinematic
    const rover = this.level.boarded
    const roverSpeed = Math.abs(this.level.rover?.speed || 0)
    for (const member of this.members) {
      if (member.gone) continue
      const dx = target.x - member.x, dz = target.z - member.z
      const distanceSquared = dx * dx + dz * dz
      if (playable && distanceSquared < SWARM_RADIUS * SWARM_RADIUS &&
          pursuers[member.kind] < MAX_PURSUERS_PER_STEP[member.kind]) {
        pursuers[member.kind]++
        const distance = Math.sqrt(distanceSquared)
        const safeSeparation = rover ? 5.3 : 3.2
        if (distance > safeSeparation && distance > 0.01) {
          const move = Math.min(member.pace * step, distance - safeSeparation)
          const ux = dx / distance, uz = dz / distance
          const nextX = member.x + ux * move, nextZ = member.z + uz * move
          if (!this.level.lavaHazards?.isLavaAt?.(nextX, nextZ, 1)) {
            member.x = nextX
            member.z = nextZ
            member.y = this.level.planet.heightAt(nextX, nextZ) + member.height
          }
        }
        member.heading = Math.atan2(dx, dz)
        if (distance < (rover ? 7 : 4.5)) {
          if (rover && roverSpeed > 10 && member.kind !== 'flyer') member.gone = true
          else contact = true
        }
      }
    }
    this._refreshMatrices(target)
    // Only one low-cost horde hit per interval. The rigged aliens remain
    // responsible for close-range animated combat and normal damage.
    if (playable && contact && this.attackCooldown <= 0) {
      this.attackCooldown = 1.25
      if (rover) this.level._applyRoverHit(0.06)
      else this.level._applyAlienHit(0.06)
    }
  }

  dispose() {
    this.disposed = true
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this.root.removeFromParent()
    this.meshes.length = 0
    this.members.length = 0
  }
}
