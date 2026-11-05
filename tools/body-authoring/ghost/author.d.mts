/// <reference types="node" />
type Adapter={period:number;bob:number;pitch:number;roll:number;yaw:number};
export const GHOST_MANIFEST:{type:'ceramic';license:'owned';rightsConfirmed:true;name:string;description:string;
 motion:{contract:'body-motion/1';idle:Adapter;move:Adapter;rest:Adapter;dance:Adapter}};
export function authorGhost(options?:{out?:string}):{
 bytes:Buffer;
 manifest:typeof GHOST_MANIFEST;
 stats:{body:string;bytes:number;triangles:number;drawCalls:number;images:number;clips:string[]};
};
