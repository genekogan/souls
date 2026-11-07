// An explicit physical checkpoint, never a scene inferred from current art.
import { commonsTransitionV1Schema,hashOf,type CommonsTransitionV1 } from '@souls/engine-contract';
import { decodeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { encode } from '../../../mars/viewer/engine/runtime/codec.ts';
import type { Mars } from './load.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';

export function prepareCommonsTransition(m:Mars,rt:Runtime,fromRulesVersion:string,toRulesVersion:string):
  {ok:true;transition:CommonsTransitionV1;runtime:Runtime}|{ok:false;diagnostic:{code:string;message:string}} {
  const no=(code:string,message:string)=>({ok:false as const,diagnostic:{code:`commons-transition.${code}`,message}});
  const old=m.greenFieldWorld() as WorldState,target=m.edenCommonsWorld() as WorldState;
  if(hashOf(rt.world.base)!==hashOf(old.base))return no('foreign-base','only the exact original Greenfield physical base is admitted');
  const quiet=m.compactionIssue(rt);if(quiet)return no('not-quiet',quiet);
  if(rt.world.obstacleEdits)return no('obstacle-overrides','existing explicit obstacle overrides need their own physical migration');
  for(const id of Object.keys(target.entities))if(rt.world.entities[id])return no('entity-collision',`existing ${id} cannot be replaced`);
  for(const id of Object.keys(target.regions))if(id!=='field'&&rt.world.regions[id])return no('region-collision',`existing ${id} cannot be replaced`);
  // Preserve the decoded graph's aliases, records, next action ID and plain
  // services. Only its detached world's physical base/additions change.
  const snap=rt.snapshot(),graph=decodeSnapshot(snap);
  for(const [id,e] of Object.entries(target.entities))graph.world.entities[id]=structuredClone(e);
  for(const [id,r] of Object.entries(target.regions))if(!graph.world.regions[id])graph.world.regions[id]=structuredClone(r);
  graph.world.base=structuredClone(target.base);
  const nextSnap={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete nextSnap.spatialEpoch;
  const next=m.Runtime.restore(nextSnap,rt.registry,m.servicesFor(m.scenes)(graph.world),m.invariants) as Runtime;
  const issues=m.invariants.flatMap(inv=>inv(next));
  if(issues.length)return no('physical-conflict',issues.map(d=>`${d.code}: ${d.message}`).join('; '));
  const transition=commonsTransitionV1Schema.parse({contract:'commons-transition/1',tick:rt.tick,
    fromRulesVersion,toRulesVersion,fromBase:rt.world.base,toBase:target.base,fromWorldHash:rt.stateHash()});
  return {ok:true,transition,runtime:next};
}
