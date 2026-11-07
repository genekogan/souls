import {contactStateKey,CONTACT_EXTRA_FIELDS,type WorldModel,type Entity} from '@souls/world-compiler';

/** Native interactions use the same depicted tick as the Soul performing them.
 * The ordered diff stream waits here; it must not show a lamp's result ahead of
 * the viewer's buffered approach/reach. Owner edits and legacy messages stay immediate. */
export function lightDiffAhead(model:WorldModel, message:unknown, depictedTick:number):boolean {
  const d=message as {by?:string;tick?:number;diff?:{upserts?:Entity[]}};
  if(d.by!=='engine'||typeof d.tick!=='number'||!Number.isFinite(d.tick)||d.tick<=depictedTick)return false;
  return !!d.diff?.upserts?.some(e=>{
    const before=model.entities.get(e.id),def=model.resolvedDef(e.def);
    const key=def&&contactStateKey(def);
    // Soul Actions entry 32: a lockable door's lock turns under the hand too (key / thumb-turn, and the latch as it shuts)
    return before&&key&&(before.state?.[key]!==e.state?.[key]||(key==='open'&&def.tags?.includes('lockable')&&(before.state?.locked??false)!==(e.state?.locked??false))||CONTACT_EXTRA_FIELDS.some(f=>before.state?.[f]!==e.state?.[f]));
  });
}
