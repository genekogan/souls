// Deterministic, detached terrain-contact geometry for future native traversal.
// It never installs a scene, assigns a contact or moves an entity. Existing
// horizontal Spatial grids/locomotion are deliberately not consumers yet.
import { terrainPatchV1Schema, terrainSweepV1Schema, terrainFootingV1Schema, terrainPointV1Schema, type TerrainPatchV1,
  type TerrainSweepGeometryV1, type TerrainTriangleV1, type TerrainSpanV1, type TerrainFootingGeometryV1, type TerrainPointGeometryV1 } from '@souls/engine-contract';

type V2=[number,number];
type Triangle={ref:TerrainTriangleV1;vertices:[V2,V2,V2];baseY:number;dx:number;dz:number;grade:number;normal:[number,number,number]};
const sub=(a:V2,b:V2):V2=>[a[0]-b[0],a[1]-b[1]];
const cross=(a:V2,b:V2)=>a[0]*b[1]-a[1]*b[0];
const sq=(a:V2)=>a[0]*a[0]+a[1]*a[1];
const at=(a:V2,b:V2,t:number):V2=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];

function triangle(p:TerrainPatchV1,column:number,row:number,half:'lower'|'upper'):Triangle {
  const s=p.spacingMetres,x=p.originXZ[0]+column*s,z=p.originXZ[1]+row*s;
  const a=p.heightMetres[row][column],b=p.heightMetres[row][column+1],c=p.heightMetres[row+1][column],d=p.heightMetres[row+1][column+1];
  const lower=half==='lower',dx=(lower?b-a:d-c)/s,dz=(lower?d-b:c-a)/s;
  const grade=Math.sqrt(dx*dx+dz*dz),n=Math.sqrt(dx*dx+1+dz*dz);
  return {ref:{column,row,half},vertices:lower?[[x,z],[x+s,z],[x+s,z+s]]:[[x,z],[x+s,z+s],[x,z+s]],
    baseY:a,dx,dz,grade,normal:[dx===0?0:-dx/n,1/n,dz===0?0:-dz/n]};
}

/** Clip a centre segment against the three closed triangle half-planes. */
function clip(a:V2,b:V2,t:Triangle):[number,number]|null {
  let lo=0,hi=1;
  for(let k=0;k<3;k++){
    const start=t.vertices[k],edge=sub(t.vertices[(k+1)%3],start);
    const ca=cross(edge,sub(a,start)),cb=cross(edge,sub(b,start));
    if(ca<0&&cb<0)return null;
    if(ca<0)lo=Math.max(lo,ca/(ca-cb));
    if(cb<0)hi=Math.min(hi,ca/(ca-cb));
    if(lo>hi)return null;
  }
  return [lo,hi];
}
function pointSegmentSquared(p:V2,a:V2,b:V2):number {
  const v=sub(b,a),w=sub(p,a),n=sq(v),u=n===0?0:Math.max(0,Math.min(1,(w[0]*v[0]+w[1]*v[1])/n));
  return sq(sub(p,at(a,b,u)));
}
function capsuleTouches(a:V2,b:V2,r2:number,t:Triangle):boolean {
  if(clip(a,b,t))return true;
  // Disjoint segment/triangle: the minimum is an endpoint-to-edge or
  // vertex-to-segment distance. No fixed-distance/path sample can miss a strip.
  for(let k=0;k<3;k++){
    const v=t.vertices[k],w=t.vertices[(k+1)%3];
    if(pointSegmentSquared(a,v,w)<=r2||pointSegmentSquared(b,v,w)<=r2||pointSegmentSquared(v,a,b)<=r2)return true;
  }
  return false;
}
function height(t:Triangle,q:V2):[number,number,number]{
  return [q[0],t.baseY+(q[0]-t.vertices[0][0])*t.dx+(q[1]-t.vertices[0][1])*t.dz,q[1]];
}
function centreTriangle(p:TerrainPatchV1,q:V2):Triangle{
  const u0=(q[0]-p.originXZ[0])/p.spacingMetres,v0=(q[1]-p.originXZ[1])/p.spacingMetres;
  const i=Math.min(p.columns-2,Math.max(0,Math.floor(u0))),j=Math.min(p.rows-2,Math.max(0,Math.floor(v0)));
  return triangle(p,i,j,v0-j<=u0-i?'lower':'upper');
}

/** Triangle/rectangle intersection vertices, including cell edges and
 * diagonals inside the rectangle. Their affine heights contain all extrema. */
function clipRectangle(t:Triangle,bounds:[number,number,number,number]):V2[]{
  let points:V2[]=[...t.vertices];
  for(const [axis,limit,sign] of [[0,bounds[0],1],[0,bounds[2],-1],[1,bounds[1],1],[1,bounds[3],-1]]){
    const output:V2[]=[];
    for(let k=0;k<points.length;k++){
      const a=points[k],b=points[(k+1)%points.length],da=sign*(a[axis]-limit),db=sign*(b[axis]-limit);
      if(da>=0)output.push(a);
      if((da<0&&db>0)||(da>0&&db<0))output.push(at(a,b,da/(da-db)));
    }
    points=output;if(!points.length)break;
  }
  return points;
}

/** Parse/copy the patch once. Source mutations and query results cannot change
 * subsequent probes. Uses only IEEE arithmetic/sqrt; no host transcendentals. */
export function createTerrainGeometryProbe(raw:unknown){
  // JSON's single zero representation is part of this detached fixture seam.
  // Validation happens before conversion; nonfinite values cannot become null.
  const p:TerrainPatchV1=JSON.parse(JSON.stringify(terrainPatchV1Schema.parse(raw)));
  return {
    point(rawRequest:unknown):TerrainPointGeometryV1 {
      const request=terrainPointV1Schema.parse(rawRequest),[x,z]=request.atXZ,[x0,z0]=p.originXZ;
      const result:TerrainPointGeometryV1={contract:'terrain-point-geometry/1',stage:'geometry-only',terrainId:p.id,
        request,geometryStatus:'outside-terrain',point:null,normal:null,grade:null};
      if(x<x0||z<z0||x>x0+(p.columns-1)*p.spacingMetres||z>z0+(p.rows-1)*p.spacingMetres)return result;
      const t=centreTriangle(p,[x,z]);result.geometryStatus='covered';result.point=height(t,[x,z]);result.normal=[...t.normal];result.grade=t.grade;
      return result;
    },
    footing(rawRequest:unknown):TerrainFootingGeometryV1{
      const request:ReturnType<typeof terrainFootingV1Schema.parse>=JSON.parse(JSON.stringify(terrainFootingV1Schema.parse(rawRequest)));
      const [x,z]=request.centreXZ,[hx,hz]=request.halfXZ,s=p.spacingMetres;
      const bounds:[number,number,number,number]=[x-hx,z-hz,x+hx,z+hz];
      const result:TerrainFootingGeometryV1={contract:'terrain-footing-geometry/1',stage:'geometry-only',terrainId:p.id,request,
        geometryStatus:'covered',checkedTriangles:0,gapRangeMetres:null,terrainHeightRangeMetres:null,
        unresolved:['foundation-policy','loads','materials','canonical-installation']};
      const [x0,z0]=p.originXZ;
      if(bounds[0]<x0||bounds[1]<z0||bounds[2]>x0+(p.columns-1)*s||bounds[3]>z0+(p.rows-1)*s){result.geometryStatus='outside-terrain';return result;}
      const i0=Math.max(0,Math.floor((bounds[0]-x0)/s)-1),i1=Math.min(p.columns-2,Math.floor((bounds[2]-x0)/s));
      const j0=Math.max(0,Math.floor((bounds[1]-z0)/s)-1),j1=Math.min(p.rows-2,Math.floor((bounds[3]-z0)/s));
      let min=Infinity,max=-Infinity;
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)for(const half of ['lower','upper'] as const){
        const t=triangle(p,i,j,half),vertices=clipRectangle(t,bounds);if(!vertices.length)continue;
        result.checkedTriangles++;
        for(const v of vertices){const y=height(t,v)[1];min=Math.min(min,y);max=Math.max(max,y);}
      }
      result.terrainHeightRangeMetres=[min,max];result.gapRangeMetres=[request.bottomY-max,request.bottomY-min];
      return result;
    },
    sweep(rawRequest:unknown):TerrainSweepGeometryV1{
      const request:ReturnType<typeof terrainSweepV1Schema.parse>=JSON.parse(JSON.stringify(terrainSweepV1Schema.parse(rawRequest)));
      const a=request.fromXZ,b=request.toXZ,r=request.radiusMetres,s=p.spacingMetres;
      const result:TerrainSweepGeometryV1={contract:'terrain-sweep-geometry/1',stage:'geometry-only',terrainId:p.id,request,
        geometryStatus:'clear',maxEncounteredGrade:null,checkedTriangles:0,centreline:[],lengthMetres:0,
        unresolved:['obstacles','water','stacked-supports','dynamic-bodies','canonical-installation']};
      const x0=p.originXZ[0],z0=p.originXZ[1],x1=x0+(p.columns-1)*s,z1=z0+(p.rows-1)*s;
      const minX=Math.min(a[0],b[0])-r,maxX=Math.max(a[0],b[0])+r,minZ=Math.min(a[1],b[1])-r,maxZ=Math.max(a[1],b[1])+r;
      // Convex rectangular domain: enclosing both endpoint discs encloses the
      // complete swept disc. No outside fallback to the engine's flat ground.
      if(minX<x0||maxX>x1||minZ<z0||maxZ>z1){result.geometryStatus='blocked';result.reason='outside-terrain';return result;}
      const i0=Math.max(0,Math.floor((minX-x0)/s)-1),i1=Math.min(p.columns-2,Math.floor((maxX-x0)/s));
      const j0=Math.max(0,Math.floor((minZ-z0)/s)-1),j1=Math.min(p.rows-2,Math.floor((maxZ-z0)/s));
      const breaks=new Set([0,1]);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)for(const half of ['lower','upper'] as const){
        const t=triangle(p,i,j,half);
        if(!capsuleTouches(a,b,r*r,t))continue;
        result.checkedTriangles++;
        if(result.maxEncounteredGrade===null||t.grade>result.maxEncounteredGrade){result.maxEncounteredGrade=t.grade;result.limitingTriangle={...t.ref};}
        const span=clip(a,b,t);if(span){breaks.add(span[0]);breaks.add(span[1]);}
      }
      if(result.maxEncounteredGrade!==null&&result.maxEncounteredGrade>request.maxGrade){result.geometryStatus='blocked';result.reason='slope-exceeded';}
      // Centreline geometry is retained even on a slope refusal for diagnostics;
      // the caller must check status. Normal/slope is constant within each span.
      const ts=[...breaks].sort((x,y)=>x-y);
      for(let k=0;k<ts.length-1;k++){
        const fromT=ts[k],toT=ts[k+1];if(toT<=fromT)continue;
        const t=centreTriangle(p,at(a,b,(fromT+toT)/2)),from=height(t,at(a,b,fromT)),to=height(t,at(a,b,toT));
        const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],lengthMetres=Math.sqrt(dx*dx+dy*dy+dz*dz);
        const span:TerrainSpanV1={fromT,toT,triangle:{...t.ref},from,to,normal:[...t.normal],grade:t.grade,lengthMetres};
        result.centreline.push(span);result.lengthMetres+=lengthMetres;
      }
      return result;
    },
  };
}
