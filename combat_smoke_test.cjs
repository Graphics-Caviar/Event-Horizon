const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert')
const dir = path.join(__dirname, 'src/levels/Level3')
class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  copy(v){return this.set(v.x,v.y,v.z)}
  clone(){return new Vec(this.x,this.y,this.z)}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this}
  subVectors(a,b){return this.copy(a).sub(b)}
  multiplyScalar(s){return this.set(this.x*s,this.y*s,this.z*s)}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}
  length(){return Math.sqrt(this.lengthSq())}
  normalize(){return this.multiplyScalar(1/(this.length()||1))}
  distanceTo(b){return this.clone().sub(b).length()}
  distanceToSquared(b){return this.clone().sub(b).lengthSq()}
  lerp(v,a){return this.addScaledVector(v.clone().sub(this),a)}
  clampLength(min,max){return this.multiplyScalar(Math.min(1,max/(this.length()||1)))}
}
const THREE = {Vector3:Vec,MathUtils:{clamp:(n,min,max)=>Math.max(min,Math.min(max,n))}}
function load(file, globalName){
  const text=fs.readFileSync(path.join(dir,file),'utf8').replace(/^import .*\n/gm,'').replace(/^export \{.*\}\s*;?\s*$/gm,'').replace(/^export /gm,'')
  return vm.runInNewContext(text+`\n${globalName}`,{THREE,console,Math})
}
let calls=[]
function makeFX(){
  return Object.fromEntries(['_damage','warn','bolt','volley','zone','pulse','field','decoy','meteor','beam','clear'].map(k=>[k, (...args)=>{calls.push(k)}]))
}
const bossClass=load('VoidGodAbilities.js','VoidGodAbilities')
const dummyLevel={voidAudio:{play:()=>{}},_showMovementFeedback:()=>{}}
const boss={position:new Vec(0,8,-300),hp:500,maxHp:500,activated:true,dead:false,_state:'idle',_timer:0}
const skills=new bossClass(boss,makeFX(),dummyLevel)
for(const [phase,hp] of [[1,500],[2,240],[3,100]]){
  boss.hp=hp
  skills.update(0.016,new Vec(0,8,-290))
  assert.equal(skills.phase,phase)
  for(const a of ['cosmicCleave','voidProjectiles','gravityStomp','armourOfTheVoid','singularityBeam','meteoricCollapse','gravitationalCrush','voidClones','realityBreak','apocalypticBarrage','eventHorizon','finalAnnihilation']){
    skills.start(a,new Vec(0,8,-290))
    skills.fire(new Vec(0,8,-290))
    assert(calls.length>0)
  }
}
skills.start('finalAnnihilation',new Vec());skills.onDamage(90)
assert.equal(skills.state,'recover')
assert.equal(skills.activeAbility,'')
const Fighter=load('VoidArenaCombat.js','VoidArenaFighter')
const fighter=Object.create(Fighter.prototype)
fighter.position=new Vec(0,8,0);fighter.root={position:fighter.position};fighter.fx=makeFX()
fighter.level={...dummyLevel,velocity:new Vec()}
fighter._warningPos=new Vec(6,8,0);fighter._target=new Vec();fighter._flank=new Vec();fighter.time=1
fighter.exposed=0;fighter.shieldTime=0;fighter.overloadTime=0;fighter.interrupted=false
fighter.kind='sentinel'
const allFighterAbilities=[
'voidStrike','riftBolt','phaseStep','guardianShield','seismicSlam','gravityPunch','voidRoar','armourOverload',
'riftCloak','shadowPounce','dimensionalBlink','executionClaws','gravityWell','riftPulse','debrisStorm','spatialDistortion',
'realityShards','voidTendrils','spatialRift','falseImage','gravityReversal','realityFracture','temporalEcho','dimensionalPrison',
'worldCollapse','eventHorizonSurge','infiniteEchoes','existenceErasure']
for(const name of allFighterAbilities){
 fighter.currentAbility=name
 fighter._execute(new Vec(4,8,4))
}
assert(fighter.shieldTime>=0)
console.log('PASS: 3 Void-God phase thresholds; 12 boss ability executions; interruptible final attack; 28 guardian/Entity ability executions.')
