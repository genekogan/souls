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
  const kept = [];
  for (const r of records) {
    const p = procs.get(r.proc) ?? {proc: r.proc, seqs: [], maxSeq: 0};
    procs.set(r.proc, p);
    const key = r.proc + ':' + r.seq;
    if (seen.has(key)) { anomalies.push({type: 'duplicate', proc: r.proc, seq: r.seq, line: r.line}); continue; }
    seen.set(key, r);
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
    for (const k of ['soulId', 'capability', 'acceptedTick', 'startedTick', 'endedTick', 'code']) if (fact[k] !== undefined) x[k] = fact[k];
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
    const key = r.op ?? r.proc + ':' + r.seq, a = acts.get(key) ?? {op: r.op ?? null, proc: r.proc, route: r.route, attempts: [], for: null, receipt: null};
    acts.set(key, a);
    a.attempts.push({attempt: r.attempt ?? 1, status: r.status, accepted: r.facts?.accepted ?? null, code: r.facts?.code ?? null, durationMs: r.durationMs ?? null, at: r.at});
    if (r.facts?.for) a.for = r.facts.for;
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
    return {op: a.op, attempts: a.attempts, outcome: last.status === 0 ? 'unreachable' : last.status >= 200 && last.status < 300 && last.accepted !== false ? 'accepted' : 'refused', code: last.code,
      receipt: rec ? {id: rec.id, capability: rec.capability ?? null, terminal: rec.terminal ?? null, code: rec.code ?? null,
        ticks: {accepted: rec.acceptedTick ?? null, started: rec.startedTick ?? null, ended: rec.endedTick ?? null}, firstObservedAt: rec.phases} : null};
  };
  const episodes = [...messages.values()].sort((a, b) => a.deliveredAt - b.deliveredAt).map(m => {
    const linked = [...acts.values()].filter(a => a.for === m.id);
    const firstCommand = starts.find(s => s.at > m.deliveredAt && s.command !== 'listen' && s.proc !== m.deliveredBy);
    return {origin: {kind: 'owner-message', id: m.id, sentAt: m.sentAt}, deliveredAt: m.deliveredAt, deliveredBy: m.deliveredBy,
      firstCommand: firstCommand ? {command: firstCommand.command ?? null, at: firstCommand.at, proc: firstCommand.proc} : null,
      inbox: inbox.filter(x => x.id === m.id), acts: linked.map(actView)};
  });
  const unlinked = [...acts.values()].filter(a => !a.for || !messages.has(a.for)).map(a => ({origin: {kind: 'unknown', for: a.for}, ...actView(a)}));
  return {schema: SCHEMA, kind: 'timeline-reconstruction', replay: false, records: kept.length, anomalies,
    processes: [...procs.values()].map(p => ({proc: p.proc, command: p.start?.command ?? null, cli: p.start?.cli ?? null, cliSha256: p.start?.cliSha256 ?? null,
      run: p.start?.run ?? null, seat: p.start?.seat ?? null, startAt: p.start?.at ?? null, durationMs: p.end?.durationMs ?? null, exitCode: p.end?.exitCode ?? null, closed: !!p.end})),
    episodes, unlinked};
}

const secs = ms => (ms === null || ms === undefined ? '?' : `${(ms / 1000).toFixed(3)}s`);
const clock = at => new Date(at).toISOString().slice(11, 23);
export function render(t) {
  const out = [`${t.schema} timeline (reconstruction from captured records; not a replay) — ${t.records} records, ${t.processes.length} processes`];
  const actLines = (a, from) => {
    const lines = [];
    for (const x of a.attempts) lines.push(`    act ${a.op ? 'op ' + a.op.slice(0, 8) + ' ' : ''}attempt ${x.attempt} → ${x.status}${x.accepted === false ? ' refused' : ''}${x.code ? ' ' + x.code : ''} in ${x.durationMs ?? '?'} ms (process clock)  @+${secs(x.at - from)} local`);
    if (a.receipt) {
      const r = a.receipt, k = r.ticks;
      lines.push(`    receipt ${r.id} ${r.capability ?? ''}: accepted t${k.accepted ?? '?'} → started t${k.started ?? '?'} → ended t${k.ended ?? '?'} = ${r.terminal ?? 'no terminal observed'}${r.code ? ' (' + r.code + ')' : ''}  [world ticks]`);
      if (k.accepted !== null && k.started !== null) lines.push(`      accepted→started ${k.started - k.accepted} ticks; started→ended ${k.ended !== null ? k.ended - k.started + ' ticks' : 'open'}`);
      if (r.terminal && r.firstObservedAt[r.terminal]) lines.push(`      terminal first seen by the client @+${secs(r.firstObservedAt[r.terminal] - from)} local (bounded by polling)`);
    }
    return lines;
  };
  for (const e of t.episodes) {
    out.push('', `episode ${e.origin.id} — owner message${e.origin.sentAt ? ' sent ' + clock(e.origin.sentAt) + ' (server clock)' : ' (send time missing)'}`);
    out.push(`  delivered ${clock(e.deliveredAt)} local${e.origin.sentAt ? ` ≈ +${secs(e.deliveredAt - e.origin.sentAt)} after send (server→local clocks, skew unknown)` : ''}`);
    if (e.firstCommand) out.push(`  first command \`${e.firstCommand.command}\` @+${secs(e.firstCommand.at - e.deliveredAt)} ≈ host time, unattributed (reasoning, tools, process spawn)`);
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
