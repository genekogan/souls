/** How far an opted-in drawer (kit role `drawer`) slides out, in the def's metres (Soul Actions entry 24). */
export const DRAWER_TRAVEL=.32;
/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;sign?:unknown;container?:unknown;display?:{controlAt?:readonly number[]};bell?:unknown};state?:Record<string,unknown>},action?:string):'on'|'open'|'text'|'locked'|'rings'|null {
  // Entry 10: an opted-in bell pull rings (a counter, not a toggle).
  if(def.components?.bell&&def.tags?.includes('hand-rung')&&(!action||action==='ring'))return 'rings';
  // Entry 9: an opted-in display's power control is the same on/off contact as a light switch.
  if((def.components?.light||def.components?.lights||(def.tags?.includes('hand-powered-display')&&def.components?.display?.controlAt))&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if((def.components?.opening||def.components?.container)&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Soul Actions entry 32: a lockable door's key / thumb-turn and a knock on its leaf are hand contact too.
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&(action==='lock'||action==='unlock'))return 'locked';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&action==='knock')return 'open';
  if(def.components?.sign&&def.tags?.includes('hand-writable')&&(!action||['write','erase','pin','unpin','sign','unsign','vote','mark','reply','take-on'].includes(action)||action==='move'&&def.tags.includes('checkers')))return 'text';
  // Opted-in drawn coverings without a hinge (curtains, a roller blind): open/close at a pull cord, the same contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&def.state&&Object.hasOwn(def.state,'open')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact. Entry 37: a radio's
  // tuning knob (`change-station`) is the same contact; the station it sets is depicted on the same clock.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off','change-station'].includes(action)))return 'on';
  // Opted-in fire (a candle, a campfire): "light" / "put out" are the same on/off contact, under their own words.
  if(def.tags?.includes('hand-operated')&&action!==undefined&&['light','put-out'].includes(action))return 'on';
  return null;
}
/** Entry 37: besides `on`/`open`, the other fields a hand contact sets that viewers depict on the same clock. */
export const CONTACT_EXTRA_FIELDS=['station'] as const;
/** Soul Actions entry 42: a hand-operated container's storage (its `shelf` slots, the mouth and what fits), else null.
 *  Shared by the server (offers, refusals, perception), the engine adapter (interior surface slots) and the viewer. */
export type ContainerInside={lip:number;face:number;stand:[number,number];fit:[number,number,number];word:string;slots:{id:string;p:readonly number[]}[]};
export function containerInside(def:{tags?:readonly string[];components?:{container?:unknown};slots?:readonly {id:string;kind:string;p:readonly number[]}[]}|undefined):ContainerInside|null{
  const c=def?.components?.container as {inside?:Omit<ContainerInside,'slots'>}|undefined;
  if(!c?.inside||!def?.tags?.includes('hand-operated'))return null;
  const slots=(def.slots??[]).filter(s=>s.kind==='shelf').map(s=>({id:s.id,p:s.p}));
  return slots.length?{...c.inside,slots}:null;
}
