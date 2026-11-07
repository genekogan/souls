import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {registerHooks} from 'node:module';
import {WorldModel,coreLibrary,applyBatch} from '@souls/world-compiler';
import {GodWorldLiving} from './world-env.ts';import {lightDiffAhead} from './light-diff-clock.ts';

async function fixture(){
 (globalThis as {location?:unknown}).location??=new URL('http://offline.invalid/w/fixture');
 const index=new URL('./gen-mesh/index.ts',import.meta.url).href;
 const hook=registerHooks({load(url,ctx,next){return url===index?{format:'module',shortCircuit:true,source:"export {meshFor} from './registry.ts';"}:next(url,ctx);}});
 const {WorldEntityLayer}=await import('./WorldEntityLayer.ts').finally(()=>hook.deregister());await import('./gen-mesh/kit.mesh.ts');
 const model=new WorldModel({constants:{ground:'land',extent:350},seed:'light-clock'});model.library=coreLibrary();
 const r=applyBatch(model,{ops:[{op:'place',def:'core/floor-lamp@2',name:'lamp',p:[3,0]}]},'god',1);assert.equal(r.result.accepted,true,JSON.stringify(r.result));
 const layer=new WorldEntityLayer(p=>p),inner=layer as unknown as {model:WorldModel;draw:(e:unknown,ease:boolean)=>void;drawn:Map<string,{obj:THREE.Object3D}>;now:number};inner.model=model;layer.active=true;(layer as unknown as {seq:number}).seq=0;inner.now=1000;
 const lamp=model.get('lamp')!;inner.draw(lamp,false);const living=new GodWorldLiving(layer);living.update(1000,0);
 const glow=()=>{const values:number[]=[];inner.drawn.get(lamp.id)!.obj.traverse(o=>{const m=(o as THREE.Mesh).material as THREE.MeshStandardMaterial;if(m?.emissive?.getHex())values.push(m.emissiveIntensity);});return Math.max(0,...values);};
 const message=(seq:number,on:boolean,tick=100,by='engine')=>({type:'edge',kind:'world-diff',seq,tick,by,diff:{upserts:[{...lamp,state:{...lamp.state,on}}],removes:[],defs:[],tiles:[]}});
 return {model,layer,inner,lamp,living,glow,message};
}

test('native switch waits for depicted contact; bulb and pool change on the same frame, with ordered following edits',async()=>{
 const f=await fixture();assert.ok(f.glow()>0);assert.equal(f.living.lights,1);
 const off=f.message(1,false),follow={type:'edge',kind:'world-diff',seq:2,tick:101,by:'god',diff:{upserts:[],removes:[],defs:[],tiles:[],world:{about:{title:'Owner edit'}}}};
 f.layer.applyEdge([off,follow],99);f.living.update(1016,0);
 assert.equal((f.layer as unknown as {seq:number}).seq,0);assert.equal(f.model.get('lamp')!.state!.on,true);assert.ok(f.glow()>0);assert.equal(f.living.lights,1);assert.notEqual(f.model.state.about?.title,'Owner edit');
 f.layer.applyEdge([off,follow],100);f.living.update(1032,0);
 assert.equal((f.layer as unknown as {seq:number}).seq,2);assert.equal(f.model.get('lamp')!.state!.on,false);assert.equal(f.glow(),0,'OFF mesh is dark before transform easing or another animation frame');assert.equal(f.living.lights,0);assert.equal(f.model.state.about?.title,'Owner edit');
 const on=f.message(3,true,150);f.layer.applyEdge([on],149);assert.equal(f.glow(),0);f.layer.applyEdge([on],150);f.living.update(1048,0);assert.ok(f.glow()>0);assert.equal(f.living.lights,1);
 f.living.dispose();
});

test('owner changes, untimed legacy messages and non-light native changes keep immediate behavior',async()=>{
 const f=await fixture();assert.equal(lightDiffAhead(f.model,f.message(1,false,100,'god'),0),false);assert.equal(lightDiffAhead(f.model,{...f.message(1,false),tick:undefined},0),false);
 assert.equal(lightDiffAhead(f.model,{...f.message(1,true),diff:{upserts:[{...f.lamp,state:{...f.lamp.state,on:true}}]}},0),false);
 f.layer.applyEdge([f.message(1,false,100,'god')],0);assert.equal((f.layer as unknown as {seq:number}).seq,1);assert.equal(f.glow(),0);f.living.dispose();
});

test('periodic seq refresh never overtakes a received contact diff waiting for its depicted tick',async()=>{
 const f=await fixture(),off=f.message(1,false,500),inner=f.layer as unknown as {signal:AbortSignal;resync:()=>Promise<void>};inner.signal=new AbortController().signal;
 const beforeFetch=globalThis.fetch;let serverSeq=1,resyncs=0;inner.resync=async()=>{resyncs++;};globalThis.fetch=async()=>new Response(JSON.stringify({seq:serverSeq}),{headers:{'content-type':'application/json'}});
 try{f.layer.applyEdge([off],499);f.layer.update(.016,20001);await new Promise(r=>setImmediate(r));assert.equal(resyncs,0,'already received future diff is buffered, not missing');assert.equal((f.layer as unknown as {seq:number}).seq,0);assert.equal(f.model.get('lamp')!.state!.on,true);
 serverSeq=2;f.layer.update(.016,40002);await new Promise(r=>setImmediate(r));assert.equal(resyncs,1,'a genuinely missing newer seq still resyncs');
 f.layer.applyEdge([off],500);assert.equal(f.model.get('lamp')!.state!.on,false);serverSeq=0;f.layer.update(.016,60003);await new Promise(r=>setImmediate(r));assert.equal(resyncs,1,'a stale heartbeat cannot roll back an applied stream');
 }finally{globalThis.fetch=beforeFetch;f.living.dispose();}
});
