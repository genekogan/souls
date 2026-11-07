import { nativeGatheringObservationV1Schema, type NativeGatheringObservationV1 } from '@souls/engine-contract';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { fixtureSlots, type Slot } from '../../../mars/viewer/engine/social/slots.ts';

/** Trusted native runtime reader. No raw request, private semantic state or
 * classification model. Group keys and members stay local to this observation. */
export function readNativeGathering(rt:Runtime,rulesVersion:string,dtSeconds:number):NativeGatheringObservationV1 {
  const live=new Set([...rt.records.keys()].filter(id=>rt.isActive(id))),groups=new Map<string,Set<string>>(),slots=new Map<string,Slot[]>();
  for(const id of live) {
    const record=rt.records.get(id);
    if(!record||record.verb!=='take_slot'||record.status!=='executing'||record.phase!=='occupied'||!record.parent)continue;
    const parent=rt.records.get(record.parent);
    if(!parent||!live.has(parent.id)||parent.status!=='executing'||parent.phase!=='gathered'
      ||!['gather','campfire_circle'].includes(parent.verb))continue;
    const p=record.params as {actor?:string;slot?:string},g=parent.params as {actors?:string[];fixture?:string;region?:string;fire?:string};
    const target=parent.verb==='campfire_circle'?g.fire:g.fixture??g.region;
    if(typeof p.actor!=='string'||typeof p.slot!=='string'||typeof target!=='string'||!g.actors?.includes(p.actor))continue;
    const entity=rt.world.entities[p.actor],h=entity?.human;
    if(entity?.kind!=='human'||!h||h.task!==id||['walk','wait','sit-down','stand-up'].includes(h.activity))continue;
    // Region slot generation syncs Spatial and can change derived navigation
    // epoch. Revision1 deliberately reads only pure fixture slots, never syncs.
    const fixture=rt.world.entities[target];if(fixture?.kind!=='fixture')continue;
    const targetSlots=slots.get(target)??fixtureSlots(rt,fixture);slots.set(target,targetSlots);
    const slot=targetSlots.find(s=>s.id===p.slot);
    if(!slot||slot.owner!==target||slot.claimedBy!==id||h.level!==slot.level
      ||!rt.holder(`actor:${p.actor}`).includes(id)||!rt.holder(`slot:${p.slot}`).includes(id))continue;
    const dx=entity.pose.p[0]-slot.p[0],dz=entity.pose.p[2]-slot.p[1];
    if(dx*dx+dz*dz>=.05*.05)continue;
    const group=groups.get(target)??new Set<string>();group.add(p.actor);groups.set(target,group);
  }
  let largestCommonTargetMembers=0;
  for(const group of groups.values())largestCommonTargetMembers=Math.max(largestCommonTargetMembers,group.size);
  return nativeGatheringObservationV1Schema.parse({contract:'native-gathering-observation/1',sourceRevision:'settled-native-gather-fixtures/1',
    tick:rt.tick,dtSeconds,rulesVersion,situation:largestCommonTargetMembers>=2?'gathering':'ordinary',largestCommonTargetMembers});
}
