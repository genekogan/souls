import type {Entity} from '@sim/engine-contract';
import {admitBodyGLB,bindBodyDefinition} from './admission.ts';
import {validateUpload,BODY_UPLOAD_POLICY} from '../../moderation/validate.ts';
import {PIP_ASSET,pipBytes} from './pip.ts';
import {QUADRUPED_TORSO} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';
import {GHOST_MANIFEST} from '../../../../../tools/body-authoring/ghost/author.mjs';

// Immutable authored v1 shared examples (#722), built like Pip: lazily from their checked-in agent-local authoring
// source, through the ordinary upload normalization and admission, and refused if the bytes drift from the pin.
// A revision gets a new hash and preset revision; saves keep their original bytes and definition.
export const MONSTER_ASSET='body_e7f634a0d090b71d85229a737bbf8bb9274ffadee38d4107a79b0db599c52b77';
// The compact centaur foal (#723), declared quadruped-torso/1.
export const CENTAUR_ASSET='body_bd1e74f87aad0e2d091f34d70b6beb6d88ea5c4d72eda57396b888d6c4d56eb7';
export const GHOST_ASSET='body_8111f1c4504c9c3b585fcc36d2590af26c3371aa7ce3390d8b7e7549f0e1a2bd';
const url=(asset:string)=>`/v1/edge/body/assets/${asset}.glb`;
export const MONSTER_PRESET={id:'monster',name:'Grumble the monster',body:{family:'humanoid',type:'humanoid',model:MONSTER_ASSET,modelUrl:url(MONSTER_ASSET),avatar:{kind:'body',modelUrl:url(MONSTER_ASSET),bodyType:'humanoid'}} as Entity['body']};
export const CENTAUR_PRESET={id:'centaur',name:'Juniper the centaur foal',body:{family:'humanoid',type:'humanoid',actionProfile:QUADRUPED_TORSO,model:CENTAUR_ASSET,modelUrl:url(CENTAUR_ASSET),avatar:{kind:'body',modelUrl:url(CENTAUR_ASSET),bodyType:'humanoid'}} as Entity['body']};
export const GHOST_PRESET={id:'ghost',name:'Wisp the ghost',body:{family:'floater',type:'ceramic',model:GHOST_ASSET,modelUrl:url(GHOST_ASSET),avatar:{kind:'body',modelUrl:url(GHOST_ASSET),bodyType:'ceramic'},radius:.35,hoverHeight:1.45,motion:structuredClone(GHOST_MANIFEST.motion)} as unknown as Entity['body']};

type Made={bytes:Buffer;manifest:unknown};
function pinned(asset:string,make:()=>Promise<Made>){
 let pending:Promise<Uint8Array>|undefined;
 return ()=>pending??=make().then(made=>{
  const normalized=validateUpload(bindBodyDefinition(made.bytes,made.manifest),BODY_UPLOAD_POLICY),bytes=Buffer.from(normalized.bytes),admitted=admitBodyGLB(bytes,made.manifest);
  if(admitted.assetId!==asset)throw Error('Shared body source does not match its immutable preset revision');return bytes;
 }).catch(error=>{pending=undefined;throw error;});
}
/** No eager Three import, upload row, per-world blob or permanent generated file. One bounded build per process. */
export const monsterBytes=pinned(MONSTER_ASSET,()=>import('../../../../../tools/body-authoring/monster/author.mjs').then(({authorMonster})=>authorMonster()));
export const centaurBytes=pinned(CENTAUR_ASSET,()=>import('../../../../../tools/body-authoring/centaur/author.mjs').then(({authorCentaur})=>authorCentaur()));
export const ghostBytes=pinned(GHOST_ASSET,()=>import('../../../../../tools/body-authoring/ghost/author.mjs').then(({authorGhost})=>authorGhost()));
/** Shared bodies served by content address; every other asset id is an owner upload. */
export const SHARED_BODY_BYTES:Readonly<Record<string,()=>Promise<Uint8Array>>>={[PIP_ASSET]:pipBytes,[MONSTER_ASSET]:monsterBytes,[GHOST_ASSET]:ghostBytes,[CENTAUR_ASSET]:centaurBytes};
