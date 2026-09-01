import RAPIER from '@dimforge/rapier3d-compat';

export async function initPhysics() {
    await RAPIER.init();

    const world = new RAPIER.World({
        x: 0,
        y: 0,
        z: 0
    });

    return {
        RAPIER,
        world
    };
}


export class Gravity {
    constructor(world, blackHolePosition) {
        this.world = world;
        this.blackHolePosition = blackHolePosition;

        this.baseStrength = 5.0;
        this.strengthIncrease = 0.5;

        this.gravityStrength = this.baseStrength;
    }


    update(spaceshipBody, deltaTime) {

        const spaceshipPosition = spaceshipBody.translation();

        const direction = {
            x: this.blackHolePosition.x - spaceshipPosition.x,
            y: this.blackHolePosition.y - spaceshipPosition.y,
            z: this.blackHolePosition.z - spaceshipPosition.z
        };


        const distance = Math.sqrt(
            direction.x * direction.x +
            direction.y * direction.y +
            direction.z * direction.z
        );


        if (distance === 0) {
            return;
        }


        direction.x /= distance;
        direction.y /= distance;
        direction.z /= distance;


        this.gravityStrength += this.strengthIncrease * deltaTime;


        const force = {
            x: direction.x * this.gravityStrength,
            y: direction.y * this.gravityStrength,
            z: direction.z * this.gravityStrength
        };


        spaceshipBody.addForce(force, true);
    }
}