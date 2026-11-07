import test from 'node:test';import assert from 'node:assert/strict';
import {marsFactory,LITTLE_MARTIANS_WORLD} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';import {Db} from './db.ts';import {WorldHost} from './world.ts';import {accept} from '../test/native-owner-fixture.ts';

test('legacy floater converse accepted suffix remains exact from snapshot and genesis; explicit BODY converse also works',async t=>{
 const factory=await marsFactory(LITTLE_MARTIANS_WORLD),db=new Db(':memory:'),host=new WorldHost(db,factory,'legacy-converse',1e9,'legacy-converse',{durableClockV1:true});host.boot();host.drainInputs();t.after(()=>{host.stop();db.close();});
 for(const [soulId,entityId,name]of [['s_a','h_a','Verdelis'],['s_b','h_b','Kalama']])await accept(host,host.enqueue('birth','scripted:legacy',{soulId,entityId,name,description:'scripted historical compatibility fixture',owner:'scripted:owner'}));
 assert.equal(host.engine.world.entities.h_a.body?.type,undefined);assert.equal(host.engine.world.entities.h_a.body?.family,'floater');
 const program={actor:'h_a',label:'Native conversation',steps:[{verb:'converse',params:{with:'h_b',seconds:2}}]};assert.equal(host.engine.canPerform(program),null);
 // An earlier snapshot must replay an actually accepted conversation suffix.
 host.saveSnapshot(true);const prefix=host.seq;
 await accept(host,host.enqueue('decision','scripted:legacy',{soulId:'s_a',entityId:'h_a',option:'converse',label:program.label,steps:program.steps,reevalTicks:1e9,fallback:false,trigger:'scripted-legacy'}));
 assert.ok(host.engine.programOf('h_a'));for(let i=0;i<100;i++)host.tickOnce();assert.equal(host.engine.programOf('h_a'),null);assert.ok(db.events(host.worldId,prefix).some(e=>e.kind==='decision'));
 const expected={engine:host.engine.stateHash(),kernel:kernelHash(host.kernel),tick:host.engine.world.tick,seq:host.seq};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);const h=new WorldHost(db,factory,host.seed,1e9,host.worldId,{durableClockV1:true});try{const boot=h.boot();assert.equal(boot.from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),tick:h.engine.world.tick,seq:h.seq},expected);}finally{h.stop();}}
 // New owner-admitted descriptors remain strict for limb actions, but a circle
 // of faces is a genuine supported conversation rather than a limb substitute.
 const e=factory.create(factory.genesis('typed-converse'));e.spawnHuman({id:'x',label:'Verdelis',soul:'x'});e.spawnHuman({id:'y',label:'Kalama',soul:'y'});e.world.entities.x.body={...e.world.entities.x.body!,type:'ceramic',modelUrl:'/world-assets/littlemartians/characters/verdelis.glb'};
 assert.equal(e.canPerform({actor:'x',label:'conversation',steps:[{verb:'converse',params:{with:'y',seconds:2}}]}),null);assert.equal(e.canPerform({actor:'x',label:'seat',steps:[{verb:'sit',params:{}}]})?.code,'body.unsupported');assert.deepEqual(host.engine.runtime.violations,[]);
});
