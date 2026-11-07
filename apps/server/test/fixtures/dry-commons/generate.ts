// Actual flat Greenfield body/controller, canonical input log and anonymous
// Hono publications. No renderer kit installation, model or network listener.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kernelHash } from '@souls/kernel';
import { newLife } from '@souls/brain';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import type { RenderSceneRefV1 } from '@souls/engine-contract';
import type { Brain } from '../../../src/brain.ts';
import type { Hub } from '../../../src/hub.ts';
import { Auth } from '../../../src/auth.ts';
import { config } from '../../../src/config.ts';
import { Db } from '../../../src/db.ts';
import { buildApp } from '../../../src/http.ts';
import { Souls } from '../../../src/souls.ts';
import { WorldHost, replayFromGenesis } from '../../../src/world.ts';

export const COMMONS_PARENT = '2fc2a2df65fa34525985b50a0e19f12a53d9d853';
export const COMMONS_WORLD = 'core-flat-commons-fixture';
export const COMMONS_SEED = 'core-flat-commons-walk/1';
export const COMMONS_ENTITY = 'h_commons';
export const COMMONS_PRIVATE = 'PRIVATE_COMMONS_FIXTURE';
export const COMMONS_CFG = { ...GREEN_FIELD_WORLD, arrival:[14,4] as [number,number],
  reference:[9,5] as [number,number], clock:{origin:0,dayTicks:72000} };

export async function generateDryCommons() {
  const factory = await marsFactory(COMMONS_CFG), directory=mkdtempSync(join(tmpdir(),'core-dry-commons-'));
  const path=join(directory,'world.sqlite');let db = new Db(path);
  try {
    const host = new WorldHost(db,factory,COMMONS_SEED,1e9,COMMONS_WORLD);
    host.boot();host.drainInputs();
    const owner = COMMONS_PRIVATE+'_OWNER', soulId = 's_commons', entityId = COMMONS_ENTITY;
    db.upsertUser({id:owner,email:null,wallet:null,role:'user'});db.setInvited(owner,'fixture-admin');
    db.createSoul({id:soulId,entityId,worldId:COMMONS_WORLD,owner,name:'Commons walker',description:'Fake-local owned walker',native:false});
    const birth=host.enqueue('birth','fixture',{soulId,entityId,owner,name:'Commons walker',description:'Fake-local owned walker'});
    host.drainInputs();await birth;
    const mandate=host.enqueue('mandate','fixture',{soulId,op:'upsert',rule:{id:'r_private',words:COMMONS_PRIVATE+'_WORDS',
      strict:false,understanding:'Walk when appropriate',agenda:[{card:'rest',target:null}],trigger:{kind:'none'},status:'active',report:null}});
    host.drainInputs();await mandate;
    host.minds.get(soulId)!.life=newLife(0);host.minds.get(soulId)!.life!.journal=COMMONS_PRIVATE+'_JOURNAL';
    const initialSnapshot=host.snapshotView();
    const choice=host.enqueue('decision','fixture',{soulId,entityId,option:'commons-walk',label:'Walking into the commons',
      steps:[{verb:'walk_to',params:{to:[9,5],standoff:0}}],reevalTicks:1e9,fallback:false,trigger:'physical-fixture'});
    host.drainInputs();await choice;
    // This body is driven by the real recorded decision. No pose edit or model
    // result is inserted; the HTTP reader below has no running mind listener.
    const positions: {tick:number;p:number[];activity:string}[]=[];
    const observe=()=>{const e=host.engine.world.entities[entityId];positions.push({tick:host.engine.world.tick,p:[...e.pose.p],activity:e.human!.activity});};
    observe();while(host.engine.world.tick<40){host.tickOnce();observe();}
    assert.equal(host.engine.world.entities[entityId].human!.activity,'walk');
    assert.equal(host.engine.canSnapshot!(),true);
    const movingSnapshot=host.engine.snapshot(),movingRestored=factory.restore(JSON.parse(JSON.stringify(movingSnapshot)));
    assert.equal(movingRestored.stateHash(),host.engine.stateHash());
    while(host.engine.world.tick<200){host.tickOnce();movingRestored.step();observe();
      assert.equal(movingRestored.stateHash(),host.engine.stateHash(),'restored native walk continues exactly');}
    assert.deepEqual(host.engine.runtime.violations,[]);
    const faultCount=db.events(COMMONS_WORLD).filter(e=>e.kind==='rules'&&e.payload?.recovery).length;
    assert.equal(faultCount,0);
    assert.equal(db.soul(soulId)!.owner,owner);assert.equal(db.user(owner)!.role,'user');
    assert.equal(host.kernel.things[soulId].traits.body,entityId);
    const chunks=host.engine.takeChunks!(-1);
    for(const chunk of chunks){const ref=(chunk.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef;
      db.saveTake(COMMONS_WORLD,chunk,host.engine.takeScene!(ref.hash)!);}
    const bodyHash=host.engine.stateHash(), meaningHash=kernelHash(host.kernel), saved=host.saveSnapshot(true);
    assert.equal('pending' in saved,false);
    db.close();db=new Db(path);
    const restored=new WorldHost(db,factory,COMMONS_SEED,1e9,COMMONS_WORLD),boot=restored.boot();
    assert.equal(boot.from,'snapshot');assert.equal(restored.engine.stateHash(),bodyHash);assert.equal(kernelHash(restored.kernel),meaningHash);
    const replay=replayFromGenesis(factory,COMMONS_SEED,db.events(COMMONS_WORLD),200,{includeHeadEvents:true});
    assert.equal(replay.engine.stateHash(),bodyHash);assert.equal(kernelHash(replay.kernel),meaningHash);
    const cfg={...config,takesPersist:true,worldId:COMMONS_WORLD,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,
      budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:''};
    const auth=new Auth(cfg,db),brain={midContext:()=>({options:[]})} as unknown as Brain;
    const souls=new Souls(restored,db,brain,cfg);
    const app=buildApp({cfg,db,host:restored,auth,brain,souls,hub:{refreshMe(){},clients:new Map()} as unknown as Hub});
    async function anonymous(path:string){const response=await app.request(path,{headers:{host:'127.0.0.1:4956'}});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
    const scene=await anonymous('/v1/scene'),stream=await anonymous('/v1/takes?from=0&to=200&limit=120');
    const refs=[...new Set(chunks.map(c=>(c.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef.hash))];
    const captures=[];for(const hash of refs)captures.push(await anonymous(`/v1/scenes/${hash}`));
    const snapshot=restored.snapshotView(),kernel=restored.kernelView();
    const publication={scene,stream,captures,initialSnapshot,snapshot,kernel};
    assert.equal(JSON.stringify(publication).includes(COMMONS_PRIVATE),false);
    assert.equal(db.paidCost(),0);
    return JSON.parse(JSON.stringify({contract:'core-flat-commons-fixture/1',worldId:COMMONS_WORLD,
      producer:{semanticsParent:COMMONS_PARENT,kind:'actual-native-canonical-decision',seed:COMMONS_SEED,config:COMMONS_CFG},
      scope:'flat Greenfield walking; no commons-kit installation, dance, terrain/water control or live owner admission',
      playback:'Canonical birth exists at tick 0 in initialSnapshot; recorder first publishes this body at tick 1. Do not backfill the take.',
      actor:{entityId,soulId,owner:'fake-local human association verified in SQLite'},
      ...publication,positions,reconstruction:{tick:200,bodyHash,kernelHash:meaningHash,snapshot:'exact',inclusiveGenesis:'exact',
        movingNativeCheckpoint:{tick:40,stateHash:movingSnapshot.stateHash,throughTick:200,continuation:'exact at every tick'}},
      faultCount,violations:[],paid:0}));
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateDryCommons(),null,2)+'\n');
