// metrics.json (spec §12.5): objective measures with units and a named basis, from evidence, turns, cost, shots
// index, healthz, oracles and the ledger. Pure: computeMetrics(run, {ledger, oracles, emergence}).
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readJson, readJsonl, writeJson } from '../lib/jsonl.mjs';
import { loadRun, secsBetween, xz } from './run.mjs';
import { runOracles } from './oracles.mjs';

export const ACK_CHAR_BOUND = 140;
const stats = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return { n: 0, median: null, p90: null, max: null, mean: null }; const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; return { n: v.length, median: mid, p90: q(0.9), max: v.at(-1), mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 }; };
const count = (rows, id, status = 'fail') => rows.filter((r) => r.id === id && r.status === status).length;

export function readLedger(file) {
  if (!existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split('\n'); const cols = head.split('\t');
  return rows.filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])));
}

const tok = (row, u, k, alt) => row?.[k] ?? u?.[k] ?? u?.[alt] ?? null;
/** Join seat turns to requests: a turn serves every request of its seat whose window (sentAt..cutoffAt) it overlaps
 *  (startedAt..endedAt), plus the request(s) it is linked to in chatTurns. Tokens and CLI calls of a turn are split evenly
 *  over the requests it served. → Map(requestId → {turns, input, cached, output, calls}). */
export function joinTurns(run) {
  const per = new Map(run.evidence.map((e) => [e.requestId, { turns: 0, input: 0, cached: 0, output: 0, calls: 0, priced: 0 }]));
  for (const [seat, s] of Object.entries(run.seats ?? {})) {
    const costBy = new Map((s.cost ?? []).map((c) => [c.turn, c]));
    const reqs = run.evidence.filter((e) => e.seat === seat);
    for (const t of s.turns ?? []) {
      if (t.reason?.startsWith('onboard')) continue;
      const a = Date.parse(t.startedAt), b = Date.parse(t.endedAt ?? t.startedAt);
      const served = reqs.filter((e) => (e.chatTurns ?? []).includes(t.turn) || (Number.isFinite(a) && a < (Date.parse(e.cutoffAt) || Infinity) && b > Date.parse(e.sentAt)));
      if (!served.length) continue;
      const c = costBy.get(t.turn), u = t.usage ?? {}, k = served.length;
      const vals = { input: tok(c, u, 'inputTokens', 'input_tokens'), cached: tok(c, u, 'cachedTokens', 'cache_read_input_tokens'), output: tok(c, u, 'outputTokens', 'output_tokens') };
      const calls = (t.toolCalls ?? []).filter((x) => /eden(-agent|-god)?\.mjs/.test(x.cmd)).length;
      for (const e of served) { const r = per.get(e.requestId); r.turns += 1; r.calls += calls / k; for (const [key, v] of Object.entries(vals)) if (v != null) { r[key] += v / k; } if (vals.output != null) r.priced += 1; }
    }
  }
  return per;
}
/** Seconds a chat request waited for the seat's running turn: recorded queuedSec, else its linked turn's start. */
export const chatQueuedSec = (run, e) => { if (Number.isFinite(e.queuedSec)) return e.queuedSec; const t = (run.seats?.[e.seat]?.turns ?? []).find((x) => (e.chatTurns ?? []).includes(x.turn)); return t ? Math.max(0, Math.round((Date.parse(t.startedAt) - Date.parse(e.sentAt)) / 100) / 10) : null; };

export function computeMetrics(run, { ledger = [], oracles = null, emergence = null } = {}) {
  const ors = oracles ?? run.evidence.flatMap((ev) => runOracles(ev, { run }));
  const ev = run.evidence;
  const cardEv = ev.filter((e) => e.channel === 'card');
  // walk speed: displacement per second while a walk receipt was in progress, timely samples only
  const speeds = ev.flatMap((e) => (e.receipts ?? []).filter((r) => /^(go|walk|visit|goto|stroll)[:.]/i.test(r.capability ?? '')).map((r) => { const a = Date.parse(r.startedAt), b = Math.min(Date.parse(r.endedAt ?? e.cutoffAt), Date.parse(e.cutoffAt)); const s = (e.samples ?? []).filter((x) => Date.parse(x.t) >= a && Date.parse(x.t) <= b && x.pos); if (s.length < 2) return null; let L = 0; for (let i = 1; i < s.length; i++) { const p = xz(s[i - 1].pos), q = xz(s[i].pos); L += Math.hypot(q[0] - p[0], q[1] - p[1]); } return L / ((Date.parse(s.at(-1).t) - Date.parse(s[0].t)) / 1000); }).filter((x) => x != null));
  const allTurns = Object.entries(run.seats).flatMap(([id, s]) => s.turns.map((t) => ({ ...t, seat: id })));
  const joined = joinTurns(run); const J = (e) => joined.get(e.requestId);
  const r0 = (v) => (v == null ? null : Math.round(v));
  const pres = ev.flatMap((e) => (e.legible ?? []).map((l) => l.card?.presence).filter(Boolean));
  const costRows = Object.values(run.seats).flatMap((s) => s.cost);
  const durH = (run.scenario?.durationSec ?? 0) / 3600;
  const sum = (k) => costRows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const fid = { H: 0, P: 0, M: 0, W: 0, unresolved: 0 }; const cls = {};
  ledger.forEach((r) => { fid[r.fidelity] = (fid[r.fidelity] ?? 0) + 1; if (r.class) cls[r.class] = (cls[r.class] ?? 0) + 1; });
  const truth = ors.filter((r) => r.id === 'truthfulness-basic' && r.status !== 'unscorable'); // H-a/H-f: neither pass nor fail
  const unscorable = (why) => new Set(ors.filter((r) => r.unscorable === why).map((r) => r.requestId)).size;
  const sampleSec = run.scenario?.observer?.sampleSec ?? 5; const cams = run.scenario?.observer?.cameras?.length ?? 1; const seatsN = (run.scenario?.seats?.length ?? 1) + (run.scenario?.god ? 1 : 0);
  const shotsPlanned = Math.floor((run.scenario?.durationSec ?? 0) / sampleSec) * (cams === 1 ? seatsN : seatsN + cams - 1);
  const lateness = ev.flatMap((e) => { const s = (e.samples ?? []).map((x) => Date.parse(x.t)); return s.slice(1).map((t, i) => (t - s[i]) / 1000 - sampleSec).filter((d) => d > sampleSec * 0.5); });
  const disagreements = existsSync(join(run.runDir, 'coordinator-ledger.tsv')) ? (() => { const c = readLedger(join(run.runDir, 'coordinator-ledger.tsv')); return c.filter((x) => ledger.find((r) => r.requestId === x.requestId && r.fidelity !== x.fidelity)).length; })() : null;
  // Basics scorecard (Gene 2026-10-25): plain walking and acting must work before anything subjective is scored.
  const WALKREQ = /\b(walk|go|come|head|run|stroll)\b/i;
  const walkReqs = ev.filter((e) => WALKREQ.test(e.text ?? ''));
  const oracleFor = (e, id) => ors.find((r) => r.requestId === e.requestId && r.id === id);
  const arrived = walkReqs.filter((e) => oracleFor(e, 'arrival')?.status === 'pass').length;
  const arrivalKnown = walkReqs.filter((e) => ['pass', 'fail'].includes(oracleFor(e, 'arrival')?.status)).length;
  // The budget clock starts when the turn that carried the request started (budgetStartAt; chat queued behind a running turn).
  const startedInBudget = ev.filter((e) => e.firstBodyChangeAt && (!e.budgetSec || secsBetween(e.budgetStartAt ?? e.sentAt, e.firstBodyChangeAt) <= e.budgetSec)).length;
  const basics = {
    requests: ev.length, walkRequests: walkReqs.length, walksArrived: arrived, walksArrivalKnown: arrivalKnown,
    walkArrivalRate: arrivalKnown ? arrived / arrivalKnown : null,
    bodyMovedInBudget: startedInBudget, bodyMovedRate: ev.length ? startedInBudget / ev.length : null,
    ackMedianSec: stats(cardEv.map((e) => secsBetween(e.sentAt, e.ackAt))).median,
    firstBodyChangeMedianSec: stats(ev.map((e) => secsBetween(e.sentAt, e.firstBodyChangeAt))).median,
    stuck: count(ors, 'stuck-receipt') + count(ors, 'no-progress'), insideSolid: count(ors, 'inside-solid'), oscillations: count(ors, 'oscillation'),
    wrong: fid.W, hits: fid.H,
    basis: 'walk requests by verb in the owner text; arrival from the arrival oracle (unknown excluded); body moved = first visible body change inside the request budget',
  };
  return {
    version: 2, scenario: run.scenario?.name ?? null, requests: ev.length, basics,
    speed: {
      ackSec: stats(cardEv.map((e) => secsBetween(e.sentAt, e.ackAt))), firstBodyChangeSec: stats(ev.map((e) => secsBetween(e.sentAt, e.firstBodyChangeAt))), resultSec: stats(ev.map((e) => secsBetween(e.sentAt, e.resultAt))),
      chatQueuedSec: stats(ev.filter((e) => e.channel === 'chat').map((e) => chatQueuedSec(run, e))),
      walkMps: stats(speeds), wallVsBudget: stats(ev.map((e) => (e.budgetSec ? secsBetween(e.sentAt, e.cutoffAt) / e.budgetSec : null))),
      basis: 'seconds from the owner message (sentAt); ack = card ack only; resultSec = latest observed card result, including server progress, not overall journey completion (use journey physicalCompleteAt/completionClaimAt); chatQueuedSec = sentAt to the start of the seat turn that carried a chat message (Claude Code queues typed messages behind a running turn); walk m/s = sampled displacement during walk receipts',
    },
    uptime: {
      listenOpenFraction: pres.length ? pres.filter((p) => /listening|working/i.test(p)).length / pres.length : null, unackedAtCutoff: cardEv.filter((e) => !e.ackAt || Date.parse(e.ackAt) > Date.parse(e.cutoffAt)).length,
      serverErrors: ev.reduce((a, e) => a + (e.serverErrors ?? 0), 0), seatCrashes: allTurns.filter((t) => t.exit !== 0 && t.exit != null).length, seatTimeouts: allTurns.filter((t) => t.timedOut).length,
      healthzBefore: run.healthz.before?.ok ?? null, healthzAfter: run.healthz.after?.ok ?? null,
      tickRate: (() => { const s = ev.flatMap((e) => e.samples ?? []).filter((x) => x.tick != null).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)); return s.length > 1 ? Math.round(((s.at(-1).tick - s[0].tick) / ((Date.parse(s.at(-1).t) - Date.parse(s[0].t)) / 1000)) * 100) / 100 : null; })(),
      unscorableStalled: unscorable('stalled'), unscorableTruncated: unscorable('truncated'),
      basis: 'presence from the rendered card; crashes = seat turns with non-zero exit; tickRate = ticks per second over all samples; unscorable* = request windows below 15 ticks/s (world stalled) or cut short by the run end or a quota stop before their budget (truncated), whose oracle rows are unscorable',
    },
    cost: {
      tokensTotal: { input: sum('inputTokens'), cached: sum('cachedTokens'), output: sum('outputTokens') },
      tokensPerHour: durH ? { input: Math.round(sum('inputTokens') / durH), output: Math.round(sum('outputTokens') / durH) } : null,
      tokensPerRequest: { input: stats(ev.map((e) => (J(e).priced ? r0(J(e).input) : null))).median, output: stats(ev.map((e) => (J(e).priced ? r0(J(e).output) : null))).median, cached: stats(ev.map((e) => (J(e).priced ? r0(J(e).cached) : null))).median },
      outputTokensPerRequest: stats(ev.map((e) => (J(e).priced ? r0(J(e).output) : null))),
      turnsPerRequest: stats(ev.map((e) => J(e).turns)), cardTurnsPerRequest: stats(cardEv.map((e) => J(e).turns)),
      cliCallsPerRequest: stats(ev.map((e) => Math.round(J(e).calls * 10) / 10)),
      ackChars: stats(ev.map((e) => e.ackText?.length)), resultChars: stats(ev.map((e) => e.resultText?.length)), acksOverBound: ev.filter((e) => (e.ackText?.length ?? 0) > ACK_CHAR_BOUND).length, ackBoundChars: ACK_CHAR_BOUND,
      chatReplyChars: stats(allTurns.filter((t) => t.reason === 'chat').map((t) => t.finalText?.length)),
      basis: 'cost.jsonl per seat turn; a turn serves the requests whose window (sentAt..cutoffAt) it overlaps or that it carried (chatTurns); its tokens and CLI calls are split evenly over them; requests served by no turn count 0 turns and no tokens',
    },
    journeys: { rows: ors.filter(r => r.id.startsWith('journey-')), basis: 'ordered frozen geometry/posture predicates and exact receipt target IDs; unknown is never a pass' },
    fidelity: { counts: fid, wrong: fid.W, classes: cls, hitRate: ledger.length ? fid.H / ledger.length : null, truthfulnessPassRate: truth.length ? truth.filter((r) => r.status === 'pass').length / truth.length : null, vocabularyMisses: count(ors, 'vocabulary'), vetoed: ledger.filter((r) => r.vetoed).length, basis: 'ledger.tsv (Reviewer, oracle-vetoed); P never counts as H' },
    physical: { insideSolid: count(ors, 'inside-solid'), noProgress: count(ors, 'no-progress'), stuckReceipts: count(ors, 'stuck-receipt'), oscillations: count(ors, 'oscillation'), basis: 'oracle fails per request' },
    emergence: emergence?.metric ? { coLocationRatio: emergence.metric.coLocation?.ratio ?? null, conversations: emergence.metric.conversations?.started ?? 0, unpromptedShared: emergence.metric.sharedActivities?.unprompted ?? 0, imitation: emergence.metric.imitationWithin2min ?? 0, meanActivityEntropyBits: emergence.metric.individuality?.meanActivityEntropyBits ?? null, chainsGe2: emergence.metric.chainsGe2 ?? 0, storyRating: emergence.narrative?.storyRating ?? null, o5Count: emergence.narrative?.o5Count ?? null } : null,
    harness: { shotsTaken: run.shotsIndex.length, shotsPlanned, lateSamples: lateness.length, packsWithUnknowns: ev.filter((e) => ors.some((r) => r.requestId === e.requestId && r.status === 'unknown')).length, reviewerCoordinatorDisagreements: disagreements, reviewerLeaks: ledger.filter((r) => r.leaked === 'true' || r.leaked === true).length },
  };
}

export function metricsRun(runDir) {
  const run = loadRun(runDir);
  const m = computeMetrics(run, { ledger: readLedger(join(runDir, 'ledger.tsv')), oracles: readJsonl(join(runDir, 'oracles.jsonl')).length ? readJsonl(join(runDir, 'oracles.jsonl')) : null, emergence: readJson(join(runDir, 'emergence.json'), null) });
  m.journeys.setup = readJsonl(join(runDir, 'fixture-setup.jsonl'));
  m.journeys.infrastructureInvalid = readJsonl(join(runDir, 'infrastructure-invalid.jsonl'));
  writeJson(join(runDir, 'metrics.json'), m);
  return m;
}
