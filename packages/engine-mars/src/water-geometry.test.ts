import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWaterGeometryProbe } from './water-geometry.ts';
import { createTerrainGeometryProbe } from './terrain.ts';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { waterGeometryV1Schema, type TerrainPatchV1 } from '@souls/engine-contract';

const bytes=readFileSync(new URL('../../../apps/server/test/fixtures/scene-placement/shore-world.v1.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b');
const shore=JSON.parse(bytes.toString()),terrain={...shore.terrain,diagonal:'min-min/max-max'};
delete terrain.interpolation;
assert.deepEqual(shore.water.wetDomain.closedPolygonXZ,[[-16,-12],[0,-12],[0,12],[-16,12],[-16,-12]],'only the exact rectangular proposal is represented by this probe');
const water={id:shore.water.id,terrain,datumY:shore.water.datumY,wetBoundsXZ:[-16,-12,0,12]};
const query=(x:number,z:number=7,halfXZ:[number,number]=[1.5,.65],draftMetres=.3,underKeelMarginMetres=.1)=>({centreXZ:[x,z],halfXZ,draftMetres,underKeelMarginMetres});
const patch=(heights:number[][]):TerrainPatchV1=>({id:'synthetic-bed',originXZ:[0,0],spacingMetres:1,columns:heights[0].length,rows:heights.length,heightMetres:heights,diagonal:'min-min/max-max'});

test('exact shore depth follows bounded wet-domain AND triangle bed, with depth zero dry',()=>{
  const probe=createWaterGeometryProbe(water);
  for(const [x,depth] of [[-10,1.5],[-4,1.2],[-1,.3],[0,0],[1,0]]){
    const out=probe.column({atXZ:[x,0]});assert.equal(out.stage,'geometry-only');assert.equal(out.depthMetres,depth);assert.equal(out.geometryStatus,depth>0?'wet':'dry');
  }
  assert.equal(probe.column({atXZ:[-16,-12]}).geometryStatus,'wet','closed western/northern boundary included');
  assert.equal(probe.column({atXZ:[-16.001,0]}).geometryStatus,'outside-terrain');assert.equal(probe.column({atXZ:[-10,12.001]}).bedY,null);
  const cove=shore.water.regions.find((r:any)=>r.id==='eden-wading-entry');assert.ok(cove.boundsXZ[2]>0);assert.equal(probe.column({atXZ:[1,0]}).geometryStatus,'dry','designation cannot turn positive bank into water');
});

test('point terrain reports both nonplanar triangles, boundary and detached normals without extrapolation',()=>{
  const bed=createTerrainGeometryProbe(patch([[-1,-.5],[-.25,-.75]]));
  const a=bed.point({atXZ:[.75,.25]}),b=bed.point({atXZ:[.25,.75]});
  assert.equal(a.point![1],-.6875);assert.equal(b.point![1],-.5625);assert.notDeepEqual(a.normal,b.normal);
  a.point![1]=100;a.normal![0]=100;assert.equal(bed.point({atXZ:[.75,.25]}).point![1],-.6875);
  assert.equal(bed.point({atXZ:[1,1]}).point![1],-.75);assert.equal(bed.point({atXZ:[1.001,1]}).point,null);
  assert.throws(()=>bed.point({atXZ:[0,NaN]}));assert.throws(()=>bed.point({atXZ:[0,0],admitted:true}));
});

test('a supplied vertical segment is clipped to bed and datum; fraction never asserts body volume or capability',()=>{
  const probe=createWaterGeometryProbe(water);
  const partly=probe.column({atXZ:[-10,0],verticalSpan:[-.5,1.5]});assert.equal(partly.submergedSpanMetres,.5);assert.equal(partly.submergedSpanFraction,.25);
  const belowBed=probe.column({atXZ:[-10,0],verticalSpan:[-2,-1]});assert.equal(belowBed.submergedSpanMetres,.5);assert.equal(belowBed.submergedSpanFraction,.5);
  assert.equal(probe.column({atXZ:[-10,0],verticalSpan:[-1,.0]}).submergedSpanFraction,1);
  assert.equal(probe.column({atXZ:[-10,0],verticalSpan:[0,2]}).submergedSpanFraction,0);
  assert.equal(probe.column({atXZ:[1,0],verticalSpan:[-1,2]}).submergedSpanFraction,0);
  assert.equal(probe.column({atXZ:[-10,0]}).submergedSpanFraction,null);
  assert.equal(probe.column({atXZ:[100,0],verticalSpan:[0,2]}).submergedSpanFraction,null);
  assert.ok(partly.unresolved.includes('body-anatomy'));assert.throws(()=>probe.column({atXZ:[0,0],verticalSpan:[1,1]}));
});

test('actual axis-aligned proposed hull has whole-footprint depth; shore-touching hull fails despite deeper centre',()=>{
  const probe=createWaterGeometryProbe(water),boat=shore.boat;
  assert.equal(boat.poseProposal.yaw,0);assert.deepEqual(boat.hullEnvelopeLocal.minXYZ,[-1.5,-.4,-.65]);assert.equal(boat.draftMetres,.3);
  const docked=probe.clearance(query(-4));assert.equal(docked.geometryStatus,'sufficient-depth');assert.deepEqual(docked.depthRangeMetres,[.75,1.5]);assert.deepEqual(docked.signedKeelClearanceRangeMetres,[.45,1.2]);
  const touching=probe.clearance(query(-1.5));assert.equal(probe.column({atXZ:[-1.5,7]}).depthMetres,.44999999999999996);
  assert.equal(touching.geometryStatus,'insufficient-depth');assert.equal(touching.depthRangeMetres![0],0);assert.equal(touching.signedKeelClearanceRangeMetres![0],-.3);
  const crossing=probe.clearance(query(-1.49));assert.equal(crossing.geometryStatus,'outside-water-domain');assert.equal(crossing.depthRangeMetres,null);
  assert.ok(docked.checkedTriangles>0);assert.ok(docked.unresolved.includes('hydrostatics'));assert.ok(docked.unresolved.includes('swept-route'));
});

test('an interior bed ridge invalidates hull clearance even when all four corners and centre seem deep enough',()=>{
  // Raised ridge at (1,1); query centre (1.3,1.3) lies off its peak.
  const terrain=patch([[-2,-2,-2],[-2,-.1,-2],[-2,-2,-2]]),probe=createWaterGeometryProbe({id:'ridge-water',terrain,datumY:0,wetBoundsXZ:[0,0,2,2]});
  const q=query(1.3,1.3,[.6,.6],.3,0),out=probe.clearance(q);
  assert.ok(probe.column({atXZ:[1.3,1.3]}).depthMetres!>.3);
  for(const x of [.7,1.9])for(const z of [.7,1.9])assert.ok(probe.column({atXZ:[x,z]}).depthMetres!>.3);
  assert.equal(out.geometryStatus,'insufficient-depth');assert.ok(Math.abs(out.depthRangeMetres![0]-.1)<1e-12);assert.ok(out.signedKeelClearanceRangeMetres![0]<0);
});

test('exact required keel margin meets the geometric condition; a stricter margin fails without rounding',()=>{
  const probe=createWaterGeometryProbe({id:'flat-water',terrain:patch([[-1,-1],[-1,-1]]),datumY:0,wetBoundsXZ:[0,0,1,1]});
  assert.equal(probe.clearance(query(.5,.5,[.2,.2],.25,.75)).geometryStatus,'sufficient-depth');
  assert.equal(probe.clearance(query(.5,.5,[.2,.2],.25,.75000000001)).geometryStatus,'insufficient-depth');
});

test('malformed domains, unknown permissions and unsupported yawed/swept hull claims reject before geometry',()=>{
  for(const bad of [{...water,wetBoundsXZ:[0,0,0,1]},{...water,wetBoundsXZ:[-17,-12,0,12]},{...water,wetBoundsXZ:[0,0,-1,1]},{...water,approved:true},{...water,flowXZ:[1,0]}])assert.ok(!waterGeometryV1Schema.safeParse(bad).success);
  const probe=createWaterGeometryProbe(water);
  for(const bad of [{...query(-4),yaw:0},{...query(-4),toXZ:[-5,7]},{...query(-4),draftMetres:0},{...query(-4),underKeelMarginMetres:-1},{...query(-4),halfXZ:[Infinity,.5]}])assert.throws(()=>probe.clearance(bad));
  assert.throws(()=>probe.column({atXZ:[-4,7],swimming:true}));
});

test('source/query/result mutations do not alter future geometry, and fresh process reconstructs exact JSON without models',()=>{
  const input=structuredClone(water),probe=createWaterGeometryProbe(input),request=query(-4),out=probe.clearance(request),original=JSON.stringify(out);
  input.terrain.heightMetres[0][0]=100;input.datumY=100;request.centreXZ[0]=100;out.depthRangeMetres![0]=100;
  assert.equal(JSON.stringify(probe.clearance(query(-4))),original);
  const code=`import {createWaterGeometryProbe} from './packages/engine-mars/src/water-geometry.ts'; process.stdout.write(JSON.stringify(createWaterGeometryProbe(${JSON.stringify(water)}).clearance(${JSON.stringify(query(-4))})));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,original);
});

test('dry-land native state, render base and rules remain unchanged across water proposal queries',async()=>{
  const factory=await marsFactory(GREEN_FIELD_WORLD),engine=factory.create(factory.genesis('water-geometry-no-install')),probe=createWaterGeometryProbe(water);
  const hash=engine.stateHash(),snapshot=JSON.stringify(engine.snapshot()),base=JSON.stringify(engine.renderScene?.()),rules=engine.rulesVersion;
  for(let i=0;i<64;i++){probe.column({atXZ:[-15+i/4,0],verticalSpan:[-.2,1.8]});probe.clearance(query(-4));}
  assert.equal(engine.stateHash(),hash);assert.equal(JSON.stringify(engine.snapshot()),snapshot);assert.equal(JSON.stringify(engine.renderScene?.()),base);assert.equal(engine.rulesVersion,rules);assert.equal(engine.world.tick,0);
});
