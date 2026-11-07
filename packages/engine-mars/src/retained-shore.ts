import {hashOf,retainedCommonsShoreV1Schema,type RenderScene} from '@souls/engine-contract';
import {decodeSnapshot,type RuntimeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {encode} from '../../../mars/viewer/engine/runtime/codec.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {WorldState} from '../../../mars/viewer/engine/world/types.ts';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {loadMars} from './load.ts';

/** A quiet exact graph transition from the retained commons, not fresh genesis. */
export async function createRetainedCommonsShoreReader(){
  const m=await loadMars(),native=await connectedCommonsShoreFixture(),old=m.edenCommonsWorld('base') as WorldState,target=native.genesis('base');
  const regions=Object.fromEntries(Object.entries(target.regions).filter(([id])=>!old.regions[id]));
  const rulesVersion='retained-shore/1+'+m.rulesVersion,additionsHash=hashOf({regions,base:target.base});
  const no=(code:string,message:string)=>({ok:false as const,diagnostic:{code:'retained-shore.'+code,message}});
  function prepare(rt:Runtime,fromRulesVersion:string,toRulesVersion:string,fromStateHash:string){
    if(hashOf(rt.world.base)!==hashOf(old.base))return no('foreign-base','Only the original dry commons physical base may enter this reader.');
    if(rt.world.obstacleEdits)return no('obstacle-overrides','Existing topology overrides need separate qualification.');
    const quiet=m.compactionIssue(rt);if(quiet)return no('not-quiet',quiet);
    if(Object.keys(regions).some(id=>rt.world.regions[id]))return no('region-collision','An existing named region cannot be replaced.');
    const snapshot=rt.snapshot();if(snapshot.dropped?.length)return no('dropped-work','An exact native graph is required.');
    const graph=decodeSnapshot(snapshot);graph.world.base=structuredClone(target.base);
    Object.assign(graph.world.regions,structuredClone(regions));
    const next={...snapshot,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const runtime=native.restore(next),issues=runtime.invariants.flatMap(inv=>inv(runtime));
    if(issues.length)return no('physical-conflict',issues.map(v=>v.code).join(', '));
    return {ok:true as const,runtime,transition:retainedCommonsShoreV1Schema.parse({contract:'retained-commons-shore/1',tick:rt.tick,
      fromRulesVersion,toRulesVersion,fromStateHash,fromNativeHash:rt.stateHash(),fromBase:rt.world.base,toBase:target.base,
      additionsHash,geometrySourceHash:native.sourceHash})};
  }
  return {rulesVersion,base:structuredClone(target.base),regions:structuredClone(regions),prepare,
    restore:(snapshot:RuntimeSnapshot)=>native.restore(snapshot),services:native.servicesForWorld,
    renderScene:():RenderScene=>native.renderScene()};
}
export type RetainedCommonsShoreReader=Awaited<ReturnType<typeof createRetainedCommonsShoreReader>>;
