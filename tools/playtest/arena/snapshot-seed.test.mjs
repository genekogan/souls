import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { WorldModel } from '../../../packages/world-compiler/src/model.ts';
import { seedSnapshot } from './snapshot-seed.mjs';
import { physicalSnapshotSha256,compilerSnapshot,assertFrozenGenesis,physicalGenesisSha256 } from '../lib/physical-fixture.mjs';
import { sha256 } from '../lib/hash.mjs';
const model=()=>new WorldModel({constants:{ground:'land',extent:100},seed:'fixed'}).snapshot();
test('seed persists only compiler state through normal store and refuses an existing DB',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-seed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const s=model();s.entities=[{id:'e_chair',name:'chair',def:'chair@1',in:{parent:'world'},p:[1,.37,2],by:'god',born:0,v:1}];
 const file=join(dir,'snapshot.json');writeFileSync(file,JSON.stringify(s));
 const receipt=await seedSnapshot({snapshotPath:file,dataDir:dir,worldId:'seed-1'});assert.equal(receipt.entities,1);
 const db=new DatabaseSync(join(dir,'sim.db'),{readOnly:true});try{
  assert.equal(db.prepare('select count(*) n from users').get().n,0);
  assert.equal(db.prepare('select count(*) n from souls').get().n,0);
  assert.equal(db.prepare('select count(*) n from god_tokens_v1').get().n,0);
  const e=JSON.parse(db.prepare('select body from world_entities_v1').get().body);assert.deepEqual(e.p,[1,.37,2]);
  assert.equal(JSON.parse(db.prepare('select body from world_meta_v1').get().body).owner,null);
 }finally{db.close();}
 await assert.rejects(seedSnapshot({snapshotPath:file,dataDir:dir,worldId:'seed-1'}),/existing database/);
});
test('snapshot hash permits only meaning/attribution changes and guards exact frozen bytes',t=>{
 const s=model();s.entities=[{id:'e_a',def:'chair@1',in:{parent:'world'},p:[1,0,2]}];const enriched=structuredClone(s);enriched.entities[0].about={title:'Harbour Bench'};enriched.entities[0].v=2;
 const defs=[{ref:'chair@1',hash:'one'},{ref:'chair@1',hash:'two'}];assert.notEqual(physicalSnapshotSha256({...s,defs}),physicalSnapshotSha256({...s,defs,defRefs:{'chair@1':'one'}}));
 assert.equal(physicalSnapshotSha256(s),physicalSnapshotSha256(enriched));enriched.entities[0].p[1]=.1;assert.notEqual(physicalSnapshotSha256(s),physicalSnapshotSha256(enriched));
 const dir=mkdtempSync(join(tmpdir(),'souls-seed-hash-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const genesis={batches:[]};writeFileSync(join(dir,'genesis.json'),JSON.stringify(genesis));const bytes=JSON.stringify(s);writeFileSync(join(dir,'snapshot.json'),bytes);
 const scenario={world:{genesis:'genesis.json',snapshot:'snapshot.json'},freeze:{physicalSha256:physicalGenesisSha256(genesis),snapshotSha256:sha256(bytes),physicalSnapshotSha256:physicalSnapshotSha256(s)}};assertFrozenGenesis(scenario,dir);
 writeFileSync(join(dir,'snapshot.json'),JSON.stringify(enriched));assert.throws(()=>assertFrozenGenesis(scenario,dir),/snapshot fixture mismatch/);
});
test('snapshot seed rejects Soul bodies and private wallets; transport extras never enter model',()=>{
 const s=model();assert.throws(()=>compilerSnapshot({...s,entities:[{id:'h_probe'}]}),/no Soul bodies/);
 assert.throws(()=>compilerSnapshot({...s,state:{layers:{wallets:{someone:1}}}}),/private layer wallets/);
 assert.equal(compilerSnapshot({...s,accounts:[{email:'not-copied'}],tokens:['not-copied']}).accounts,undefined);
});
