import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { createRegistry } from '../api/registry.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import { Spatial } from '../spatial/service.ts';
import { poseV1 } from '../social/pose.ts';
import { angleDelta } from '../core/math.ts';

test('a seated game overlay keeps the occupied seat facing despite an opposite face target',()=>{
 const scene=provingGround(),world=addAll(emptyWorld('proving-ground',scene),human('player',0,-7),{id:'chair',def:'camp-chair',kind:'fixture',pose:{p:[0,0,-5],yaw:Math.PI/2},provenance:FIXTURE});
 const registry=createRegistry();registry.set(poseV1.verb,poseV1);
 const rt=new Runtime(world,registry,{spatial:new Spatial(scene)},DEFAULT_INVARIANTS);
 const seat=rt.submit('sit',{actor:'player',fixture:'chair'});
 for(let i=0;i<600&&seat.phase!=='occupied';i++)rt.step();
 assert.equal(seat.phase,'occupied',seat.diagnostic?.message);
 const yaw=world.entities.player.pose.yaw;
 const game=rt.submit('pose_v1',{actor:'player',activity:'play-game',seconds:2,face:[0,-20]});
 for(let i=0;i<50&&rt.isActive(game.id);i++){
  rt.step();assert.ok(Math.abs(angleDelta(world.entities.player.pose.yaw,yaw))<.001);
 }
 assert.equal(game.status,'completed',game.diagnostic?.message);
 assert.equal(rt.isActive(seat.id),true);assert.deepEqual(rt.violations,[]);
});
