import type {WorldModel,Entity} from '@souls/world-compiler';
/** A native reparent/set-down belongs to the same buffered tick as the hands.
 * Only the new opt-in revisions wait; owner edits and frozen predecessors retain
 * their existing delivery semantics. No held-item details enter controller context. */
export function itemDiffAhead(model:WorldModel,message:unknown,depictedTick:number):boolean {
 const d=message as{by?:string;tick?:number;diff?:{upserts?:Entity[]}};
 if(d.by!=='engine'||typeof d.tick!=='number'||!Number.isFinite(d.tick)||d.tick<=depictedTick)return false;
 return !!d.diff?.upserts?.some(e=>{const before=model.entities.get(e.id),def=model.resolvedDef(e.def);
  return !!before&&def?.tags.includes('recorded-item')===true&&JSON.stringify([before.in,before.p,before.r])!==JSON.stringify([e.in,e.p,e.r]);
 });
}
