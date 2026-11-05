/// <reference types="node" />
export const MONSTER_MANIFEST:{type:'humanoid';license:'owned';rightsConfirmed:true;rig:'quaternius/1';name:string;description:string};
export function authorMonster(options?:{source?:string;out?:string}):{
 bytes:Buffer;
 manifest:typeof MONSTER_MANIFEST;
 stats:{body:string;bytes:number;triangles:number;drawCalls:number;images:number;joints:number;clips:string[]};
};
