#!/usr/bin/env node
// Local readout of soul-trace/1 JSONL (#733). A timeline reconstruction from what
// was captured, never a replay. Links are made only by recorded identities (owner
// message id, `for`, receipt id, idempotency key); nothing is joined by nearby time.
// Intervals across clock domains are labelled approximate.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {SCHEMA} from './tap.mjs';

const TERMINAL = new Set(['completed', 'failed', 'replaced', 'interrupted', 'cancelled', 'refused']);
const ORDER = ['accepted', 'waiting', 'started', 'completed', 'failed', 'replaced', 'interrupted', 'cancelled'];
const ACT = /^\/v1\/edge\/(act|objects\/[^/]+\/act)$/;
const INBOX = /^\/v1\/edge\/inbox\/([^/?]+)\/(ack|result)$/;

export function parse(text) {
  const records = [], bad = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = JSON.parse(line);
      if (r?.v !== SCHEMA || typeof r.proc !== 'string' || !Number.isSafeInteger(r.seq)) throw Error('schema');
      records.push({...r, line: i + 1});
    } catch { bad.push(i + 1); }
  });
  return {records, bad};
}

export function reconstruct(text) {
  const {records, bad} = parse(text), anomalies = [], procs = new Map(), seen = new Map();
  if (bad.length) anomalies.push({type: 'unparsed-lines', lines: bad.slice(0, 20), count: bad.length});
  const kept = [], hostRecs = [];
  for (const r of records) {
    const key = r.proc + ':' + r.seq;
    if (seen.has(key)) { anomalies.push({type: 'duplicate', proc: r.proc, seq: r.seq, line: r.line}); continue; }
    seen.set(key, r);
    // Host boundaries (host.mjs) are written by the chat host, not by a CLI process.
    if (typeof r.kind === 'string' && r.kind.startsWith('host.')) { hostRecs.push(r); continue; }
    const p = procs.get(r.proc) ?? {proc: r.proc, seqs: [], maxSeq: 0};
    procs.set(r.proc, p);
    if (r.seq < p.maxSeq) anomalies.push({type: 'reordered', proc: r.proc, seq: r.seq, after: p.maxSeq, line: r.line});
    p.maxSeq = Math.max(p.maxSeq, r.seq); p.seqs.push(r.seq);
    if (r.kind === 'proc.start') p.start = r;
    if (r.kind === 'proc.end') p.end = r;
    kept.push(r);
  }
  for (const p of procs.values()) {
    const missing = p.maxSeq - new Set(p.seqs).size;
    if (!p.start) anomalies.push({type: 'missing-start', proc: p.proc});
    if (missing > 0) anomalies.push({type: 'missing-records', proc: p.proc, count: missing});
    if (!p.end) anomalies.push({type: 'unclosed-process', proc: p.proc, command: p.start?.command ?? null, note: 'killed, restarted, still running or its last batch was lost'});
    const s = p.end?.stats;
    if (s && (s.dropped || s.truncated || s.sinkFailures || s.inFlightAtExit || s.bodiesPendingAtExit)) anomalies.push({type: 'capture-loss', proc: p.proc, ...s});
  }
  // A second listen starting while an earlier one never closed is a restart/takeover.
  const listens = [...procs.values()].filter(p => p.start?.command === 'listen').sort((a, b) => a.start.at - b.start.at);
  for (let i = 1; i < listens.length; i++) if (!listens[i - 1].end || listens[i - 1].end.at > listens[i].start.at) anomalies.push({type: 'restart', proc: listens[i].proc, previous: listens[i - 1].proc});

  // Ordered by local wall clock for display only; per-process order is by seq.
  const http = kept.filter(r => r.kind === 'http').sort((a, b) => a.at - b.at || a.seq - b.seq);
  const messages = new Map(), receipts = new Map();
  const observeReceipt = (fact, r) => {
    const x = receipts.get(fact.id) ?? {id: fact.id, phases: {}, lastRank: -1};
    receipts.set(fact.id, x);
    for (const k of ['soulId', 'capability', 'acceptedTick', 'startedTick', 'firstMotionTick', 'endedTick', 'code']) if (fact[k] !== undefined) x[k] = fact[k];
    const rank = ORDER.indexOf(fact.phase);
    if (fact.phase && !(fact.phase in x.phases)) x.phases[fact.phase] = r.at;
    if (rank >= 0 && rank < x.lastRank && TERMINAL.has(x.terminal)) anomalies.push({type: 'stale-receipt', receipt: fact.id, phase: fact.phase, after: x.terminal, proc: r.proc, seq: r.seq});
    if (TERMINAL.has(fact.phase) && !x.terminal) x.terminal = fact.phase;
    x.lastRank = Math.max(x.lastRank, rank);
  };
  for (const r of http) {
    const f = r.facts ?? {};
    for (const m of f.messages ?? []) if (!messages.has(m.id) && m.state !== 'acknowledged') messages.set(m.id, {id: m.id, sentAt: m.sentAt ?? null, deliveredAt: r.at, deliveredBy: r.proc, route: r.route});
    if (f.receipt) observeReceipt(f.receipt, r);
    for (const e of f.events ?? []) observeReceipt(e, r);
  }
  const acts = new Map();
  for (const r of http.filter(r => r.method === 'POST' && ACT.test(r.route?.split('?')[0] ?? ''))) {
    const key = r.op ?? r.proc + ':' + r.seq, a = acts.get(key) ?? {op: r.op ?? null, proc: r.proc, route: r.route, attempts: [], for: null, linkSource: 'world', receipt: null};
    acts.set(key, a);
    a.attempts.push({attempt: r.attempt ?? 1, status: r.status, accepted: r.facts?.accepted ?? null, code: r.facts?.code ?? null, ...(r.facts?.alternatives?.length ? {alternatives: r.facts.alternatives} : {}), durationMs: r.durationMs ?? null, at: r.at});
    if (r.facts?.for) { a.for = r.facts.for; a.linkSource = 'world'; }
    else if (r.requestedFor && !a.for) { a.for = r.requestedFor; a.linkSource = 'requested'; }
    if (r.facts?.receipt?.id) a.receipt = r.facts.receipt.id;
    a.firstAt ??= r.at;
  }
  const inbox = http.filter(r => r.method === 'POST' && INBOX.test(r.route?.split('?')[0] ?? '')).map(r => {
    const [, id, verb] = r.route.split('?')[0].match(INBOX);
    return {id, verb, status: r.status, at: r.at};
  });
  const starts = [...procs.values()].map(p => p.start).filter(Boolean).sort((a, b) => a.at - b.at);
  const actView = a => {
    const rec = a.receipt ? receipts.get(a.receipt) : null, last = a.attempts.at(-1);
    if (rec && !rec.terminal) anomalies.push({type: 'receipt-unresolved', receipt: rec.id, note: 'no terminal phase observed in this trace'});
    return {op: a.op, link: a.for ? a.linkSource : null, attempts: a.attempts, outcome: last.status === 0 ? 'unreachable' : last.status >= 200 && last.status < 300 && last.accepted !== false ? 'accepted' : 'refused', code: last.code,
      receipt: rec ? {id: rec.id, capability: rec.capability ?? null, terminal: rec.terminal ?? null, code: rec.code ?? null,
        ticks: {accepted: rec.acceptedTick ?? null, started: rec.startedTick ?? null, firstMotion: rec.firstMotionTick ?? null, ended: rec.endedTick ?? null}, firstObservedAt: rec.phases} : null};
  };
  const host = hostIndex(hostRecs, procs, http, anomalies);
  const episodes = [...messages.values()].sort((a, b) => a.deliveredAt - b.deliveredAt).map(m => {
    const linked = [...acts.values()].filter(a => a.for === m.id);
    const firstCommand = starts.find(s => s.at > m.deliveredAt && s.command !== 'listen' && s.proc !== m.deliveredBy);
    return {origin: {kind: 'owner-message', id: m.id, sentAt: m.sentAt}, deliveredAt: m.deliveredAt, deliveredBy: m.deliveredBy,
      firstCommand: firstCommand ? {command: firstCommand.command ?? null, at: firstCommand.at, proc: firstCommand.proc} : null,
      host: hostGap(m, host, firstCommand, anomalies),
      inbox: inbox.filter(x => x.id === m.id), acts: linked.map(actView)};
  });
  for (const t of host.turns.values()) if (!t.for || !messages.has(t.for)) anomalies.push({type: 'host-turn-unlinked', turn: t.id, for: t.for ?? null, note: t.for ? 'its message was not delivered in this trace' : 'no `for` recorded'});
  const unlinked = [...acts.values()].filter(a => !a.for || !messages.has(a.for)).map(a => ({origin: {kind: 'unknown', for: a.for}, ...actView(a)}));
  return {schema: SCHEMA, kind: 'timeline-reconstruction', replay: false, records: kept.length, anomalies,
    processes: [...procs.values()].map(p => ({proc: p.proc, command: p.start?.command ?? null, cli: p.start?.cli ?? null, cliSha256: p.start?.cliSha256 ?? null,
      run: p.start?.run ?? null, seat: p.start?.seat ?? null, turn: p.start?.turn ?? null, tool: p.start?.tool ?? null, startAt: p.start?.at ?? null, durationMs: p.end?.durationMs ?? null, exitCode: p.end?.exitCode ?? null, closed: !!p.end})),
    episodes, unlinked};
}

const ticks = n => `${n} ticks (≈${n * 50} ms at 20 Hz)`;

// ── host boundaries (host.mjs) ─────────────────────────────────────────────────────────────────────────────────
/** Turns and tool calls from host records; procs are linked to a tool only by the id on their proc.start. */
function hostIndex(recs, procs, http, anomalies) {
  const turns = new Map(), tools = new Map(), at = r => ({at: r.at, mono: r.mono, proc: r.proc});
  for (const r of [...recs].sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    if (r.kind === 'host.turn' && r.turn) {
      const t = turns.get(r.turn) ?? {id: r.turn, for: null, start: null, end: null};
      turns.set(r.turn, t);
      if (r.for) t.for ??= r.for;
      if (r.phase === 'start') t.start ??= at(r); else if (r.phase === 'end') t.end ??= at(r);
    } else if ((r.kind === 'host.tool' || r.kind === 'host.spawn') && r.tool) {
      const c = tools.get(r.tool) ?? {id: r.tool, turn: null, start: null, spawn: null, end: null, exitCode: null};
      tools.set(r.tool, c);
      if (r.turn) c.turn ??= r.turn;
      if (r.kind === 'host.spawn') c.spawn ??= at(r);
      else if (r.phase === 'start') c.start ??= at(r);
      else if (r.phase === 'end') { c.end ??= at(r); c.exitCode = r.exitCode ?? null; }
    }
  }
  const byTool = new Map();
  for (const p of procs.values()) {
    const tool = p.start?.tool;
    if (!tool) continue;
    if (!tools.has(tool)) { anomalies.push({type: 'host-tool-missing', proc: p.proc, tool, note: 'the process names a tool call the host did not record'}); continue; }
    const first = http.filter(r => r.proc === p.proc && Number.isFinite(r.startMono)).sort((a, b) => a.startMono - b.startMono)[0];
    if (!byTool.has(tool)) byTool.set(tool, {p, first});
  }
  for (const c of tools.values()) if (c.turn && !turns.has(c.turn)) anomalies.push({type: 'host-tool-unlinked', tool: c.id, turn: c.turn});
  return {turns, tools, byTool};
}

/** Boundary names in causal order, and what the interval ending at each one is. */
export const HOST_SEGMENTS = {
  'turn.start': 'host picks up the delivery',
  'tool.start': 'host reasoning before the tool call',
  spawn: 'tool runner before spawn',
  'proc.origin': 'process spawn (exec)',
  'proc.start': 'Node boot and tap load',
  'first.request': 'CLI start to first request',
};
const ORDERED = ['delivered', ...Object.keys(HOST_SEGMENTS)];
const round = ms => Math.round(ms * 1000) / 1000;

/**
 * The delivery → first-command gap of one episode, split at recorded host boundaries; null without a linked turn.
 * Only the earliest turn that names the message is used, and only tool calls that name that turn; a later turn or a
 * tool call without a turn is not attached (deterministic, never joined by time). When no tool call links a command,
 * the rest of the gap up to the first command (found by time, as without host records) stays unattributed.
 */
function hostGap(m, {turns, tools, byTool}, firstCommand = null, anomalies = []) {
  const turn = [...turns.values()].filter(t => t.for === m.id && t.start).sort((a, b) => a.start.at - b.start.at)[0];
  if (!turn) return null;
  const calls = [...tools.values()].filter(c => c.turn === turn.id).sort((a, b) => (a.start?.at ?? a.spawn?.at ?? 0) - (b.start?.at ?? b.spawn?.at ?? 0));
  // The first tool call whose CLI process is linked and is a command (a listen is not the answer to the message).
  const call = calls.find(c => byTool.has(c.id) && byTool.get(c.id).p.start.command !== 'listen') ?? null;
  const linked = call ? byTool.get(call.id) : null, ps = linked?.p.start;
  const pts = {delivered: {at: m.deliveredAt, mono: null, proc: m.deliveredBy}, 'turn.start': turn.start, 'tool.start': call?.start ?? null, spawn: call?.spawn ?? null,
    'proc.origin': ps?.timeOrigin ? {at: ps.timeOrigin, mono: 0, proc: ps.proc, origin: true} : null,
    'proc.start': ps ? {at: ps.at, mono: ps.mono, proc: ps.proc} : null,
    'first.request': linked?.first ? {at: ps.at + (linked.first.startMono - ps.mono), mono: linked.first.startMono, proc: ps.proc} : null};
  const before = [], segments = [];
  let prev = 'delivered';
  for (const name of ORDERED.slice(1)) {
    const p = pts[name];
    if (!p) continue;
    if (p.at < pts[prev].at && prev === 'delivered') { before.push({boundary: name, msBeforeDelivery: round(pts.delivered.at - p.at)}); continue; }
    const a = pts[prev], exact = a.proc === p.proc && Number.isFinite(a.mono) && Number.isFinite(p.mono) && !a.origin;
    const skipped = ORDERED.slice(ORDERED.indexOf(prev) + 1, ORDERED.indexOf(name));
    const early = skipped.filter(n => before.some(b => b.boundary === n)), missing = skipped.filter(n => !early.includes(n));
    const label = missing.length ? `unattributed (no ${missing.join(', ')} recorded)` : early.length ? `${HOST_SEGMENTS[name]} (from the delivery; ${early.join(', ')} came before it)` : HOST_SEGMENTS[name];
    const ms = round(exact ? p.mono - a.mono : p.at - a.at);
    if (ms < 0) anomalies.push({type: 'host-clock-skew', message: m.id, from: prev, to: name, ms, note: 'boundaries out of order across clocks; the interval is not meaningful'});
    segments.push({from: prev, to: name, ms, clock: exact ? 'process-monotonic' : 'local-wall≈', label});
    prev = name;
  }
  // No tool call links a command, and the turn ended before any later command (the managed runtime, which runs no
  // CLI process: its turn ends in a decision the runtime then applies). The turn itself is the host's reasoning.
  if (!call && turn.end && prev === 'turn.start' && turn.end.at >= turn.start.at && !(firstCommand && firstCommand.at < turn.end.at)) {
    const exact = turn.start.proc === turn.end.proc && Number.isFinite(turn.start.mono) && Number.isFinite(turn.end.mono);
    segments.push({from: 'turn.start', to: 'turn.end', ms: round(exact ? turn.end.mono - turn.start.mono : turn.end.at - turn.start.at), clock: exact ? 'process-monotonic' : 'local-wall≈', label: 'host turn to its decision (no tool call linked)'});
    prev = 'turn.end'; pts['turn.end'] = turn.end;
  }
  // No tool call links a command: keep the rest of the gap visible, as it was without host records.
  if (!call && firstCommand && firstCommand.at > pts[prev].at) {
    segments.push({from: prev, to: 'first.command', ms: round(firstCommand.at - pts[prev].at), clock: 'local-wall≈',
      label: `unattributed (no tool call linked; \`${firstCommand.command ?? '?'}\` found by time)`});
  }
  return {turn: turn.id, tool: call?.id ?? null, proc: ps?.proc ?? null, command: ps?.command ?? null, before, segments,
    toolCalls: calls.length, toEnd: pts[prev] === pts.delivered ? null : round(pts[prev].at - m.deliveredAt)};
}

const secs = ms => (ms === null || ms === undefined ? '?' : `${(ms / 1000).toFixed(3)}s`);
const clock = at => new Date(at).toISOString().slice(11, 23);
export function render(t) {
  const out = [`${t.schema} timeline (reconstruction from captured records; not a replay) — ${t.records} records, ${t.processes.length} processes`];
  const actLines = (a, from) => {
    const lines = [];
    if (a.link === 'requested') lines.push('    (linked by the CLI\'s requested `for`; the world returned no link)');
    for (const x of a.attempts) lines.push(`    act ${a.op ? 'op ' + a.op.slice(0, 8) + ' ' : ''}attempt ${x.attempt} → ${x.status}${x.accepted === false ? ' refused' : ''}${x.code ? ' ' + x.code : ''}${x.alternatives ? ' (alternatives: ' + x.alternatives.join(', ') + ')' : ''} in ${x.durationMs ?? '?'} ms (process clock)  @+${secs(x.at - from)} local`);
    if (a.receipt) {
      const r = a.receipt, k = r.ticks;
      // #790: `started` is the body program's start; first motion is when the body visibly began (the receipt's
      // firstMotionTick; absent when the world did not report one, for example an older server or no body program).
      lines.push(`    receipt ${r.id} ${r.capability ?? ''}: accepted t${k.accepted ?? '?'} → started (program) t${k.started ?? '?'} → first motion t${k.firstMotion ?? '?'} → ended t${k.ended ?? '?'} = ${r.terminal ?? 'no terminal observed'}${r.code ? ' (' + r.code + ')' : ''}  [world ticks]`);
      if (k.accepted !== null && k.started !== null) lines.push(`      accepted→started ${k.started - k.accepted} ticks; started→first motion ${k.firstMotion !== null ? ticks(k.firstMotion - k.started) : 'not reported'}; started→ended ${k.ended !== null ? k.ended - k.started + ' ticks' : 'open'}`);
      if (r.terminal && r.firstObservedAt[r.terminal]) lines.push(`      terminal first seen by the client @+${secs(r.firstObservedAt[r.terminal] - from)} local (bounded by polling)`);
    }
    return lines;
  };
  for (const e of t.episodes) {
    out.push('', `episode ${e.origin.id} — owner message${e.origin.sentAt ? ' sent ' + clock(e.origin.sentAt) + ' (server clock)' : ' (send time missing)'}`);
    out.push(`  delivered ${clock(e.deliveredAt)} local${e.origin.sentAt ? ` ≈ +${secs(e.deliveredAt - e.origin.sentAt)} after send (server→local clocks, skew unknown)` : ''}`);
    if (e.host) {
      out.push(`  host turn ${e.host.turn}${e.host.tool ? `, tool call ${e.host.tool} → \`${e.host.command}\`` : ' (no linked command)'}:`);
      for (const b of e.host.before) out.push(`    ${b.boundary} was ${secs(b.msBeforeDelivery)} before the delivery (turn already running; not subtracted)`);
      for (const g of e.host.segments) out.push(`    ${g.from} → ${g.to}  ${g.ms} ms  ${g.label}  [${g.clock}]`);
    } else if (e.firstCommand) out.push(`  first command \`${e.firstCommand.command}\` @+${secs(e.firstCommand.at - e.deliveredAt)} ≈ host time, unattributed (reasoning, tools, process spawn)`);
    else out.push('  no later command captured');
    for (const x of e.inbox) out.push(`  ${x.verb} → ${x.status} @+${secs(x.at - e.deliveredAt)}`);
    if (!e.acts.length) out.push('  no act linked by `for` to this message');
    for (const a of e.acts) out.push(...actLines(a, e.deliveredAt));
  }
  for (const a of t.unlinked) out.push('', `act with unknown origin${a.origin.for ? ' (for ' + a.origin.for + ', not delivered in this trace)' : ''}`, ...actLines(a, a.attempts[0].at));
  out.push('', t.anomalies.length ? `anomalies (${t.anomalies.length}):` : 'anomalies: none detected');
  for (const x of t.anomalies) out.push('  ' + JSON.stringify(x));
  return out.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), json = args.includes('--json'), file = args.find(a => a !== '--json');
  if (!file) { process.stderr.write('usage: node tools/soul-trace/readout.mjs <trace.jsonl> [--json]\n'); process.exit(2); }
  const t = reconstruct(readFileSync(file, 'utf8'));
  process.stdout.write(json ? JSON.stringify(t, null, 1) + '\n' : render(t));
}
