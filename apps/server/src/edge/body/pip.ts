import type {Entity} from '@sim/engine-contract';
import {admitBodyGLB,bindBodyDefinition} from './admission.ts';
import {validateUpload,BODY_UPLOAD_POLICY} from '../../moderation/validate.ts';
import {ROLLING_GRIPPER} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';

// Immutable authored v1. A body revision gets a new hash; saves keep their original bytes and definition.
export const PIP_ASSET='body_0ac8dd17fab38e64b9367357232b819847bad25254252b5a47921ff1afa23b0f';
export const PIP_PRESET={id:'pip',name:'Pip the rolling robot',body:{family:'humanoid',type:'humanoid',actionProfile:ROLLING_GRIPPER,model:PIP_ASSET,modelUrl:`/v1/edge/body/assets/${PIP_ASSET}.glb`,avatar:{kind:'body',modelUrl:`/v1/edge/body/assets/${PIP_ASSET}.glb`,bodyType:'humanoid'}} as Entity['body']};
let pending:Promise<Uint8Array>|undefined;
/** No eager Three import, upload row, per-world blob or permanent generated file. One bounded build per process. */
export function pipBytes(){return pending??=import('../../../../../tools/body-authoring/robot/author.mjs').then(({authorPip})=>{
 const made=authorPip(),normalized=validateUpload(bindBodyDefinition(made.bytes,made.manifest),BODY_UPLOAD_POLICY),bytes=Buffer.from(normalized.bytes),admitted=admitBodyGLB(bytes,made.manifest);
 if(admitted.assetId!==PIP_ASSET)throw Error('Pip source does not match the immutable preset revision');return bytes;
}).catch(error=>{pending=undefined;throw error;});}
