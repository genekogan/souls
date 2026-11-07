import {localClassroomObservationV1Schema} from '@souls/engine-contract';
import type {Mind,WorldHost} from './world.ts';
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const word=(n:number)=>n<20?small[n]:n<30?'twenty'+(n===20?'':'-'+small[n-20]):'thirty'+(n===30?'':'-'+small[n-30]);
/** Model context only: no clock/coordinates/native IDs/private semantic fields.
 * The observer is the current Mind's actual body, never a caller-selected body. */
export function nativeActivityContextV1(host:WorldHost,m:Mind):string[]|undefined {
 const raw=host.engine.observeLocalClassroomV1?.(m.entityId);if(raw===undefined)return undefined;
 const read=localClassroomObservationV1Schema.parse(raw);
 if(read.observer!==m.entityId||read.tick!==host.engine.world.tick||read.rulesVersion!==host.engine.rulesVersion)throw Error('native-activity-context.observer-frontier-differs');
 return read.sessions.map(s=>{
  const me=s.participants.find(p=>p.actor===m.entityId);
  return 'Nearby classroom: '+s.phase.replaceAll('-',' ')+'; '+word(s.participants.length)+' locally present participants; '+word(s.seatedAttendees)+' actual seated attendees.'+(me?' Your current native role is '+me.role+'.':'')+' Distance scope only; walls and line of sight are not checked. This grants no participation or body-control authority.';
 });
}
