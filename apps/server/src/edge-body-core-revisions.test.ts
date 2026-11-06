import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Hono} from 'hono';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {WorldHost} from './world.ts';import {Db} from './db.ts';
import {CORE_REVISIONS,coreRevision,revisionProblems,versionOf,type CoreRevision} from './edge/body/core-revisions.ts';
import {BODY_PRESETS,corePreset} from './edge/body/routes.ts';import {SHARED_BODY_BYTES} from './edge/body/shared-bodies.ts';import {PIP_ASSET,PIP_PRESET} from './edge/body/pip.ts';

// #795 A1 (D027): the released core revisions. APPEND ONLY. Changing, removing or renumbering a line here re-pins a
// released preset, which is forbidden: a changed preset is a new line with a new id (`pip-2`, shown as `pip@2`).
const RELEASED:readonly CoreRevision[]=[
 {id:'pip',family:'pip',n:1,asset:'body_0ac8dd17fab38e64b9367357232b819847bad25254252b5a47921ff1afa23b0f'},
 {id:'monster',family:'monster',n:1,asset:'body_e7f634a0d090b71d85229a737bbf8bb9274ffadee38d4107a79b0db599c52b77'},
 {id:'ghost',family:'ghost',n:1,asset:'body_8111f1c4504c9c3b585fcc36d2590af26c3371aa7ce3390d8b7e7549f0e1a2bd'},
 {id:'centaur',family:'centaur',n:1,asset:'body_955a6445d2d048035674ace76795b2a7403be127a6a33ad5bedfcb178c749b32'},
];
const modelOf=(p:{body:unknown})=>(p.body as {model?:unknown}|null)?.model;

test('core revisions: a released preset is never re-pinned, and every content-addressed preset is in the ledger',()=>{
 assert.deepEqual(CORE_REVISIONS.slice(0,RELEASED.length).map(r=>({...r})),RELEASED,'released entries keep their place, id, number and asset');
 assert.deepEqual(revisionProblems(CORE_REVISIONS),[]);assert.ok(Object.isFrozen(CORE_REVISIONS)&&CORE_REVISIONS.every(Object.isFrozen));
 for(const p of BODY_PRESETS){const m=modelOf(p);if(typeof m!=='string'||!/^body_/.test(m))continue;
  const r=CORE_REVISIONS.find(r=>r.id===p.id);assert.ok(r,`${p.id} is content-addressed but has no released revision`);assert.equal(m,r.asset,`${p.id} wears its ledger asset`);}
 for(const r of CORE_REVISIONS){assert.ok(BODY_PRESETS.some(p=>p.id===r.id&&modelOf(p)===r.asset),`${versionOf(r)} stays a selectable preset`);assert.ok(SHARED_BODY_BYTES[r.asset],`${versionOf(r)} stays servable`);}
 assert.equal(PIP_ASSET,RELEASED[0].asset);
});

test('core revisions: the way forward is a new id; re-pins, reused ids and gaps are refused',()=>{
 const next=[...RELEASED,{id:'pip-2',family:'pip',n:2,asset:'body_'+'f'.repeat(64)}];
 assert.deepEqual(revisionProblems(next),[]);
 assert.equal(coreRevision('pip@2',next)?.id,'pip-2');assert.equal(coreRevision('pip-2',next)?.n,2);assert.equal(coreRevision('pip@1',next)?.asset,RELEASED[0].asset,'the old version keeps its bytes');
 const bad:[string,CoreRevision[],RegExp][]=[
  ['re-pin',[{...RELEASED[0],asset:'body_'+'a'.repeat(64)},...RELEASED],/id pip is already released|expected pip@2/],
  ['reused id',[...RELEASED,{id:'pip',family:'pip',n:2,asset:'body_'+'b'.repeat(64)}],/id must be pip-2/],
  ['gap',[...RELEASED,{id:'pip-3',family:'pip',n:3,asset:'body_'+'c'.repeat(64)}],/expected pip@2/],
  ['same bytes twice',[...RELEASED,{id:'pip-2',family:'pip',n:2,asset:RELEASED[1].asset}],/already released as another revision/],
  ['not an address',[...RELEASED,{id:'pip-2',family:'pip',n:2,asset:'pip.glb'}],/asset must be body_/],
 ];
 for(const [what,list,want]of bad)assert.match(revisionProblems(list).join('\n'),want,what);
 for(const ref of ['pip@0','pip@2','nope@1','humanoid@1','pip@','@1','pip@01'])assert.equal(corePreset(ref),undefined,ref);
 assert.equal(corePreset('pip@1'),corePreset('pip'));assert.equal(corePreset('humanoid')?.id,'humanoid','engine-native presets by id');
});

test('core revisions: library core lists <preset>@<n> → body_<sha>; lookup and selection by version; restart keeps the address',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'core-rev-')),path=join(dir,'sim.db'),f=fixture(path,factory,{durableClockV1:true});f.brain.quiesce();
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});
 await invite(f,'rev');const row=await accept(f.host,f.souls.create('dev:rev',{name:'Rev',description:'core revision test'})),pair=f.souls.pairCode(row,'https://example.invalid'),token=f.souls.pairExchange(pair.code,'fixture').token;
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono(),comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});t.after(()=>comms.close());
 const req=async(url:string,body?:unknown)=>app.request('/v1/edge/'+url,{method:body?'PUT':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 for(let i=0;i<5;i++)f.host.tickOnce();
 // A1a: every authored preset in the core listing has its version and content address; engine-native ones do not.
 const items:any[]=[];for(let cursor='';;){const page=await(await req('body/library?scope=core&limit=20'+(cursor?'&cursor='+cursor:''))).json();items.push(...page.items);if(!page.next)break;cursor=page.next;}
 assert.deepEqual(items.map(i=>i.ref),BODY_PRESETS.map(p=>p.id),'ids and order unchanged');
 assert.deepEqual(items.filter(i=>i.version).map(i=>`${i.version} → ${i.asset}`),RELEASED.map(r=>`${r.family}@${r.n} → ${r.asset}`));
 assert.equal(items.find(i=>i.ref==='humanoid').version,undefined);
 // A1b: lookup by version or id gives the same versioned definition; unknown versions are refused.
 const byVersion=await(await req('body/library/pip@1')).json(),byId=await(await req('body/library/pip')).json();
 assert.deepEqual(byVersion,byId);assert.equal(byVersion.definition.version,'pip@1');assert.equal(byVersion.definition.asset,PIP_ASSET);assert.equal(byVersion.definition.core,true);
 for(const ref of ['pip@2','nope@1','pip@0']){const r=await req('body/library/'+ref);assert.equal(r.status,404,ref);assert.equal((await r.json()).error.code,'body.ref-unknown',ref);}
 const unknown=await req('body',{preset:'pip@2'});assert.equal(unknown.status,400);assert.equal((await unknown.json()).error.code,'body.preset-unknown');
 const set=await accept(f.host,req('body',{preset:'pip@1'}));assert.equal(set.status,200,await set.clone().text());
 const worn=structuredClone(f.host.engine.world.entities[row.entity_id].body);assert.deepEqual(worn,PIP_PRESET.body,'pip@1 wears exactly what pip wears');
 assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1').get() as {n:number}).n,0,'no per-world blob');
 // A1d: every released revision is served by its content address.
 for(const r of CORE_REVISIONS){const res=await app.request(`/v1/edge/body/assets/${r.asset}.glb`);assert.equal(res.status,200,versionOf(r));assert.match(res.headers.get('cache-control')??'',/immutable/);
  assert.equal('body_'+createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex'),r.asset,versionOf(r)+' bytes match their address');}
 // A1e: the selection is stored as the content address, not as a preset id or version, and survives a restart.
 const stored=f.db.events(f.host.worldId).filter(e=>e.kind==='body-assignment-v1').map(e=>JSON.stringify(e));assert.equal(stored.length,1);
 assert.ok(stored[0].includes(PIP_ASSET)&&!stored[0].includes('pip@1')&&!stored[0].includes('"preset"'),stored[0].slice(0,300));
 const hash=f.host.engine.stateHash(),id=f.host.worldId,seed=f.host.seed;f.host.saveSnapshot(true);comms.close();f.host.stop();f.db.close();
 for(const mode of ['snapshot','genesis']){const db=new Db(path);if(mode==='genesis')db.db.exec('DELETE FROM snapshots');const h=new WorldHost(db,factory,seed,1e9,id,{durableClockV1:true});h.boot();h.drainInputs();
  assert.deepEqual(h.engine.world.entities[row.entity_id].body,worn,mode);assert.equal(h.engine.stateHash(),hash,mode);h.stop();db.close();}
});
