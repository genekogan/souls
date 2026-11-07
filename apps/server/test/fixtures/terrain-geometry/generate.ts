// Public proposal geometry only; no host, DB, owner, models or live installation.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createTerrainGeometryProbe } from '@souls/engine-mars';

const input=new URL('../scene-placement/',import.meta.url);
function pinned(name:string,sha256:string){
  const bytes=readFileSync(new URL(name,input));
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error(`changed public geometry input: ${name}`);
  return JSON.parse(bytes.toString());
}
export function generateTerrainGeometryFixture(){
  const terrainPin={commit:'27879c144ef7716cd0238b5734a93d785e922950',sha256:'69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b',fixture:'shore-world.v1.json'};
  const supportPin={commit:'6d665ca34bc8619e2472703cb7e073c7f3047b34',sha256:'5ba65ada39e255a4646f3910b008c7c46f314a5a72533b8e16b79f4373737a60',fixture:'shore-support-world.v1.json'};
  const shore=pinned(terrainPin.fixture,terrainPin.sha256),support=pinned(supportPin.fixture,supportPin.sha256);
  const {id,originXZ,spacingMetres,columns,rows,heightMetres}=shore.terrain;
  const probe=createTerrainGeometryProbe({id,originXZ,spacingMetres,columns,rows,heightMetres,diagonal:'min-min/max-max'});
  // Supplied example constraint, not a new native default or qualified anatomy.
  const profile={radiusMetres:.28,maxGrade:.25};
  return {contract:'core-terrain-geometry-fixture/1',worldId:shore.world,sourcePins:[terrainPin,supportPin],illustrativeProfile:profile,
    sweeps:[
      {id:'bank',result:probe.sweep({...profile,fromXZ:[2,0],toXZ:[12,0]})},
      {id:'shore-straddle',result:probe.sweep({...profile,fromXZ:[.15,-2],toXZ:[.15,2]})},
      {id:'outside-edge',result:probe.sweep({...profile,fromXZ:[15.9,11.9],toXZ:[15.9,11.9]})},
    ],
    footings:support.beds.map((bed:any)=>{
      const [lo,hi]=[bed.enclosure.minXYZ,bed.enclosure.maxXYZ];
      return {id:bed.id,proposedRootIds:bed.proposedRootIds,result:probe.footing({
        centreXZ:[(lo[0]+hi[0])/2,(lo[2]+hi[2])/2],halfXZ:[(hi[0]-lo[0])/2,(hi[2]-lo[2])/2],bottomY:lo[1]})};
    }),paid:0};
}
