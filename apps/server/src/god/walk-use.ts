// Lane BS3F (BUILDSAFE, 2026-10-21): the use-check the walk audit scores, behind one function. Lane BS1 owns the real check
// (engine.useCheckV1: every seat and bed reachable AND usable, sit/lie as the sit plan does it); until that lands on main,
// useCheckFor falls back to the part of it the engine already answers: a seat or bed with no approach at all (a Soul sent
// there has nowhere to stand; navTargetsV1 skips such slots, so the walk audit never saw them) or an approach not walkable
// both ways from the main ground (connectivityV1, as the walk audit's seat:/berth: destinations).
import { fixtureSlots, seatApproach } from '../../../../mars/viewer/engine/social/slots.ts';
import { spatialFixtureIdsV1 } from '@souls/engine-mars';

/** BS1's useCheckV1 row (t4-bs1.md "API"). */
export type UseVerdict = { id: string; of: string; kind: 'seat' | 'berth'; level: number; ok: boolean; code?: string; message?: string; at?: [number, number] };

/** Every seat/berth slot of the fixtures `keep` accepts (by position), with whether a Soul can use it. */
export function useCheckFor(engine: any, keep?: (xz: [number, number]) => boolean): UseVerdict[] {
  if (typeof engine.useCheckV1 === 'function') return engine.useCheckV1({ keep });
  return stubUseCheck(engine, keep);
}

function stubUseCheck(engine: any, keep?: (xz: [number, number]) => boolean): UseVerdict[] {
  const rt = engine.rt, w = rt.world, out: UseVerdict[] = [], pending: { v: UseVerdict; p: [number, number] }[] = [];
  for (const id of spatialFixtureIdsV1(w.entities)) {
    const e = w.entities[id];
    if ((keep && !keep([e.pose.p[0], e.pose.p[2]]))) continue;
    for (const slot of fixtureSlots(rt, e)) {
      if (slot.kind !== 'seat' && slot.kind !== 'berth') continue;
      const v: UseVerdict = { id: slot.id, of: id, kind: slot.kind, level: slot.level ?? 0, ok: true };
      const a = seatApproach(rt, slot);
      out.push(v);
      if (!Array.isArray(a)) { Object.assign(v, { ok: false, code: 'use.no-approach', message: (a as any)?.message ?? (a as any)?.code }); continue; }
      v.at = [a[0], a[1]]; pending.push({ v, p: v.at });
    }
  }
  const verdicts = engine.navCheckV1(pending.map(({ v, p }) => ({ id: v.id, p, level: v.level, tol: 0.5 }))) as { id: string; ok: boolean; code?: string }[];
  const by = new Map(pending.map(({ v }) => [v.id, v]));
  for (const r of verdicts) if (!r.ok) Object.assign(by.get(r.id)!, { ok: false, code: r.code ?? 'nav.unknown' });
  return out;
}
