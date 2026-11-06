// The tranche scorecard over the frozen set (ROOT-CAUSES-20261025 §E): which runs are frozen, how each becomes a scripted
// replay that sends the exact original requests on the original channels, the §E measures per run, the thresholds, the
// delta against a baseline, and the "no new bugs" verdict. Pure over run folders (no model, no world).
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJson, readJsonl } from '../lib/jsonl.mjs';
import { loadRun, secsBetween, xz } from './run.mjs';
import { runOracles } from './oracles.mjs';
import { computeMetrics, joinTurns, readLedger } from './metrics.mjs';
import { fitDuration } from '../lib/schedule.mjs';

export const FROZEN = [
  { label: 'basics-1', run: '20261025-055730-basics-walk-act-1-77', kind: 'battery' },
  { label: 'basics-2', run: '20261025-071922-basics-walk-act-2-78', kind: 'battery' },
  { label: 'basics-3', run: '20261025-111032-basics-walk-act-3-79', kind: 'battery' },
  { label: 'newcomer-opus', run: '20261025-104004-newcomer-opus-1-4119', kind: 'persona' },
  { label: 'newcomer-rich', run: '20261025-124610-newcomer-rich-1-4117', kind: 'persona' },
  { label: 'trio', run: '20261025-131525-trio-social-1-9020', kind: 'persona' },
  { label: 'god-hamlet-2', run: '20261025-095620-god-hamlet-2-303', kind: 'persona' },
];
export const PHYS_IDS = ['inside-solid', 'no-progress', 'oscillation', 'stuck-receipt'];

/** Original per-request budget of a persona run: quick decisions got the quick budget; others the default (null). */
function personaBudgets(runDir, scenario) {
  const out = {};
  const quickSec = scenario.director?.budgetSec?.quick ?? 90;
  const dirs = (scenario.seats ?? []).map((s) => s.id); // god requests keep today's god default (600 s)
  for (const seat of dirs) {
    for (const f of ['decisions.jsonl', 'turns.jsonl']) for (const d of readJsonl(join(runDir, 'personas', seat, f))) {
      const rid = d.delivered?.requestId ?? d.requestId; if (!rid || out[rid] !== undefined) continue;
      out[rid] = d.decision?.quick ? quickSec : null;
    }
  }
  return out;
}

/** Scenario that replays one frozen run as a script: the original script verbatim for scripted runs, else every
 *  request of replay.json at its offset with its original channel, text and budget (god budgets use today's default). */
export function frozenScenario(runDir, { currentScenario = null } = {}) {
  const scen = readJson(join(runDir, 'scenario.json'), null); const rp = readJson(join(runDir, 'replay.json'), null);
  if (!scen || !rp) throw new Error(`${runDir}: scenario.json and replay.json are required`);
  const scripted = scen.director?.mode === 'scripted' && Array.isArray(scen.director.script);
  const budgets = scripted ? {} : personaBudgets(runDir, scen);
  const script = scripted ? scen.director.script.map((e) => ({ seat: e.seat, atSec: e.atSec, channel: e.channel ?? 'card', text: e.text, budgetSec: e.budgetSec ?? null }))
    : rp.requests.map((r) => ({ seat: r.seat, atSec: Math.max(0, Math.round(r.sendOffsetSec * 10) / 10), channel: r.channel, text: r.text, budgetSec: r.budgetSec ?? budgets[r.requestId] ?? null }));
  const natives = currentScenario?.world && 'natives' in currentScenario.world ? currentScenario.world.natives : scen.world?.natives;
  const { scenarioPath, scenarioSha256, serverRoot, ...base } = scen;
  return fitDuration({ // H-f: long enough for every replayed request to finish (durationSec only grows)
    ...base, name: `${scen.name}-frozen`, seed: rp.seed ?? scen.seed, replayOf: basename(runDir), replayMode: 'scripted',
    world: { ...scen.world, ...(natives === undefined ? {} : { natives }) },
    director: { ...(scen.director ?? {}), mode: 'scripted', sequential: true, script },
    review: { ...(scen.review ?? {}), developer: false },
  });
}

const pct = (a, b) => (b ? a / b : null);
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const nearestSample = (samples, t) => samples.reduce((best, s) => (Math.abs(Date.parse(s.t) - t) < Math.abs(Date.parse(best?.t ?? 0) - t) ? s : best), null);
const POSTURE_WORD = [['sitting', /\b(sit|sitting|seated)\b/i], ['lying', /\b(lying|lie|asleep|sleeping|napping)\b/i], ['standing', /\b(stand|standing)\b/i]];

/** §E measures for one run folder (oracles from oracles.jsonl when present, else recomputed). */
export function runMeasures(runDir) {
  const full = loadRun(runDir);
  // Seats that never paired (onboard.ok false, no soulId) had no body: their requests are not measures of the product.
  // They are listed as dead seats and left out of every denominator. Seats whose adapter was substituted (a Codex seat
  // on a box without Codex) are listed too, so a reader can see the replay was not the exact original.
  const deadSeats = Object.entries(full.seats ?? {}).filter(([id, s]) => id !== 'god' && s.seat?.kind !== 'god' && s.seat && (s.seat.onboard ? s.seat.onboard.ok === false : !s.seat.soulId)).map(([id]) => id);
  const substituted = Object.entries(full.seats ?? {}).filter(([, s]) => s.seat?.substitutedFrom).map(([id, s]) => `${id}: ${s.seat.substitutedFrom} → ${s.seat.adapter}/${s.seat.model ?? '?'}`);
  const live = (e) => !deadSeats.includes(e.seat);
  const run = deadSeats.length ? { ...full, evidence: full.evidence.filter(live) } : full;
  const liveIds = new Set(run.evidence.map((e) => e.requestId));
  const ledger = readLedger(join(runDir, 'ledger.tsv')).filter((r) => !deadSeats.includes(r.seat));
  const file = readJsonl(join(runDir, 'oracles.jsonl')).filter((r) => !r.requestId || liveIds.has(r.requestId));
  const rows = file.length ? file : run.evidence.flatMap((e) => runOracles(e, { run }));
  const m = computeMetrics(run, { ledger, oracles: rows });
  const joined = joinTurns(run);
  const of = (e, id) => rows.find((r) => r.requestId === e.requestId && r.id === id);
  const truth = rows.filter((r) => r.id === 'truthfulness-basic' && r.status !== 'unscorable'); // H-a/H-f: neither pass nor fail
  const card = run.evidence.filter((e) => e.channel === 'card' && of(e, 'result-sent')?.status !== 'unscorable');
  // "sit down" sits within 15 s of the first body change, in place (first sit request per seat)
  const sits = {};
  for (const e of run.evidence.filter((x) => /^\s*sit( down)?\s*[.!]?\s*$/i.test(x.text ?? ''))) {
    if (sits[e.seat]) continue;
    const s = (e.samples ?? []).filter((x) => Date.parse(x.t) <= Date.parse(e.cutoffAt));
    const i = s.findIndex((x) => /sit|seated/i.test(String(x.posture ?? '')));
    const fb = Date.parse(e.firstBodyChangeAt ?? '');
    const ok = i >= 0 && Number.isFinite(fb) && (Date.parse(s[i].t) - fb) / 1000 <= 15 && (!s[0]?.pos || !s[i].pos || Math.hypot(...[0, 1].map((k) => xz(s[i].pos)[k] - xz(s[0].pos)[k])) <= 3);
    sits[e.seat] = { requestId: e.requestId, ok };
  }
  const named = run.evidence.filter((e) => /\b(pavilion|kitchen)\b/i.test(e.text ?? '') && ['pass', 'fail'].includes(of(e, 'arrival')?.status));
  // card `doing` vs body posture at the nearest sample
  let agree = 0, compared = 0;
  for (const e of run.evidence) for (const l of e.legible ?? []) {
    const d = l.card?.doing; if (!d) continue; const w = POSTURE_WORD.find(([, re]) => re.test(d)); if (!w) continue;
    const s = nearestSample(e.samples ?? [], Date.parse(l.t)); if (!s || Math.abs(Date.parse(s.t) - Date.parse(l.t)) > 6000) continue;
    compared += 1; if (new RegExp(w[0] === 'sitting' ? 'sit|seated|riding|rowing' : w[0] === 'lying' ? 'lying|lie|asleep|sleep' : 'stand', 'i').test(String(s.posture ?? ''))) agree += 1;
  }
  const seatH = {}; for (const r of ledger) { seatH[r.seat] ??= { H: 0, n: 0 }; seatH[r.seat].n += 1; if (r.fidelity === 'H') seatH[r.seat].H += 1; }
  return {
    run: basename(runDir), scenario: run.scenario?.name ?? null, seats: (run.scenario?.seats ?? []).length, requests: run.evidence.length,
    walks: { arrived: m.basics.walksArrived, known: m.basics.walksArrivalKnown }, bodyMoved: { n: m.basics.bodyMovedInBudget, of: run.evidence.length },
    ackMedianSec: m.speed.ackSec.median, firstBodyMedianSec: m.speed.firstBodyChangeSec.median, chatQueuedMedianSec: m.speed.chatQueuedSec?.median ?? null,
    truth: { pass: truth.filter((r) => r.status === 'pass').length, n: truth.length },
    fidelity: { H: m.fidelity.counts.H ?? 0, P: m.fidelity.counts.P ?? 0, M: m.fidelity.counts.M ?? 0, W: m.fidelity.counts.W ?? 0 },
    outTokPerReq: m.cost.outputTokensPerRequest?.median ?? null, turnsPerReq: m.cost.turnsPerRequest.median, callsPerReq: m.cost.cliCallsPerRequest.median,
    cardResult: { pass: card.filter((e) => of(e, 'result-sent')?.status === 'pass').length, n: card.length },
    listenOpenFails: rows.filter((r) => r.id === 'listen-open' && r.status === 'fail').length,
    physical: Object.fromEntries(PHYS_IDS.map((id) => [id, rows.filter((r) => r.id === id && r.status === 'fail').length])),
    sits, namedWalks: { pass: named.filter((e) => of(e, 'arrival').status === 'pass').length, n: named.length },
    doing: { agree, compared }, seatH, deadSeats, substituted, requestsDropped: full.evidence.length - run.evidence.length,
    raw: { ackSec: card.map((e) => secsBetween(e.sentAt, e.ackAt)), cardTurns: card.map((e) => joined.get(e.requestId)?.turns ?? 0), calls: run.evidence.map((e) => joined.get(e.requestId)?.calls ?? 0) },
  };
}

const sum = (ms, f) => ms.reduce((a, x) => a + (f(x) ?? 0), 0);
/** Threshold rows for one repeat (an array of {label, kind, m}). → [{id, label, threshold, value, ok}] */
export function thresholds(set) {
  const bat = set.filter((x) => x.kind === 'battery').map((x) => x.m), all = set.map((x) => x.m), per = set.filter((x) => x.kind === 'persona');
  const sitRows = bat.flatMap((m) => Object.values(m.sits));
  const r = (id, label, threshold, value, ok, shown) => ({ id, label, threshold, value: shown ?? value, ok: value == null ? null : ok });
  const fr = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '—');
  const W = (lab) => set.filter((x) => x.label.startsWith(lab)).reduce((a, x) => a + x.m.fidelity.W, 0);
  const single = set.filter((x) => x.m.seats === 1).flatMap((x) => x.m.raw.ackSec), multi = set.filter((x) => x.m.seats > 1).flatMap((x) => x.m.raw.ackSec);
  const out = [
    r('sit', '"sit down" sits ≤15 s after the first body change, in place (battery seats)', 'all', sitRows.length ? sitRows.filter((s) => s.ok).length / sitRows.length : null, sitRows.length && sitRows.every((s) => s.ok), fr(sitRows.filter((s) => s.ok).length, sitRows.length)),
    r('named-walks', 'pavilion / house-2 kitchen walks arrive (arrival oracle; polygon proxy)', '≥ 5/6', pct(sum(bat, (m) => m.namedWalks.pass), sum(bat, (m) => m.namedWalks.n)), pct(sum(bat, (m) => m.namedWalks.pass), sum(bat, (m) => m.namedWalks.n)) >= 5 / 6, fr(sum(bat, (m) => m.namedWalks.pass), sum(bat, (m) => m.namedWalks.n))),
    r('arrival', 'walk arrival of accepted walks (batteries)', '≥ 90%', pct(sum(bat, (m) => m.walks.arrived), sum(bat, (m) => m.walks.known)), pct(sum(bat, (m) => m.walks.arrived), sum(bat, (m) => m.walks.known)) >= 0.9, fr(sum(bat, (m) => m.walks.arrived), sum(bat, (m) => m.walks.known))),
    r('body-moved', 'body moved in budget (batteries)', '≥ 95%', pct(sum(bat, (m) => m.bodyMoved.n), sum(bat, (m) => m.bodyMoved.of)), pct(sum(bat, (m) => m.bodyMoved.n), sum(bat, (m) => m.bodyMoved.of)) >= 0.95, fr(sum(bat, (m) => m.bodyMoved.n), sum(bat, (m) => m.bodyMoved.of))),
    r('truth', 'truthfulness pass, chat included (all runs)', '≥ 0.97', pct(sum(all, (m) => m.truth.pass), sum(all, (m) => m.truth.n)), pct(sum(all, (m) => m.truth.pass), sum(all, (m) => m.truth.n)) >= 0.97, fr(sum(all, (m) => m.truth.pass), sum(all, (m) => m.truth.n))),
    r('w-newcomer', 'W in newcomer-opus + newcomer-rich (any class; D1 needs the ledger read)', '0', W('newcomer'), W('newcomer') === 0, String(W('newcomer'))),
    r('doing', 'card `doing` agrees with body posture (samples)', '≥ 95%', pct(sum(all, (m) => m.doing.agree), sum(all, (m) => m.doing.compared)), pct(sum(all, (m) => m.doing.agree), sum(all, (m) => m.doing.compared)) >= 0.95, fr(sum(all, (m) => m.doing.agree), sum(all, (m) => m.doing.compared))),
    r('card-result', 'card result before cutoff', '≥ 80%', pct(sum(all, (m) => m.cardResult.pass), sum(all, (m) => m.cardResult.n)), pct(sum(all, (m) => m.cardResult.pass), sum(all, (m) => m.cardResult.n)) >= 0.8, fr(sum(all, (m) => m.cardResult.pass), sum(all, (m) => m.cardResult.n))),
    r('ack-single', 'ack median, single-seat runs (s)', '≤ 8', median(single), median(single) <= 8),
    r('ack-trio', 'ack median, multi-seat runs (s)', '≤ 15', median(multi), median(multi) <= 15),
    r('away', 'listen-open fails (proxy for "away" while the agent waits)', '0', sum(all, (m) => m.listenOpenFails), sum(all, (m) => m.listenOpenFails) === 0),
    r('card-turns', 'card turns per message (median)', '≤ 1', median(all.flatMap((m) => m.raw.cardTurns)), median(all.flatMap((m) => m.raw.cardTurns)) <= 1),
    r('calls', 'CLI calls per request (median)', '≤ 3', median(all.flatMap((m) => m.raw.calls)), median(all.flatMap((m) => m.raw.calls)) <= 3),
    r('out-tok', 'output tokens per request, worst persona run median', '≤ 500', per.length ? Math.max(...per.map((x) => x.m.outTokPerReq ?? 0)) : null, per.length && Math.max(...per.map((x) => x.m.outTokPerReq ?? 0)) <= 500),
    { id: 'skill', label: 'skill size', threshold: '≤ 1.6k tokens', value: 'release check, not measured by replay', ok: null },
  ];
  return out;
}

/** No-new-bugs checks for one run: W and physical fails never rise, H never falls per battery seat; a change counts
 *  only if every repeat shows it. → [{check, base, reps, verdict: ok|regression|inconclusive}] */
export function noNewBugs(label, kind, base, reps) {
  const out = [];
  const cmp = (check, b, vals, worse) => { const w = vals.map((v) => worse(v, b)); out.push({ label, check, base: b, reps: vals, verdict: w.every(Boolean) ? 'regression' : w.some(Boolean) ? 'inconclusive' : 'ok' }); };
  cmp('W', base.fidelity.W, reps.map((m) => m.fidelity.W), (v, b) => v > b);
  for (const id of PHYS_IDS) cmp(id, base.physical[id], reps.map((m) => m.physical[id]), (v, b) => v > b);
  if (kind === 'battery') for (const seat of Object.keys(base.seatH)) cmp(`H ${seat}`, base.seatH[seat].H, reps.map((m) => m.seatH[seat]?.H ?? 0), (v, b) => v < b);
  return out;
}

const f = (v) => (v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
const fr2 = (o, a, b) => `${o[a]}/${o[b]}`;
function seatNotes(m) {
  const n = [];
  if (m.deadSeats?.length) n.push(`${m.deadSeats.join(', ')} never paired: ${m.requestsDropped} requests left out`);
  if (m.substituted?.length) n.push(`substituted ${m.substituted.join('; ')}`);
  return n.length ? ` (${n.join('; ')})` : '';
}
function runRow(tag, x) {
  const m = x.m; const ph = PHYS_IDS.reduce((a, id) => a + m.physical[id], 0); const sit = Object.values(m.sits);
  return `| ${x.label} | ${tag} | ${fr2(m.walks, 'arrived', 'known')} | ${fr2(m.bodyMoved, 'n', 'of')} | ${f(m.ackMedianSec)} | ${f(m.firstBodyMedianSec)} | ${f(m.chatQueuedMedianSec)} | ${m.truth.n ? f(m.truth.pass / m.truth.n) : '—'} | ${m.fidelity.H}/${m.fidelity.P}/${m.fidelity.M}/${m.fidelity.W} | ${f(m.outTokPerReq)} | ${f(m.turnsPerReq)} | ${f(m.callsPerReq)} | ${fr2(m.cardResult, 'pass', 'n')} | ${m.listenOpenFails} | ${ph} | ${sit.length ? `${sit.filter((s) => s.ok).length}/${sit.length}` : '—'} | \`${m.run}\`${seatNotes(m)} |`;
}

/** SCORECARD.md. entries: [{label, kind, base: measures, baseFrom, reps: [measures…]}] */
export function renderScorecard({ title = 'Frozen-set scorecard', entries, baselineName, repeats, notes = [] }) {
  const L = [`# ${title}`, '', `Built ${new Date().toISOString()}. Repeats per frozen run: ${repeats}. Baseline: ${baselineName}.`, '',
    'Measures and thresholds are those of `team/playtest/ROOT-CAUSES-20261025.md` §E. Arrival, truthfulness and cost use the 2026-10-25 harness fixes (in-window walk targets, chat replies, turn↔request join). Speed thresholds count only from gated runs.', ''];
  L.push('## Per run', '', '| run | repeat | walk arrival | body moved in budget | ack med s | first body med s | chat queued med s | truth | H/P/M/W | out tok/req | turns/req | calls/req | card result | listen-open fails | physical fails | sit ≤15 s | folder |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of entries) { L.push(runRow('base', { label: e.label, m: e.base })); e.reps.forEach((m, i) => L.push(runRow(`r${i + 1}`, { label: e.label, m }))); }
  L.push('', '## Thresholds (totals over the frozen set)', '');
  const repSets = Array.from({ length: Math.max(0, ...entries.map((e) => e.reps.length)) }, (_, i) => entries.filter((e) => e.reps[i]).map((e) => ({ label: e.label, kind: e.kind, m: e.reps[i] })));
  const baseT = thresholds(entries.map((e) => ({ label: e.label, kind: e.kind, m: e.base })));
  const repT = repSets.map(thresholds);
  L.push(`| measure | threshold | base | ${repT.map((_, i) => `r${i + 1}`).join(' | ')} | verdict |`, `|---|---|---|${repT.map(() => '---|').join('')}---|`);
  const mark = (t) => `${f(t.value)}${t.ok === true ? ' ✓' : t.ok === false ? ' ✗' : ''}`;
  baseT.forEach((t, k) => { const rs = repT.map((x) => x[k]); const oks = rs.map((x) => x.ok).filter((x) => x != null); const v = !rs.length || !oks.length ? 'not measured' : oks.every(Boolean) ? 'PASS' : oks.some(Boolean) ? 'repeats disagree' : 'FAIL'; L.push(`| ${t.label} | ${t.threshold} | ${mark(t)} | ${rs.map(mark).join(' | ')} | ${v} |`); });
  L.push('', '## Delta against the baseline (mean of repeats − baseline)', '', '| run | walk arrival | body moved | ack med s | truth | H | W | out tok/req | calls/req |', '|---|---|---|---|---|---|---|---|---|');
  const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const d = (e, g) => { const b = g(e.base), r = mean(e.reps.map(g)); return b == null || r == null ? '—' : `${r - b >= 0 ? '+' : ''}${f(Math.round((r - b) * 100) / 100)}`; };
  for (const e of entries) L.push(`| ${e.label} | ${d(e, (m) => pct(m.walks.arrived, m.walks.known))} | ${d(e, (m) => pct(m.bodyMoved.n, m.bodyMoved.of))} | ${d(e, (m) => m.ackMedianSec)} | ${d(e, (m) => pct(m.truth.pass, m.truth.n))} | ${d(e, (m) => m.fidelity.H)} | ${d(e, (m) => m.fidelity.W)} | ${d(e, (m) => m.outTokPerReq)} | ${d(e, (m) => m.callsPerReq)} |`);
  const checks = entries.filter((e) => e.reps.length).flatMap((e) => noNewBugs(e.label, e.kind, e.base, e.reps));
  const bad = checks.filter((c) => c.verdict === 'regression'), unsure = checks.filter((c) => c.verdict === 'inconclusive');
  L.push('', '## No-new-bugs rule (verdict below)', '', !checks.length ? '**Verdict: not evaluated** (no repeats yet).' : bad.length ? `**Verdict: NEW BUGS** — ${bad.length} regression(s) shown by every repeat.` : unsure.length ? `**Verdict: no new bugs confirmed; ${unsure.length} change(s) where the repeats disagree** (rerun before trusting).` : '**Verdict: no new bugs** (W and physical-oracle fails did not rise, H did not fall on any battery seat, repeats agree).', '');
  if (repeats < 2) L.push('Fewer than two repeats: the "two repeats agree" rule cannot hold.', '');
  const shown = checks.filter((c) => c.verdict !== 'ok' || c.reps.some((v) => v !== c.base));
  if (shown.length) { L.push('| run | check | base | repeats | verdict |', '|---|---|---|---|---|'); shown.forEach((c) => L.push(`| ${c.label} | ${c.check} | ${c.base} | ${c.reps.join(', ')} | ${c.verdict} |`)); L.push(''); }
  L.push('Rules: W count and every physical-oracle fail count (inside-solid, no-progress, oscillation, stuck-receipt) must not rise on any frozen run; H must not fall on any battery seat; a change counts only if every repeat shows it.', '');
  if (notes.length) L.push('## Notes', '', ...notes.map((n) => `- ${n}`), '');
  return L.join('\n');
}

/** Measures for the baseline of one frozen run: the matching repeats of a previous replay-set, else the original run. */
/** dirOnly: only a previous replay set's repeats (null when it has none), for callers with their own fallback. */
export function baselineFor(entry, { baselineDir = null, runsRoot, dirOnly = false }) {
  if (baselineDir) {
    const man = readJson(join(baselineDir, 'replay-set.json'), null);
    // A set pulled from another machine (the cloud box) keeps that machine's absolute paths: fall back to the same
    // folder name beside the manifest.
    const local = (d) => (existsSync(join(d, 'evidence')) ? d : existsSync(join(baselineDir, basename(d), 'evidence')) ? join(baselineDir, basename(d)) : null);
    const dirs = ((man?.runs ?? []).find((r) => r.label === entry.label)?.repeats ?? []).map(local).filter(Boolean);
    if (dirs.length) return { from: dirs, measures: dirs.map(runMeasures) };
  }
  if (dirOnly) return null;
  const d = join(runsRoot, entry.run);
  return { from: [d], measures: [runMeasures(d)] };
}

/** One baseline from several repeats, conservative for the no-new-bugs rule: W and physical fails take the highest
 *  repeat, per-seat H the lowest; the other measures are the first repeat's. */
export function mergeBase(list) {
  if (list.length <= 1) return list[0];
  const b = structuredClone(list[0]);
  b.fidelity.W = Math.max(...list.map((m) => m.fidelity.W));
  for (const id of PHYS_IDS) b.physical[id] = Math.max(...list.map((m) => m.physical[id]));
  for (const seat of Object.keys(b.seatH)) b.seatH[seat].H = Math.min(...list.map((m) => m.seatH[seat]?.H ?? 0));
  b.run = list.map((m) => m.run).join(' + ');
  return b;
}
