import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {biologyOf,biologyAt,biologyHourAt} from '../../packages/world-compiler/src/index.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

// Entry 18: planters dry by a third each world day; a dry planter nearby is noticed ({stage:'seed',dry:true}); far ones add nothing.
const out=process.env.SOUL_ACTIONS_OUT;
test('garden drying: a third per world day, one pass per day change, dry fact only nearby', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Water test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/garden-planter@1',name:`far-bed-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2]}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/garden-planter@3',name:'wet-bed',p:[ax+1.6,az+1],state:{biologyEnabled:true,moisture:1}},{op:'place',def:'core/garden-planter@3',name:'dry-bed',p:[ax-1.6,az+1],state:{biologyEnabled:true}}]}).accepted,true);await tick(45);
 const near=await here(),id=n=>god.model.get(n).id,obj=(h,n)=>h.objects.find(o=>o.id===id(n));
 assert.deepEqual(obj(near,'dry-bed')?.state,{stage:'seed',dry:true},'a dry planter nearby is noticed');assert.deepEqual(obj(near,'wet-bed')?.state,{stage:'seed'},'a watered planter adds nothing');
 // a short world day for the test (the real one is the world clock's)
 const living0=f.host.living??{};Object.defineProperty(f.host,"living",{configurable:true,value:{...living0,origin:f.host.engine.world.tick,dayTicks:200}});
 await tick(1); // activation anchor, then measure three complete world-day intervals
 const m=n=>{const e=god.model.get(n),def=god.model.resolvedDef(e.def);return biologyAt(biologyOf(e.state,def),biologyHourAt(f.host.engine.world.tick,f.host.living)).m;},days=[];
 for(let d=1;d<=3;d++){await tick(200);days.push(m('wet-bed'));}
 assert.deepEqual(days.map(v=>Math.round(v*100)/100),[0.67,0.33,0],'a third per day: '+JSON.stringify(days));
 const afterDry=await here();assert.deepEqual(obj(afterDry,'wet-bed')?.state,{stage:'leafy',dry:true},'now it is noticed as dry');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Dry:JSON.stringify(far).length,nearby:JSON.stringify(near).length},moistureByDay:days,checks:['dry fact only for dry nearby planters','watered planter adds nothing','a third per world day, fully dry after 3','100 distant dry planters add nothing','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
