// Declarative adapter selection only: a profile narrows existing world abilities and never grants authority.
export const ROLLING_GRIPPER='rolling-gripper/1' as const;
/** A compact four-legged body with a canonical upper torso (#723): the same disposition as rolling-gripper/1, walking. */
export const QUADRUPED_TORSO='quadruped-torso/1' as const;
export type ActionProfile=typeof ROLLING_GRIPPER|typeof QUADRUPED_TORSO;
export const ACTION_PROFILES:readonly ActionProfile[]=[ROLLING_GRIPPER,QUADRUPED_TORSO];
export const isActionProfile=(x:unknown):x is ActionProfile=>ACTION_PROFILES.includes(x as ActionProfile);
export const hasRollingProfile=(body:{actionProfile?:string}|null|undefined)=>body?.actionProfile===ROLLING_GRIPPER;
/** Any declared profile: upright standby instead of seats or prone poses, an authored dance, canonical hands, the rest refused. */
export const hasDeclaredProfile=(body:{actionProfile?:string}|null|undefined)=>isActionProfile(body?.actionProfile);
const edgeCore=['go','walk','glide','stroll','wander','approach','go-near','hang-out','stand','turn','face','look','auto-face','follow','ask-to-stop','accept','decline','make','speak','say','talk','converse','listen'];
const edgePhysical=['dance','rest','lie','nap','standby','pick-up','put-on','put-down','drop','wave','nod','shake-head','point','clap','cheer'];
const nativeCore=['walk_to','ground_travel','ambient_wander','face','stand','converse'];
const nativeHands=['take_item','put_item','hold_items','stow_items','hand_actuator_v1','let_go_v1'];
export const ROLLING_POSES=['dance','wave','nod','shake-head','point','clap','cheer','listen'] as const;
export const ROLLING_ACTIONS={contract:'body-actions/1',id:ROLLING_GRIPPER,locomotion:'supported ground travel rendered as rolling',rest:'upright standby; no seat or prone posture',edge:[...edgeCore,...edgePhysical],native:[...nativeCore,...nativeHands,'pose_v1','body_motion_v1'],poses:ROLLING_POSES,unknown:'unsupported; requires an admitted adapter'} as const;
export const QUADRUPED_ACTIONS={contract:'body-actions/1',id:QUADRUPED_TORSO,locomotion:'supported ground travel rendered as a four-legged walk (walk gait only)',rest:'upright standby on four legs; no seat or prone posture',support:'the canonical humanoid navigation disc; the whole lower body is admitted inside it',edge:[...edgeCore,...edgePhysical],native:[...nativeCore,...nativeHands,'pose_v1','body_motion_v1'],poses:ROLLING_POSES,unknown:'unsupported; requires an admitted adapter'} as const;
export const PROFILE_ACTIONS={[ROLLING_GRIPPER]:ROLLING_ACTIONS,[QUADRUPED_TORSO]:QUADRUPED_ACTIONS} as const;
const edge=new Set<string>(ROLLING_ACTIONS.edge),native=new Set<string>(ROLLING_ACTIONS.native),poses=new Set<string>(ROLLING_POSES);
const WORDS:Record<ActionProfile,{body:string;profile:string;hands:string;travel:string}>={
 [ROLLING_GRIPPER]:{body:'rolling body',profile:'rolling profile',hands:'its grippers',travel:'its ground rolling adapter'},
 [QUADRUPED_TORSO]:{body:'four-legged body',profile:'four-legged profile',hands:'its hands',travel:'its walking gait adapter'}};
function problemFor(profile:ActionProfile,verb:string,params:Record<string,unknown>|undefined,kind:'edge'|'native'):string|null{
 const v=verb.replace(/^mars:/,''),w=WORDS[profile];
 if(!(kind==='edge'?edge:native).has(v))return `This ${w.body} has no admitted ${v} adapter; use ground movement, upright standby, dance or ${w.hands}.`;
 if(kind==='native'&&['walk_to','ground_travel'].includes(v)&&params?.gait!==undefined&&params.gait!=='walk')return `This ${w.body} uses ${w.travel}, not cycling or an unqualified running gait.`;
 if(kind==='native'&&v==='pose_v1'&&(!poses.has(String(params?.activity))||params?.base==='sit'||params?.seatHeight!==undefined||params?.group!==undefined||params?.gap!==undefined||params?.hold!==undefined||params?.release!==undefined||params?.prop!==undefined))return `This ${w.body} cannot sit, lie prone or use an unqualified pose/prop; use upright standby or an admitted standing gesture.`;
 if(kind==='native'&&v==='body_motion_v1'&&!['rest'].includes(String(params?.motion)))return `This ${w.profile} uses its authored standing dance clip; only upright rest uses body motion.`;
 return null;
}
export function rollingActionProblem(verb:string,params?:Record<string,unknown>,kind:'edge'|'native'='native'):string|null{return problemFor(ROLLING_GRIPPER,verb,params,kind);}
/** The declared profile's refusal for this verb, or null (also null for a body with no declared profile). */
export function profileActionProblem(body:{actionProfile?:string}|null|undefined,verb:string,params?:Record<string,unknown>,kind:'edge'|'native'='native'):string|null{
 const p=body?.actionProfile;return isActionProfile(p)?problemFor(p,verb,params,kind):null;
}
