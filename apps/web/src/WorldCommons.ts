// Applicability of this authored scenery, not physical validation or a wire codec.
import { hashOf, type CommonsSceneMetadataV1 } from '@souls/engine-contract';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import { commonsPrefabPlacements } from '../../../mars/viewer/app/engine-view/content/environment/commons.ts';
const SOURCE='9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8';
// Complete geometry of Core's reviewed3be capture, excluding the metadata/clock.
const CONNECTED_SPATIAL='fb9116a3d8f05b27d4f5358625859176a33f7543d8087bb7b27b209ef6f5a7ba';
const SPATIAL='d77bbd08b58127faacdd90498692e623b551185d798e41618bc7da07b6e26705';
export function authoredCommons(scene:SpatialScene|null,metadata:CommonsSceneMetadataV1|undefined):CommonsSceneMetadataV1|null {
  if(!scene||!metadata||metadata.source!==SOURCE||![SPATIAL,CONNECTED_SPATIAL].includes(hashOf(scene)))return null;
  const roots=commonsPrefabPlacements(()=>0);
  if(metadata.layout.length!==roots.length||!metadata.layout.every((m,i)=>m.id===roots[i].id&&m.kind===roots[i].kind&&m.p.every((v,a)=>v===roots[i].p[a])&&m.yaw===roots[i].yaw))return null;
  return structuredClone(metadata);
}
/** A conservative prism is hidden only while its actual recorded replacement
 * is present at the reviewed pose. Missing/moved/replaced entities restore it. */
export function commonsFixtureAtRoot(metadata:CommonsSceneMetadataV1,id:string,entities:Readonly<Record<string,SampledEntity>>,records:Readonly<Record<string,{def:string;kind:string}>>):boolean {
  const m=metadata.layout.find(p=>p.id===id),e=entities[id];
  return !!m&&!!e&&records[id]?.kind==='fixture'&&records[id]?.def===m.def&&Math.abs(e.pitch)<=.0005&&Math.abs(e.roll)<=.0005&&e.p.every((v,a)=>Math.abs(v-m.p[a])<=.0005)&&Math.abs(Math.atan2(Math.sin(e.yaw-m.yaw),Math.cos(e.yaw-m.yaw)))<=.0005;
}
