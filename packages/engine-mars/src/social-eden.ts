import {readFileSync} from 'node:fs';
import {hashOf,socialEdenLayoutV1Schema} from '@souls/engine-contract';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import {add2,rot2,wrapAngle} from '../../../mars/viewer/engine/core/math.ts';
import type {Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
export function socialEdenV1(){
 const layout=socialEdenLayoutV1Schema.parse(JSON.parse(readFileSync(new URL('./fixtures/social-eden.v1.json',import.meta.url),'utf8'))),entities:Record<string,Entity>={},regions:Record<string,Region>={};
 const provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Frozen social-eden/1 proposalA, exact native catalogue roots/slots'};
 for(const p of layout.fixtures){if(!CATALOG[p.def])throw Error('social-eden.unknown-def');entities[p.id]={id:p.id,def:p.def,kind:'fixture',label:p.label,pose:{p:[...p.position],yaw:p.yaw},support:{kind:'ground'},provenance};}
 for(const p of layout.regions)regions[p.id]={id:p.id,label:p.label,kind:'place',level:0,polygon:p.polygon.map(v=>[...v]),provenance};
 const nativeGeometry=layout.fixtures.map(p=>{const d=CATALOG[p.def];return {id:p.id,def:p.def,size:[...d.size],support:{kind:'ground' as const,level:0,y:0},seats:(d.slots??[]).filter(s=>s.kind==='seat').map(s=>({id:p.id+'#'+s.id,owner:p.id,positionXZ:add2([p.position[0],p.position[2]],rot2(s.local,p.yaw)),yaw:wrapAngle(p.yaw+s.yaw),level:0,claim:'slot:'+p.id+'#'+s.id})),approachPolicy:'native-front-or-back/current-clearance',exitPolicy:'native-stand/current-reservations'};});
 return {layout,nativeGeometry,layoutHash:hashOf(layout),entities,regions,hash:hashOf({contract:'social-eden/1',entities,regions})};
}
