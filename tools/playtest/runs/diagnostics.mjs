// Soul Runs diagnostics (SR3, #752): opt-in attachment of the passive soul-trace capture (#733, tools/soul-trace/tap.mjs,
// contract soul-trace/1) to temporary run controllers, plus correlation of the trace with the run's own records and a
// link to the local inspector (#624, tools/soul-trace/inspect.mjs). Capture, viewing and analysis are separate choices:
// the spec only turns capture on for named seats; `run.mjs inspect` opens the viewer; `run.mjs correlate` analyses.
// Nothing here re-implements capture, the readout or the inspector; when they are not in this checkout the capability
// is reported unavailable and a run that asks for it is refused before anything starts.
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../lib/hash.mjs';
import { run } from '../lib/proc.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';

export const TRACE = Object.freeze({
  capability: 'soul-trace', contract: 'soul-trace/1',
  tap: 'tools/soul-trace/tap.mjs', readout: 'tools/soul-trace/readout.mjs', inspector: 'tools/soul-trace/inspect.mjs',
  owners: { capture: '#733 (PR #757)', inspector: '#624 (PR #758)', boundary: '#623' },
});
// The one controller path this attaches to: the scripted owner runs every CLI command itself, so the preload is added
// to exactly those processes. Live agent seats run `node eden.mjs` through their own shell; reaching those would need
// NODE_OPTIONS for every node process the agent starts, which #733 has not qualified.
export const TRACE_ADAPTERS = ['scripted-owner'];
const REF = /^[A-Za-z0-9._:-]{1,100}$/;
// Experience reports (#590 A17): the client's own opt-in record. Unlike the tap they need no preload, so every kind of seat can
// carry one: the run creates the switch in the seat's folder and copies the file out afterwards.
export const REPORTS = Object.freeze({ cli: 'tools/world-launcher/soul/eden.mjs', switchFile: '.eden-report-on', file: '.eden-report.jsonl' });

const file = (root, rel) => { const p = join(root, rel); return existsSync(p) ? { path: rel, sha256: sha256(readFileSync(p)).slice(0, 16) } : null; };
/** What this checkout offers: the tap (capture), readout (analysis) and inspector (viewer), each with its hash. */
export function traceCapability({ root = REPO_ROOT } = {}) {
  const tap = file(root, TRACE.tap), readout = file(root, TRACE.readout), inspector = file(root, TRACE.inspector);
  return {
    capability: TRACE.capability, contract: TRACE.contract, available: !!tap, tap, readout, inspector,
    ...(tap ? {} : { reason: `${TRACE.tap} is not in this checkout (capture is owned by ${TRACE.owners.capture})` }),
    ...(inspector ? {} : { inspectorReason: `${TRACE.inspector} is not in this checkout (owned by ${TRACE.owners.inspector})` }),
  };
}

/** spec.diagnostics = {trace?: true | [seatIds], reports?: true | [seatIds]} → {errors, effective}. Off (absent) is the default and adds nothing. */
export function validateDiagnostics(diag, seats, { root = REPO_ROOT } = {}) {
  const errors = [], fail = (code, message) => errors.push({ code, message });
  if (diag == null) return { errors, effective: null };
  if (typeof diag !== 'object' || Array.isArray(diag)) return { errors: [{ code: 'diagnostics', message: 'diagnostics: {trace: true | [seat ids], reports: true | [seat ids]}' }], effective: null };
  for (const k of Object.keys(diag)) if (k !== 'trace' && k !== 'reports') fail('diagnostics.unknown-field', `diagnostics.${k} is unknown (diagnostics takes trace and reports; viewing and analysis are separate commands)`);
  const seatIds = (name, v) => {
    if (v == null || v === false) return null;
    if (v !== true && !(Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'))) { fail(`diagnostics.${name}`, `diagnostics.${name}: true (every seat) or a list of seat ids`); return null; }
    const ids = v === true ? seats.map((s) => s.id) : v;
    for (const id of ids) {
      if (!seats.find((x) => x.id === id)) fail('diagnostics.seat', `diagnostics.${name}: ${id} is not a seat`);
      else if (!REF.test(id)) fail('diagnostics.seat-id', `diagnostics.${name}: seat id ${id} is not a valid trace reference`);
    }
    return ids;
  };
  const traced = seatIds('trace', diag.trace), reported = seatIds('reports', diag.reports);
  for (const id of traced ?? []) {
    const s = seats.find((x) => x.id === id);
    if (s && !TRACE_ADAPTERS.includes(s.adapter)) fail('diagnostics.unsupported-adapter', `diagnostics.trace: seat ${id} uses ${s.adapter}; trace attachment is supported for ${TRACE_ADAPTERS.join(', ')} only (live agent seats would need NODE_OPTIONS, not qualified by #733)`);
  }
  const capability = traced ? traceCapability({ root }) : null;
  if (capability && !capability.available) fail('diagnostics.unavailable', `diagnostics.trace requested but ${capability.reason}`);
  if (reported) { const cli = join(root, REPORTS.cli); if (!existsSync(cli) || !readFileSync(cli, 'utf8').includes(REPORTS.switchFile)) fail('diagnostics.reports-unavailable', `diagnostics.reports requested but ${REPORTS.cli} has no experience reports (#590)`); }
  if (errors.length || (!traced && !reported)) return { errors, effective: null };
  return { errors, effective: { ...(traced ? { trace: { seats: traced, ...capability } } : {}), ...(reported ? { reports: { seats: reported } } : {}) } };
}

/** The tap must load cleanly with capture off, or every traced CLI call would fail: checked once before play. */
export async function checkTap({ root = REPO_ROOT, maxWallMs = 10000 } = {}) {
  const tap = join(root, TRACE.tap);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SOUL_TRACE_')));
  const t0 = Date.now();
  const r = await run(process.execPath, ['--import', pathToFileURL(tap).href, '-e', ''], { cwd: root, env: { ...env, SOUL_TRACE_FILE: '' }, maxWallMs });
  return { ok: r.code === 0, ms: Date.now() - t0, ...(r.code === 0 ? {} : { error: (() => { const ls = (r.stderr || `exit ${r.code}`).split('\n').filter((l) => l.trim()); return (ls.find((l) => /\w*Error\b/.test(l)) ?? ls[0] ?? '').slice(0, 200); })() }) };
}

/** Attach capture to the effective scenario's traced seats (in place) and return the receipt section. */
export function attachTrace(scenario, { effective, runId, runDir, root = REPO_ROOT }) {
  if (!effective?.trace) return null;
  const dir = join(runDir, 'diagnostics'); mkdirSync(dir, { recursive: true });
  const seats = {};
  for (const s of scenario.seats ?? []) {
    if (!effective.trace.seats.includes(s.id)) continue;
    const f = join(dir, `${s.id}.trace.jsonl`);
    s.diagnostics = { trace: { tap: pathToFileURL(join(root, TRACE.tap)).href, file: f, run: runId, seat: s.id } };
    seats[s.id] = { file: relative(runDir, f), run: runId, seat: s.id };
  }
  return {
    capture: { capability: TRACE.capability, contract: TRACE.contract, tap: effective.trace.tap, seats },
    // Viewer and analysis are separate, explicit choices; neither starts with the run.
    viewer: effective.trace.inspector ? { command: 'node tools/playtest/runs/run.mjs inspect <runDir> --seat <id>', inspector: effective.trace.inspector, startedByRun: false } : { available: false, reason: effective.trace.inspectorReason },
    analysis: { command: 'node tools/playtest/runs/run.mjs correlate <runDir>', readout: effective.trace.readout, startedByRun: false },
    sharing: 'none: traces are private run evidence (retention class evidence), never a publication input',
  };
}

/** Mark the effective scenario's reporting seats (in place) and return the receipt section. Off returns null. */
export function attachReports(scenario, { effective }) {
  if (!effective?.reports) return null;
  const seats = {};
  for (const s of scenario.seats ?? []) {
    if (!effective.reports.seats.includes(s.id)) continue;
    s.diagnostics = { ...s.diagnostics, reports: true };
    seats[s.id] = { file: `diagnostics/${s.id}.report.jsonl` };
  }
  return { seats, analysis: { command: 'node tools/playtest/runs/run.mjs correlate <runDir>', startedByRun: false }, sharing: 'none: reports are private run evidence, never a publication input' };
}

/** After the run: copy each seat's report out of its folder, which retention may delete, and say what it holds. */
export function collectReports(runDir, playtestDir, section) {
  if (!section?.seats) return null;
  const out = {};
  mkdirSync(join(runDir, 'diagnostics'), { recursive: true });
  for (const [seat, s] of Object.entries(section.seats)) {
    const from = join(playtestDir ?? join(runDir, 'playtest'), 'seats', seat, 'folder', REPORTS.file), to = join(runDir, s.file);
    if (!existsSync(from)) { out[seat] = { ...s, present: false, note: 'no report written (no reporting CLI ran, or the served CLI has none)' }; continue; }
    copyFileSync(from, to);
    const text = readFileSync(to, 'utf8'), recs = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
    out[seat] = { ...s, present: true, bytes: statSync(to).size, sha256: sha256(text), records: recs.length, unparsed: recs.filter((r) => !r).length, http: recs.filter((r) => r?.kind === 'http').length, notes: recs.filter((r) => r?.kind === 'note').length };
  }
  return out;
}

/** Process arguments and environment for one CLI process of a traced seat; off (no trace) returns nothing to add. */
export function traceLaunch(diagnostics) {
  const t = diagnostics?.trace;
  if (!t) return { pre: [], env: undefined };
  return { pre: ['--import', t.tap], env: { SOUL_TRACE_FILE: t.file, SOUL_TRACE_RUN: t.run, SOUL_TRACE_SEAT: t.seat } };
}

/** After the run: what each trace file holds (no interpretation): bytes, hash, records, processes, losses, ids seen. */
export function summarizeTraces(runDir, section) {
  if (!section?.capture) return null;
  const out = {};
  for (const [seat, s] of Object.entries(section.capture.seats)) {
    const f = join(runDir, s.file);
    if (!existsSync(f)) { out[seat] = { ...s, present: false, note: 'no trace written (no traced CLI process ran, or every write failed)' }; continue; }
    const text = readFileSync(f, 'utf8'), lines = text.split('\n').filter(Boolean);
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
    const starts = recs.filter((r) => r?.kind === 'proc.start'), ends = recs.filter((r) => r?.kind === 'proc.end');
    const loss = (k) => ends.reduce((a, r) => a + (Number(r.stats?.[k]) || 0), 0);
    out[seat] = {
      ...s, present: true, bytes: statSync(f).size, sha256: sha256(text), records: lines.length, unparsed: recs.filter((r) => !r).length,
      processes: starts.length, closed: ends.length, http: recs.filter((r) => r?.kind === 'http').length,
      loss: { dropped: loss('dropped'), truncated: loss('truncated'), sinkFailures: loss('sinkFailures'), inFlightAtExit: loss('inFlightAtExit') },
      ids: { run: [...new Set(starts.map((r) => r.run ?? null))], seat: [...new Set(starts.map((r) => r.seat ?? null))] },
      commands: Object.fromEntries([...new Set(starts.map((r) => r.command))].map((c) => [c, starts.filter((r) => r.command === c).length])),
    };
  }
  return out;
}

const count = (xs) => xs.reduce((o, x) => ({ ...o, [x]: (o[x] ?? 0) + 1 }), {});
/** Where a seat's report disagrees with its transcript, the world's receipts and the scorecard. A list, with no verdict: each side
 *  keeps its own account, and which is right is for whoever reads the evidence. `card` is a saved scorecard or null. */
export function reportDisagreements({ seat, rows, steps, packs = [], card = null, actOutput, receiptOutcome }) {
  const out = [], acts = rows.filter((r) => r.kind === 'http' && r.route === '/v1/edge/act');
  const reported = [...new Set(acts.map((r) => r.facts?.receipt?.id).filter(Boolean))], refused = acts.filter((r) => r.facts?.accepted === false).map((r) => r.facts.code ?? 'unknown');
  const said = steps.filter((s) => s.verb === 'act').map((s) => actOutput(s.out)).filter(Boolean);
  const printed = [...new Set(said.map((o) => o.receipt?.id).filter(Boolean))], turnedDown = said.filter((o) => o.accepted === false || (!o.receipt && o.code)).map((o) => o.code ?? 'unknown');
  for (const id of reported) if (!printed.includes(id)) out.push({ kind: 'receipt.report-only', receipt: id, note: 'in the report, never printed to the seat (a plan step serve ran, or a lost transcript line)' });
  for (const id of printed) if (!reported.includes(id)) out.push({ kind: 'receipt.transcript-only', receipt: id, note: 'printed to the seat, no report row (reports off for that process, or rows dropped)' });
  const a = count(refused), b = count(turnedDown);
  for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[code] ?? 0) !== (b[code] ?? 0)) out.push({ kind: 'refusals.count', code, report: a[code] ?? 0, transcript: b[code] ?? 0 });
  const asSteps = rows.filter((r) => r.facts?.receipt?.id).map((r) => ({ out: { receipt: r.facts.receipt } }));
  for (const id of reported.filter((x) => printed.includes(x))) { const report = receiptOutcome(id, asSteps), world = receiptOutcome(id, steps, packs); if (report !== world) out.push({ kind: 'receipt.outcome', receipt: id, report, world }); }
  if (card) {
    const mine = (card.intentions ?? []).filter((i) => i.seat === seat).flatMap((i) => i.acts ?? []);
    const scored = { accepted: new Set(mine.filter((x) => x.state === 'accepted').map((x) => x.receipt).filter(Boolean)).size, refused: mine.filter((x) => x.state === 'refused').length };
    if (scored.accepted !== reported.length) out.push({ kind: 'scorecard.accepted', report: reported.length, scorecard: scored.accepted });
    if (scored.refused !== refused.length) out.push({ kind: 'scorecard.refused', report: refused.length, scorecard: scored.refused });
  }
  return out;
}

/** Each reporting seat of a finished run against the run's own records. Reports and traces are independent; either can be off. */
async function correlateReports(sr, section, { root }) {
  const { actOutput, receiptOutcome } = await import('./controllability.mjs');
  const evalDir = join(sr.runDir, 'evaluations'), latest = existsSync(evalDir) ? readdirSync(evalDir).sort().reverse().find((d) => existsSync(join(evalDir, d, 'scorecard.json'))) : null;
  const card = latest ? JSON.parse(readFileSync(join(evalDir, latest, 'scorecard.json'), 'utf8')) : null;
  const readout = traceCapability({ root }).readout ? await import(pathToFileURL(join(root, TRACE.readout)).href) : null, seats = {};
  for (const [seat, s] of Object.entries(section.seats)) {
    const f = join(sr.runDir, s.file);
    if (!existsSync(f)) { seats[seat] = { report: s.file, present: false }; continue; }
    const text = readFileSync(f, 'utf8'), rows = text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    seats[seat] = { report: s.file, present: true, records: rows.length, anomalies: readout ? readout.reconstruct(text).anomalies : null, notes: rows.filter((r) => r.kind === 'note').map((r) => ({ annotation: r.annotation, expected: r.expected, observed: r.observed })), disagreements: reportDisagreements({ seat, rows, steps: sr.steps[seat] ?? [], packs: sr.run?.evidence ?? [], card, actOutput, receiptOutcome }) };
  }
  return { scorecard: latest ? `evaluations/${latest}/scorecard.json` : null, seats };
}

/** Correlate a finished run's traces with its director records and seat transcripts. Keeps every original id and clock,
 *  lists what is missing, and keeps ack, admission (accepted), physical start and completion as separate facts. */
export async function correlateRun(runDir, { root = REPO_ROOT } = {}) {
  const { loadSoulRun, joinRequests } = await import('./evaluate.mjs');
  const sr = loadSoulRun(runDir);
  const section = sr.receipt?.diagnostics ?? null;
  const cap = traceCapability({ root });
  const reports = section?.reports ? await correlateReports(sr, section.reports, { root }) : null, withReports = reports ? { reports } : {};
  if (!section?.capture) return { runId: sr.runId, capture: 'off', ...(reports ? withReports : { note: 'this run did not request diagnostics; nothing was captured' }) };
  if (!cap.readout) return { runId: sr.runId, capture: 'on', analysis: 'unavailable', reason: `${TRACE.readout} is not in this checkout (${TRACE.owners.capture})`, ...withReports };
  const { reconstruct } = await import(pathToFileURL(join(root, TRACE.readout)).href);
  const requests = joinRequests(sr);
  const seats = {};
  for (const [seat, s] of Object.entries(section.capture.seats)) {
    const f = join(sr.runDir, s.file);
    if (!existsSync(f)) { seats[seat] = { trace: s.file, present: false }; continue; }
    const t = reconstruct(readFileSync(f, 'utf8'));
    const procs = t.processes;
    const foreign = procs.filter((p) => p.run !== s.run || p.seat !== s.seat);
    const rows = requests.filter((r) => r.seat === seat).map((r) => {
      const ep = t.episodes.find((e) => e.origin.id === r.messageId) ?? null;
      const missing = [];
      if (!r.messageId) missing.push('director record has no owner message id');
      if (!ep) missing.push('no traced delivery of this owner message (listen not traced, killed, or capture lost)');
      if (ep && !ep.acts.length && r.physical.length) missing.push('the seat ran acts the trace did not link to this message');
      if (r.ackSec == null) missing.push('no ack in the seat transcript');
      return {
        requestId: r.requestId, seat, run: s.run, messageId: r.messageId,
        director: { sentAt: r.sentAt, cutoff: r.director },
        seatTranscript: { ackAt: r.ackAt, result: r.seatResult, refs: r.refs.map((x) => `${x.path}:${x.line ?? ''}`) },
        trace: ep ? {
          sentAt: ep.origin.sentAt, deliveredAt: ep.deliveredAt, deliveredBy: ep.deliveredBy, firstCommand: ep.firstCommand,
          inbox: ep.inbox, acts: ep.acts.map((a) => ({ op: a.op, link: a.link, attempts: a.attempts, outcome: a.outcome, code: a.code, receipt: a.receipt })),
        } : null,
        clocks: { director: 'local wall (decisions.jsonl t)', seat: 'local wall (transcript _rx)', trace: 'local wall `at`, process `mono`; owner sentAt is server wall; receipt ticks are world ticks' },
        // Never equated: the seat's ack (owner told), the world's admission (accepted), physical start and terminal phase.
        stages: ep ? ep.acts.map((a) => ({ receipt: a.receipt?.id ?? null, capability: a.receipt?.capability ?? null, ackedByOwnerCard: ep.inbox.some((x) => x.verb === 'ack'), admitted: a.outcome, acceptedTick: a.receipt?.ticks?.accepted ?? null, startedTick: a.receipt?.ticks?.started ?? null, endedTick: a.receipt?.ticks?.ended ?? null, terminal: a.receipt?.terminal ?? null })) : [],
        missing,
      };
    });
    seats[seat] = { trace: s.file, records: t.records, processes: procs.length, foreignProcesses: foreign.length, anomalies: t.anomalies, episodes: t.episodes.length, unlinked: t.unlinked, requests: rows };
  }
  return { schema: 'soul-run-trace-correlation/1', runId: sr.runId, replay: false, capability: { contract: TRACE.contract, readout: cap.readout, tapAtRun: section.capture.tap }, seats, ...withReports };
}
