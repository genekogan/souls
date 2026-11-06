// A run's model budget, reserved before each live seat turn (#1098). The repo rule is at most $1 per world per rolling
// 24 h, reserved before each provider call; a run is one world. Before a turn the seat reserves its worst case (the turn's
// own CLI cap plus a margin for the one API call that can land past it); the turn is refused when what is spent plus
// what is reserved would pass the cap. After the turn the reservation is settled with what the turn actually cost.
// One ledger per run folder in this process, written to <runDir>/budget.jsonl as it changes.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const WORLD_BUDGET_DEFAULTS = Object.freeze({ capUsd: 0.90, turnCapUsd: 0.20, overshootUsd: 0.05 });
const ledgers = new Map();

/** The run's shared ledger: {capUsd, turnCapUsd, reserveUsd, spentUsd, reservedUsd, reserve(seat), settle(r, costUsd), view()}. */
export function worldBudgetFor(runDir, { capUsd, turnCapUsd, overshootUsd } = {}) {
  const key = resolve(runDir);
  if (ledgers.has(key)) return ledgers.get(key);
  const k = { ...WORLD_BUDGET_DEFAULTS, ...(capUsd != null ? { capUsd } : {}), ...(turnCapUsd != null ? { turnCapUsd } : {}), ...(overshootUsd != null ? { overshootUsd } : {}) };
  if (!(k.capUsd > 0 && k.capUsd <= 1)) throw new Error(`world budget cap must be in (0, 1] USD: ${k.capUsd}`);   // never above the repo's $1 per world
  const file = join(key, 'budget.jsonl');
  const write = (row) => { try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...row }) + '\n'); } catch { /* the ledger itself decides */ } };
  let spent = 0, reserved = 0, n = 0;
  const round = (x) => Math.round(x * 1e6) / 1e6;
  const ledger = {
    capUsd: k.capUsd, turnCapUsd: k.turnCapUsd, reserveUsd: round(k.turnCapUsd + k.overshootUsd),
    get spentUsd() { return round(spent); }, get reservedUsd() { return round(reserved); },
    /** Reserve one turn's worst case for `seat`; {ok:true, id, usd} or {ok:false, reason}. */
    reserve(seat) {
      const usd = ledger.reserveUsd;
      if (spent + reserved + usd > k.capUsd + 1e-9) {
        const reason = `world budget: spent $${round(spent)} + reserved $${round(reserved)} + this turn's $${usd} would pass $${k.capUsd}`;
        write({ kind: 'refused', seat, usd, spentUsd: round(spent), reservedUsd: round(reserved), capUsd: k.capUsd, reason });
        return { ok: false, reason };
      }
      reserved += usd; const id = ++n;
      write({ kind: 'reserved', id, seat, usd, spentUsd: round(spent), reservedUsd: round(reserved), capUsd: k.capUsd });
      return { ok: true, id, seat, usd };
    },
    /** Settle a reservation with the turn's cost (unknown cost counts as the whole reservation). */
    settle(r, costUsd) {
      if (!r?.ok || r.settled) return; r.settled = true;
      const cost = Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : r.usd;
      reserved = Math.max(0, reserved - r.usd); spent += cost;
      write({ kind: 'settled', id: r.id, seat: r.seat, usd: r.usd, costUsd: round(cost), known: Number.isFinite(costUsd), overReservation: cost > r.usd, spentUsd: round(spent), reservedUsd: round(reserved), capUsd: k.capUsd });
    },
    view: () => ({ capUsd: k.capUsd, turnCapUsd: k.turnCapUsd, reserveUsd: ledger.reserveUsd, spentUsd: round(spent), reservedUsd: round(reserved) }),
  };
  ledgers.set(key, ledger);
  return ledger;
}
