// A world's model budget, reserved before each live seat turn (#1098). The repo rule is at most $1 per world per rolling
// 24 h, reserved before each provider call. Before a turn the seat reserves its worst case: the turn's own CLI cap
// (`--max-budget-usd`, which the CLI checks after each API call) plus the worst single call that can land past that cap,
// sized as an uncached Sonnet call at the largest context and output a seat turn is allowed. A turn whose worst case
// would take the world past the cap on what is already spent is refused before any call; one that only collides with
// another seat's turn in flight waits for it to settle. After the turn the reservation is settled with its real cost.
// The ledger is <runDir>/budget.jsonl (or rails.worldBudgetFile for a world shared by several runs). It is read back when
// the run starts, so a restart or a second run on the same world counts what was spent in the last 24 h.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Sonnet list prices per million tokens. An uncached input token is written to the 1-hour prompt cache by Claude Code
// (cacheCreationEphemeral1hInputTokens), which costs twice the base input price.
export const SONNET_USD_PER_MTOK = Object.freeze({ uncachedInput: 6, output: 15 });
export const WORLD_BUDGET_DEFAULTS = Object.freeze({ capUsd: 0.90, turnCapUsd: 0.20, maxContextTokens: 60_000, maxOutputTokens: 4_096 });
const DAY_MS = 24 * 3600 * 1000;
const ledgers = new Map();
const round = (x) => Math.round(x * 1e6) / 1e6;

/** The worst single call past a turn's CLI cap: every context token uncached, plus the most output a call may write. */
export function worstCallUsd({ maxContextTokens, maxOutputTokens } = WORLD_BUDGET_DEFAULTS, price = SONNET_USD_PER_MTOK) {
  return round((maxContextTokens * price.uncachedInput + maxOutputTokens * price.output) / 1e6);
}

/** Spend already recorded in a ledger file within the last 24 h: settled costs, plus reservations never settled (a crash). */
function priorSpend(file, now) {
  if (!existsSync(file)) return { spentUsd: 0, rows: 0 };
  const open = new Map(); let spent = 0, rows = 0;
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (now - Date.parse(r.t ?? 0) > DAY_MS) continue;
    rows += 1; const key = `${r.run ?? ''}:${r.id}`;
    if (r.kind === 'reserved') open.set(key, r.usd ?? 0);
    if (r.kind === 'settled') { open.delete(key); spent += r.costUsd ?? r.usd ?? 0; }
  }
  for (const usd of open.values()) spent += usd;   // reserved and never settled: count the whole worst case
  return { spentUsd: round(spent), rows };
}

/** The world's shared ledger: {capUsd, turnCapUsd, reserveUsd, spentUsd, reservedUsd, reserve(seat) → Promise, settle(r, costUsd), view()}. */
export function worldBudgetFor(runDir, { capUsd, turnCapUsd, maxContextTokens, maxOutputTokens, file = null, now = Date.now } = {}) {
  const path = resolve(file ?? join(runDir, 'budget.jsonl'));
  if (ledgers.has(path)) return ledgers.get(path);
  const k = { ...WORLD_BUDGET_DEFAULTS };
  for (const [key, v] of Object.entries({ capUsd, turnCapUsd, maxContextTokens, maxOutputTokens })) if (v != null) k[key] = v;
  if (!(k.capUsd > 0 && k.capUsd <= 1)) throw new Error(`world budget cap must be in (0, 1] USD: ${k.capUsd}`);   // never above the repo's $1 per world
  const run = resolve(runDir), write = (row) => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ t: new Date(now()).toISOString(), run, ...row }) + '\n'); } catch { /* the ledger itself decides */ } };
  const prior = priorSpend(path, now());
  let spent = prior.spentUsd, reserved = 0, n = 0, broken = null; const waiting = [];
  const marginUsd = worstCallUsd(k), reserveUsd = round(k.turnCapUsd + marginUsd);
  write({ kind: 'opened', capUsd: k.capUsd, turnCapUsd: k.turnCapUsd, marginUsd, reserveUsd, priorSpentUsd: prior.spentUsd, priorRows: prior.rows });
  const wake = () => { while (waiting.length && spent + reserved + reserveUsd <= k.capUsd + 1e-9) waiting.shift()(); };
  const ledger = {
    capUsd: k.capUsd, turnCapUsd: k.turnCapUsd, marginUsd, reserveUsd, maxOutputTokens: k.maxOutputTokens, file: path,
    get spentUsd() { return round(spent); }, get reservedUsd() { return round(reserved); },
    /** Reserve one turn's worst case for `seat`: {ok:true, id, usd}, or {ok:false, reason} when what is spent leaves no room. */
    async reserve(seat) {
      const refuse = () => { const reason = `world budget: spent $${round(spent)} + this turn's worst case $${reserveUsd} would pass $${k.capUsd}`;
        write({ kind: 'refused', seat, usd: reserveUsd, spentUsd: round(spent), reservedUsd: round(reserved), reason }); return { ok: false, reason }; };
      if (broken) { write({ kind: 'refused', seat, usd: reserveUsd, reason: broken }); return { ok: false, reason: broken }; }
      if (spent + reserveUsd > k.capUsd + 1e-9) return refuse();
      if (spent + reserved + reserveUsd > k.capUsd + 1e-9) {   // another turn in flight holds the room: wait for it to settle
        write({ kind: 'waiting', seat, usd: reserveUsd, spentUsd: round(spent), reservedUsd: round(reserved) });
        await new Promise((go) => waiting.push(go));
        if (spent + reserveUsd > k.capUsd + 1e-9) return refuse();
      }
      reserved += reserveUsd; const id = ++n;
      write({ kind: 'reserved', id, seat, usd: reserveUsd, spentUsd: round(spent), reservedUsd: round(reserved) });
      return { ok: true, id, seat, usd: reserveUsd };
    },
    /** Settle a reservation with the turn's cost (an unknown cost counts as the whole reservation). */
    settle(r, costUsd) {
      if (!r?.ok || r.settled) return; r.settled = true;
      const cost = Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : r.usd;
      reserved = Math.max(0, reserved - r.usd); spent += cost;
      write({ kind: 'settled', id: r.id, seat: r.seat, usd: r.usd, costUsd: round(cost), known: Number.isFinite(costUsd), overReservation: cost > r.usd, spentUsd: round(spent), reservedUsd: round(reserved) });
      wake();
    },
    /** A turn showed a call larger than the worst case the margin was sized for: refuse every later turn in this world. */
    exceeded(seat, what) { broken ??= `world budget: ${seat}'s turn exceeded the sized worst case (${what}); no further turns`; write({ kind: 'exceeded', seat, what }); wake(); },
    maxContextTokens: k.maxContextTokens,
    view: () => ({ capUsd: k.capUsd, turnCapUsd: k.turnCapUsd, marginUsd, reserveUsd, spentUsd: round(spent), reservedUsd: round(reserved), priorSpentUsd: prior.spentUsd }),
  };
  ledgers.set(path, ledger);
  return ledger;
}
