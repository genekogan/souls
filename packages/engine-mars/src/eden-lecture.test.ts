import test from 'node:test';
import assert from 'node:assert/strict';
import {edenLectureV1} from './eden-lecture.ts';
import {edenLecturePlacementV1Schema} from '@souls/engine-contract';
import {fixtureSlots} from '../../../mars/viewer/engine/social/slots.ts';
import {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import {emptyWorld} from '../../../mars/viewer/engine/world/factory.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import {angleDelta} from '../../../mars/viewer/engine/core/math.ts';
test('16/20/24 native audience seats and separate presenter return/station have exact catalogue support/orientation and bounded real lesson data',()=>{
 for(const audienceSeats of [16,20,24] as const)for(const yaw of [0,.7]){const input={id:'eden-lecture-main',origin:[20,20] as [number,number],yaw,audienceSeats,lesson:'Eden lesson: observe, ask, share.'},v=edenLectureV1(input);assert.deepEqual(v,edenLectureV1(input));assert.equal(v.audienceSeats.length,audienceSeats);assert.equal(new Set(v.audienceSeats).size,audienceSeats);assert.ok(!v.audienceSeats.includes(v.presenterReturnSeat));const scene={bounds:[-100,-100,100,100] as [number,number,number,number],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'floor',level:0,y:0,obb:{c:[0,0] as [number,number],half:[100,100] as [number,number],yaw:0}}],obstacles:[],links:[]};const w=emptyWorld('lecture-placement',scene);Object.assign(w.entities,v.entities);Object.assign(w.regions,v.regions);const rt=new Runtime(w,new Map(),{spatial:new Spatial(scene)},[]);
  for(const id of v.audienceSeats){const e=w.entities[id.split('#')[0]],seat=fixtureSlots(rt,e).find(s=>s.id===id);assert.ok(seat);assert.equal(seat.kind,'seat');assert.equal(seat.level,0);assert.ok(Math.abs(angleDelta(seat.yaw,yaw-Math.PI/2))<1e-8);assert.deepEqual(CATALOG[e.def].size,CATALOG['camp-chair'].size);assert.equal(e.pose.p[1],0);}
  const station=fixtureSlots(rt,w.entities[v.presenterStation.split('#')[0]]).find(s=>s.id===v.presenterStation);assert.ok(station);assert.equal(station.kind,'stand');assert.equal(station.level,0);assert.ok(Math.abs(angleDelta(station.yaw,yaw+Math.PI/2))<1e-8);assert.equal(w.entities[v.displayId].equipment?.config.content,input.lesson);assert.equal(Object.keys(v.entities).length,audienceSeats+3);for(const id of [...v.audienceSeats,v.presenterReturnSeat,v.presenterStation,v.displayId])assert.ok(id.length<=80,'native classroom ID bound');assert.equal(Object.values(v.entities).filter(e=>e.kind==='human').length,0,'fixture data never invents seated people');
 }
 for(const patch of [{audienceSeats:18},{lesson:'x'.repeat(161)},{origin:[Infinity,0]},{id:'foreign-room'},{id:'eden-lecture-'+('x'.repeat(50))}])assert.equal(edenLecturePlacementV1Schema.safeParse({id:'eden-lecture-main',origin:[20,20],yaw:0,audienceSeats:20,lesson:'Local lesson',...patch}).success,false);
});
