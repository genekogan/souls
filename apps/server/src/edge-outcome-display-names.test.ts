// F8 (#379): what a Soul reads at the end of an act names places and rides as people do, never by their ids.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {ActionOutcomes,type OutcomeSnapshot} from './edge/outcomes/store.ts';
import {confirmedObjectEffects} from './edge/outcomes/effects.ts';
import type {EdgeReceipt} from './edge/contract.ts';

const RAW_ID=/\b(place|int|g|region)-[a-z]/;
const receipt=(id:string,capability:string,phase:EdgeReceipt['phase']='completed'):EdgeReceipt=>({id,soulId:'s_fixture',capability,phase,acceptedTick:1,startedTick:2,endedTick:20,code:null,reason:null,programId:'p_fixture'});
const snapshot=(place:string|null,placeName?:string|null):OutcomeSnapshot=>({worldId:'fixture-world',tick:20,place,placeName,placePath:place?[place]:[],pos:[1,2],walkable:[],sections:[],materials:[]});

void test('a terminal summary names the place by its display name and leaves out a place that has none',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');
 try{
  const summary=(id:string,snap:OutcomeSnapshot,phase:EdgeReceipt['phase']='completed')=>{const r=receipt(id,'walk:commons-pavilion/pavilion',phase);store.capture(r.id,{soulId:r.soulId,capability:r.capability,params:{},acceptedTick:1});return store.terminal(r,snap)!.summary;};
  assert.equal(summary('named',snapshot('g-commons-pavilion.pavilion','Pavilion')),'walk completed at Pavilion.');
  assert.equal(summary('unnamed',snapshot('g-commons-pavilion.pavilion',null)),'walk completed.','no name: no "at" clause, never the id');
  assert.equal(summary('nowhere',snapshot(null)),'walk completed.');
  assert.equal(summary('failed',snapshot('world','World'),'failed'),'walk failed at World.');
 }finally{db.close();}
});

void test('a ride boarding summary names the ride, never its object id',()=>{
 const join=(vehicle:string|undefined)=>confirmedObjectEffects(null,{object:{id:'ride-region-seaside-resort.ferris-wheel',kind:'ride',state:vehicle?{vehicle}:{}}},'join',2).summary;
 assert.equal(join('ferris-wheel'),'Boarded the ferris wheel and seated; the ride has not left the ground yet and is not finished.');
 assert.match(String(join('carousel')),/^Boarded the carousel and seated/);
 assert.match(String(join('punt')),/^Boarded the punt and seated/);
 assert.match(String(join(undefined)),/^Boarded the balloon and seated/,'an older object without a vehicle is a balloon, as vehicleOf reads it');
 for(const v of ['ferris-wheel','carousel','punt',undefined])assert.doesNotMatch(String(join(v)),RAW_ID);
});

void test('a real walk in the Eden world ends with the place name in its summary',{timeout:300000},async()=>{
 const w=await edenNavWorld(1),[a]=w.souls;
 const out:any=await w.act(a,'walk:commons-pavilion');assert.equal(out.accepted,true,JSON.stringify(out));
 await w.run([{soulId:a.soulId,id:out.receipt.id}],12000);
 const end=w.ledger.receipt(a.soulId,out.receipt.id)!;assert.equal(end.phase,'completed',JSON.stringify(end));
 const place=String((end.endedAt as {place?:string}|undefined)?.place),name=w.ledger.places.byId.get(place)?.name;assert.ok(name,`the end place ${place} has a display name`);
 assert.equal(end.outcome?.summary,`walk completed at ${name}.`);assert.ok(!String(end.outcome?.summary).includes(place),'never the place id');
});
