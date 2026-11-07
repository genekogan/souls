import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import type {PublicSoul} from '@souls/protocol';
import {AssetDownloads} from '../src/AssetDownloads.ts';
import {explorePresence,orderedExploreSouls,exploreRoom} from '../src/explore-data.ts';
import {twilightColour} from '../src/atmosphere/twilight.ts';
import {createWorldWallFrames,WALL_FRAME_MANIFEST,validWallFrames} from '../src/WorldWallFrames.ts';
import {inspectPublicLibraryProposal} from '../../../mars/viewer/app/engine-view/content/assets/public-library-proposal/library.ts';
const soul=(id:string,name=id):PublicSoul=>({id,name,entityId:'h_'+id,description:'',owner:'fixture',intent:null,intentText:'',mood:'',energy:'',doing:'',native:true});
void test('download counts actual requests, retained errors and explicit retries without inventing a percentage',()=>{
 const d=new AssetDownloads();d.start('one');d.start('two');d.finish('one');assert.deepEqual(d.snapshot(),{loaded:1,total:2,failed:0,pending:1});d.finish('two',true);d.finish('two');assert.deepEqual(d.snapshot(),{loaded:1,total:2,failed:1,pending:0});d.start('two');assert.equal(d.snapshot().pending,1);d.finish('two');assert.deepEqual(d.snapshot(),{loaded:2,total:2,failed:0,pending:0});
});
void test('Explore presence follows the actual public roster; green sorts first, away last and unknown remains unknown',()=>{
 const people=new Map([['a',soul('a','Zebra')],['b',soul('b','Alpha')],['c',soul('c','Beta')]]),presence=explorePresence([{kind:'fade.roster',souls:[{soulId:'a',colour:'green'},{soulId:'b',colour:'gone'}]}]);assert.deepEqual(orderedExploreSouls(people,presence).map(s=>s.id),['a','c','b']);assert.equal(presence.has('c'),false);assert.deepEqual(orderedExploreSouls(people,presence,'alp').map(s=>s.id),['b']);assert.equal(explorePresence([{kind:'fade',soulId:'a',change:'reclaimed'}]).get('a'),'active');assert.equal(explorePresence([{kind:'fade.roster',souls:[{soulId:'a',colour:'green'}]},{kind:'fade.roster',souls:[]}]).size,0);
});
void test('room roster uses actual polygon and elevation containment, excludes nearby/outside/other-floor Souls',()=>{
 const places=[{id:'int-room',name:'Room',kind:'room',level:0,polygon:[[0,0],[4,0],[4,4],[0,4]]},{id:'int-upper',name:'Upper',kind:'room',level:1,polygon:[[0,0],[4,0],[4,4],[0,4]]}];const souls=new Map(['in','out','upper'].map(id=>[id,soul(id)])),entities={h_in:{p:[1,0,1]},h_out:{p:[4.1,0,1]},h_upper:{p:[1,3.1,1]}};
 assert.deepEqual(exploreRoom([2,1.65,2],places,souls,entities)?.soulIds,['in']);assert.deepEqual(exploreRoom([2,4.75,2],places,souls,entities)?.soulIds,['upper']);assert.equal(exploreRoom([7,1.65,2],places,souls,entities),null);
});
void test('dawn/sunset cloud colour is bounded and smooth at every transition, with day-dependent rose variation',()=>{
 for(const cloud of[0,.3,.7,1])for(const day of[1,2,100])for(let elevation=-10;elevation<22;elevation+=.01){const a=twilightColour(elevation,cloud,day),b=twilightColour(elevation+.01,cloud,day);assert.ok(a.strength>=0&&a.strength<=1);assert.ok(Math.abs(a.strength-b.strength)<.004);assert.ok(a.rgb.every(c=>c>=0&&c<=1));}
 assert.equal(twilightColour(30,.4,1).strength,0);assert.equal(twilightColour(-10,.4,1).strength,0);assert.notDeepEqual(twilightColour(-1,.5,1).rgb,twilightColour(-1,.5,2).rgb);
});
void test('authored image/video assignments fit actual solid library walls, preserve stable IDs and own disposable frames',()=>{
 const library=inspectPublicLibraryProposal(),rows=WALL_FRAME_MANIFEST;assert.equal(validWallFrames(rows),true);assert.equal(new Set(rows.map(r=>r.id)).size,2);
 for(const row of rows){const local=[row.p[0]-74,row.p[1],row.p[2]+7];const support=library.parts.filter(p=>p.name.includes('south-entry-side')).some(p=>{const bounds={min:p.p.map((v,i)=>v-p.size[i]/2),max:p.p.map((v,i)=>v+p.size[i]/2)};return Math.abs(row.yaw-Math.PI)<.01&&Math.abs(local[2]-(bounds.min[2]-.025))<1e-5&&local[0]-row.width/2-.07>=bounds.min[0]&&local[0]+row.width/2+.07<=bounds.max[0]&&local[1]-row.height/2-.07>=bounds.min[1]&&local[1]+row.height/2+.07<=bounds.max[1];});assert.ok(support,'entire frame sits on a solid wall beside the open doorway');}
 const owner=createWorldWallFrames();assert.equal(owner.group.children.length,2);assert.equal(owner.group.userData.skipBuildingIdentity,true);const geos=new Set<THREE.BufferGeometry>();owner.group.traverse(o=>{if(o instanceof THREE.Mesh)geos.add(o.geometry);});let disposed=0;for(const g of geos)g.addEventListener('dispose',()=>disposed++);owner.dispose();owner.dispose();assert.equal(disposed,geos.size);assert.equal(owner.group.children.length,0);
});
void test('video loops pause when hidden/offscreen and release media plus event listeners at teardown',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),events=new EventTarget();let playing=false,removed=0,loads=0,hidden=false;
 const video={paused:true,muted:false,loop:false,playsInline:false,preload:'',src:'',currentTime:0,readyState:4,play(){this.paused=false;playing=true;return Promise.resolve();},pause(){this.paused=true;playing=false;},removeAttribute(){this.src='';},load(){loads++;},remove(){removed++;}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>video,get visibilityState(){return hidden?'hidden':'visible';},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)}});
 try{const owner=createWorldWallFrames([{id:'test-video',buildingId:'wall',p:[0,1,0],yaw:0,width:1,height:1,media:{kind:'video',url:'/fixture.mp4'}}]);const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,1,3);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);owner.update(camera);await Promise.resolve();assert.equal(playing,true);assert.equal(video.loop,true);owner.update(camera,false);assert.equal(playing,false);owner.update(camera);await Promise.resolve();hidden=true;events.dispatchEvent(new Event('visibilitychange'));assert.equal(playing,false);owner.dispose();owner.dispose();assert.equal(removed,1);assert.equal(loads,1);assert.equal(video.src,'');}
 finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
});
void test('transparent raw previews restore the borrowed world renderer even when a render fails',async()=>{
 const {WorldPlacePreviews}=await import('../src/WorldPlacePreviews.ts');
 const geometry=new THREE.BoxGeometry(2,2,2),material=new THREE.MeshStandardMaterial({color:'#789abc'}),root=new THREE.Group();root.add(new THREE.Mesh(geometry,material));root.position.set(79,0,0);let sourceDisposed=0;geometry.addEventListener('dispose',()=>sourceDisposed++);
 const original={marker:'world-target'},viewport=new THREE.Vector4(0,0,640,480),scissor=new THREE.Vector4(1,2,600,400),color=new THREE.Color('#123456');let target:unknown=original,scissorTest=true,alpha=.8,autoClear=false;
 const renderer={get autoClear(){return autoClear;},set autoClear(v:boolean){autoClear=v;},getRenderTarget:()=>target,setRenderTarget:(v:unknown)=>{target=v;},getViewport:(v:THREE.Vector4)=>v.copy(viewport),getScissor:(v:THREE.Vector4)=>v.copy(scissor),getScissorTest:()=>scissorTest,setScissorTest:(v:boolean)=>{scissorTest=v;},setViewport:(v:THREE.Vector4)=>{assert.deepEqual(v.toArray(),[0,0,640,480]);},setScissor:(v:THREE.Vector4)=>{assert.deepEqual(v.toArray(),[1,2,600,400]);},getClearColor:(v:THREE.Color)=>v.copy(color),getClearAlpha:()=>alpha,setClearColor:(v:THREE.Color|number,a:number)=>{if(v instanceof THREE.Color)color.copy(v);else color.set(v);alpha=a;},render:()=>{throw Error('fixture render failure');}};
 const owner=new WorldPlacePreviews(renderer as unknown as THREE.WebGLRenderer,()=>[root]);assert.equal(await owner.capture('fountain'),null);assert.equal(target,original);assert.equal(scissorTest,true);assert.equal(alpha,.8);assert.equal(autoClear,false);assert.equal(color.getHexString(),'123456');assert.equal(sourceDisposed,0);owner.dispose();geometry.dispose();material.dispose();
});
void test('actual conversation peers override nearby strangers and idle standing faces them without changing recorded pose',async()=>{
 const {WorldIdleLife,conversationAttention,lookTarget}=await import('../src/WorldIdleLife.ts');const root=new THREE.Group(),head=new THREE.Bone();head.name='Head';root.add(head);const original=root.quaternion.clone(),life=new WorldIdleLife(),self={id:'a',root,p:[0,0,0] as[number,number,number],yaw:0,activity:'idle',speaking:false,attention:['b']},peer={...self,id:'b',root:null,p:[-3,0,0] as[number,number,number],attention:undefined},stranger={...peer,id:'c',p:[1,0,1] as[number,number,number]};
 const rows=[{speaker:'b',at:100,channel:{kind:'conversation',members:['a','b']}}];assert.deepEqual(conversationAttention('a',rows,101),['b']);assert.deepEqual(conversationAttention('a',rows,20101),[]);assert.equal(lookTarget({...self,attention:['c']},[self,peer,stranger]),Math.PI/4);
 let forward=new THREE.Vector3();for(let i=0;i<180;i++){life.apply([self,peer,stranger],i/60,1/60);forward.set(1,0,0).applyQuaternion(root.quaternion);life.restore();assert.ok(root.quaternion.angleTo(original)<1e-9);assert.deepEqual(self.p,[0,0,0]);}assert.ok(forward.x<-.98,'rendered idle body actually faces conversation peer behind it');
 life.apply([{...self,activity:'read'},peer],3,1/60);assert.ok(root.quaternion.angleTo(original)<1e-9,'supported reading keeps recorded root orientation');life.restore();
});
void test('hover/info text is compact while the complete activity remains available on its card',async()=>{
 const {hoverTooltipText}=await import('../src/WorldHover.ts');const text=hoverTooltipText('A'.repeat(120),'B'.repeat(180));assert.ok(text.length<=133);assert.equal(text.split(' · ').length,2);assert.ok(text.endsWith('…'));assert.equal(hoverTooltipText('Moss','Reading'),'Moss · Reading');
});

void test('Vite-inlined original image data is admitted without admitting inline videos or executable URLs',()=>{
 const image={...WALL_FRAME_MANIFEST[0],media:{kind:'image' as const,url:'data:image/svg+xml;base64,PHN2Zy8+'}};
 assert.equal(validWallFrames([image]),true);assert.equal(validWallFrames([{...image,media:{kind:'video',url:image.media.url}}]),false);assert.equal(validWallFrames([{...image,media:{kind:'image',url:'javascript:alert(1)'}}]),false);
});
