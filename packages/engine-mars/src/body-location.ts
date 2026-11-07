import {bodyLocationV1Schema,type BodyLocationV1} from '@souls/engine-contract';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {Entity} from '../../../mars/viewer/engine/world/types.ts';
import type {Diagnostic} from '../../../mars/viewer/engine/actions/types.ts';
const inside=(x:number,z:number,p:[number,number][])=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){
  const [xi,zi]=p[i],[xj,zj]=p[j];if(zi>z!==zj>z&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)hit=!hit;
}return hit;};
const area=(p:[number,number][])=>Math.abs(p.reduce((s,[x,z],i)=>{const q=p[(i+1)%p.length];return s+x*q[1]-q[0]*z;},0))/2;
/** Current self only; actual occupancy is certified by the installed native
 * controller. Native regions are geometrical labels, never new world ontology. */
export function readBodyLocation(rt:Runtime,actorId:string,bodyContact:(rt:Runtime,e:Entity)=>Diagnostic[]|null):BodyLocationV1|null{
  const e=rt.world.entities[actorId],h=e?.human;if(!h)return null;
  const regions=Object.values(rt.world.regions).filter(r=>r.kind!=='no-go'&&r.level===h.level&&inside(e.pose.p[0],e.pose.p[2],r.polygon))
    .sort((a,b)=>area(a.polygon)-area(b.polygon)||(a.id<b.id?-1:a.id>b.id?1:0));
  const r=regions[0],p=h.boatPassenger,v=p?rt.world.entities[p.boatId]:undefined;
  if((p&&(!v||bodyContact(rt,e)?.length!==0))||(h.shore&&bodyContact(rt,e)?.length!==0))return null;
  const parsed=bodyLocationV1Schema.safeParse({contract:'body-location/1',actorId,tick:rt.tick,physicalBase:{...rt.world.base},root:[...e.pose.p],
    region:r?{id:r.id,name:r.label}:null,
    occupancy:p?{container:{id:p.boatId,name:v!.label??'the boat'},passenger:structuredClone(p),transfer:h.boatTransit?structuredClone(h.boatTransit):null}:null,
    shore:h.shore?structuredClone(h.shore):null,
  });
  return parsed.success?parsed.data:null;
}
