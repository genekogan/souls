import * as THREE from 'three';
import {recordedGameObjects,recordedJuggles,recordedKites} from '../../../mars/viewer/app/engine-view/recorded-games.ts';
import type {SampledEntity} from '../../../mars/viewer/engine/take/replay.ts';
/** One prop per recorded court flight; landed boules persist for exactly the current end. */
const UP=new THREE.Vector3(0,1,0);
export class WorldGames{
 readonly group=new THREE.Group();private meshes=new Map<string,THREE.Mesh>();
 private ball=new THREE.SphereGeometry(1,16,12);private disc=new THREE.CylinderGeometry(.12,.12,.018,24);
 private materials={frisbee:new THREE.MeshStandardMaterial({color:'#e9712e',roughness:.5}),petanque:new THREE.MeshStandardMaterial({color:'#9ca5ac',metalness:.8,roughness:.3}),volleyball:new THREE.MeshStandardMaterial({color:'#f2eee3',roughness:.7}),jack:new THREE.MeshStandardMaterial({color:'#dfb356',roughness:.7})};
 /** #441: the held sets drawn as flying balls this frame: the entity layer hides these. */
 readonly juggledSets=new Set<string>();
 private juggleMaterial(color?:string){const key='#'+(color??'e2583e').replace(/^#/,'');let m=this.juggleMaterials.get(key);if(!m){m=new THREE.MeshStandardMaterial({color:key,roughness:.6});this.juggleMaterials.set(key,m);}return m;}
 private juggleMaterials=new Map<string,THREE.MeshStandardMaterial>();
 /** #441 (W108): a diamond sail in its own plane, one unit of string. */
 private kiteSail=(()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,.42,0, .24,.08,0, 0,-.36,0, -.24,.08,0],3));g.setIndex([0,1,2,0,2,3,0,2,1,0,3,2]);g.computeVertexNormals();return g;})();
 private kiteString=new THREE.CylinderGeometry(.006,.006,1,4);
 private stringMaterial=new THREE.MeshStandardMaterial({color:'#efeadf',roughness:.9});
 private spoolMaterial=new THREE.MeshStandardMaterial({color:'#8a6a3f',roughness:.8});
 private kiteMesh(key:string,g:THREE.BufferGeometry,m:THREE.Material,seen:Set<string>){seen.add(key);let mesh=this.meshes.get(key);if(!mesh){mesh=new THREE.Mesh(g,m);mesh.name=key;mesh.castShadow=true;this.meshes.set(key,mesh);this.group.add(mesh);}return mesh;}
 constructor(){this.group.name='recorded-games';}
 update(entities:Readonly<Record<string,SampledEntity>>,tick:number){
  const seen=new Set<string>();for(const obj of recordedGameObjects(entities,tick)){seen.add(obj.key);let mesh=this.meshes.get(obj.key);
   if(!mesh){mesh=new THREE.Mesh(obj.kind==='frisbee'?this.disc:this.ball,this.materials[obj.kind]);mesh.name=obj.key;mesh.castShadow=mesh.receiveShadow=true;mesh.userData.gameKind=obj.kind;this.meshes.set(obj.key,mesh);this.group.add(mesh);}
   const size=obj.kind==='volleyball' ? .105 : obj.kind==='petanque' ? .045 : obj.kind==='jack' ? .025 : 1;mesh.scale.setScalar(size);mesh.position.set(...obj.p);mesh.rotation.set(0,obj.progress*Math.PI*4,obj.kind==='frisbee'&&obj.flight ? .08 : 0);mesh.visible=true;
  }
  const juggles=recordedJuggles(entities,tick);this.juggledSets.clear();for(const id of juggles.sets)this.juggledSets.add(id);
  for(const id of recordedKites(entities,tick).items)this.juggledSets.add(id);
  // #441 (W108): a kite in the air, its string from the hand, the spool in the hand
  for(const k of recordedKites(entities,tick).kites){
   const sail=this.kiteMesh(k.key,this.kiteSail,this.juggleMaterial(k.color??'d9483b'),seen),line=this.kiteMesh(k.key+':string',this.kiteString,this.stringMaterial,seen),spool=this.kiteMesh(k.key+':spool',this.ball,this.spoolMaterial,seen);
   sail.position.set(...k.p);sail.rotation.set(0,-k.yaw+Math.PI/2,k.roll);
   const dx=k.p[0]-k.hand[0],dy=k.p[1]-k.hand[1],dz=k.p[2]-k.hand[2],len=Math.hypot(dx,dy,dz)||1e-3;
   line.position.set(k.hand[0]+dx/2,k.hand[1]+dy/2,k.hand[2]+dz/2);line.scale.set(1,len,1);line.quaternion.setFromUnitVectors(UP,new THREE.Vector3(dx/len,dy/len,dz/len));
   spool.position.set(...k.hand);spool.scale.setScalar(.035);}
  for(const ball of juggles.balls){seen.add(ball.key);let mesh=this.meshes.get(ball.key);if(!mesh){mesh=new THREE.Mesh(this.ball,this.juggleMaterial(ball.color));mesh.name=ball.key;mesh.castShadow=mesh.receiveShadow=true;mesh.scale.setScalar(.04);this.meshes.set(ball.key,mesh);this.group.add(mesh);}mesh.position.set(...ball.p);}
  for(const [key,mesh] of this.meshes)if(!seen.has(key)){mesh.removeFromParent();this.meshes.delete(key);}
 }
 dispose(){this.group.removeFromParent();this.group.clear();this.meshes.clear();this.ball.dispose();this.disc.dispose();Object.values(this.materials).forEach(m=>m.dispose());this.juggleMaterials.forEach(m=>m.dispose());this.juggleMaterials.clear();this.kiteSail.dispose();this.kiteString.dispose();this.stringMaterial.dispose();this.spoolMaterial.dispose();}
}
