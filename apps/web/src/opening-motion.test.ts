import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {WorldModel,coreLibrary,applyBatch,contactStateKey} from '@souls/world-compiler';import {meshFor} from './gen-mesh/registry.ts';import './gen-mesh/kit.mesh.ts';import {MaterialLib} from './gen-mesh/materials.ts';import {beginOpeningMotion,stepOpeningMotion} from './opening-motion.ts';import {lightDiffAhead} from './light-diff-clock.ts';
function fixture(name:string){const model=new WorldModel({constants:{ground:'land'},seed:'hinge'});model.library=coreLibrary();const r=applyBatch(model,{ops:[{op:'place',def:`core/${name}@2`,name,p:[0,0]}]},'god',1);assert.equal(r.result.accepted,true);const e=model.get(name)!,def=model.resolvedDef(e.def)!;const draw=(open:boolean)=>meshFor(def)!.build({def,entity:{...e,state:{...e.state,open}},params:Object.fromEntries(Object.entries(def.params).map(([k,v])=>[k,v.default])) as Record<string,never>,args:def.make.kind==='gen'?def.make.args??{}:{},baked:model.bake(def,e.params??{},e.seed??0),model,materials:new MaterialLib(),tint:(key,fallback)=>def.palette?.[key??'']??fallback})!;return {model,e,def,draw};}
for(const name of ['door','gate'])test(`${name}: actual kit geometry hinges at its side and swings continuously on open, close and reversal`,()=>{
 const f=fixture(name),closed=f.draw(false),open=f.draw(true),part=open.getObjectByName('role:door')!;assert.ok(part);assert.equal(part.position.x,name==='door'?-.5:-.56);assert.equal(contactStateKey(f.def,'open'),'open');
 const msg={by:'engine',tick:100,diff:{upserts:[{...f.e,state:{...f.e.state,open:true}}]}};assert.equal(lightDiffAhead(f.model,msg,99),true);assert.equal(lightDiffAhead(f.model,msg,100),false);
 const tween=beginOpeningMotion(open,closed,1000)!;assert.ok(tween);assert.equal(part.rotation.y,0);assert.equal(stepOpeningMotion(tween,1225),true);const mid=part.rotation.y;assert.ok(mid<-.5&&mid>-1.1);
 const reversed=f.draw(false),reverse=beginOpeningMotion(reversed,open,1225)!;assert.equal(reversed.getObjectByName('role:door')!.rotation.y,mid,'reversal begins at the current angle');assert.equal(stepOpeningMotion(reverse,1675),false);assert.equal(reversed.getObjectByName('role:door')!.rotation.y,0);
 assert.equal(stepOpeningMotion(tween,1450),false);assert.ok(Math.abs(part.rotation.y+Math.PI*.48)<1e-9);assert.equal(beginOpeningMotion(f.draw(true),open,2000),undefined,'unchanged opening has no idle tween');
});
// Soul Actions entry 23: curtains bunch to their rod ends and a roller blind rolls up, easing over 1.1 s from the contact.
for(const [name,roles,axis] of [['curtained-window',['role:curtain-l','role:curtain-r'],'x'],['blind-window',['role:blind'],'y']] as const)test(`${name}: the covering draws along its rod and eases from the contact, reversal included`,()=>{
 const model=new WorldModel({constants:{ground:'land'},seed:'cover'});model.library=coreLibrary();assert.equal(applyBatch(model,{ops:[{op:'place',def:`core/${name}@1`,name,p:[0,0]}]},'god',1).result.accepted,true);
 const e=model.get(name)!,def=model.resolvedDef(e.def)!;assert.equal(contactStateKey(def,'close'),'open');assert.equal(contactStateKey(def),'open');
 const draw=(open:boolean)=>meshFor(def)!.build({def,entity:{...e,state:{...e.state,open}},params:Object.fromEntries(Object.entries(def.params).map(([k,v])=>[k,v.default])) as never,args:def.make.kind==='gen'?def.make.args??{}:{},baked:model.bake(def,e.params??{},e.seed??0),model,materials:new MaterialLib(),tint:(key,fallback)=>def.palette?.[key??'']??fallback})!;
 const open=draw(true),closed=draw(false),s=(o:THREE.Object3D,r:string)=>o.getObjectByName(r)!.scale[axis];
 for(const r of roles){assert.ok(s(open,r)<0.25,`${r} drawn back when open`);assert.equal(s(closed,r),1,`${r} across the glass when closed`);}
 const tween=beginOpeningMotion(closed,open,1000)!;assert.ok(tween);for(const r of roles)assert.ok(s(closed,r)<0.25,'starts where it was');
 assert.equal(stepOpeningMotion(tween,1550),true);const mid=s(closed,roles[0]);assert.ok(mid>0.4&&mid<0.8,'half drawn at half time: '+mid);
 const back=draw(true),rev=beginOpeningMotion(back,closed,1550)!;assert.equal(s(back,roles[0]),mid,'reversal begins at the current draw');
 assert.equal(stepOpeningMotion(rev,2650),false);assert.ok(s(back,roles[0])<0.25);assert.equal(stepOpeningMotion(tween,2100),false);assert.equal(s(closed,roles[0]),1);
});
