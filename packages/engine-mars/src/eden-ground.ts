import {hashOf,type RenderScene} from '@souls/engine-contract';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {decodeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {encode} from '../../../mars/viewer/engine/runtime/codec.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {loadMars} from './load.ts';
export const EDEN_GROUND_EXTENSION_V1=Object.freeze({version:'eden-expansion-ground/1' as const,rectangles:[{id:'eden-east-ground',boundsXZ:[30,-30,105,85] as [number,number,number,number]},{id:'eden-north-ground',boundsXZ:[-20,-65,30,-30] as [number,number,number,number]}]});
export async function createEdenGroundReaderV1(){
 const old=await connectedCommonsShoreFixture(),native=await connectedCommonsShoreFixture(undefined,EDEN_GROUND_EXTENSION_V1),m=await loadMars(),fromBase=old.genesis('base').base,toBase=native.genesis('base').base,rulesVersion='retained-shore/1+'+m.rulesVersion+'+eg/1',layoutHash=hashOf(EDEN_GROUND_EXTENSION_V1);
 return {rulesVersion,fromBase,toBase,layoutHash,services:native.servicesForWorld,renderScene:():RenderScene=>native.renderScene(),restore:native.restore,
  prepare(rt:Runtime,fromRulesVersion:string,toRulesVersion:string,fromStateHash:string){if(hashOf(rt.world.base)!==hashOf(fromBase)||rt.world.obstacleEdits)return {ok:false as const,diagnostic:{code:'eden-ground.foreign-base'}};let snapshot;try{snapshot=rt.snapshot();}catch{return {ok:false as const,diagnostic:{code:'eden-ground.resumable-boundary-required'}};}if(snapshot.dropped?.length)return {ok:false as const,diagnostic:{code:'eden-ground.dropped-work'}};const graph=decodeSnapshot(snapshot);graph.world.base=structuredClone(toBase);const next={...snapshot,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;const copy=native.restore(next);if(copy.invariants.some(i=>i(copy).length))return {ok:false as const,diagnostic:{code:'eden-ground.physical-conflict'}};return {ok:true as const,runtime:copy,transition:{contract:'eden-expansion-ground/1' as const,tick:rt.tick,fromRulesVersion,toRulesVersion,fromStateHash,fromBase,toBase,layoutHash}};}
 };
}
export type EdenGroundReaderV1=Awaited<ReturnType<typeof createEdenGroundReaderV1>>;
