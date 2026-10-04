import * as THREE from 'three';

export class NitrogenCanister{

    constructor(assetManager) {
        this.object = this._buildNitrogen(assetManager)
    }

    _buildNitrogen(assetManager){
        const group = new THREE.Group();
        const radius = 2;
        const height = 3;
        const segments = 32;
        let geo = assetManager.createNitrogenGeometry(radius, height, segments, true);
        let mat = assetManager.createNitrogenMiddleMaterial(0xffffff);
        const main = new THREE.Mesh(geo, mat);
        geo = assetManager.createNitrogenGeometry(3, 1, segments, false);
        mat = assetManager.createNitrogenMaterial(0x736b6b);
        const top = new THREE.Mesh(geo, mat);
        const bottom = new THREE.Mesh(geo, mat);
        geo = assetManager.createNitrogenGeometry(2.6, 0.2, segments, false);
        mat = assetManager.createNitrogenMaterial(0x736b6b);
        const top2 = new THREE.Mesh(geo, mat);
        const bottom2 = new THREE.Mesh(geo, mat);
        geo = assetManager.createNitrogenGeometry(1.9, 2.5, segments, false);
        mat = assetManager.createNitrogenLiquidMaterial(0x00fffb);
        const liquid = new THREE.Mesh(geo, mat);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x00fffb,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide,
            depthWrite: false,
        })

        const glowGeometry = new THREE.SphereGeometry(12, 32, 32)

        const glow = new THREE.Mesh(
            glowGeometry,
            glowMaterial
        )

        group.add(glow)
        liquid.position.set(0, -1.3, 0);
        main.position.set(0, 0, 0);
        top.position.set(0, 2, 0);
        bottom.position.set(0, -2, 0);
        top2.position.set(0, 2.5, 0);
        bottom2.position.set(0, -2.5, 0);
        group.add(main);
        group.add(top);
        group.add(bottom);
        group.add(top2);
        group.add(bottom2);
        group.add(liquid);
        return group;
    }
}