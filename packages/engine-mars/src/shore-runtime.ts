// Isolated native fixture installation. Intentionally not a living-world
// factory/default migration: only these certified locomotion verbs are admitted.
import { readFileSync } from 'node:fs';
import { hashOf,nativeShoreSceneV1Schema,type RenderScene } from '@souls/engine-contract';
import { loadMars } from './load.ts';
import { createTerrainGeometryProbe } from './terrain.ts';
import { createWaterGeometryProbe } from './water-geometry.ts';
import { shoreActions, shoreContactInvariant, shoreSpeedInvariant, SHORE_POLICY, type ShoreGeometry } from '../../../mars/viewer/engine/locomotion/shore.ts';
import { speedWithinCap } from '../../../mars/viewer/engine/runtime/invariants.ts';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { decodeSnapshot, type RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';

export const SHORE_RULES = 'native-shore-fixture/1';
export async function nativeShoreFixture() {
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/shore-bed.v1.json',import.meta.url),'utf8'));
  const terrain=createTerrainGeometryProbe(fixture.terrain);
  const water=createWaterGeometryProbe({...fixture.water,terrain:fixture.terrain});
  const geometry:ShoreGeometry=Object.freeze({terrainId:fixture.terrain.id,waterId:fixture.water.id,datumY:fixture.water.datumY,
    point(at){const p=terrain.point({atXZ:at}),c=water.column({atXZ:at});return p.point&&p.normal&&c.depthMetres!==null?{point:p.point,normal:p.normal,depth:c.depthMetres}:null;},
    sweep(from,to,radius,grade){const p=terrain.sweep({fromXZ:from,toXZ:to,radiusMetres:radius,maxGrade:grade});return {ok:p.geometryStatus==='clear',reason:p.reason,spans:p.centreline};},
  } satisfies ShoreGeometry);
  // This horizontal grid provides static clearance/bounds checks only. Its
  // legacy walk_to is absent; the authoritative root is always the triangle bed.
  const scene:SpatialScene={bounds:[-16,-12,16,12],levels:[{id:0,y:0,label:'shore clearance grid'}],
    surfaces:[{id:'shore-clearance-domain',level:0,y:0,obb:{c:[0,0],half:[16,12],yaw:0}}],obstacles:[],links:[]};
  const m=await loadMars();
  const rulesVersion=`${SHORE_RULES}+${m.rulesVersion}`;
  const base={campus:'eden-shore-fixture/1',staticHash:hashOf({fixture,policy:SHORE_POLICY,scene,rules:rulesVersion})};
  const registry=new Map(shoreActions(geometry).map(a=>[a.verb,a]));
  const services=m.servicesFor({[base.campus]:scene});
  const invariants=[...m.invariants.filter(i=>i!==speedWithinCap),shoreSpeedInvariant,shoreContactInvariant(geometry)];
  const validate=(w:WorldState)=>{
    if(w.base.campus!==base.campus||w.base.staticHash!==base.staticHash||w.obstacleEdits)
      throw new Error('shore fixture physical base/rules differ; no history reinterpretation');
  };
  return {
    rulesVersion,fixture:structuredClone(fixture),geometry,
    renderScene():RenderScene {return {scene:structuredClone(scene),shore:nativeShoreSceneV1Schema.parse({
      contract:'native-shore-scene/1',rulesVersion,physicalBase:base,terrain:fixture.terrain,water:fixture.water})};},
    genesis(seed='shore'):WorldState {
      const w=m.greenFieldWorld(seed) as WorldState;w.base={...base};w.regions={
        bank:{id:'bank',label:'Native sloped shore',kind:'walkable',level:0,polygon:[[0,-12],[16,-12],[16,12],[0,12]],provenance:{origin:'design-edit',confidence:'hypothetical'}},
        water:{id:'water',label:'Native calm water',kind:'place',level:0,polygon:[[-16,-12],[0,-12],[0,12],[-16,12]],provenance:{origin:'design-edit',confidence:'hypothetical'}},
      };return w;
    },
    create(w:WorldState):Runtime {validate(w);return new m.Runtime(w,registry,services(w),invariants);},
    restore(s:RuntimeSnapshot):Runtime {
      const w=decodeSnapshot(s).world;validate(w);
      return m.Runtime.restore(s,registry,services(w),invariants);
    },
    human(id:string,x:number,z:number) {
      const p=geometry.point([x,z]);if(!p||p.depth>0)throw new Error('shore fixture spawn requires dry terrain');
      const sweep=geometry.sweep([x,z],[x,z],SHORE_POLICY.radius,SHORE_POLICY.maxGrade);
      if(!sweep.ok)throw new Error('shore fixture spawn disc unsupported');
      return m.human(id,x,z,{y:p.point[1]});
    },
  };
}
