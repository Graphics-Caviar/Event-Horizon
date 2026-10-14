import * as THREE from 'three'




export const ALIENS = {
    0: {
        name: "runner",
        model: [
			'/assets/models/aliens/alien-predator.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/aliens/alien-predator.glb',
		],
        stats: {
			speed: 6,
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
			speed: 25,
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
		this.diveTimer = 8;
		this.turnabout = false;
		this.diveTarget = new THREE.Vector3(0, 0, 0)
		this.orbitAngle = 0;
		this.orbitRadius = 12;
		this.orbitSpeed = 1.5;
		this.orbiting = false;
		this.velocity = new THREE.Vector3(0, 0, 0)
        this.loadModel(this.type.model)
		this.collisionCooldown = 0;
		this.stopTimer = 0;
    }

	updatePhysics(delta) {
		const dt = delta
		const target = this.target.position
		if(this.type.name == "runner") {
			if(this.stopTimer == 0){
				this.alienGroup.rotation.y = Math.atan2(target.x - this.position.x, target.z - this.position.z)
				this.velocity.set(0, 0, this.type.stats.speed).applyQuaternion(this.alienGroup.quaternion)
			} else {
				this.stopTimer = Math.max(0, this.stopTimer - dt)
				this.velocity.set(0, 0, 0)
			}
			
		} else if (this.type.name == "launcher") {
			if(this.stopTimer == 0) {
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
			} else {
				this.stopTimer = Math.max(0, this.stopTimer - dt)
				this.velocity.set(0, 0, 0)
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
					this.diveTimer = Math.max(0, this.diveTimer - dt)
					if(this.diveTimer == 0){
						this.diving = true
						this.diveTimer = 8
						this.diveTarget.copy(target)
						this.turnabout = false
						this.orbiting = false;
					} 
				} else {
					this.alienGroup.rotation.y = Math.atan2(target.x - this.position.x, target.z - this.position.z)
					this.velocity.set(0, 0, this.type.stats.speed).applyQuaternion(this.alienGroup.quaternion)
				}
				
			} else {
				this.velocity.set(0, 0, 0);
    			const step = 10 * dt;
				if (!this.turnabout) {
					this.alienGroup.lookAt(this.diveTarget);
					if (this.position.distanceTo(this.diveTarget) <= step) {
						this.position.copy(this.diveTarget);
						this.turnabout = true;
					} else {
						this.moveTowards(this.diveTarget, step);
					}
				} else {
					const returnTarget = target.clone().add(
						new THREE.Vector3(0, 10.2, 0)
					);
					this.alienGroup.lookAt(returnTarget);
					if (this.position.distanceTo(returnTarget) <= step) {
						this.position.copy(returnTarget);
						this.diving = false;
						this.turnabout = false;
					} else {
						this.moveTowards(returnTarget, step);
					}
				}
			}
		}
		this.position.addScaledVector(this.velocity, dt)
		this.syncToTerrain();
		const terrainHeight = this.planet.heightAt(
			this.position.x,
			this.position.z
		);

		const shouldCollide =
			this.type.name !== "flyer" ||
			(this.diving && this.position.y <= terrainHeight + 3);

		if (shouldCollide) {
			const colliderRadius =
				this.type.name === "runner" ? 1.5 : 2;

			this.planet.clampToBounds(
				this.position,
				colliderRadius
			);

			this.planet.resolveCircleCollisions(
				this.position,
				colliderRadius,
				this.planet.level.gameplayColliders
			);

			this.syncToTerrain();
		}
		this.collisionCooldown = Math.max(
			0,
			this.collisionCooldown - delta
		);
		this.alienGroup.position.copy(this.position);
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

	checkPlayerCollision(player, playerRadius = 0.9) {
		const dx = this.position.x - player.position.x;
		const dz = this.position.z - player.position.z;
		const dy = this.position.y - player.position.y;

		const enemyRadius = this.type.name === "runner" ? 1.5 : 2;
		let hit = Math.hypot(dx, dz) <= enemyRadius + playerRadius && dy <= enemyRadius + playerRadius;
		if(hit){
			this.stopTimer = 3;
		}
		return hit;
	}

	checkRoverCollision(rover, roverRadius = 8) {
		const dx = this.position.x - rover.group.position.x;
		const dz = this.position.z - rover.group.position.z;
		const dy = this.position.y - rover.group.position.y;

		const enemyRadius = this.type.name === "runner" ? 1.5 : 2;
		let hit = Math.hypot(dx, dz) <= enemyRadius + roverRadius && dy <= enemyRadius + 1;
		if(hit){
			this.stopTimer = 3;
		}
		return hit;
	}

	moveTowards(target, maxDistance) {
		const direction = target.clone().sub(this.position);
		const distance = direction.length();

		if (distance <= maxDistance) {
			this.position.copy(target);
		} else {
			this.position.add(
				direction.normalize().multiplyScalar(maxDistance)
			);
		}
	}
}