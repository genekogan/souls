import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import { defSchema } from '@sim/world-compiler';
import { defLights, lightPhase, lightPatternLevel, PatternNightMap, installNightLighting, paintNightMap, worldNightBounds } from '../src/WorldNightLights.ts';
import { Halos } from '../src/atmosphere/halos.ts';
import { animate, hasMotion } from '../src/gen-mesh/motion.ts';
const hooks = registerHooks({ load(url, context, next) {
  if (url !== new URL('../src/world-env.ts', import.meta.url).href) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
} });
const { GodWorldLiving } = await import('../src/world-env.ts'); hooks.deregister();
installNightLighting();
const uniforms = THREE.ShaderLib.standard.uniforms;
const sample = (map: THREE.DataTexture, x: number, z: number, bounds: { x0:number; z0:number; x1:number; z1:number }) => {
  const { width, height, data } = map.image as {width:number;height:number;data:Uint8Array};
  const i = Math.floor((x-bounds.x0)/(bounds.x1-bounds.x0)*width), j = Math.floor((z-bounds.z0)/(bounds.z1-bounds.z0)*height), k=(j*width+i)*4;
  return data[k]+data[k+1]+data[k+2];
};

test('night bounds follow centred extent and asymmetric extensions, including lights beyond the old rectangle', () => {
  assert.deepEqual(worldNightBounds(4000), { x0:-2000,z0:-2000,x1:2000,z1:2000 });
  const bounds=worldNightBounds(100,[1000,-50,1100,50]);
  const t=paintNightMap([{x:1040,z:0,radius:3,intensity:1,color:'#ffffff'}],[],bounds);
  assert.ok(sample(t,1040,0,bounds)>sample(t,1060,0,bounds));t.dispose();
});

test('offsets follow world yaw/scale, sample ground under the bulb, preserve colour, and update on edits', () => {
  let components: any = { light: { at: [5, 200, 0], color:'#ff8800',range:4 } };
  const model={entities:new Map([['a',{id:'a',def:'a@1'}]]),constants:{extent:100},ground:()=>({extent:[500,-50,600,50]}),resolvedDef:()=>({components}),worldPose:()=>({x:550,y:7,z:0,yaw:Math.PI/2,s:2})};
  const layer={active:true,group:new THREE.Group(),model,groundAt:(x:number,z:number)=>x===550&&Math.abs(z+10)<1e-8?12:3};
  const living=new GodWorldLiving(layer);living.update(0,0);
  const mark=living.group.userData.edenLightSources[0];
  assert.deepEqual(mark.slice(0,5),[550,407,-10,'festoon',.5]);
  const map=uniforms.uEdenLightMap.value;
  assert.deepEqual(map.bounds,{x:500,y:-50,z:100,w:100});assert.equal(map.raw,0);
  assert.ok(sample(map.map,550,-10,worldNightBounds(100,[500,-50,600,50]))>sample(map.map,550,0,worldNightBounds(100,[500,-50,600,50])));
  const version=map.map.version;components.light.range=8;living.update(500,0);assert.ok(map.map.version>version,'range change repaints');
  components={lights:[{at:[1,2],color:'#ffffff'},{at:[-1,2],on:false}],light:{}};living.update(1000,0);assert.equal(living.lights,1,'plural replaces singular, on:false skips one');
  model.entities.clear();living.update(1500,0);assert.equal(living.lights,0);assert.equal(sample(map.map,550,-10,worldNightBounds(100,[500,-50,600,50])),0);living.dispose();
});

test('patterns are deterministic gentle cycles; chase follows bulb order, twinkle uses stable independent phases', () => {
  for(const pattern of ['steady','blink','twinkle','chase','pulse'] as const){
    for(let i=0;i<60;i++){const t=i/10+.017,v=lightPatternLevel(pattern,t,.2);assert.ok(v>=.15&&v<=1);assert.ok(Math.abs(v-lightPatternLevel(pattern,t+6,.2))<1e-12);assert.equal(lightPatternLevel(pattern,t,.2,true),1);}
  }
  assert.equal(lightPhase('a',2,8,'chase'),.25);assert.notEqual(lightPhase('a',0,8,'twinkle'),lightPhase('a',1,8,'twinkle'));
  assert.equal(lightPhase('a',0,8,'twinkle'),lightPhase('a',0,8,'twinkle'));
  assert.notEqual(lightPatternLevel('chase',0,0),lightPatternLevel('chase',0,.5));
  assert.equal(defLights({light:{},lights:[{on:false}]}).length,1);
});

test('GPU map uses one instanced geometry, shares its sampler across cloned material uniforms and disposes', () => {
  const map=new PatternNightMap();map.setSources([{x:0,z:0,radius:3,intensity:1,color:'#ffffff',pattern:'chase'},{x:4,z:0,radius:3,intensity:1,color:'#ff8800',pattern:'twinkle'}],worldNightBounds(100));
  const m=map as any;assert.equal(m.geometry.instanceCount,2);assert.equal(m.geometry.getAttribute('position').count,6);
  const cloned=THREE.UniformsUtils.clone(uniforms);assert.equal(cloned.uEdenLightMap.value,uniforms.uEdenLightMap.value);
  let disposed=0;for(const resource of [m.geometry,m.material,m.target])resource.addEventListener('dispose',()=>disposed++);
  map.dispose();assert.equal(disposed,3);
});

test('halos carry exact authored height, independent phases/colour and update a middle source', () => {
  const halos=new Halos(8),sources:any[]=[[0,3,0,'festoon',1,'chase',0,'#ffffff'],[2,4,0,'festoon',1,'twinkle',.2,'#ff8800'],[4,3,0,'festoon',1]];
  halos.setSources(sources);assert.equal(halos.size,3);const matrix=new THREE.Matrix4();halos.mesh.getMatrixAt(1,matrix);assert.equal(matrix.elements[13],4);
  const pattern=halos.mesh.geometry.getAttribute('aPattern');assert.equal(pattern.getX(1),2);assert.ok(Math.abs(pattern.getY(1)-.2)<1e-6);
  sources[1][1]=8;halos.setSources(sources);halos.mesh.getMatrixAt(1,matrix);assert.equal(matrix.elements[13],8);
  halos.update(3,1,true);assert.equal(halos.uniforms.uPatternTime.value.y,1);halos.dispose();
  const fires=new Halos(2);fires.setSources([[0,0,0,'fire',1],[4,0,0,'fire',1,'pulse']]);
  const flicker=fires.mesh.geometry.getAttribute('aHalo');assert.ok(flicker.getW(0)>=0);assert.equal(flicker.getW(1),-1,'authored patterns suppress the legacy fast fire flicker');fires.dispose();
});

test('plural lamps animate their glow independently and can be switched repeatedly without changing shared materials', () => {
  const def=defSchema.parse({schema:'def/1',name:'light',make:{kind:'none'},size:{box:[1,1,1]},components:{lights:[{pattern:'pulse'}]}}) as any;
  assert.ok(hasMotion(def));const shared=new THREE.MeshStandardMaterial({emissive:'#ffffff',emissiveIntensity:1}),a=new THREE.Mesh(new THREE.BoxGeometry(),shared),b=new THREE.Mesh(new THREE.BoxGeometry(),shared);
  const entity:any={id:'one',def:'light@1',state:{}};
  animate(a,entity,def,1e9,{y:0,yaw:0});assert.notEqual(a.material,shared);assert.equal(b.material.emissiveIntensity,1);
  for(let i=0;i<2;i++){entity.state.on=false;animate(a,entity,def,1e9,{y:0,yaw:0});assert.equal(a.material.emissiveIntensity,0);entity.state.on=true;animate(a,entity,def,1e9,{y:0,yaw:0});assert.ok(a.material.emissiveIntensity>0);}
  // lane PERF-MATERIALS: a glow level is a variant shared by every lamp at that level (material-variants.ts): nothing is released per entity; the variants go with the shared source
  let disposed=0;a.material.addEventListener('dispose',()=>disposed++);const parent=new THREE.Group();parent.add(a);parent.remove(a);assert.equal(disposed,0,'a shared glow level is not released with one root');
  const c=new THREE.Mesh(new THREE.BoxGeometry(),shared);animate(c,{id:'two',def:'light@1',state:{}} as any,def,1e9,{y:0,yaw:0});assert.equal(c.material,a.material,'two lamps at one level share the material');
  shared.dispose();assert.equal(disposed,1,'glow levels are released with their source material');
  a.geometry.dispose();b.geometry.dispose();c.geometry.dispose();
});

function fakeRenderer() {
  const state:any={target:{name:'original'},viewport:new THREE.Vector4(2,3,10,20),scissor:new THREE.Vector4(4,5,6,7),scissorTest:true,color:new THREE.Color('#123456'),alpha:.7,renders:0};
  const renderer:any={autoClear:true,shadowMap:{autoUpdate:true},xr:{enabled:true},
    getRenderTarget:()=>state.target,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>1,
    getViewport:(v:any)=>v.copy(state.viewport),getScissor:(v:any)=>v.copy(state.scissor),getScissorTest:()=>state.scissorTest,getClearAlpha:()=>state.alpha,getClearColor:(v:any)=>v.copy(state.color),
    setRenderTarget:(t:any)=>{state.target=t;},setViewport:(v:any)=>state.viewport.copy(v),setScissor:(v:any)=>state.scissor.copy(v),setScissorTest:(v:any)=>{state.scissorTest=v;},
    setClearColor:(c:any,a:any)=>{state.color.set(c);state.alpha=a;},clear:()=>{},render:()=>{state.renders++;if(state.fail)throw Error('render failed');}};
  return {state,renderer};
}

test('pool pass restores the renderer target, XR/shadows, clear colour, viewport and scissor even on failure', () => {
  const {state,renderer}=fakeRenderer(),map=new PatternNightMap();map.setSources([{x:0,z:0,radius:3,intensity:1,color:'#ffffff',pattern:'pulse'}],worldNightBounds(200));
  const original=state.target;
  for(const fail of [false,true]){
    state.fail=fail;if(fail)assert.throws(()=>map.render(renderer,10),/render failed/);else map.render(renderer,10);
    assert.equal(state.target,original);assert.equal(renderer.autoClear,true);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);
    assert.equal(state.scissorTest,true);assert.deepEqual(state.viewport.toArray(),[2,3,10,20]);assert.deepEqual(state.scissor.toArray(),[4,5,6,7]);assert.equal(state.color.getHexString(),'123456');assert.equal(state.alpha,.7);
  }
  assert.equal(uniforms.uEdenLightMap.value.raw,1);map.dispose();assert.equal(uniforms.uEdenLightMap.value.raw,0);
});

test('reduced-motion switches patterns to steady once, resumes live, and removes the pass when lights become steady', () => {
  const {state,renderer}=fakeRenderer(),components:any={light:{pattern:'pulse'}};
  const model={entities:new Map([['a',{id:'a',def:'a@1'}]]),resolvedDef:()=>({components}),worldPose:()=>({x:0,y:0,z:0})};
  const living=new GodWorldLiving({active:true,group:new THREE.Group(),model,groundAt:()=>0} as any,renderer);
  living.update(0,0,false);assert.equal(state.renders,1);
  living.update(100,0,false);assert.equal(state.renders,2);
  living.update(200,0,true);assert.equal(state.renders,3);
  living.update(300,0,true);living.update(500,0,true);assert.equal(state.renders,3);
  living.update(600,0,false);assert.equal(state.renders,4);
  components.light.pattern='steady';living.update(1000,0,true);const n=state.renders;
  living.update(1100,0,false);assert.equal(state.renders,n);assert.equal(uniforms.uEdenLightMap.value.raw,0);living.dispose();
});
