import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf} from '@souls/engine-contract';
import {marsCampExpansionFactory} from '../../engine-mars/src/camp-expansion-engine.ts';
import type {MarsWorldConfig} from '../../engine-mars/src/engine.ts';
import {STATION_PINS_V1,stationEpochId,stationEpochV1Schema} from './station-v1.ts';
import {stationCampSourceV1Schema,stationCommonsSourceV1Schema,stationSourceFromRulesV1,stationPhysicalTransitionV1,
  foldStationRulesEraV1,stationPhysicalHeadV1Schema} from './station-era-v1.ts';
import {stationEraPageV1Schema} from './station-era-page-v1.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsCampExpansionFactory(cfg),engine=factory.create(factory.genesis('camp-era-codec'));for(let i=0;i<37;i++)engine.step();
const preview=engine.previewCampExpansionV1!();assert.ok(preview.ok);const transition=preview.transition,genesisId=hashOf('explicit codec fixture');
const station=stationEpochV1Schema.parse({contract:'station-epoch/1',worldId:'camp-era-codec',genesisId,epoch:stationEpochId('camp-era-codec',genesisId),rulesVersion:engine.rulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,createdTick:1});
const source=stationSourceFromRulesV1(station.worldId,{seq:10,tick:37,payload:{campExpansion:transition}});
const fact={seq:11,tick:37,payload:{contract:'station-rules-era/1',worldId:station.worldId,epoch:station.epoch,revision:1,previousRevision:0,fromRulesVersion:transition.fromRulesVersion,toRulesVersion:transition.toRulesVersion,dtSeconds:.05,effectiveTick:37,source:{seq:10,tick:37,transitionHash:hashOf(transition)}}};
test('strict camp source preserves original station identity and validates its exact physical hash/adjacency/page',()=>{
  const before=hashOf({source,station,fact}),state=foldStationRulesEraV1(undefined,fact,source,station);
  assert.equal(state.station.epoch,station.epoch);assert.equal(state.station.genesisId,station.genesisId);assert.equal(state.head.rulesVersion,transition.toRulesVersion);assert.equal(hashOf(stationPhysicalTransitionV1(state.head.source!)),hashOf(transition));
  assert.equal(hashOf({source,station,fact}),before);assert.equal(stationCommonsSourceV1Schema.safeParse(source).success,false,'old exact commons parser does not silently accept camp');
  assert.equal(stationEraPageV1Schema.safeParse({contract:'station-era-page/1',worldId:station.worldId,station,afterSeq:0,sourceCutoff:{seq:11,tick:37},nextAfterSeq:null,eras:[{fact,source}]}).success,true);
});
test('camp source/head refuses extra private data, mixed source keys, wrong source tick, altered stock seal and nonadjacent era',()=>{
  for(const bad of [{...source,owner:'PRIVATE'},{...source,tick:38},{...source,commonsTransition:transition}])assert.equal(stationCampSourceV1Schema.safeParse(bad).success,false);
  assert.throws(()=>stationSourceFromRulesV1(station.worldId,{seq:10,tick:37,payload:{campExpansion:transition,privateWords:'PRIVATE'}}));
  const state=foldStationRulesEraV1(undefined,fact,source,station),altered=structuredClone(state.head);assert.ok(altered.source&&'campExpansion' in altered.source);altered.source.campExpansion.additionsHash='0'.repeat(64);assert.equal(stationPhysicalHeadV1Schema.safeParse(altered).success,false);
  assert.throws(()=>foldStationRulesEraV1(undefined,{...fact,seq:12},source,station));
});
