// #1150: what a broken rule did to a world, kept so root causes get fixed rather than hidden and production's rate can be
// measured. One record per refusal, recovery and halt. Records are operations data, outside the event log: replay never reads
// them, no state hash covers them, and a halted host may still write them (its log and clock frontier stay frozen, #1120).
export type GlitchRung = 'refusal' | 'recovery' | 'halt';
export type GlitchRecordV1 = {rung: GlitchRung; rule: string; bodies: string[]; tick: number; at: number; evidence: Record<string, unknown>};
/** Public on the world's /healthz, so rule names and numbers only. */
export type GlitchCountsV1 = {total: number; byRule: Record<string, Partial<Record<GlitchRung, number>>>};

// A rule name is the engine's violation code. Anything else (a thrown message, which can name a body) is not a public key.
const RULE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
export const THROWN_RULE = 'engine.thrown';

/** The rule and bodies a fault names. A tick's violations arrive as a JSON list, see WorldHost.tickOnce. */
export function faultFacts(fault: unknown): {rule: string; rules: string[]; bodies: string[]} {
  let list: {code?: unknown; subjects?: unknown}[] = [];
  try { const v = JSON.parse(fault instanceof Error ? fault.message : String(fault)); if (Array.isArray(v)) list = v; } catch { /* a thrown error */ }
  const rules = [...new Set(list.map(v => v?.code).filter((c): c is string => typeof c === 'string' && RULE.test(c)))];
  const bodies = [...new Set(list.flatMap(v => Array.isArray(v?.subjects) ? v.subjects.filter((s): s is string => typeof s === 'string') : []))].sort();
  return {rule: rules[0] ?? THROWN_RULE, rules, bodies};
}

export function countGlitch(counts: GlitchCountsV1, rule: string, rung: GlitchRung, n = 1): void {
  counts.total += n;
  const by = counts.byRule[rule] ??= {};
  by[rung] = (by[rung] ?? 0) + n;
}

/** The one line in the world's log (private to the host, so it may name bodies). */
export function glitchLine(g: GlitchRecordV1): string {
  const seq = typeof g.evidence.seq === 'number' ? ` seq=${g.evidence.seq}` : '';
  return `[world] glitch rung=${g.rung} rule=${g.rule} tick=${g.tick}${seq} bodies=${g.bodies.join(',') || '-'}`;
}
