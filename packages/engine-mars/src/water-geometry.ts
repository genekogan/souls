import { waterGeometryV1Schema, waterColumnV1Schema, waterClearanceV1Schema,
  type WaterColumnGeometryV1, type WaterClearanceGeometryV1 } from '@souls/engine-contract';
import { createTerrainGeometryProbe } from './terrain.ts';

/** Geometry-only proposal probe. Rectangular/domain and whole-footprint tests
 * reuse the declared triangle bed; source labels cannot grant movement. */
export function createWaterGeometryProbe(raw:unknown) {
  const p=JSON.parse(JSON.stringify(waterGeometryV1Schema.parse(raw))) as ReturnType<typeof waterGeometryV1Schema.parse>;
  const terrain=createTerrainGeometryProbe(p.terrain),[x0,z0,x1,z1]=p.wetBoundsXZ;
  const inside=(x:number,z:number)=>x>=x0&&x<=x1&&z>=z0&&z<=z1;
  return {
    column(rawRequest:unknown):WaterColumnGeometryV1 {
      const request=waterColumnV1Schema.parse(rawRequest),[x,z]=request.atXZ,bed=terrain.point({atXZ:[x,z]});
      const result:WaterColumnGeometryV1={contract:'water-column-geometry/1',stage:'geometry-only',waterId:p.id,terrainId:p.terrain.id,
        request,geometryStatus:'outside-terrain',bedY:null,datumY:p.datumY,depthMetres:null,submergedSpanMetres:null,submergedSpanFraction:null,
        unresolved:['body-anatomy','physical-support','water-physics','canonical-installation']};
      if(!bed.point)return result;
      result.bedY=bed.point[1];result.depthMetres=inside(x,z)?Math.max(0,p.datumY-result.bedY):0;
      result.geometryStatus=result.depthMetres>0?'wet':'dry';
      if(request.verticalSpan) {
        const [bottom,top]=request.verticalSpan;
        const length=result.geometryStatus==='wet'?Math.max(0,Math.min(top,p.datumY)-Math.max(bottom,result.bedY)):0;
        result.submergedSpanMetres=length;result.submergedSpanFraction=length/(top-bottom);
      }
      return result;
    },
    clearance(rawRequest:unknown):WaterClearanceGeometryV1 {
      const request=waterClearanceV1Schema.parse(rawRequest),[x,z]=request.centreXZ,[hx,hz]=request.halfXZ;
      const result:WaterClearanceGeometryV1={contract:'water-clearance-geometry/1',stage:'geometry-only',waterId:p.id,terrainId:p.terrain.id,
        request,geometryStatus:'outside-water-domain',checkedTriangles:0,depthRangeMetres:null,signedKeelClearanceRangeMetres:null,
        unresolved:['yawed-hull','swept-route','obstacles','hydrostatics','passengers','canonical-installation']};
      if(!inside(x-hx,z-hz)||!inside(x+hx,z+hz))return result;
      const bed=terrain.footing({centreXZ:request.centreXZ,halfXZ:request.halfXZ,bottomY:p.datumY});
      if(bed.geometryStatus!=='covered'||!bed.gapRangeMetres)return result;
      const [lo,hi]=bed.gapRangeMetres;result.checkedTriangles=bed.checkedTriangles;
      result.depthRangeMetres=[Math.max(0,lo),Math.max(0,hi)];
      result.signedKeelClearanceRangeMetres=[lo-request.draftMetres,hi-request.draftMetres];
      result.geometryStatus=result.signedKeelClearanceRangeMetres[0]>=request.underKeelMarginMetres?'sufficient-depth':'insufficient-depth';
      return result;
    },
  };
}
