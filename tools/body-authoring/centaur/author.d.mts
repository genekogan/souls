/// <reference types="node" />
export const CENTAUR_MANIFEST:{type:'humanoid';license:'owned';rightsConfirmed:true;rig:'quaternius/1';actionProfile:'quadruped-torso/1';name:string;description:string};
export const HIND_OFFSET:number;
export function authorCentaur(options?:{source?:string;out?:string;hindOffset?:number}):{
 bytes:Buffer;
 manifest:typeof CENTAUR_MANIFEST;
 stats:{body:string;bytes:number;triangles:number;drawCalls:number;images:number;joints:number;clips:string[];lowerBodyReach:number;hindOffset:number};
};
