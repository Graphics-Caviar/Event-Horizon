import * as THREE from 'three'



export const ALIENS = {
    0: {
        name: "runner",
        model: [
			'/assets/models/aliens/alien-predator.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/alien-predator.glb',
		],
        stats: {
			speed: 10,
			hp: 5
		},
    },
    1: {
        name: "launcher",
        model: [
			'/assets/models/aliens/armored-alien-brute.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/armored-alien-brute.glb',
		],
        stats: {
			speed: 5,
			hp: 5
		},
    },
    2: {
        name: "flyer",
        model: [
			'/assets/models/aliens/alien-flying-predator.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/alien-flying-predator.glb',
		],
        stats: {
			speed: 20,
			hp: 5
		},
    }
}

export class Alien {
    constructor(target, type, assetManager, planet) {
        this.assetManager = assetManager
        this.target = target
		this.planet = planet
        this.type = ALIENS[type]
        this.position = new THREE.Vector3(0, 0, 0)
        this.alienGroup = new THREE.Group()
        this.alienGroup.name = 'alien'
        this.visualGroup = new THREE.Group()
        this.visualGroup.name = 'alien-visuals'
        this.alienGroup.add(this.visualGroup);
        this.model = null
        this._disposed = false
		this.launch = false;
		this.launchTimer = 5;
		this.launchDuration = 2;
		this.diving = false;
		this.diveTimer = 
		this.orbitAngle = 0;
		this.orbitRadius = 12;
		this.orbitSpeed = 1.5;
		this.orbiting = false;
		this.velocity = new THREE.Vector3(0, 0, 0)
        this.loadModel(this.type.model)
    }

	updatePhysics(delta) {
		const dt = delta
		const target = this.target.position
		if(this.type.name == "runner") {
			this.alienGroup.rotation.y = Math.atan2(target.x - this.position.x, target.z - this.position.z)
			this.velocity.set(0, 0, this.type.stats.speed).applyQuaternion(this.alienGroup.quaternion)
		} else if (this.type.name == "launcher") {
			if(this.launchTimer == 0){
				this.launch = true
				this.launchDuration = 1
				this.launchTimer = 5
			} else if(this.launchDuration == 0){
				this.launch = false
				this.launchDuration = 1
			}
			if(!this.launch) {
				this.alienGroup.rotation.y = Math.atan2(target.x - this.position.x, target.z - this.position.z)
				this.velocity.set(0, 0, this.type.stats.speed).applyQuaternion(this.alienGroup.quaternion)
				this.launchTimer = Math.max(0, this.launchTimer - dt)
			} else {
				this.velocity.set(0, 0, 40).applyQuaternion(this.alienGroup.quaternion)
				this.launchDuration = Math.max(0, this.launchDuration - dt)
			}
		} else if (this.type.name == "flyer") {
			if(!this.diving){
				if(!this.orbiting && Math.hypot(this.position.x - target.x, this.position.z - target.z) <= this.orbitRadius){
					this.orbiting = true
				}
				if(this.orbiting){
					this.velocity.set(0, 0, 0)
					this.orbitAngle += this.orbitSpeed * delta;
					this.position.x = this.target.position.x + this.orbitRadius * Math.cos(this.orbitAngle);
					this.position.z = this.target.position.z + this.orbitRadius * Math.sin(this.orbitAngle);
					const direction = new THREE.Vector3(-Math.sin(this.orbitAngle), 0, Math.cos(this.orbitAngle));	
					this.alienGroup.rotation.y =  Math.atan2(direction.x, direction.z) - Math.PI/2;
				} else {
					this.alienGroup.rotation.y = Math.atan2(target.x - this.position.x, target.z - this.position.z)
					this.velocity.set(0, 0, this.type.stats.speed).applyQuaternion(this.alienGroup.quaternion)
				}
				
			}
		}
		this.position.addScaledVector(this.velocity, dt)
		this.syncToTerrain();
		this.alienGroup.position.copy(this.position)
	}

	syncToTerrain() {
		if(this.type.name == "flyer") {
			if(!this.diving){
				this.position.y =
				this.target.position.y + 10.2
			}
			
		} else {
			this.position.y =
				this.planet.heightAt(
					this.position.x,
					this.position.z
				) + 1.2
		}
		
	}

    async loadModel(pathOrPaths) {
        
		try {
			const model =
				await this.assetManager.loadModel(
					pathOrPaths
				)
			if (this._disposed) return
			//this.model = this._fitModel(model)
			this.visualGroup.add(model)
		} catch (error) {
			console.warn(
				'[Level2] Alien model failed to load.',
				error?.message
			)
		}
	}
}