import {localClassroomObservationV1Schema,type LocalClassroomObservationV1} from '@souls/engine-contract';
import {readClassroom} from '../../../mars/viewer/engine/activities/index.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';

/** Pure projection of current native activity. Historical records, distant
 * participants, private strings and display content never enter this payload. */
export function readLocalClassroomV1(rt:Runtime,observer:string,rulesVersion:string):LocalClassroomObservationV1|undefined {
 const body=rt.world.entities[observer];if(body?.kind!=='human'||!body.human)return undefined;
 const nearby=(actor:string)=>{const e=rt.world.entities[actor];return e?.kind==='human'&&!!e.human&&Math.hypot(e.pose.p[0]-body.pose.p[0],e.pose.p[2]-body.pose.p[2])<=20&&Math.abs(e.pose.p[1]-body.pose.p[1])<=3;};
 const active=rt.activeIds().map(id=>rt.records.get(id)).filter((r):r is NonNullable<typeof r>=>!!r);
 const live=active.filter(r=>r.verb==='classroom_session').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const seats=new Set(active.filter(r=>r.verb==='sit'&&r.phase==='occupied').map(r=>JSON.stringify([(r.params as {actor?:string}).actor,(r.params as {slot?:string}).slot])));
 const sessions:LocalClassroomObservationV1['sessions']=[];
 for(const record of live){
  const read=readClassroom(rt,record.id);if(!read)continue;
  const participants=read.participants.filter(p=>p.state==='participating'&&nearby(p.actor)).map(p=>({actor:p.actor,role:p.role,occupiedSeat:seats.has(JSON.stringify([p.actor,p.seat]))&&rt.holder('slot:'+p.seat).includes(record.id)}));
  if(!participants.length)continue;
  const visible=new Set(participants.map(p=>p.actor));
  sessions.push({session:record.id,phase:read.phase,participants,seatedAttendees:participants.filter(p=>p.actor!==read.presenter&&p.occupiedSeat).length,
   ...(read.presenter&&visible.has(read.presenter)?{presenter:read.presenter}:{}),
   ...(read.floorHolder&&visible.has(read.floorHolder)?{floorHolder:read.floorHolder}:{}),
   ...(read.attentionTarget&&visible.has(read.attentionTarget.actor)?{attentionActor:read.attentionTarget.actor}:{})});
  if(sessions.length===16)break;
 }
 return localClassroomObservationV1Schema.parse({contract:'local-classroom-observation/1',scope:'local-distance-only',tick:rt.tick,rulesVersion,observer,radiusMetres:20,sessions});
}
