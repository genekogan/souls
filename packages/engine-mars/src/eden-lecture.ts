import {readFileSync} from 'node:fs';
import {hashOf,edenLecturePlacementV1Schema,type EdenLecturePlacementV1} from '@souls/engine-contract';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import {add2,rot2,wrapAngle} from '../../../mars/viewer/engine/core/math.ts';
import type {Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
/** Seeded additive venue descriptors; installation/admission belongs to the
 * native checkpoint, never this geometry generator or a renderer. */
export function edenLectureV1(raw:EdenLecturePlacementV1){
 const p=edenLecturePlacementV1Schema.parse(raw),entities:Record<string,Entity>={},regions:Record<string,Region>={},point=(v:[number,number])=>add2(p.origin,rot2(v,p.yaw)),provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Gene commissioned seeded Eden lecture venue; exact native catalogue slots, not constructed history'};
 const fixture=(id:string,def:string,local:[number,number],yaw:number,label:string)=>{const q=point(local);if(!CATALOG[def])throw Error('eden-lecture.unknown-def');entities[id]={id,def,kind:'fixture',label,pose:{p:[q[0],0,q[1]],yaw:wrapAngle(p.yaw+yaw)},support:{kind:'ground'},provenance};};
 if(p.worldEast==='world-v2'){
  const source=JSON.parse(readFileSync(new URL('./fixtures/eden-expansion.world-v2.json',import.meta.url),'utf8')),c=source.classroom;if(p.id!==c.id||p.yaw!==0||p.audienceSeats!==20)throw Error('eden-lecture.world-placement-binding');
  for(const q of [...c.chairs,c.lectern,c.screen]){if(q.p[1]!==0)throw Error('eden-lecture.ground-fixture-required');fixture(q.id,q.def,[q.p[0]-p.origin[0],q.p[2]-p.origin[1]],q.fixtureYaw,q.id);}
  const returnId='eden-classroom-presenter-return-seat';fixture(returnId,'camp-chair',[47-p.origin[0],-12-p.origin[1]],Math.PI,'Presenter return seat');entities[c.screen.id].equipment={kind:'display',config:{available:true,mode:'on',content:p.lesson}};const [x0,z0,x1,z1]=c.boundsXZ,polygon:[number,number][]=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];regions[p.id]={id:p.id,kind:'place',label:'Eden east classroom',level:0,polygon,provenance};return {contract:'eden-lecture-placement/1' as const,placement:p,entities,regions,audienceSeats:c.chairs.map((q:any)=>q.id+'#seat') as string[],presenterReturnSeat:returnId+'#seat',presenterStation:c.lectern.id+'#presenter',displayId:c.screen.id,entrance:[c.openEntrance[0],c.openEntrance[2]] as [number,number],sideAisles:[[35,-5],[49,-5]] as [number,number][],footprint:polygon,layoutHash:hashOf({p,entities,regions,sourceHash:hashOf(source)})};
 }
 const seats:string[]=[];for(let i=0;i<p.audienceSeats;i++){const id=p.id+'-chair-'+String(i+1).padStart(2,'0');fixture(id,'camp-chair',[[-5,-2.8,2.8,5][i%4],-1+Math.floor(i/4)*2.2],Math.PI,'Lecture seat '+(i+1));seats.push(id+'#seat');}
 const returnSeat=p.id+'-presenter-chair';fixture(returnSeat,'camp-chair',[6,-6],Math.PI,'Presenter return seat');
 const lectern=p.id+'-lectern',display=p.id+'-screen';fixture(lectern,'speaker-lectern',[0,-6.3],0,'Lecture lectern');fixture(display,'standing-display',[0,-9],0,'Lesson screen');entities[display].equipment={kind:'display',config:{available:true,mode:'on',content:p.lesson}};
 const polygon:[number,number][]=[[-9,-13],[9,-13],[9,13],[-9,13]].map(v=>point(v as [number,number]));regions[p.id]={id:p.id,kind:'place',label:'Eden lecture venue',level:0,polygon,provenance};
 return {contract:'eden-lecture-placement/1' as const,placement:p,entities,regions,audienceSeats:seats,presenterReturnSeat:returnSeat+'#seat',presenterStation:lectern+'#presenter',displayId:display,entrance:point([0,12]),sideAisles:[point([-7.4,0]),point([7.4,0])],footprint:polygon,layoutHash:hashOf({p,entities,regions})};
}
