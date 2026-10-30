import * as THREE from 'three'
import { createLevel3Art } from './Level3VisualAssets.js'

/** Boss projectiles imprison the player until repeated, distinct Space presses fill the meter. */
export class VoidPrisonBubble {
    constructor(level,group){
        this.level=level
        this.group=group
        this.projectiles=[]
        this.active=false
        this.progress=0
        this.spaceWasDown=false
        this.damageTimer=0
        this.time=0
        this.projectileGeometry=new THREE.SphereGeometry(1,12,8)
        this.projectileMaterial=new THREE.MeshBasicMaterial({color:0x9f62ff,transparent:true,opacity:0.5,wireframe:true,depthWrite:false})
        this.trapGeometry=new THREE.SphereGeometry(1,20,14)
        this.trapMaterial=new THREE.MeshBasicMaterial({color:0x7c54ff,transparent:true,opacity:0.24,side:THREE.DoubleSide,depthWrite:false})
        this.trapMesh=new THREE.Mesh(this.trapGeometry,this.trapMaterial)
        this.trapMesh.scale.setScalar(4.3)
        this.trapMesh.visible=false
        group.add(this.trapMesh)
        // Optional static high-detail rune/shell overlay; a cheap sphere stays
        // underneath to clearly show the actual collision envelope.
        this.art = createLevel3Art(level, group, 'prison', 8.2)
        for(let i=0;i<3;i++){
            const mesh=new THREE.Mesh(this.projectileGeometry,this.projectileMaterial)
            mesh.scale.setScalar(3.4)
            mesh.visible=false
            group.add(mesh)
            this.projectiles.push({mesh,life:0,velocity:new THREE.Vector3()})
        }
        this.meter=document.createElement('div')
        this.meter.style.cssText='position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:9999;min-width:280px;max-width:85vw;padding:14px;background:rgba(12,5,30,.9);border:2px solid #a76cff;color:white;text-align:center;font:700 15px system-ui;pointer-events:none;display:none;'
        this.label=document.createElement('div')
        this.label.textContent='VOID PRISON — TAP SPACE REPEATEDLY TO BREAK FREE'
        this.bar=document.createElement('div')
        this.bar.style.cssText='height:15px;background:#271739;margin-top:10px;overflow:hidden;'
        this.fill=document.createElement('div')
        this.fill.style.cssText='height:100%;width:0%;background:linear-gradient(90deg,#7f48ff,#63f9ff);'
        this.bar.appendChild(this.fill)
        this.meter.append(this.label,this.bar)
        document.body.appendChild(this.meter)
        this._scratch=new THREE.Vector3()
    }
    launch(from,target){
        if(this.active || this.level.completed)return false
        const projectile=this.projectiles.find(p=>p.life<=0)
        if(!projectile)return false
        projectile.mesh.position.copy(from)
        projectile.velocity.subVectors(target,from).normalize().multiplyScalar(24)
        projectile.life=5.5
        projectile.mesh.visible=true
        this.level._showMovementFeedback?.('VOID-GOD: PRISON ORBS INCOMING — DODGE!',2)
        return true
    }
    get trapped(){return this.active}
    _trap(){
        if(this.active)return
        this.active=true
        this.progress=0
        this.damageTimer=0.95
        this.spaceWasDown=this.level.keys.has('Space')
        this.level.velocity.set(0,0,0)
        this.meter.style.display='block'
        this.fill.style.width='0%'
        this.label.textContent='VOID PRISON — TAP SPACE TO ESCAPE: 0%'
        this.level._showMovementFeedback?.('TRAPPED — TAP SPACE TO ESCAPE',2)
    }
    release(){
        this.active=false
        this.meter.style.display='none'
        this.trapMesh.visible=false
        this.art.root.visible=false
        this.progress=0
    }
    clear(){
        this.release()
        for(const p of this.projectiles){p.life=0;p.mesh.visible=false}
    }
    update(dt){
        if(this.level.completed){this.release();return}
        this.time+=dt
        const player=this.level.playerRoot.position
        for(const p of this.projectiles){
            if(p.life<=0)continue
            p.life-=dt
            p.mesh.position.addScaledVector(p.velocity,dt)
            p.mesh.rotation.y+=dt*2
            if(p.mesh.position.distanceTo(player)<4.8){p.life=0;p.mesh.visible=false;this._trap()}
            if(p.life<=0)p.mesh.visible=false
        }
        if(!this.active)return
        const space=this.level.keys.has('Space')
        if(space&&!this.spaceWasDown){
            this.progress=Math.min(100,this.progress+12.5)
            this.fill.style.width=`${this.progress}%`
            this.label.textContent=`VOID PRISON — TAP SPACE TO ESCAPE: ${Math.round(this.progress)}%`
            if(this.progress>=100){this.release();this.level._showMovementFeedback?.('VOID PRISON SHATTERED — ESCAPED!',2);return}
        }
        this.spaceWasDown=space
        this.trapMesh.visible=true
        this.art.load()
        this.art.root.visible=this.art.ready
        this.art.root.position.copy(player)
        // The supplied mesh is flattened along its Z axis. Keep it facing
        // the camera as decorative energy glyphs, not a replacement hitbox.
        if(this.art.ready) this.art.root.lookAt(this.level.sceneManager.camera.position)
        this.trapMesh.position.copy(player)
        this.trapMesh.rotation.y+=dt
        this.trapMaterial.opacity=0.2+Math.sin(this.time*7)*0.07
        this.damageTimer-=dt
        if(this.damageTimer<=0){this.damageTimer=1;this.level._applyAlienHit?.(6)}
    }
    dispose(){this.release();this.art.dispose();this.meter.remove();this.trapMesh.removeFromParent();for(const p of this.projectiles)p.mesh.removeFromParent();this.projectileGeometry.dispose();this.projectileMaterial.dispose();this.trapGeometry.dispose();this.trapMaterial.dispose()}
}
