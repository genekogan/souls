import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashOf } from '@souls/engine-contract';
import { STATION_PINS_V1,stationEpochId,stationEpochV1Schema } from './station-v1.ts';
import { stationRulesEraV1Schema,stationRulesEraFactV1Schema,stationCommonsSourceV1Schema,stationPhysicalHeadV1Schema,
  initialStationPhysicalHeadV1,acceptStationPhysicalHeadV1,foldStationRulesEraV1,stationPhysicalHeadCoversTickV1,
  negotiateStationContractV1,stationHelloCapabilitiesV1Schema } from './station-era-v1.ts';

// Real immutable physical payload; row numbers/epoch below are expressly codec
// fixtures, not proof of an installed canonical station/physical transaction.
const bytes=readFileSync(new URL('../../../apps/server/test/fixtures/commons-transition/journey.v1.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'976943f31a14c8213bfdd83a7f1ece5e7dc306cc27c9319b5efc8c8d98079663');
const native=JSON.parse(bytes.toString()),genesisId=hashOf('SYNTHETIC_ERA_CODEC_GENESIS');
const station=stationEpochV1Schema.parse({contract:'station-epoch/1',worldId:native.worldId,genesisId,epoch:stationEpochId(native.worldId,genesisId),
  rulesVersion:native.oldRulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,createdTick:1});
const source={worldId:native.worldId,seq:10,tick:37,commonsTransition:native.transition};
const era={contract:'station-rules-era/1' as const,worldId:station.worldId,epoch:station.epoch,revision:1,previousRevision:0,
  fromRulesVersion:station.rulesVersion,toRulesVersion:native.rulesVersion,dtSeconds:.05,effectiveTick:37,
  source:{seq:source.seq,tick:source.tick,transitionHash:hashOf(source.commonsTransition)}};
const fact={seq:11,tick:37,payload:era};
const binding={worldId:station.worldId,rulesVersion:native.rulesVersion,dtSeconds:.05};
const folded=()=>foldStationRulesEraV1(undefined,fact,source,station);

test('era/head fold binds exact published native tick37 source, preserves original epoch and retains only a detached current head',()=>{
  const before=hashOf({station,fact,source}),state=folded();assert.equal(state.head.effectiveTick,37);assert.equal(state.head.revision,1);
  assert.equal(state.station.epoch,station.epoch);assert.equal(state.station.rulesVersion,native.oldRulesVersion);assert.equal(state.head.rulesVersion,native.rulesVersion);
  assert.ok(state.head.source&&'commonsTransition' in state.head.source);
  assert.deepEqual(state.head.source!.commonsTransition,native.transition);assert.equal(hashOf({station,fact,source}),before);
  state.head.source!.commonsTransition.fromWorldHash='0'.repeat(64);assert.equal(source.commonsTransition.fromWorldHash,native.transition.fromWorldHash);
  assert.deepEqual(Object.keys(state).sort(),['head','lastFactSeq','station']);
});
test('strict source and era projections reject private metadata, nonfinite values, no-op rules and unsafe adjacency',()=>{
  for(const bad of [{...source,author:'PRIVATE_OWNER'},{...source,tick:38},{...source,seq:Number.MAX_SAFE_INTEGER},
    {...source,commonsTransition:{...native.transition,words:'PRIVATE'}}])assert.equal(stationCommonsSourceV1Schema.safeParse(bad).success,false);
  for(const bad of [{...era,privateIntent:'PRIVATE'},{...era,revision:3},{...era,previousRevision:1},{...era,effectiveTick:38},
    {...era,toRulesVersion:era.fromRulesVersion},{...era,dtSeconds:Infinity},{...era,source:{...era.source,compiler:'PRIVATE'}}])
    assert.equal(stationRulesEraV1Schema.safeParse(bad).success,false);
  assert.equal(stationRulesEraFactV1Schema.safeParse({...fact,seq:12}).success,false);
  assert.equal(stationRulesEraFactV1Schema.safeParse({...fact,tick:38}).success,false);
});
test('head validation refuses missing/foreign/changed physical source, original epoch, rules, dt and private fields',()=>{
  const state=folded(),head=state.head;
  for(const bad of [{...head,source:null},{...head,era:null},{...head,owner:'PRIVATE'},
    {...head,source:{...source,worldId:'foreign'}},{...head,source:{...source,commonsTransition:{...native.transition,fromWorldHash:'0'.repeat(64)}}},
    {...head,origin:{...head.origin,rulesVersion:'foreign'}},{...head,effectiveTick:38}])assert.throws(()=>acceptStationPhysicalHeadV1(bad,station,binding));
  for(const bad of [{...binding,worldId:'foreign'},{...binding,rulesVersion:station.rulesVersion},{...binding,dtSeconds:.1}])
    assert.throws(()=>acceptStationPhysicalHeadV1(head,station,bad));
  assert.throws(()=>acceptStationPhysicalHeadV1(head,{...station,genesisId:hashOf('foreign')},binding));
  assert.equal(stationPhysicalHeadV1Schema.safeParse({...initialStationPhysicalHeadV1(station),source}).success,false);
  const birth=initialStationPhysicalHeadV1(station);assert.equal(stationPhysicalHeadV1Schema.safeParse({...birth,origin:{...birth.origin,genesisId:hashOf('wrong')}}).success,false);
});
test('deterministic fold rejects reset/duplicate/era gap/changed dt and neither mutates nor repairs existing head',()=>{
  const state=folded(),before=hashOf(state);assert.throws(()=>foldStationRulesEraV1(state,fact,source,station),/sequence regressed/);
  const gap={seq:21,tick:37,payload:{...era,revision:3,previousRevision:2,source:{...era.source,seq:20}}};
  assert.throws(()=>foldStationRulesEraV1(state,gap,{...source,seq:20},station),/gap/);
  assert.throws(()=>foldStationRulesEraV1(undefined,{...fact,payload:{...era,dtSeconds:.1}},source,station));
  assert.throws(()=>foldStationRulesEraV1(undefined,{...fact,payload:{...era,epoch:hashOf('foreign')}},source,station));
  assert.equal(hashOf(state),before);
  assert.throws(()=>foldStationRulesEraV1({...state,lastFactSeq:0},fact,{...source,seq:20},station),/head sequence differs/);
});

test('explicit bounded public capability negotiation defaults absent offer to V1 and never guesses support or fallback',()=>{
  assert.equal(negotiateStationContractV1({},['station-live/1','station-live/2']),'station-live/1');
  for(const stationContracts of [['station-live/1','station-live/2'],['station-live/2','station-live/1']])
    assert.equal(negotiateStationContractV1({stationContracts},['station-live/1','station-live/2']),'station-live/2');
  assert.equal(negotiateStationContractV1({stationContracts:['station-live/2']},['station-live/1']),null);
  assert.equal(negotiateStationContractV1({},[]),null);
  for(const stationContracts of [[],null,['station-live/3'],['station-live/1','station-live/1'],['station-live/1','station-live/2','station-live/1']])
    assert.equal(stationHelloCapabilitiesV1Schema.safeParse({stationContracts}).success,false);
  assert.throws(()=>negotiateStationContractV1({stationContracts:['station-live/2'],owner:'PRIVATE'},['station-live/2']));
  assert.throws(()=>negotiateStationContractV1({},['station-live/1','station-live/1']));
});
test('requested take/body tick37 belongs to new head, while earlier history cannot borrow its future source',()=>{
  const head=folded().head;
  assert.equal(stationPhysicalHeadCoversTickV1(head,station,binding,36.999),null);
  assert.equal(stationPhysicalHeadCoversTickV1(head,station,binding,37)!.source!.tick,37);
  assert.equal(stationPhysicalHeadCoversTickV1(head,station,binding,38)!.revision,1);
  assert.throws(()=>stationPhysicalHeadCoversTickV1(head,station,binding,NaN));
  assert.equal(stationPhysicalHeadCoversTickV1(initialStationPhysicalHeadV1(station),station,
    {worldId:station.worldId,rulesVersion:station.rulesVersion,dtSeconds:.05},0),null);
});
