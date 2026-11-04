// Exercise the committed browser journey's actual control flow through native edge admission, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {playWholeGame} from './game-facing-proof.mjs';

test('owned whole-game driver completes its actual five admitted marks and observes the5° native waiting bound',{timeout:60000},async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async n=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 const players={};for(const name of ['Ana','Ben']){await invite(f,name.toLowerCase());const row=await accept(f.host,f.souls.create('dev:'+name.toLowerCase(),{name,description:'Owned whole-game preflight'}));players[name]={soulId:row.id,entityId:row.entity_id,name,owner:row.owner};await tick(5);}
 const p=f.host.engine.world.entities[players.Ana.entityId].pose.p,board=[p[0],p[2]+2.6];
 assert.equal(god.act({ops:[{op:'place',def:'core/tictactoe-board@1',name:'game',p:board,r:Math.PI}]}).accepted,true);await tick(45);
 let observations=0,maxDegrees=0;const start=f.host.engine.world.tick;
 const moves=await playWholeGame({signal:new AbortController().signal,stage:async()=>{},wait:ms=>tick(Math.round(ms/50)),
  act:async(name,square)=>{soul=players[name];const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:'mark a square on the game board',params:{square}})}));return r.json();},
  receipt:async(name,id)=>edge.receipt(players[name].soulId,id),
  displayed:async r=>{assert.ok(Number.isFinite(r.endedTick));assert.ok(f.host.engine.world.tick>=r.endedTick);},
  poll:async waiting=>{for(const name of waiting){const e=f.host.engine.poseSampleOf(players[name].entityId),want=Math.atan2(board[1]-e[3]/1000,board[0]-e[1]/1000),deg=Math.abs(Math.atan2(Math.sin(e[4]/1000-want),Math.cos(e[4]/1000-want)))*180/Math.PI;observations++;maxDegrees=Math.max(maxDegrees,deg);assert.ok(deg<=5,JSON.stringify({name,deg}));}}
 });
 assert.equal(moves.length,5);assert.equal(god.model.get('game').state.text,'O.XOX.X..');assert.equal(god.model.get('game').state.players,'Ana,Ben');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.ok(observations>50);
 console.log(JSON.stringify({status:'pass',moves:moves.length,waitingSamples:observations,maxDegrees,nativeSeconds:(f.host.engine.world.tick-start)/20,browser:false}));
});
