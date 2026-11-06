#!/usr/bin/env node
// Opt-in host-side boundaries for a soul-trace/1 file (#733 S2). The chat host that runs the
// thin CLI (one process per command) calls this around its own work, so the time between a
// delivery and the next command can be split into turn, tool call, spawn and Node boot.
//
//   module: const h = hostRecorder({file}); h.turn('start', {turn, for}); h.tool('start', {turn, tool});
//           h.spawn({tool}); …spawn `node --import tap.mjs eden.mjs …` with h.env({turn, tool})…; h.tool('end', {tool, exitCode})
//   CLI:    node tools/soul-trace/host.mjs turn|tool|spawn [start|end] --turn T --tool C [--for M] [--exit N]
//           (SOUL_TRACE_FILE names the trace; for hooks that run as their own process)
//
// Ids are opaque refs the host chooses; nothing else is recorded: no prompt, command text, paths
// or tool output. Writes are small synchronous appends to a regular file; a failing or refused
// sink disables the recorder and never throws into the host.
import {performance} from 'node:perf_hooks';
import {randomBytes} from 'node:crypto';
import {appendFileSync, lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
// Not imported from tap.mjs: importing the tap installs it when SOUL_TRACE_FILE is set (host.test.mjs checks they agree).
export const SCHEMA = 'soul-trace/1';

const REF = /^[A-Za-z0-9._:~-]{1,100}$/;
const ref = v => (typeof v === 'string' && REF.test(v) ? v : undefined);
const prune = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const PHASES = new Set(['start', 'end']);

const regularOrNew = file => { try { const st = lstatSync(file); return st.isFile() && !st.isSymbolicLink(); } catch (e) { return e?.code === 'ENOENT'; } };

export function hostRecorder({file, now = Date.now, mono = () => performance.now(), appendSync = appendFileSync, maxRecords = 2000} = {}) {
  const proc = 'host-' + randomBytes(6).toString('hex'), started = mono();
  const stats = {records: 0, dropped: 0, sinkFailures: 0};
  let seq = 0, disabled = typeof file !== 'string' || !file || !regularOrNew(file);
  const write = (kind, fields) => {
    if (disabled || stats.records >= maxRecords) { stats.dropped++; return false; }
    const line = JSON.stringify({v: SCHEMA, kind, proc, seq: ++seq, at: now(), mono: Math.round((mono() - started) * 1000) / 1000, ...prune(fields)}) + '\n';
    try { appendSync(file, line, {mode: 0o600}); stats.records++; return true; } catch { stats.sinkFailures++; stats.dropped++; disabled = true; return false; }
  };
  const phase = p => (PHASES.has(p) ? p : undefined);
  return {
    proc, stats, get enabled() { return !disabled; },
    turn: (p, {turn, for: forId} = {}) => write('host.turn', {phase: phase(p), turn: ref(turn), for: ref(forId)}),
    tool: (p, {turn, tool, exitCode} = {}) => write('host.tool', {phase: phase(p), turn: ref(turn), tool: ref(tool), exitCode: Number.isSafeInteger(exitCode) ? exitCode : undefined}),
    spawn: ({tool} = {}) => write('host.spawn', {tool: ref(tool)}),
    /** Environment for the spawned CLI so its proc.start names the turn and tool (explicit link). */
    env: ({turn, tool} = {}) => prune({SOUL_TRACE_TURN: ref(turn), SOUL_TRACE_TOOL: ref(tool)}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const [what, p] = a, h = hostRecorder({file: process.env.SOUL_TRACE_FILE});
  const ids = {turn: opt('--turn'), tool: opt('--tool'), for: opt('--for'), exitCode: opt('--exit') === undefined ? undefined : Number(opt('--exit'))};
  if (what === 'turn' || what === 'tool') h[what](p, ids);
  else if (what === 'spawn') h.spawn(ids);
  else { process.stderr.write('usage: host.mjs turn|tool start|end [--turn T] [--tool C] [--for M] [--exit N] | host.mjs spawn --tool C\n'); process.exitCode = 2; }
  // Always exit 0 on a recording problem: a host hook must never fail because tracing did.
}
