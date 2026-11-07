import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {physicalGenesisSha256,assertFrozenGenesis} from './physical-fixture.mjs';
const base={schema:'genesis/1',constants:{extent:100},state:{sky:{sun:1}},batches:[{note:'physical',ops:[{op:'place',def:'chair@1',name:'chair',p:[1,2]}]}]};
test('semantic enrichment and JSON key ordering preserve physical hash; pose and affordance changes do not',()=>{
 const enriched=structuredClone(base);enriched.state.about={title:'World'};enriched.batches[0].ops[0].about={title:'Seat'};enriched.batches.push({note:'meaning',ops:[{op:'set',id:'chair',about:{title:'Seat'}},{op:'world',state:{about:{title:'World'}}}]});
 assert.equal(physicalGenesisSha256(enriched),physicalGenesisSha256(base));
 assert.equal(physicalGenesisSha256({...base,constants:{extent:100}}),physicalGenesisSha256(base));
 enriched.batches[0].ops[0].p=[1,3];assert.notEqual(physicalGenesisSha256(enriched),physicalGenesisSha256(base));
 enriched.batches[0].ops[0].p=[1,2];enriched.batches.push({ops:[{op:'set',id:'chair',about:{title:'Seat'},params:{w:8}}]});assert.notEqual(physicalGenesisSha256(enriched),physicalGenesisSha256(base));
});
test('runner checks actual genesis bytes before a frozen measurement can launch',t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-physical-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'world.json'),JSON.stringify(base));
 const scenario={freeze:{physicalSha256:physicalGenesisSha256(base)},world:{genesis:'world.json'}};
 assert.equal(assertFrozenGenesis(scenario,dir).physicalSha256,scenario.freeze.physicalSha256);
 writeFileSync(join(dir,'world.json'),JSON.stringify({...base,constants:{extent:101}}));assert.throws(()=>assertFrozenGenesis(scenario,dir),/fixture mismatch/);
 assert.throws(()=>assertFrozenGenesis({freeze:{}},dir),/explicit genesis/);
});

test('genesis-only destination credit requires both unchanged materialization proofs before boot',async t=>{
 const {destinationBinding}=await import('./destination-choice.mjs');
 const dir=mkdtempSync(join(tmpdir(),'souls-destination-proof-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'world.json'),JSON.stringify(base));
 const snapshot={defs:[{ref:'hall@1',hash:'hash'}],entities:[{id:'hall-id',name:'hall',def:'hall@1',in:{parent:'world'},p:[1,0,2]}]};
 const bytes=JSON.stringify(snapshot);for(const arm of['control','treatment'])writeFileSync(join(dir,arm+'.json'),bytes);
 const {sha256}=await import('./hash.mjs');const s={world:{genesis:'world.json'},freeze:{physicalSha256:physicalGenesisSha256(base),destinationSources:Object.fromEntries(['control','treatment'].map(a=>[a,{path:a+'.json',sha256:sha256(bytes)}]))},director:{script:[{expect:{journey:{firstDestinationChoices:[{binding:destinationBinding(snapshot,'hall',{portable:true}),receipt:{verb:'walk',capabilities:['walk:hall']}}]}}}]}};
 assert.doesNotThrow(()=>assertFrozenGenesis(s,dir));const missing=structuredClone(s);delete missing.freeze.destinationSources.control;assert.throws(()=>assertFrozenGenesis(missing,dir),/both frozen/);
 writeFileSync(join(dir,'control.json'),bytes+' ');assert.throws(()=>assertFrozenGenesis(s,dir),/proof changed/);
});
