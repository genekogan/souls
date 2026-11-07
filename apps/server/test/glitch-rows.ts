import type { Db } from '../src/db.ts';
/** The glitch records a world has written, oldest first. */
export const rowsOf = (db: Db) => (db.db.prepare('SELECT at, tick, rung, rule, bodies, evidence FROM glitches_v1 ORDER BY id').all() as { at: number; tick: number; rung: string; rule: string; bodies: string; evidence: string }[])
  .map(r => ({ ...r, bodies: JSON.parse(r.bodies) as string[], evidence: JSON.parse(r.evidence) as Record<string, unknown> }));
