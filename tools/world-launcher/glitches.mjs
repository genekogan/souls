// #1150: the records a world keeps of its recoveries and halts (apps/server/src/glitch.ts), read from its store, so a
// sleeping or exited world answers too. Loopback only: the evidence names bodies and Souls.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** { total, byRule: { rule: { rung: n } }, last, records: newest first, up to `limit` }; null with no store or no table yet. */
export function readGlitches(file, { limit = 0 } = {}) {
  if (!existsSync(file)) return null;
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const out = { total: 0, byRule: {}, last: null };
    for (const r of db.prepare('SELECT rule, rung, COUNT(*) AS n, MAX(at) AS last FROM glitches_v1 GROUP BY rule, rung ORDER BY rule, rung').all()) {
      out.total += r.n; (out.byRule[r.rule] ??= {})[r.rung] = r.n;
      if (out.last === null || r.last > out.last) out.last = r.last;
    }
    if (out.last !== null) out.last = new Date(out.last).toISOString();
    if (limit > 0) out.records = db.prepare('SELECT at, tick, rung, rule, bodies, evidence FROM glitches_v1 ORDER BY id DESC LIMIT ?').all(limit)
      .map((r) => ({ at: new Date(r.at).toISOString(), tick: r.tick, rung: r.rung, rule: r.rule, bodies: JSON.parse(r.bodies), evidence: JSON.parse(r.evidence) }));
    return out;
  } catch { return null; /* busy, or a store from before the table */ } finally { try { db?.close(); } catch { /* closed */ } }
}
