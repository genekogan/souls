// Detached public proposal producer. No DB, engine installation, model or route.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWaterGeometryProbe } from '@souls/engine-mars';
const sourcePath='apps/server/test/fixtures/scene-placement/shore-world.v1.json';
const sourceCommit='27879c144ef7716cd0238b5734a93d785e922950';
const sourceSha256='69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b';
export function generateShoreWaterGeometry() {
  const raw=readFileSync(new URL('../scene-placement/shore-world.v1.json',import.meta.url));
  if(createHash('sha256').update(raw).digest('hex')!==sourceSha256)throw new Error('shore proposal source changed');
  const shore=JSON.parse(raw.toString()),[a,b,c,d,end]=shore.water.wetDomain.closedPolygonXZ;
  if(JSON.stringify([a,b,c,d,end])!==JSON.stringify([[-16,-12],[0,-12],[0,12],[-16,12],[-16,-12]]))throw new Error('unsupported water polygon');
  const {interpolation,...terrain}=shore.terrain,probe=createWaterGeometryProbe({id:shore.water.id,terrain:{...terrain,diagonal:'min-min/max-max'},datumY:shore.water.datumY,wetBoundsXZ:[a[0],a[1],c[0],c[1]]});
  const columnRequests=[{atXZ:[-10,0],verticalSpan:[-.5,1.5]},{atXZ:[-1,0]},{atXZ:[0,0]},{atXZ:[1,0]},{atXZ:[-16.001,0]}];
  const boat=shore.boat,hull=boat.hullEnvelopeLocal;
  if(boat.poseProposal.yaw!==0 || hull.minXYZ[0]!==-hull.maxXYZ[0] || hull.minXYZ[2]!==-hull.maxXYZ[2])throw new Error('unsupported yawed/asymmetric hull');
  const halfXZ=[hull.maxXYZ[0],hull.maxXYZ[2]],draftMetres=boat.draftMetres,underKeelMarginMetres=.1;
  const clearanceRequests=[{centreXZ:[boat.poseProposal.p[0],boat.poseProposal.p[2]],halfXZ,draftMetres,underKeelMarginMetres},
    {centreXZ:[-1.5,7],halfXZ,draftMetres,underKeelMarginMetres},{centreXZ:[-1.49,7],halfXZ,draftMetres,underKeelMarginMetres}];
  return {contract:'shore-water-geometry-fixture/1',stage:'geometry-only',source:{path:sourcePath,commit:sourceCommit,sha256:sourceSha256},
    columns:columnRequests.map(q=>probe.column(q)),hullClearances:clearanceRequests.map(q=>probe.clearance(q)),
    suppliedUnderKeelMarginMetres:underKeelMarginMetres};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(generateShoreWaterGeometry(),null,2)+'\n');
