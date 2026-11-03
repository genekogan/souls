import {handReachSeconds,handSwingSeconds,handReleaseSeconds,type HandActuatorMotion} from '../../engine/social/hand-actuator.ts';
/** Incomplete M05 handoff correction. Explicit local build/test opt-in only. */
const browserEnv = (import.meta as ImportMeta & {env?:Record<string,string|boolean|undefined>}).env;
export const IDLE_REACH_HANDOFF = browserEnv?.VITE_SOUL_IDLE_REACH_HANDOFF === '1'
  || typeof process !== 'undefined' && process.env.SOUL_IDLE_REACH_HANDOFF === '1';

/** Visible idle return only; native contact, arm-down and action clocks are unchanged. */
export const ACTUATOR_IDLE_RETURN_SECONDS = 1.2;
export function actuatorIdleBlend(m:HandActuatorMotion, seconds:number) {
  if(m.passage?.mode==='unlock'&&m.abortedAt===undefined)return 0;
  const downAt=(m.abortedAt??handReachSeconds(m)+handSwingSeconds(m))+(m.stroke?.release??handReleaseSeconds(m));
  const x=Math.max(0,Math.min(1,(seconds-downAt)/ACTUATOR_IDLE_RETURN_SECONDS));
  return x*x*(3-2*x);
}

export const ACTUATOR_GESTURE_HISTORY_SECONDS = 10.2;
export function interruptedGesture(idHash:number, now:number, start:number, variant:boolean) {
  const period=variant?37:25, phase=variant?((idHash>>>7)%991)/991:(idHash%997)/997;
  return now>=start && Math.floor(now/period+phase)===Math.floor(start/period+phase);
}

export function actuatorArmDownSeconds(m:HandActuatorMotion){return (m.abortedAt??handReachSeconds(m)+handSwingSeconds(m))+(m.stroke?.release??handReleaseSeconds(m));}
