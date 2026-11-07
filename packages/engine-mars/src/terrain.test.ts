import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { terrainPatchV1Schema, type TerrainPatchV1 } from '@souls/engine-contract';
import { createTerrainGeometryProbe } from './terrain.ts';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';

const patch=(heights:number[][],spacingMetres=1):TerrainPatchV1=>({id:'test-terrain',originXZ:[0,0],spacingMetres,
  columns:heights[0].length,rows:heights.length,heightMetres:heights,diagonal:'min-min/max-max'});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const request=(fromXZ:[number,number],toXZ:[number,number],radiusMetres=.1,maxGrade=.25)=>({fromXZ,toXZ,radiusMetres,maxGrade});
const shoreBytes=readFileSync(new URL('../../../apps/server/test/fixtures/scene-placement/shore-world.v1.json',import.meta.url));
const shore=JSON.parse(shoreBytes.toString());
const {id,originXZ,spacingMetres,columns,rows,heightMetres}=shore.terrain;
const worldTerrain={id,originXZ,spacingMetres,columns,rows,heightMetres,diagonal:'min-min/max-max' as const};

test('flat covered sweep supplies triangle spans, upward normals and true 3D length',()=>{
  const out=createTerrainGeometryProbe(patch([[0,0,0],[0,0,0],[0,0,0]])).sweep(request([.25,.25],[1.75,1.75],.25,0));
  assert.equal(out.geometryStatus,'clear');assert.equal(out.maxEncounteredGrade,0);assert.ok(out.checkedTriangles>=4);
  near(out.lengthMetres,Math.sqrt(4.5));assert.ok(out.centreline.length>=2);
  assert.equal(out.centreline[0].fromT,0);assert.equal(out.centreline.at(-1)!.toT,1);
  for(const span of out.centreline){assert.deepEqual(span.normal,[0,1,0]);assert.equal(span.from[1],0);assert.equal(span.to[1],0);}
  assert.equal(out.stage,'geometry-only');assert.deepEqual(out.unresolved,['obstacles','water','stacked-supports','dynamic-bodies','canonical-installation']);
});

test('nonplanar cell follows declared diagonal with different exact triangle gradients',()=>{
  const out=createTerrainGeometryProbe(patch([[0,1],[2,4]])).sweep(request([.2,.8],[.8,.2],.01,4));
  assert.equal(out.geometryStatus,'clear');assert.equal(out.centreline.length,2);
  near(out.centreline[0].from[1],2);near(out.centreline.at(-1)!.to[1],1.4);
  assert.deepEqual(out.centreline.map(s=>s.triangle.half),['upper','lower']);
  near(out.centreline[0].grade,Math.sqrt(8));near(out.centreline[1].grade,Math.sqrt(10));
  for(const span of out.centreline)near(span.normal[0]**2+span.normal[1]**2+span.normal[2]**2,1);
  near(out.centreline[0].to[1],out.centreline[1].from[1]);
});

test('millimetre-wide steep strip between flat endpoints is refused without sampling the path',()=>{
  const row=Array.from({length:65},(_,i)=>i===31?.08:0),p=patch([row,row],.002);
  const out=createTerrainGeometryProbe(p).sweep(request([.01,.001],[.11,.001],.0004,10));
  assert.equal(out.geometryStatus,'blocked');assert.equal(out.reason,'slope-exceeded');near(out.maxEncounteredGrade!,40);
  assert.equal(out.centreline[0].from[1],0);assert.equal(out.centreline.at(-1)!.to[1],0);
  assert.ok(out.centreline.some(s=>s.from[1]>.079||s.to[1]>.079),'interior crest retained in diagnostics');
  assert.ok(out.checkedTriangles>50,'full touched triangles, not endpoint claims');
});

test('full body disc touches a steep triangle missed by its flat centreline',()=>{
  const probe=createTerrainGeometryProbe(patch([[0,0,0,0],[0,0,0,0],[1,1,1,1]]));
  const wide=probe.sweep(request([.4,.75],[2.6,.75],.3,.25));
  assert.equal(wide.reason,'slope-exceeded');assert.equal(wide.maxEncounteredGrade,1);
  assert.ok(wide.centreline.every(s=>s.grade===0&&s.from[1]===0&&s.to[1]===0));
  assert.equal(probe.sweep(request([.4,.75],[2.6,.75],.2,.25)).geometryStatus,'clear');
  assert.equal(probe.sweep(request([.4,.75],[2.6,.75],.25,.25)).geometryStatus,'blocked','closed tangency is conservatively checked');
});

test('standing on or moving across the contour of a steep plane checks the whole slope',()=>{
  const probe=createTerrainGeometryProbe(patch([[0,1,2],[0,1,2],[0,1,2]]));
  for(const query of [request([1,.3],[1,1.7],.2,.5),request([1,1],[1,1],.2,.5)]){
    const out=probe.sweep(query);assert.equal(out.reason,'slope-exceeded');assert.equal(out.maxEncounteredGrade,1);
  }
  const held=probe.sweep(request([1,1],[1,1],.2,1));
  assert.equal(held.geometryStatus,'clear');assert.equal(held.centreline.length,1);assert.equal(held.lengthMetres,0);
  assert.deepEqual(held.centreline[0].from,[1,1,1]);assert.deepEqual(held.centreline[0].to,[1,1,1]);
});

test('outer boundary protects the complete disc and never extrapolates or substitutes flat ground',()=>{
  const probe=createTerrainGeometryProbe(patch([[2,2,2],[2,2,2],[2,2,2]]));
  for(const query of [request([.1,.5],[1.5,.5],.2),request([.5,.5],[2,1],.2),request([-.1,1],[1,1],.01)]){
    const out=probe.sweep(query);assert.equal(out.reason,'outside-terrain');assert.equal(out.checkedTriangles,0);
    assert.equal(out.maxEncounteredGrade,null);assert.deepEqual(out.centreline,[]);assert.equal(out.lengthMetres,0);
  }
  assert.equal(probe.sweep(request([.25,.25],[1.75,1.75],.25)).geometryStatus,'clear','exact rectangular edge is inside');
});

test('grade limit uses exact comparison, including the supplied boundary and no slope tolerance',()=>{
  const probe=createTerrainGeometryProbe(patch([[0,1],[0,1]]));
  assert.equal(probe.sweep(request([.2,.2],[.8,.8],.1,1)).geometryStatus,'clear');
  assert.equal(probe.sweep(request([.2,.2],[.8,.8],.1,1-Number.EPSILON)).reason,'slope-exceeded');
});

test('actual pinned World shore has bank, straddling footprint and outside-edge results',()=>{
  assert.equal(createHash('sha256').update(shoreBytes).digest('hex'),'69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b');
  const probe=createTerrainGeometryProbe(worldTerrain),bank=probe.sweep(request([2,0],[12,0],.28,.25));
  assert.equal(bank.geometryStatus,'clear');near(bank.maxEncounteredGrade!,.13);near(bank.lengthMetres,10*Math.sqrt(1+.13*.13));
  near(bank.centreline[0].from[1],.26);near(bank.centreline.at(-1)!.to[1],1.56);
  const straddle=probe.sweep(request([.15,-2],[.15,2],.28,.25));
  assert.equal(straddle.reason,'slope-exceeded');near(straddle.maxEncounteredGrade!,.3);
  assert.ok(straddle.centreline.every(s=>Math.abs(s.grade-.13)<1e-12));
  assert.equal(probe.sweep(request([15.9,11.9],[15.9,11.9],.28)).reason,'outside-terrain');
  assert.ok(bank.unresolved.includes('water'),'dry designation/water admission are not inferred from terrain');
});

test('reverse traversals cover the same slope set and distance; multi-cell height continuity holds',()=>{
  const p=patch(Array.from({length:5},(_,z)=>Array.from({length:6},(_,x)=>((x*13+z*7)%11)/20)));
  const probe=createTerrainGeometryProbe(p);
  for(let k=1;k<=24;k++){
    const a:[number,number]=[.3+(k%5)*.81,.3+((k*3)%4)*.78],b:[number,number]=[.3+((k*2)%5)*.81,.3+((k*7)%4)*.78];
    const forward=probe.sweep(request(a,b,.15,1)),back=probe.sweep(request(b,a,.15,1));
    assert.equal(forward.checkedTriangles,back.checkedTriangles);assert.equal(forward.geometryStatus,back.geometryStatus);
    assert.equal(forward.maxEncounteredGrade,back.maxEncounteredGrade);near(forward.lengthMetres,back.lengthMetres);
    for(let i=1;i<forward.centreline.length;i++){
      assert.equal(forward.centreline[i-1].toT,forward.centreline[i].fromT);
      forward.centreline[i-1].to.forEach((v,j)=>near(v,forward.centreline[i].from[j]));
    }
  }
});

test('strict bounded inputs, detached patch/results and repeated JSON reconstruction',()=>{
  const raw=patch([[0,0],[0,0]]),probe=createTerrainGeometryProbe(raw),q=request([.2,.2],[.8,.8],.1),one=probe.sweep(q);
  raw.heightMetres[0][0]=20;one.request.fromXZ[0]=99;one.centreline[0].normal[1]=99;
  const two=probe.sweep(q);assert.equal(two.maxEncounteredGrade,0);assert.equal(two.request.fromXZ[0],.2);assert.equal(two.centreline[0].normal[1],1);
  assert.deepEqual(createTerrainGeometryProbe(JSON.parse(JSON.stringify(patch([[0,0],[0,0]])))).sweep(JSON.parse(JSON.stringify(q))),two);
  for(const bad of [{...q,radiusMetres:0},{...q,radiusMetres:Number.MIN_VALUE},{...q,radiusMetres:11},{...q,maxGrade:-1},{...q,maxGrade:Infinity},{...q,fromXZ:[NaN,0]},
    {...q,approved:true},{...q,ownerId:'PRIVATE_OWNER'},{...q,contactId:'invented'}])assert.throws(()=>probe.sweep(bad));
  for(const bad of [{...raw,rows:1},{...raw,heightMetres:[[0,0]]},{...raw,diagonal:'opposite'},{...raw,heightMetres:[[Infinity,0],[0,0]]},
    {...raw,originXZ:[10000,10000]},{...raw,installedAt:0}])assert.throws(()=>createTerrainGeometryProbe(bad));
  assert.ok(terrainPatchV1Schema.safeParse(worldTerrain).success);
  const zeros=createTerrainGeometryProbe(patch([[-0,0],[0,-0]])).sweep(request([-0,.2],[.8,.2],.1));
  assert.deepEqual(JSON.parse(JSON.stringify(zeros)),zeros,'new probe seam normalizes signed zero without changing geometric thresholds');
});

test('footing checks interior crest extrema missed by enclosure-corner heights',()=>{
  const row=[0,0,1,0,0],probe=createTerrainGeometryProbe(patch([row,row,row]));
  const out=probe.footing({centreXZ:[2,1],halfXZ:[1.5,.5],bottomY:.1});
  assert.equal(out.geometryStatus,'covered');assert.deepEqual(out.terrainHeightRangeMetres,[0,1]);
  assert.deepEqual(out.gapRangeMetres,[-.9,.1]);assert.ok(out.checkedTriangles>4);
  assert.equal(out.stage,'geometry-only');assert.deepEqual(out.unresolved,['foundation-policy','loads','materials','canonical-installation']);
});

test('actual named World bed enclosures retain whole-footprint gap and terrain intersection',()=>{
  const bytes=readFileSync(new URL('../../../apps/server/test/fixtures/scene-placement/shore-support-world.v1.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'5ba65ada39e255a4646f3910b008c7c46f314a5a72533b8e16b79f4373737a60');
  const support=JSON.parse(bytes.toString()),probe=createTerrainGeometryProbe(worldTerrain),original=JSON.stringify(support);
  assert.equal(support.beds.length,2);assert.equal(support.beds.flatMap((b:any)=>b.proposedRootIds).length,8);
  for(const bed of support.beds){
    const [lo,hi]=[bed.enclosure.minXYZ,bed.enclosure.maxXYZ];
    const out=probe.footing({centreXZ:[(lo[0]+hi[0])/2,(lo[2]+hi[2])/2],halfXZ:[(hi[0]-lo[0])/2,(hi[2]-lo[2])/2],bottomY:lo[1]});
    assert.equal(out.geometryStatus,'covered');near(out.gapRangeMetres![0],-.0465);near(out.gapRangeMetres![1],.0965);
    assert.ok(out.unresolved.includes('materials'));assert.ok(bed.unresolved.includes('load-bearing'));
  }
  assert.equal(JSON.stringify(support),original,'no root lowering, enclosure repair or support approval');
});

test('footing outside/malformed requests retain unresolved status and return no invented contact',()=>{
  const probe=createTerrainGeometryProbe(patch([[0,0],[0,0]]));
  const request={centreXZ:[.5,.5],halfXZ:[.2,.2],bottomY:0};
  for(const bad of [{...request,halfXZ:[0,.2]},{...request,halfXZ:[.2,Infinity]}, {...request,bottomY:NaN},
    {...request,yaw:1},{...request,approved:true},{...request,loadKg:100}])assert.throws(()=>probe.footing(bad));
  const out=probe.footing({...request,halfXZ:[.6,.6]});assert.equal(out.geometryStatus,'outside-terrain');
  assert.equal(out.gapRangeMetres,null);assert.equal(out.terrainHeightRangeMetres,null);assert.equal(out.checkedTriangles,0);
  const inside=probe.footing(request);inside.request.centreXZ[0]=99;inside.gapRangeMetres![0]=99;
  assert.deepEqual(probe.footing(request).gapRangeMetres,[0,0]);
});

test('terrain probe is not a second native movement authority or canonical scene installation',async()=>{
  const factory=await marsFactory(GREEN_FIELD_WORLD),engine=factory.create(factory.genesis('terrain-probe-no-install'));
  engine.spawnHuman({id:'a',label:'Alice',soul:'s_a'});for(let i=0;i<20;i++)engine.step();
  const before={hash:engine.stateHash(),snapshot:engine.snapshot(),scene:engine.renderScene!(),tick:engine.world.tick};
  const probe=createTerrainGeometryProbe(worldTerrain);
  for(let i=0;i<64;i++)probe.sweep(request([2,0],[12,0],.28,.25));
  assert.equal(engine.stateHash(),before.hash);assert.deepEqual(engine.snapshot(),before.snapshot);
  assert.deepEqual(engine.renderScene!(),before.scene);assert.equal(engine.world.tick,before.tick);
  assert.deepEqual(engine.runtime.violations,[]);
});

test('largest validated grid remains bounded with finite footprint/centreline output',t=>{
  const p=patch(Array.from({length:129},()=>Array(129).fill(0))),probe=createTerrainGeometryProbe(p),start=performance.now();
  const sweep=probe.sweep(request([.25,.25],[127.75,127.75],.25,0));
  const footing=probe.footing({centreXZ:[64,64],halfXZ:[64,64],bottomY:0});
  assert.equal(sweep.geometryStatus,'clear');assert.equal(footing.geometryStatus,'covered');
  assert.equal(footing.checkedTriangles,32768);assert.ok(sweep.checkedTriangles<=32768);
  assert.ok(sweep.centreline.length<=1024);near(sweep.lengthMetres,127.5*Math.sqrt(2));
  assert.deepEqual(footing.gapRangeMetres,[0,0]);
  const encoded=JSON.stringify({sweep,footing});assert.ok(!encoded.includes('null'),'all covered geometric values finite');
  t.diagnostic(`single largest-grid sweep+footing=${(performance.now()-start).toFixed(2)}ms; not tick/soak capacity qualification`);
});
