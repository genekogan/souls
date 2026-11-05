// body-motion/1: authored data, never executable code. Kept dependency-free so the same
// checks ship with the downloadable local validator and run at the authoritative boundary.
export type MotionAdapter = {period:number; bob:number; pitch:number; roll:number; yaw:number};
export type BodyMotion = {contract:'body-motion/1'; idle:MotionAdapter; move:MotionAdapter; rest:MotionAdapter; dance?:MotionAdapter};
export type BodyMotionState = {since:number; until:number; release?:{at:number; weight:number}};
export const MOTION_LIMITS = {periodMin:.6,periodMax:12,bob:.06,rotation:.6,fadeSeconds:.4} as const;
const modes=['idle','move','rest','dance'] as const;
const fields=['period','bob','pitch','roll','yaw'] as const;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
/** The first failing field; no defaults may silently fill an incomplete submitted adapter. */
export function bodyMotionProblem(x:unknown):string|null {
 if(!record(x)||x.contract!=='body-motion/1')return 'motion.contract';
 if(Object.keys(x).some(k=>k!=='contract'&&!(modes as readonly string[]).includes(k)))return 'motion.unknown-field';
 for(const mode of modes){
  const a=x[mode];if(mode==='dance'&&a===undefined)continue;
  if(!record(a)||Object.keys(a).length!==fields.length||Object.keys(a).some(k=>!(fields as readonly string[]).includes(k)))return `motion.${mode}`;
  for(const field of fields){const v=a[field],lo=field==='period'?MOTION_LIMITS.periodMin:field==='bob'?0:-MOTION_LIMITS.rotation,hi=field==='period'?MOTION_LIMITS.periodMax:field==='bob'?MOTION_LIMITS.bob:MOTION_LIMITS.rotation;
   if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)return `motion.${mode}.${field}`;
  }
 }
 return null;
}
export function hasBodyDance(body:{family?:string;type?:string;motion?:BodyMotion}|undefined):boolean {
 return body?.family==='floater'&&body.type!=='creature'&&!!body.motion?.dance&&bodyMotionProblem(body.motion)===null;
}
/** Sole native dance shape admitted for these bodies; props, partners and hand effects stay unavailable. */
export function bodyDanceStep(body:Parameters<typeof hasBodyDance>[0],verb:string,params:Record<string,unknown>):boolean {
 return hasBodyDance(body)&&verb.replace(/^mars:/,'')==='body_motion_v1'&&params.motion==='dance';
}
export const LITTLE_MARTIANS_MOTION:Readonly<BodyMotion> = {
 contract:'body-motion/1',
 idle:{period:4,bob:.035,pitch:.025,roll:.035,yaw:.05},
 move:{period:3.2,bob:.025,pitch:.12,roll:.025,yaw:.02},
 rest:{period:5,bob:.015,pitch:.012,roll:.015,yaw:.02},
 dance:{period:.95,bob:.045,pitch:.16,roll:.24,yaw:.32},
};
