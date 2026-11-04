// Soul Runs evaluation (SR4, #753): answer standard measures and small named questions about a COMPLETED run from its
// retained artifacts, offline (no world, controller, network or model), and compare repeats of the same spec. It reuses
// the playtest review code (review/run.mjs loadRun, metrics.mjs computeMetrics, oracles.mjs, emergence.json) where its
// inputs exist, and reads the director records and seat transcripts (every CLI command and output) in place. Evidence is
// indexed by path and sha256, never copied. Each evaluation is a new versioned folder; nothing it reads is modified.
// See README.md (Evaluation).
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../lib/hash.mjs';
import { readJson, readJsonl } from '../lib/jsonl.mjs';
import { loadRun } from '../review/run.mjs';
import { computeMetrics, readLedger } from '../review/metrics.mjs';
import { runOracles } from '../review/oracles.mjs';

export const EVALUATOR = Object.freeze({ name: 'soul-runs/evaluate', version: '1' });
export const SCHEMA = 'soul-run-evaluation/1';
export const INDEX_SCHEMA = 'soul-run-index/1';
const VERDICTS = ['pass', 'fail', 'unknown'];
// Never indexed: world data, the seat working folders (owner identity, controller credentials, the served CLI) and
// earlier evaluations. Seat transcripts are indexed (hash only) because they are the controller's evidence.
const SKIP = [/^evaluations(\/|$)/, /^playtest\/server\/data(\/|$)/, /^playtest\/seats\/[^/]+\/folder(\/|$)/, /(^|\/)node_modules(\/|$)/];

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
const hashOf = (v) => sha256(JSON.stringify(canonical(v ?? null)));
export function dist(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, min: null, max: null };
  const m = v.length >> 1;
  return { n: v.length, median: r3(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2), min: r3(v[0]), max: r3(v.at(-1)) };
}

/** Every evidence file under the run folder (except SKIP), by relative path → {bytes, sha256}. */
export function indexSources(runDir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name), rel = relative(runDir, p).split('\\').join('/');
      if (SKIP.some((re) => re.test(rel))) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files[rel] = { bytes: st.size, sha256: sha256(readFileSync(p)) };
    }
  };
  walk(runDir);
  return files;
}

/** One seat transcript as CLI steps with line references: {seat, line, resultLine, turn, cmd, verb, args, atMs, doneMs, out, isError}. */
export function seatSteps(file, seat) {
  if (!existsSync(file)) return [];
  const steps = [], open = new Map();
  readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let ev; try { ev = JSON.parse(l); } catch { return; }
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'tool_use') {
        const cmd = String(c.input?.command ?? '');
        const args = cliArgs(cmd);
        const s = { seat, line: i + 1, resultLine: null, turn: ev.turn ?? null, cmd, verb: args[0] ?? null, args: args.slice(1), atMs: ev._rx ?? null, doneMs: null, out: null, isError: null };
        open.set(c.id, s); steps.push(s);
      } else if (c.type === 'tool_result' && open.has(c.tool_use_id)) {
        const s = open.get(c.tool_use_id), raw = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '');
        let out = raw; try { out = JSON.parse(raw); } catch { /* plain text */ }
        Object.assign(s, { resultLine: i + 1, doneMs: ev._rx ?? null, out, isError: !!c.is_error });
      }
    }
  });
  return steps;
}
/** `node eden.mjs ack msg_1 "Walking to the orchard"` → ['ack', 'msg_1', 'Walking to the orchard']; anything else → []. */
export function cliArgs(cmd) {
  const m = /^node\s+eden\.mjs\s+(.*)$/s.exec(cmd.trim()); if (!m) return [];
  const out = []; const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g; let x;
  while ((x = re.exec(m[1]))) out.push(x[1] != null ? (() => { try { return JSON.parse(`"${x[1]}"`); } catch { return x[1]; } })() : x[2]);
  return out;
}

/** The physical outcome one act step reports: completed | failed | ongoing | started (not observed to finish). */
export function actOutcome(step) {
  const o = step.out && typeof step.out === 'object' ? step.out : null;
  if (step.isError || !o) return { outcome: 'failed', why: 'CLI error or unparsed output' };
  if (o.accepted === false) return { outcome: 'failed', why: o.code ?? o.reason ?? 'not accepted' };
  const phase = o.receipt?.phase ?? null;
  if (phase === 'completed') return { outcome: 'completed', phase };
  if (['failed', 'refused', 'cancelled', 'interrupted'].includes(phase)) return { outcome: 'failed', phase, why: o.receipt?.reason ?? phase };
  const ongoing = (o.events ?? []).some((e) => e?.kind === 'activity.observed' && e.receipt?.id === o.receipt?.id && e.action?.status === 'executing');
  return { outcome: ongoing ? 'ongoing' : 'started', phase };
}

/** Load a Soul Run folder (run-receipt.json + playtest/), a plain playtest run folder, or a refused run (receipt only). */
export function loadSoulRun(dir) {
  const runDir = resolve(dir);
  const receipt = readJson(join(runDir, 'run-receipt.json'), null);
  const playtestDir = existsSync(join(runDir, 'playtest', 'receipts')) ? join(runDir, 'playtest') : existsSync(join(runDir, 'receipts')) ? runDir : null;
  if (!receipt && !playtestDir) throw new Error(`${runDir}: not a Soul Run or playtest run folder (no run-receipt.json, no receipts/)`);
  const pRel = playtestDir ? relative(runDir, playtestDir).split('\\').join('/') : null;
  const at = (...p) => [pRel, ...p].filter(Boolean).join('/');
  const run = playtestDir ? loadRun(playtestDir) : null;
  const seatIds = playtestDir && existsSync(join(playtestDir, 'seats')) ? readdirSync(join(playtestDir, 'seats')).filter((s) => existsSync(join(playtestDir, 'seats', s, 'seat.json'))).sort() : [];
  const steps = Object.fromEntries(seatIds.map((s) => [s, seatSteps(join(playtestDir, 'seats', s, 'transcript.jsonl'), s).map((x) => ({ ...x, file: at('seats', s, 'transcript.jsonl') }))]));
  const director = {};
  for (const s of playtestDir && existsSync(join(playtestDir, 'personas')) ? readdirSync(join(playtestDir, 'personas')).sort() : []) {
    director[s] = { decisions: readJsonl(join(playtestDir, 'personas', s, 'decisions.jsonl')), cutoffs: readJsonl(join(playtestDir, 'personas', s, 'requests.jsonl')), decisionsFile: at('personas', s, 'decisions.jsonl'), cutoffsFile: at('personas', s, 'requests.jsonl') };
  }
  const scenario = playtestDir ? readJson(join(playtestDir, 'scenario.json'), null) : readJson(join(runDir, 'scenario.effective.json'), null);
  return {
    runDir, receipt, playtestDir, pRel, at, run, seatIds, steps, director, scenario,
    setup: readJson(join(runDir, 'setup.json'), null),
    kind: receipt ? 'soul-run' : 'playtest',
    runId: receipt?.runId ?? basename(runDir),
    status: receipt?.status ?? (playtestDir && readJson(join(playtestDir, 'receipts', '7-report.json'), null)?.ok ? 'completed' : 'unknown'),
  };
}

/** Owner requests joined from the director's records and the seat's own CLI calls, with references to both. */
export function joinRequests(sr) {
  const out = [];
  for (const [seat, d] of Object.entries(sr.director)) {
    d.decisions.forEach((dec, i) => {
      const del = dec.delivered; if (!del?.requestId) return;
      const sentMs = Date.parse(dec.t);
      const ci = d.cutoffs.findIndex((c) => c.requestId === del.requestId), cut = ci >= 0 ? d.cutoffs[ci] : null;
      const mine = sr.steps[seat] ?? [], mid = del.messageId;
      const ack = mid ? mine.find((s) => s.verb === 'ack' && s.args[0] === mid) : null;
      const result = mid ? mine.find((s) => s.verb === 'result' && s.args[0] === mid) : null;
      // An act belongs to a request when the CLI says so (`for`); a refusal carries no `for`, so an act between this
      // request's ack and result calls in the same transcript belongs to it too.
      const between = (s) => ack && s.line > ack.line && (!result || s.line < result.line);
      const acts = mine.filter((s) => s.verb === 'act' && (s.out?.for === mid || (s.out?.for == null && between(s))));
      const say = mine.filter((s) => s.verb === 'say' && between(s));
      const cutMs = cut ? Date.parse(cut.t) : null;
      const physical = acts.map((s) => ({ capability: s.out?.receipt?.capability ?? s.out?.resolved ?? null, waited: s.args.includes('--wait'), ...actOutcome(s), ref: ref(sr, s.file, s.resultLine ?? s.line) }));
      const seatOutcome = result ? (result.out?.outcome ?? result.args[1] ?? null) : null;
      const r = {
        requestId: del.requestId, seat, channel: del.channel ?? dec.scripted?.channel ?? null, text: dec.scripted?.text ?? dec.decision?.text ?? null,
        budgetSec: dec.scripted?.budgetSec ?? null, broadcast: !!dec.scripted?.broadcast, sentAt: dec.t, messageId: mid ?? null,
        ackSec: ack?.doneMs ? r1((ack.doneMs - sentMs) / 1000) : null, ackAt: ack?.doneMs ? new Date(ack.doneMs).toISOString() : null, ackText: ack?.args[1] ?? null,
        seatResult: result ? { outcome: seatOutcome, text: result.args[2] ?? null, atSec: result.doneMs ? r1((result.doneMs - sentMs) / 1000) : null, at: result.doneMs ? new Date(result.doneMs).toISOString() : null, accepted: !!result.out?.reported } : null,
        director: cut ? { cutoffReason: cut.cutoffReason ?? null, openSec: cut.openSec ?? null, state: cut.state ?? null } : null,
        physical, said: say.map((s) => ({ channel: s.out?.said?.channel?.kind ?? null, heardBy: s.out?.said?.heardBy ?? null, ref: ref(sr, s.file, s.resultLine ?? s.line) })),
        conflicts: [],
        refs: [ref(sr, d.decisionsFile, i + 1), ...(ci >= 0 ? [ref(sr, d.cutoffsFile, ci + 1)] : []), ...(ack ? [ref(sr, ack.file, ack.line)] : []), ...(result ? [ref(sr, result.file, result.line)] : [])],
      };
      // Keep both records when they disagree: the director watches its latest card and may close an earlier one by
      // budget although the seat already reported a result (SR2 known limit). Neither record is discarded.
      if (r.seatResult && r.director && r.director.cutoffReason !== 'result') r.conflicts.push({ kind: 'director-vs-seat', detail: `seat reported ${r.seatResult.outcome} at ${r.seatResult.atSec} s; director closed it by ${r.director.cutoffReason} at ${r.director.openSec} s` });
      if (result?.doneMs && cutMs && result.doneMs > cutMs + 1000) r.conflicts.push({ kind: 'late-result', detail: `seat result ${r1((result.doneMs - cutMs) / 1000)} s after the director's cutoff` });
      if (seatOutcome === 'done' && physical.length && physical.every((p) => p.outcome === 'failed')) r.conflicts.push({ kind: 'claim-vs-physical', detail: 'seat reported done but every act it ran failed' });
      out.push(r);
    });
  }
  return out.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.requestId.localeCompare(b.requestId));
}
function ref(sr, path, line = null) { return { path, ...(line ? { line } : {}) }; } // sha256 is added once sources are indexed

const measured = (id, family, unit, value, { n = null, denominator = null, dist: d = null, basis, sources = [] }) => ({ id, family, unit, status: 'measured', value, n, denominator, ...(d ? { dist: d } : {}), basis, sources });
const unavailable = (id, family, unit, reason, basis) => ({ id, family, unit, status: 'unavailable', value: null, reason, basis });

/** Standard measures, each in its own family with unit, n, denominator and basis. Absent sources are unavailable, never 0. */
export function standardMeasures(sr, requests) {
  const M = [];
  const cards = requests.filter((r) => r.channel === 'card');
  const dirFiles = Object.values(sr.director).flatMap((d) => [d.decisionsFile, d.cutoffsFile]);
  const seatFiles = Object.values(sr.steps).map((s) => s[0]?.file).filter(Boolean);
  const LAT = 'request-latency', LAT_BASIS = 'seconds from the director delivering the owner card (decisions.jsonl t) to the seat\'s own CLI call returning (transcript _rx); both clocks are this machine\'s wall clock';
  // Seat-side timing exists only for seats whose transcript was retained (controllerState: delete removes them).
  const heard = cards.filter((r) => sr.steps[r.seat]?.length), deaf = [...new Set(cards.filter((r) => !sr.steps[r.seat]?.length).map((r) => r.seat))];
  const missing = deaf.length ? `; no transcript for ${deaf.join(', ')}, whose requests are left out` : '';
  if (!heard.length) for (const id of ['ackSec', 'seatResultSec', 'unacked']) M.push(unavailable(id, LAT, id === 'unacked' ? 'requests' : 's', !Object.keys(sr.director).length ? 'no director records' : !cards.length ? 'no card requests were delivered' : 'no seat transcripts were retained', LAT_BASIS));
  else {
    const acks = heard.map((r) => r.ackSec), res = heard.map((r) => r.seatResult?.atSec);
    M.push(measured('ackSec', LAT, 's', dist(acks).median, { n: dist(acks).n, denominator: heard.length, dist: dist(acks), basis: `${LAT_BASIS}; median over card requests with an ack${missing}`, sources: [...dirFiles, ...seatFiles] }));
    M.push(measured('seatResultSec', LAT, 's', dist(res).median, { n: dist(res).n, denominator: heard.length, dist: dist(res), basis: `${LAT_BASIS}; to the seat's result call, which is its claim, not physical completion${missing}`, sources: [...dirFiles, ...seatFiles] }));
    M.push(measured('unacked', LAT, 'requests', heard.filter((r) => r.ackSec == null).length, { n: heard.length, denominator: heard.length, basis: `card requests with no ack call in the seat transcript${missing}`, sources: seatFiles }));
  }
  if (cards.length) {
    const open = cards.map((r) => r.director?.openSec);
    M.push(measured('directorOpenSec', LAT, 's', dist(open).median, { n: dist(open).n, denominator: cards.length, dist: dist(open), basis: 'director\'s own open time per request (requests.jsonl openSec), closed by result or budget; a budget close is not a seat outcome', sources: dirFiles }));
  }
  const PHYS = 'physical-completion', withActs = requests.filter((r) => r.physical.length);
  if (!seatFiles.length) M.push(unavailable('requestsPhysicallyCompleted', PHYS, 'requests', 'no seat transcripts', 'receipt phases the world returned to the seat\'s act calls'));
  else {
    const last = (r) => r.physical.at(-1)?.outcome;
    M.push(measured('requestsPhysicallyCompleted', PHYS, 'requests', withActs.filter((r) => last(r) === 'completed').length, { n: withActs.length, denominator: withActs.length, basis: 'requests whose last act call returned a completed receipt (the world\'s phase, not the seat\'s claim); requests without an act are not in the denominator', sources: seatFiles }));
    M.push(measured('requestsPhysicallyOngoing', PHYS, 'requests', withActs.filter((r) => last(r) === 'ongoing').length, { n: withActs.length, denominator: withActs.length, basis: 'last act still executing when the seat\'s wait ended (for example seated); neither completed nor failed', sources: seatFiles }));
    M.push(measured('requestsPhysicallyUnknown', PHYS, 'requests', withActs.filter((r) => last(r) === 'started').length, { n: withActs.length, denominator: withActs.length, basis: 'last act started without a wait, so its end was not observed by the seat', sources: seatFiles }));
    const claimed = requests.filter((r) => r.seatResult), done = claimed.filter((r) => r.seatResult.outcome === 'done');
    M.push(measured('seatReportedDone', 'seat-claims', 'requests', done.length, { n: claimed.length, denominator: claimed.length, basis: 'result calls with outcome done; a claim, compared with physical completion separately', sources: seatFiles }));
  }
  // Observed walking speed and the review metrics need the observer's per-request evidence packs (evidence/*.json).
  const packs = sr.run?.evidence?.length ?? 0;
  const obsWhy = sr.receipt?.observer && sr.receipt.observer.ok === false ? `no observer evidence packs: observer ${sr.receipt.observer.stage ?? ''} failed (${sr.receipt.observer.owner ?? 'observer'}); cameras were disabled` : 'no observer evidence packs (evidence/*.json) in this run';
  if (!packs) M.push(unavailable('walkMps', 'observed-walking-speed', 'm/s', obsWhy, 'sampled displacement during walk receipts (review/metrics.mjs speed.walkMps)'));
  else {
    const ledger = readLedger(join(sr.playtestDir, 'ledger.tsv'));
    const stored = readJsonl(join(sr.playtestDir, 'oracles.jsonl'));
    const oracles = stored.length ? stored : sr.run.evidence.flatMap((ev) => runOracles(ev, { run: sr.run }));
    const m = computeMetrics(sr.run, { ledger, oracles, emergence: readJson(join(sr.playtestDir, 'emergence.json'), null) });
    const src = [sr.at('evidence'), sr.at(stored.length ? 'oracles.jsonl' : 'evidence')];
    M.push(m.speed.walkMps.n ? measured('walkMps', 'observed-walking-speed', 'm/s', m.speed.walkMps.median, { n: m.speed.walkMps.n, dist: m.speed.walkMps, basis: m.speed.basis, sources: src }) : unavailable('walkMps', 'observed-walking-speed', 'm/s', (() => { const w = sr.run.evidence.flatMap((e) => (e.receipts ?? []).filter((r) => /^(go|walk|visit|goto|stroll)[:.]/i.test(r.capability ?? ''))); return !w.length ? 'the evidence packs hold no walk receipt' : !w.some((r) => r.startedAt) ? `the evidence packs' ${w.length} walk receipt(s) carry no startedAt, which review/metrics.mjs needs to window the samples (an existing gap in the pack, not a zero speed)` : 'no walk receipt has two timely samples in its window'; })(), m.speed.basis));
    M.push(measured('observedFirstBodyChangeSec', 'observed-latency', 's', m.speed.firstBodyChangeSec.median, { n: m.speed.firstBodyChangeSec.n, denominator: packs, dist: m.speed.firstBodyChangeSec, basis: m.speed.basis, sources: src }));
    M.push(measured('walkArrivalRate', 'observed-physical', 'fraction', m.basics.walkArrivalRate, { n: m.basics.walksArrivalKnown, denominator: m.basics.walkRequests, basis: m.basics.basis, sources: src }));
    const ids = [...new Set(oracles.map((o) => o.id))].sort();
    M.push(measured('oracles', 'review-oracles', 'rows', oracles.length, { n: packs, basis: `deterministic oracles per request (${stored.length ? 'stored oracles.jsonl' : 'recomputed offline'}): ${ids.map((id) => `${id} ${['pass', 'fail', 'unknown'].map((s) => oracles.filter((o) => o.id === id && o.status === s).length).join('/')}`).join('; ')} (pass/fail/unknown)`, sources: src }));
  }
  const tv = sr.receipt?.evidence?.tickValidity ?? (sr.playtestDir ? readJson(join(sr.playtestDir, 'server', 'tick-validity.json'), null) : null);
  if (!tv || !Number.isFinite(tv.ticks) || !Number.isFinite(tv.seconds)) M.push(unavailable('tickRate', 'tick-timing', 'ticks/s', 'no tick-validity record', 'world ticks over wall seconds from the tick service'));
  else M.push(measured('tickRate', 'tick-timing', 'ticks/s', r3(tv.ticks / tv.seconds), { n: tv.ticks, basis: `tick-validity: ${tv.ticks} ticks over ${tv.seconds} s, clockRate ${tv.clockRate ?? '?'}, valid ${tv.valid}`, sources: [sr.receipt ? 'run-receipt.json' : sr.at('server', 'tick-validity.json')] }));
  const costRows = Object.keys(sr.steps).flatMap((s) => readJsonl(join(sr.playtestDir, 'seats', s, 'cost.jsonl')).map((c) => ({ ...c, seat: s })));
  const turns = Object.keys(sr.steps).flatMap((s) => readJsonl(join(sr.playtestDir, 'seats', s, 'turns.jsonl')));
  const usage = turns.map((t) => t.usage).filter(Boolean);
  if (!usage.length && !costRows.length) M.push(unavailable('tokens', 'token-cost', 'tokens', 'no seat usage records', 'per-turn usage reported by the seat adapter'));
  else {
    const sum = (k) => usage.reduce((a, u) => a + (Number(u[k]) || 0), 0);
    const adapters = [...new Set(Object.keys(sr.steps).map((s) => readJson(join(sr.playtestDir, 'seats', s, 'seat.json'), {}).adapter ?? '?'))];
    M.push(measured('tokens', 'token-cost', 'tokens', sum('inputTokens') + sum('outputTokens'), { n: usage.length, basis: `input ${sum('inputTokens')} + output ${sum('outputTokens')} (cached ${sum('cachedTokens')}) over ${usage.length} turns as reported by adapter(s) ${adapters.join(', ')}; scripted-owner has no provider and reports 0`, sources: Object.keys(sr.steps).map((s) => sr.at('seats', s, 'turns.jsonl')) }));
    M.push(measured('costUsd', 'token-cost', 'USD', r3(sum('costUsd')), { n: usage.length, basis: 'adapter-reported cost per turn', sources: Object.keys(sr.steps).map((s) => sr.at('seats', s, 'turns.jsonl')) }));
  }
  if (sr.receipt?.cost) M.push(measured('lifecycleOverheadMs', 'lifecycle', 'ms', sr.receipt.cost.lifecycleOverheadMs ?? null, { basis: `run wall ${sr.receipt.cost.wallMs} ms minus scenario execution ${sr.receipt.cost.executeMs} ms`, sources: ['run-receipt.json'] }));
  M.push(directionsMeasure(sr));
  const em = sr.playtestDir ? readJson(join(sr.playtestDir, 'emergence.json'), null) : null;
  if (!em?.metric?.souls) M.push({ ...unavailable('coLocationRatio', 'social-heuristic', 'ratio', em ? 'emergence.json saw no Souls (it reads observer samples)' : 'no emergence.json', 'review/emergence.mjs'), heuristic: true });
  else M.push({ ...measured('coLocationRatio', 'social-heuristic', 'ratio', em.metric.coLocation?.ratio ?? null, { n: em.metric.souls, basis: `HEURISTIC, not a social outcome: ${em.metric.basis?.coLocation ?? 'co-location'}`, sources: [sr.at('emergence.json')] }), heuristic: true });
  return M;
}

/** Directed casts (#783): the direction journal (director/commands.jsonl) as counts by command and outcome, and each
 *  redirection with its target, run-relative time, outcome and whether the target spoke afterwards (director/speech.jsonl,
 *  world time after the command's wall time; with expect words, whether that speech contained one). */
export function directionsMeasure(sr) {
  const BASIS = 'console commands recorded by the swarm orchestrator (typed, scripted or from the lifecycle), with the outcome it applied';
  const file = sr.playtestDir ? join(sr.playtestDir, 'director', 'commands.jsonl') : null;
  if (!file || !existsSync(file)) return unavailable('directions', 'direction', 'commands', 'no direction journal (not a directed cast, or recorded before #783)', BASIS);
  const cmds = readJsonl(file), speech = readJsonl(join(sr.playtestDir, 'director', 'speech.jsonl'));
  const byCommand = {};
  for (const c of cmds) { const b = (byCommand[c.cmd] ??= { applied: 0, held: 0, refused: 0 }); b[c.outcome] = (b[c.outcome] ?? 0) + 1; }
  const redirections = cmds.filter((c) => c.cmd === 'redirect').map((c) => {
    const after = speech.filter((x) => x.seat === c.target && (x.atMs ?? Date.parse(x.t)) > Date.parse(c.t));
    const words = Array.isArray(c.expect) ? c.expect.map((w) => String(w).toLowerCase()) : null;
    return { target: c.target, source: c.source, atSec: c.elapsedSec, outcome: c.outcome, ...(c.reason ? { reason: c.reason } : {}), requestIds: c.requestIds ?? [], spokeAfter: after.length > 0, ...(words ? { expect: words, expectHeard: after.some((x) => words.some((w) => String(x.text ?? '').toLowerCase().includes(w))) } : {}) };
  });
  return { ...measured('directions', 'direction', 'commands', cmds.length, { n: cmds.length, basis: BASIS, sources: [sr.at('director', 'commands.jsonl'), ...(speech.length ? [sr.at('director', 'speech.jsonl')] : [])] }),
    byCommand, refused: cmds.filter((c) => c.outcome === 'refused').length, redirections };
}

/** Load a question module: default export {id, version, question, assumptions?, score(ctx)}. */
export async function loadQuestion(file) {
  const path = resolve(file);
  const mod = await import(pathToFileURL(path).href);
  const q = mod.default ?? mod;
  const errs = [];
  if (typeof q?.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(q.id)) errs.push('id: lowercase name');
  if (q?.version == null) errs.push('version required');
  if (typeof q?.question !== 'string') errs.push('question: the text it answers');
  if (typeof q?.score !== 'function') errs.push('score(ctx) required');
  if (errs.length) throw new Error(`${file}: ${errs.join('; ')}`);
  return { ...q, path, sha256: sha256(readFileSync(path)) };
}

/** The read-only context a question scorer gets. */
function questionContext(sr, requests, sources) {
  const packs = sr.run?.evidence ?? [];
  return {
    runId: sr.runId, status: sr.status, scenario: sr.scenario, setup: sr.setup, requests, seats: sr.seatIds,
    steps: (seat) => sr.steps[seat] ?? [],
    hasTranscript: (seat) => (sr.steps[seat]?.length ?? 0) > 0,
    observer: { packs: packs.length, available: packs.length > 0, receipt: sr.receipt?.observer ?? null },
    evidencePacks: packs,
    ref: (path, line = null) => ({ path, ...(line ? { line } : {}), sha256: sources[path]?.sha256 ?? null }),
    stepRef: (s) => ({ path: s.file, line: s.resultLine ?? s.line, sha256: sources[s.file]?.sha256 ?? null }),
  };
}

/** Run one question; any malformed or unsupported answer becomes unknown with the reason, never a pass. */
export async function answerQuestion(q, ctx, { predeclared }) {
  const base = { id: q.id, version: String(q.version), question: q.question, assumptions: q.assumptions ?? [], scorer: { path: q.path, sha256: q.sha256 }, basis: predeclared ? 'predeclared' : 'exploratory' };
  let a;
  try { a = await q.score(ctx); } catch (e) { return { ...base, verdict: 'unknown', uncertainty: `scorer error: ${String(e?.message ?? e).slice(0, 200)}`, evidence: [] }; }
  const verdict = VERDICTS.includes(a?.verdict) ? a.verdict : 'unknown';
  const evidence = Array.isArray(a?.evidence) ? a.evidence.filter((r) => r?.path) : [];
  const notes = [...(a?.notes ?? [])];
  if (!VERDICTS.includes(a?.verdict)) notes.push(`invalid verdict ${JSON.stringify(a?.verdict)} → unknown`);
  if (verdict !== 'unknown' && !evidence.length) return { ...base, verdict: 'unknown', uncertainty: 'the scorer cited no evidence, so its answer is not accepted', evidence, notes: [...notes, `scorer said ${verdict}`] };
  return { ...base, verdict, uncertainty: a?.uncertainty ?? null, evidence, notes, ...(a?.detail ? { detail: a.detail } : {}) };
}

/** Predeclared acceptance the scenario already carries: its `expect` oracles (review/expect-oracles.mjs) from oracles.jsonl. */
function scenarioAcceptance(sr) {
  const script = sr.scenario?.director?.script ?? [];
  const declared = script.filter((e) => e.expect).length;
  if (!declared) return { declared: 0, note: 'the scenario script declares no expect oracles' };
  const rows = sr.playtestDir ? readJsonl(join(sr.playtestDir, 'oracles.jsonl')).filter((r) => /^(target-arrival|answer-|facing|view-used|named-in|journey-)/.test(r.id ?? '')) : [];
  if (!rows.length) return { declared, rows: [], note: 'declared but no scored rows (no observer evidence packs)', verdict: 'unknown' };
  return { declared, rows: rows.map((r) => ({ requestId: r.requestId, id: r.id, status: r.status })), source: sr.at('oracles.jsonl') };
}

/** Identity of what ran (must match for repeats to pool) and the conditions it ran under (listed, not pooled on). */
export function runIdentity(sr) {
  const sc = sr.scenario ? structuredClone(sr.scenario) : null;
  if (sc) { for (const k of ['scenarioPath', 'scenarioSha256', 'serverRoot', 'castPath']) delete sc[k]; if (sc.world) delete sc.world.port; }
  const eff = sr.receipt?.spec?.effective ?? null;
  const seats = (sc?.seats ?? []).map((s) => ({ id: s.id, adapter: s.adapter ?? 'claude-headless', model: s.model ?? null, effort: s.effort ?? null, persona: s.persona ?? null, script: s.script ? hashOf(s.script).slice(0, 16) : null }));
  const components = {
    scenario: sc ? hashOf(sc).slice(0, 16) : null,
    worldSource: eff?.world?.source ? `${eff.world.source.kind}:${eff.world.source.path}@${eff.world.source.sha256.slice(0, 16)}` : sc?.world ? `${sc.world.snapshot ? 'snapshot' : 'genesis'}:${sc.world.snapshot ?? sc.world.genesis}@unhashed` : null,
    setup: eff?.setup ? eff.setup.batches.map((b) => `${b.id}@${b.sha256.slice(0, 16)}`).join(',') : 'none',
    seats: hashOf(seats).slice(0, 16), director: hashOf({ mode: sc?.director?.mode ?? null, script: sc?.director?.script ?? null, sequential: sc?.director?.sequential ?? null }).slice(0, 16),
    seed: sc?.seed ?? null, durationSec: sc?.durationSec ?? null,
  };
  const pre = sr.receipt?.preflight?.scenario?.checks ?? (sr.playtestDir ? readJson(join(sr.playtestDir, 'preflight.json'), null)?.checks : null) ?? null;
  const ev = sr.receipt?.evidence ?? {};
  const conditions = {
    commit: sr.receipt?.source?.commit ?? null, dirtyTrackedFiles: sr.receipt?.source?.dirtyTrackedFiles ?? null, node: sr.receipt?.source?.node ?? null,
    cli: ev.cli ?? null, skill: ev.skill ?? null, build: ev.build ?? null,
    machine: pre ? { load1: pre.laptopLoad?.[0] ?? null, freeGb: pre.freeGb ?? null, machineOk: pre.machineOk ?? null } : null,
    observer: sr.receipt?.observer ? { ok: sr.receipt.observer.ok, stage: sr.receipt.observer.stage ?? null } : null,
  };
  return { arm: hashOf(components).slice(0, 12), components, seats, conditions };
}

function evaluatorFiles() {
  const here = dirname(new URL(import.meta.url).pathname);
  const files = ['runs/evaluate.mjs', 'review/run.mjs', 'review/metrics.mjs', 'review/oracles.mjs'];
  const root = resolve(here, '..');
  const out = Object.fromEntries(files.map((f) => [f, existsSync(join(root, f)) ? sha256(readFileSync(join(root, f))).slice(0, 16) : null]));
  let commit = null, dirty = null;
  try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean).length; } catch { /* not a checkout */ }
  return { ...EVALUATOR, files: out, commit, dirtyFiles: dirty };
}

/** Evaluate one run folder offline. questions: [{file} | loaded], exploratory unless named in the spec's
 *  evaluation.questions. write: false returns the record without writing. Returns {evaluation, dir}. */
export async function evaluateRun(dir, { questions = [], write = true, now = () => new Date() } = {}) {
  const sr = loadSoulRun(dir);
  const before = indexSources(sr.runDir);
  const requests = sr.playtestDir ? joinRequests(sr) : [];
  for (const r of requests) for (const x of [...r.refs, ...r.physical.map((p) => p.ref), ...r.said.map((p) => p.ref)]) x.sha256 = before[x.path]?.sha256 ?? null;
  const measures = sr.playtestDir ? standardMeasures(sr, requests) : [];
  const declared = new Set((sr.receipt?.spec?.effective?.evaluation?.questions ?? []).map((q) => q.sha256));
  const ctx = questionContext(sr, requests, before);
  const loaded = [];
  for (const q of questions) loaded.push(typeof q === 'string' ? await loadQuestion(q) : q);
  for (const q of sr.receipt?.spec?.effective?.evaluation?.questions ?? []) if (!loaded.some((l) => l.sha256 === q.sha256) && existsSync(q.path)) { const l = await loadQuestion(q.path); if (l.sha256 === q.sha256) loaded.push(l); }
  const answers = [];
  for (const q of loaded) answers.push(await answerQuestion(q, ctx, { predeclared: declared.has(q.sha256) }));
  for (const q of sr.receipt?.spec?.effective?.evaluation?.questions ?? []) if (!loaded.some((l) => l.sha256 === q.sha256)) answers.push({ id: q.id ?? basename(q.path), basis: 'predeclared', verdict: 'unknown', uncertainty: 'the predeclared scorer file is missing or changed since the run (hash mismatch)', evidence: [], scorer: q });
  const review = sr.playtestDir ? readJson(join(sr.playtestDir, 'receipts', '5-review.json'), null) : null;
  const identity = runIdentity(sr);
  const evaluation = {
    schema: SCHEMA, evaluator: evaluatorFiles(), createdAt: now().toISOString(),
    offline: { worldStarted: false, controllersStarted: false, network: false, modelCalls: 0 },
    run: { runId: sr.runId, kind: sr.kind, status: sr.status, stage: sr.receipt?.stage ?? null, reason: sr.receipt?.reason ?? null, receiptSha256: before['run-receipt.json']?.sha256 ?? null, specSha256: sr.receipt?.spec?.sha256 ?? null, arm: identity.arm, identity: identity.components, conditions: identity.conditions },
    coverage: {
      directorSeats: Object.keys(sr.director).length, seatTranscripts: Object.values(sr.steps).filter((s) => s.length).length, requests: requests.length,
      observerEvidencePacks: sr.run?.evidence?.length ?? 0, observer: sr.receipt?.observer ?? null,
      // Semantic (model) review is never run here. When the run had one, its mode, model and outputs are identified so
      // an answer built on it can say what it rests on; review/cli.mjs review is the explicit, separately budgeted path.
      semanticReview: review ? { mode: sr.scenario?.review?.mode ?? 'model', provider: (sr.scenario?.review?.mode ?? 'model') === 'model' ? 'claude' : null, model: (sr.scenario?.review?.mode ?? 'model') === 'model' ? (sr.scenario?.review?.reviewerModel ?? 'opus') : null, requests: review.requests ?? 0, inputs: (sr.scenario?.review?.mode ?? 'model') === 'model' ? 'bounded per-request evidence projections (review/run.mjs projectEvidence)' : 'deterministic oracles only', outputs: ['ledger.tsv', 'reviews.jsonl'].map((f) => sr.at(f)).filter((f) => before[f]), note: 'indexed, not re-run; evaluate makes no model call' } : null,
    },
    measures,
    acceptance: { scenario: sr.playtestDir ? scenarioAcceptance(sr) : null, predeclared: answers.filter((a) => a.basis === 'predeclared') },
    questions: answers.filter((a) => a.basis === 'exploratory'),
    requests,
    conflicts: requests.flatMap((r) => r.conflicts.map((c) => ({ requestId: r.requestId, ...c }))),
    sources: { files: Object.keys(before).length, bytes: Object.values(before).reduce((a, f) => a + f.bytes, 0), index: before },
    limits: [
      'Retrospective: answers describe what the records show; they do not establish motivation, causality or that a replay would repeat it.',
      'Latency uses this machine\'s wall clock on both sides (director and seat); there is no shared tick stamp on owner requests.',
      ...(requests.some((r) => r.conflicts.length) ? ['Conflicting records are kept side by side; neither is chosen.'] : []),
    ],
  };
  const after = indexSources(sr.runDir);
  evaluation.sources.unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!write) return { evaluation, dir: null };
  const root = join(sr.runDir, 'evaluations');
  mkdirSync(root, { recursive: true });
  const n = readdirSync(root).filter((d) => /^\d{3}-/.test(d)).length + 1;
  const out = join(root, `${String(n).padStart(3, '0')}-v${EVALUATOR.version}`);
  mkdirSync(out);
  writeFileSync(join(out, 'evaluation.json'), JSON.stringify(evaluation, null, 1) + '\n');
  writeFileSync(join(out, 'EVALUATION.md'), renderEvaluation(evaluation));
  return { evaluation, dir: out };
}

const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? String(v) : String(v));
export function renderEvaluation(e) {
  const L = [`# Evaluation of ${e.run.runId}`, '', `${e.run.kind}, status **${e.run.status}**, arm \`${e.run.arm}\`. Evaluator ${e.evaluator.name} v${e.evaluator.version} at ${e.evaluator.commit?.slice(0, 8) ?? '?'}, offline (no world, controller, network or model). Sources: ${e.sources.files} files, unchanged: ${e.sources.unchanged}.`, ''];
  L.push(`Coverage: ${e.coverage.requests} requests from ${e.coverage.directorSeats} director seat(s), ${e.coverage.seatTranscripts} seat transcript(s), ${e.coverage.observerEvidencePacks} observer evidence pack(s).`, '');
  L.push('## Standard measures', '', '| family | measure | value | unit | n / of | status | basis |', '|---|---|---|---|---|---|---|');
  for (const m of e.measures) L.push(`| ${m.family}${m.heuristic ? ' (heuristic)' : ''} | ${m.id} | ${fmt(m.value)} | ${m.unit} | ${m.status === 'measured' ? `${fmt(m.n)} / ${fmt(m.denominator)}` : '—'} | ${m.status} | ${(m.reason ?? m.basis).replace(/\|/g, '/')} |`);
  const qs = [...e.acceptance.predeclared, ...e.questions];
  L.push('', '## Questions', '');
  if (!qs.length) L.push('None asked.');
  for (const q of qs) L.push(`- **${q.id}** (${q.basis}, v${q.version ?? '?'}): ${q.question ?? ''} → **${q.verdict}**${q.uncertainty ? `. Uncertainty: ${q.uncertainty}` : ''}. Evidence: ${q.evidence.map((r) => `\`${r.path}${r.line ? `:${r.line}` : ''}\``).join(', ') || 'none'}.`);
  if (e.acceptance.scenario) L.push('', `Scenario acceptance (expect oracles): ${e.acceptance.scenario.declared} declared${e.acceptance.scenario.note ? `; ${e.acceptance.scenario.note}` : ''}.`);
  L.push('', '## Conflicting or late records', '');
  if (!e.conflicts.length) L.push('None.');
  for (const c of e.conflicts) L.push(`- ${c.requestId}: ${c.kind}: ${c.detail}`);
  L.push('', '## Limits', '', ...e.limits.map((l) => `- ${l}`));
  return L.join('\n') + '\n';
}

/** Compare attempts: group by exact identity into arms, keep every attempt, pool only completed repeats within an arm,
 *  and flag incompatible arms instead of averaging across them. Accepts run folders and replay-set manifests. */
export async function compareRunSet(dirs, { questions = [], now = () => new Date() } = {}) {
  const expanded = [];
  for (const d of dirs) {
    const m = readJson(join(resolve(d), 'replay-set.json'), null);
    if (m?.runs) for (const r of m.runs) for (const x of r.exits ?? []) expanded.push({ dir: resolve(x.dir), from: `replay-set ${basename(resolve(d))}:${r.label}`, exit: x.exit });
    else expanded.push({ dir: resolve(d), from: 'run folder' });
  }
  const attempts = [];
  for (const x of expanded) {
    if (!existsSync(x.dir)) { attempts.push({ runId: basename(x.dir), from: x.from, status: 'missing', arm: null, note: 'listed but not on disk' }); continue; }
    try {
      const { evaluation: e } = await evaluateRun(x.dir, { questions, write: false, now });
      attempts.push({ runId: e.run.runId, from: x.from, kind: e.run.kind, status: e.run.status, arm: e.run.arm, identity: e.run.identity, conditions: e.run.conditions, measures: e.measures, questions: [...e.acceptance.predeclared, ...e.questions], conflicts: e.conflicts.length, coverage: { requests: e.coverage.requests, observerEvidencePacks: e.coverage.observerEvidencePacks } });
    } catch (err) { attempts.push({ runId: basename(x.dir), from: x.from, status: 'unreadable', arm: null, note: String(err.message).slice(0, 200) }); }
  }
  const arms = [];
  for (const a of attempts.filter((t) => t.arm)) {
    let arm = arms.find((x) => x.arm === a.arm);
    if (!arm) arms.push((arm = { arm: a.arm, identity: a.identity, attempts: [], repeats: [] }));
    arm.attempts.push({ runId: a.runId, status: a.status, kind: a.kind, from: a.from });
    if (a.status === 'completed') arm.repeats.push(a.runId);
  }
  for (const arm of arms) {
    const reps = attempts.filter((t) => t.arm === arm.arm && t.status === 'completed');
    const ids = [...new Set(reps.flatMap((r) => r.measures.map((m) => m.id)))];
    arm.measures = Object.fromEntries(ids.map((id) => {
      const per = reps.map((r) => ({ runId: r.runId, m: r.measures.find((m) => m.id === id) }));
      const values = Object.fromEntries(per.map(({ runId, m }) => [runId, m?.status === 'measured' ? m.value : null]));
      const d = dist(Object.values(values));
      const units = [...new Set(per.map((p) => p.m?.unit).filter(Boolean))];
      return [id, { family: per.find((p) => p.m)?.m.family, unit: units.join('|'), values, measured: d.n, unavailable: per.length - d.n, median: d.median, min: d.min, max: d.max, ...(units.length > 1 ? { flag: 'units differ across repeats' } : {}) }];
    }));
    const qids = [...new Set(reps.flatMap((r) => r.questions.map((q) => q.id)))];
    arm.questions = Object.fromEntries(qids.map((id) => {
      const v = Object.fromEntries(reps.map((r) => { const q = r.questions.find((x) => x.id === id); return [r.runId, q ? { verdict: q.verdict, basis: q.basis, version: q.version } : null]; }));
      const versions = [...new Set(Object.values(v).filter(Boolean).map((x) => x.version))];
      return [id, { verdicts: v, pass: Object.values(v).filter((x) => x?.verdict === 'pass').length, fail: Object.values(v).filter((x) => x?.verdict === 'fail').length, unknown: Object.values(v).filter((x) => !x || x.verdict === 'unknown').length, ...(versions.length > 1 ? { flag: `scorer versions differ: ${versions.join(', ')}` } : {}) }];
    }));
    const keys = ['commit', 'dirtyTrackedFiles', 'node', 'cli', 'skill', 'build', 'machine', 'observer'];
    const all = attempts.filter((t) => t.arm === arm.arm);
    arm.conditions = Object.fromEntries(all.map((t) => [t.runId, t.conditions]));
    arm.conditionsDiffer = keys.filter((k) => new Set(all.map((t) => JSON.stringify(k === 'machine' ? { ok: t.conditions?.machine?.machineOk } : t.conditions?.[k]))).size > 1);
    if (all.some((t) => t.conditions?.dirtyTrackedFiles)) arm.caveats = [`source not exactly identified for ${all.filter((t) => t.conditions?.dirtyTrackedFiles).map((t) => t.runId).join(', ')} (uncommitted tracked files)`];
    if (reps.length < 2) arm.caveats = [...(arm.caveats ?? []), `${reps.length} completed repeat(s): no spread can be read`];
  }
  const incompatible = [];
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const differ = Object.keys(arms[i].identity).filter((k) => JSON.stringify(arms[i].identity[k]) !== JSON.stringify(arms[j].identity[k]));
    incompatible.push({ arms: [arms[i].arm, arms[j].arm], differ });
  }
  return { schema: INDEX_SCHEMA, createdAt: now().toISOString(), evaluator: { ...EVALUATOR }, pooled: 'within an arm only; arms are never averaged together', attempts: attempts.map(({ measures, questions: q, identity, ...rest }) => rest), arms, incompatible };
}

export function renderIndex(ix) {
  const L = [`# Run comparison`, '', `${ix.attempts.length} attempt(s), ${ix.arms.length} arm(s). ${ix.pooled}.`, ''];
  for (const a of ix.arms) {
    L.push(`## Arm \`${a.arm}\``, '', `Attempts: ${a.attempts.map((t) => `${t.runId} (${t.status})`).join(', ')}. Completed repeats: ${a.repeats.length}.${a.conditionsDiffer.length ? ` Conditions differ: ${a.conditionsDiffer.join(', ')}.` : ''}${a.caveats ? ` Caveats: ${a.caveats.join('; ')}.` : ''}`, '');
    if (a.repeats.length) {
      L.push(`| measure | unit | ${a.repeats.join(' | ')} | measured / unavailable |`, `|---|---|${a.repeats.map(() => '---').join('|')}|---|`);
      for (const [id, m] of Object.entries(a.measures)) L.push(`| ${id} | ${m.unit} | ${a.repeats.map((r) => fmt(m.values[r])).join(' | ')} | ${m.measured} / ${m.unavailable} |`);
      for (const [id, q] of Object.entries(a.questions)) L.push(`| question ${id} | verdict | ${a.repeats.map((r) => q.verdicts[r]?.verdict ?? '—').join(' | ')} | ${q.pass} pass, ${q.fail} fail, ${q.unknown} unknown${q.flag ? `; ${q.flag}` : ''} |`);
      L.push('');
    }
  }
  if (ix.incompatible.length) { L.push('## Incompatible arms (not pooled)', ''); for (const x of ix.incompatible) L.push(`- \`${x.arms[0]}\` vs \`${x.arms[1]}\`: differ in ${x.differ.join(', ') || 'nothing listed (check conditions)'}`); }
  const other = ix.attempts.filter((t) => !t.arm);
  if (other.length) L.push('', '## Attempts not in an arm', '', ...other.map((t) => `- ${t.runId}: ${t.status} (${t.note ?? ''})`));
  return L.join('\n') + '\n';
}
