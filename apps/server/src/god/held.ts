// F3 (rehearsal item 16): a Soul that picks up a god-built thing is seen holding it. The engine already moves the
// thing into the body's hand (support in-hand) and the bridge's write-back already parents its entity to the body's
// carry slot (F1: the body entity follows the engine body), but the Soul's own surfaces read the edge's item ledger
// (edge_items_v1), which knows nothing of god things: the receipt said "completed" with `changed` empty, observe/here
// said holding null, and nothing offered to put it down. On an entity world this adds, on our side of the edge:
//   - observe.self.holding (and so `here`): the god thing in this body's hand, when the edge's own ledger has none;
//   - pick-up / put-on / put-down receipts: outcome.changed names what is now held or where it was put;
//   - `put-down:here` (on the ground in front of you) while holding a god thing.
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { WorldModel } from '@sim/world-compiler';
import { groundPutDistance, groundPutNeed } from '../../../../mars/viewer/engine/items/actions.ts';

type Ents = Record<string, any>;
export type HeldHost = { engine: { world: { entities: Ents; tick?: number }; standableNearV1?: (at: [number, number], level?: number, except?: string, minClear?: number, maxRing?: number) => [number, number] | null }; model: WorldModel; minds: Map<string, { entityId: string }> };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function heldGodThing(ents: Ents, body: string): any | null {
  for (const x of Object.values(ents)) if (x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === body) return x;
  return null;
}

export function installHeld(L: EdgeLedger, h: HeldHost) {
  const ents = () => h.engine.world.entities;
  const name = (id: string) => (h.model.entities.has(id) ? h.model.pathOf(id) : String(ents()[id]?.label ?? id));
  // observe.self.holding
  const tog = (L as any).together, observe = tog.observe.bind(tog);
  // entry 41: a hand-over names the thing by its own name ("the lantern"), not its path under the body holding it
  tog.thingName = (id: string) => String(h.model.entities.get(id)?.name ?? ents()[id]?.label ?? id);
  // PC05 (#684): a shared load's identity is its placed def ref with revision (null once the thing is gone)
  tog.thingDef = (id: string) => h.model.entities.get(id)?.def ?? null;
  tog.observe = (soul: { entityId: string }) => {
    const o = observe(soul);
    if (!o.holding) { const all=ents(),gripped=all[soul.entityId]?.human?.grip?.entity; const x = heldGodThing(all, soul.entityId) ?? (typeof gripped==='string'&&all[gripped]?.tags?.includes('entity-world')?all[gripped]:null); if (x) o.holding = { id: x.id, kind: 'item', name: name(x.id) }; }
    return o;
  };
  // what a put-on / put-down is putting (the god thing in hand when it was asked for)
  const putting = new Map<string, string>(), act = L.act.bind(L);
  (L as any).act = async (soul: { soulId: string; entityId: string }, input: { capability?: unknown }) => {
    const c = typeof input?.capability === 'string' ? input.capability : '';
    if (/^(?:put|give|hand|pass|drop|set)\b/i.test(c)) { const x = heldGodThing(ents(), soul.entityId); if (x) putting.set(soul.soulId, x.id); }
    return act(soul as never, input as never);
  };
  // put it down here (the edge offers put-down:here only for its own items)
  const prev = L.worldProfile;
  L.worldProfile = (soul, caps, plans) => {
    prev?.(soul, caps, plans);
    const x = heldGodThing(ents(), soul.entityId); if (!x || caps.some((c) => c.id === 'put-down:here')) return;
    const me = ents()[soul.entityId], seated = me?.human?.activity === 'sit' || me?.human?.baseActivity === 'sit';
    // the item goes on the ground in front of the body (mars put_item: 0.55 m, further for a long thing) where it has its
    // own clear radius: face the clearest way first
    const p = me.pose.p, level = me.human?.level ?? 0, yaw0 = me.pose.yaw, ahead = groundPutDistance(x.def, me), need = Math.max(0.2, groundPutNeed(x.def));
    const clear = (yaw: number) => !!h.engine.standableNearV1?.([p[0] + Math.cos(yaw) * ahead, p[2] + Math.sin(yaw) * ahead], level, soul.entityId, need, 0);
    const face = [0, 1, -1, 2, -2, 3, -3, 4].map((k) => yaw0 + (k * Math.PI) / 4).find(clear);
    const label = `Put ${name(x.id)} down on the ground here`;
    caps.push({ id: 'put-down:here', verb: 'put-down', label, target: { id: x.id, kind: 'item' }, available: face !== undefined,
      ...(face === undefined ? { blocked: { code: 'item.no-room', reason: 'No clear ground around you to put it on; step somewhere more open first.' } } : {}) });
    if (face !== undefined) plans.set('put-down:here', { label, steps: [...(seated ? [{ verb: 'stand', params: {} }] : []),
      ...(face !== yaw0 ? [{ verb: 'mars:walk_to', params: { x: p[0], z: p[2], level, face: Math.atan2(Math.sin(face), Math.cos(face)) } }] : []),
      { verb: 'mars:put_item', params: { item: x.id, surfaceSlot: 'ground' } }] });
  };
  // These wrappers add only put/give offers; existing walks are unchanged.
  L.registerExactWalkProfile(L.worldProfile!,prev);
  // E-life (quality case 35): hand a god-built thing to someone near: walk up to them and set it down at their feet for
  // them to pick up (the engine has no hand-to-hand transfer); they hear of it. Offered where the edge offers no give.
  const prev2 = L.worldProfile;
  L.worldProfile = (soul, caps, plans) => {
    prev2?.(soul, caps, plans);
    const x = heldGodThing(ents(), soul.entityId); if (!x) return;
    const me = ents()[soul.entityId], seated = me?.human?.activity === 'sit' || me?.human?.baseActivity === 'sit';
    for (const o of L.perceivedBodies(soul.soulId, 20)) {
      const id = `give:${o.soulId}`; if (caps.some((c) => c.id === id)) continue;
      const label = `Hand ${name(x.id)} to ${o.name}: walk up and set it down at their feet for them to pick up`;
      caps.push({ id, verb: 'give', label, target: { id: o.soulId, kind: 'soul' }, available: true });
      plans.set(id, { label, steps: [...(seated ? [{ verb: 'stand', params: {} }] : []), { verb: 'walk_to', params: { to: o.entityId, standoff: 1.2 } }, { verb: 'mars:put_item', params: { item: x.id, surfaceSlot: 'ground' } }] });
    }
  };
  L.registerExactWalkProfile(L.worldProfile!,prev2);
  // receipts: what changed
  const outcomes = (L as any).outcomes, terminal = outcomes.terminal.bind(outcomes);
  outcomes.terminal = (receipt: any, snapshot: any, effects: any = {}) => {
    const [kind, target] = String(receipt.capability ?? '').split(':');
    // entry 41: a hand-over (the together ledger's invitation) says who holds the thing now, on both sides
    if (receipt.phase === 'completed' && (kind === 'give' || kind === 'accept') && !outcomes.read(receipt.id)) {
      const inv = tog.inviteForReceipt?.(receipt.id), thing = inv?.what === 'hand-over' ? inv.thing : undefined, x = thing ? ents()[thing.id] : undefined;
      const by = x?.support?.kind === 'in-hand' ? x.support.by : undefined, ctx = outcomes.context(receipt.id);
      if (thing && by && ctx) {
        putting.delete(ctx.soulId);
        const giver = inv.host.name, taker = inv.guests[0]?.name ?? 'them', mine = h.minds.get(ctx.soulId)?.entityId === by;
        const summary = kind === 'give' ? `Gave the ${thing.name} to ${taker}; it is in ${taker}'s hand now.` : `Took the ${thing.name} from ${giver}; you are holding it.`;
        return terminal(receipt, snapshot, { ...effects, summary, changed: [...(effects.changed ?? []), { id: thing.id, kind: mine ? 'item-held' : 'item-given', summary: mine ? `The ${thing.name} is in your hand.` : `The ${thing.name} is in ${taker}'s hand.`, source: `item:${thing.id}:${mine ? 'held' : 'given'}` }] });
      }
    }
    if (receipt.phase !== 'completed' || !['pick-up', 'put-on', 'put-down', 'give', 'carry'].includes(kind) || outcomes.read(receipt.id)) return terminal(receipt, snapshot, effects);
    if (kind === 'give' && !putting.has(outcomes.context(receipt.id)?.soulId ?? '')) return terminal(receipt, snapshot, effects);   // an edge item's give
    const ctx = outcomes.context(receipt.id), body = ctx ? h.minds.get(ctx.soulId)?.entityId : undefined;
    if (!body) return terminal(receipt, snapshot, effects);
    let eff = effects;
    if (kind === 'pick-up') {
      const x = heldGodThing(ents(), body);
      if (x && (!h.model.entities.has(target) || x.id === target)) eff = { ...effects, summary: `Picked up ${name(x.id)}; you are holding it.`,
        changed: [...(effects.changed ?? []), { id: x.id, kind: 'item-held', summary: `${name(x.id)} is in your hand.`, source: `item:${x.id}:held` }], detail: { ...(effects.detail ?? {}), holding: { id: x.id, name: name(x.id) } } };
    } else if(kind==='carry') {
      const x=ents()[target];
      const place=x&&L.places.containing(x.pose.p[0],x.pose.p[2],0).find(p=>p.parent!==null),where=place?` in ${place.name}`:'';
      if(x?.support?.kind==='ground'&&x.phase!=='carried')eff={...effects,summary:`Carried ${name(target)}${x.kind==='component'?'':' upright'} and ${x.kind==='component'?'laid it':'set it down'} on the ground${where}; your hands are free.`,changed:[...(effects.changed??[]),{id:target,kind:'item-placed',summary:`${name(target)} is on the ground${where} at (${x.pose.p[0].toFixed(1)}, ${x.pose.p[2].toFixed(1)}).`,source:`item:${target}:placed`}],detail:{...(effects.detail??{}),placed:{id:target,name:name(target),at:[...x.pose.p],...(place?{place:{id:place.id,name:place.name}}:{})}}};
    } else {
      const id = putting.get(ctx.soulId), x = id ? ents()[id] : undefined;
      if (x && !(x.support?.kind === 'in-hand' && x.support.by === body)) {
        const where = x.support?.kind === 'resting-on' ? `on ${name(x.support.on)}` : 'on the ground';
        if (kind === 'give') {
          const to = h.minds.get(target), toName = (to as { name?: string } | undefined)?.name ?? 'them';
          try { (L.comms as any)?.streams?.deliver?.(target, 'world.notice', h.engine.world.tick ?? 0, { text: `${(h.minds.get(ctx.soulId) as { name?: string } | undefined)?.name ?? 'Someone'} set ${name(x.id)} down at your feet for you: pick-up:${x.id}.` }); } catch { /* notices are best effort */ }
          eff = { ...effects, summary: `Set ${name(x.id)} down at ${toName}'s feet for them to pick up (pick-up:${x.id}); it is not in their hand until they do.`, changed: [...(effects.changed ?? []), { id: x.id, kind: 'item-placed', summary: `${name(x.id)} is on the ground by ${toName}.`, source: `item:${x.id}:placed` }] };
          putting.delete(ctx.soulId); return terminal(receipt, snapshot, eff);
        }
        eff = { ...effects, summary: `Put ${name(x.id)} down ${where}.`, changed: [...(effects.changed ?? []), { id: x.id, kind: 'item-placed', summary: `${name(x.id)} is ${where}; your hands are free.`, source: `item:${x.id}:placed` }] };
      }
      putting.delete(ctx.soulId);
    }
    return terminal(receipt, snapshot, eff);
  };
}
