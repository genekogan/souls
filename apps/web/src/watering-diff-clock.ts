import type {Entity, WorldModel} from '@souls/world-compiler';

/** Entry 34: like the lamps' contact clock (light-diff-clock.ts), an engine diff that moves a watering can between a hook
 *  and a hand, changes its water, or changes a growing planter (the soil darkening, the patter of water, a stage) waits for
 *  the viewer's depicted tick, so it shows on the same frame as the hand that caused it, never ahead of it. */
export function wateringDiffAhead(model: WorldModel, message: unknown, depictedTick: number): boolean {
  const d = message as {by?: string; tick?: number; diff?: {upserts?: Entity[]}};
  if (d.by !== 'engine' || typeof d.tick !== 'number' || !Number.isFinite(d.tick) || d.tick <= depictedTick) return false;
  return !!d.diff?.upserts?.some((e) => {
    const before = model.entities.get(e.id), def = model.resolvedDef(e.def) as {slots?: {kind: string}[]; state?: Record<string, {type?: string}>} | undefined;
    if (!before || !def) return false;
    const can = !!def.slots?.some((s) => s.kind === 'carry'), growing = def.state?.growth?.type === 'number';
    // entry 43: a kettle's switch contact (heatTick) and a cup's tea wait the same way (the steam and the tea never show
    // ahead of the hand that pressed or poured)
    if (can) return before.in.parent !== e.in.parent || before.state?.level !== e.state?.level || before.state?.heatTick !== e.state?.heatTick;
    // entry 44: a sip (tea) and a rinse (tea, brewedTick, bag) wait the same way: the tea falls with the mug at the lips
    if ((def.state as Record<string, unknown> | undefined)?.tea) return before.state?.tea !== e.state?.tea || before.state?.brewedTick !== e.state?.brewedTick || before.state?.bag !== e.state?.bag;
    return growing && JSON.stringify(before.state ?? {}) !== JSON.stringify(e.state ?? {});
  });
}
