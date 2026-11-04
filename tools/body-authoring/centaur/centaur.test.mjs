// Renderer check for the centaur (#723). The renderer imports parameter properties, so run with Node 24:
// node --experimental-transform-types --test tools/body-authoring/centaur/centaur.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {authorCentaur} from './author.mjs';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';import {HumanViews} from '../../../mars/viewer/app/engine-view/humans.ts';
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url));const moduleRoot=require.resolve('three').replace('/build/three.cjs','');const T=await import(pathToFileURL(moduleRoot+'/build/three.module.js').href);const {GLTFLoader}=await import(pathToFileURL(moduleRoot+'/examples/jsm/loaders/GLTFLoader.js').href);
const {bytes}=authorCentaur(),load=()=>new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
async function views(){const t=templateFromGltf('centaur',await load()),v=new HumanViews();v.setTemplates([t]);return {v,t};}
const HIND=['HindUpperLeg.L','HindUpperLeg.R','HindLowerLeg.L','HindLowerLeg.R','HindFoot.L','HindFoot.R'];
function frame(v,activity,t,extra={}){v.setFrame([{id:'c',p:[0,0,0],yaw:0,walk:0,walkDist:0,activity,since:4,...extra}],t);v.render(1);const h=v.bodyObject('c');h.updateMatrixWorld(true);return h;}
const local=(h,name)=>h.getObjectByName(name.replace('.',''))??h.getObjectByName(name);
const world=(h,name)=>local(h,name).getWorldPosition(new T.Vector3());

test('the renderer plays the authored walk on the extra hind joints, half a stride after the same-side foreleg',async()=>{
 const {v,t}=await views(),hind=[],fore=[];
 for(let i=0;i<=40;i++){const clock=i/30,d=clock*t.walkSpeed;v.setFrame([{id:'c',p:[d,0,0],yaw:0,walk:1,walkDist:d,speed:t.walkSpeed,walkAge:10,activity:'walk'}],clock);v.render(1);const h=v.bodyObject('c');
  hind.push(local(h,'HindUpperLeg.L').quaternion.clone());fore.push(local(h,'UpperLeg.L').quaternion.clone());}
 const swing=qs=>Math.max(...qs.map(q=>q.angleTo(qs[0])));assert.ok(swing(hind)>.2,'hind leg swings: '+swing(hind));
 assert.ok(hind.some((q,i)=>q.angleTo(fore[i])>.2),'hind leg is not in phase with its same-side foreleg');
});

test('pose adapters leave the hind joints alone; standby and dance keep all four hooves planted',async()=>{
 const {v}=await views(),snap=h=>HIND.map(n=>local(h,n).quaternion.clone()),hooves=h=>['Foot.L','Foot.R','HindFoot.L','HindFoot.R'].map(n=>world(h,n));
 const idle=frame(v,'idle',10),idleHind=snap(idle),idleHooves=hooves(idle),idleHead=local(idle,'Head').getWorldQuaternion(new T.Quaternion());
 const wave=frame(v,'wave',20);snap(wave).forEach((q,i)=>assert.ok(q.angleTo(idleHind[i])<1e-3,'wave touched '+HIND[i]));
 const rest=frame(v,'rest',30);hooves(rest).forEach((p,i)=>assert.ok(p.distanceTo(idleHooves[i])<.02,'standby moved a hoof'));assert.ok(local(rest,'Head').getWorldQuaternion(new T.Quaternion()).angleTo(idleHead)>.2,'standby lowers the head');
 const chest=[];for(let i=0;i<=16;i++){const h=frame(v,'dance',40+i*.125,{since:4+i*.125});chest.push(local(h,'Chest').getWorldQuaternion(new T.Quaternion()));hooves(h).forEach((p,k)=>assert.ok(p.distanceTo(idleHooves[k])<.02,'dance moved a hoof'));}
 assert.ok(Math.max(...chest.map(q=>q.angleTo(chest[0])))>.2,'the torso dances');
 const back=frame(v,'idle',60,{since:4});hooves(back).forEach((p,i)=>assert.ok(p.distanceTo(idleHooves[i])<.02));
});

