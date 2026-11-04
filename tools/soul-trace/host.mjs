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
// or tool output. Writes are small synchronous appends to a regular file (or, with `queued`, the
// bounded async queue in sink.mjs); a failing or refused sink disables the recorder and never throws into the host.
import {performance} from 'node:perf_hooks';
import {randomBytes} from 'node:crypto';
import {appendFile, appendFileSync, lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSink} from './sink.mjs';
// Not imported from tap.mjs: importing the tap installs it when SOUL_TRACE_FILE is set (host.test.mjs checks they agree).
export const SCHEMA = 'soul-trace/1';

const REF = /^[A-Za-z0-9._:~-]{1,100}$/;
const ref = v => (typeof v === 'string' && REF.test(v) ? v : undefined);
const prune = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const PHASES = new Set(['start', 'end']);

const regularOrNew = file => { try { const st = lstatSync(file); return st.isFile() && !st.isSymbolicLink(); } catch (e) { return e?.code === 'ENOENT'; } };

/**
 * `queued: true` (a long-lived host such as the managed runtime) appends through soul-trace's bounded asynchronous
 * queue instead of one synchronous write per record; call `close()` (sync, at exit) or `await drain()` before exit.
 * `when` ({at, mono} from `mark()`) times a record at an earlier moment, e.g. a turn timed at its request.
 */
export function hostRecorder({file, now = Date.now, mono = () => performance.now(), appendSync = appendFileSync, append = appendFile, maxRecords = 2000, queued = false, limits} = {}) {
  const proc = 'host-' + randomBytes(6).toString('hex'), started = mono();
  const stats = {records: 0, dropped: 0, sinkFailures: 0};
  let seq = 0, disabled = typeof file !== 'string' || !file || !regularOrNew(file);
  const sink = queued && !disabled ? createSink({target: file, append, appendSync, stats, ...(limits ? {limits} : {})}) : null;
  const mark = () => ({at: now(), mono: Math.round((mono() - started) * 1000) / 1000});
  const write = (kind, fields, when) => {
    if (disabled || sink?.disabled || stats.records >= maxRecords) { stats.dropped++; return false; }
    const t = when && Number.isFinite(when.at) && Number.isFinite(when.mono) ? when : mark();
    const line = JSON.stringify({v: SCHEMA, kind, proc, seq: ++seq, at: t.at, mono: t.mono, ...prune(fields)}) + '\n';
    if (sink) { if (!sink.push(line)) return false; stats.records++; return true; }
    try { appendSync(file, line, {mode: 0o600}); stats.records++; return true; } catch { stats.sinkFailures++; stats.dropped++; disabled = true; return false; }
  };
  const phase = p => (PHASES.has(p) ? p : undefined);
  return {
    proc, stats, mark, get enabled() { return !disabled && !sink?.disabled; },
    turn: (p, {turn, for: forId, when} = {}) => write('host.turn', {phase: phase(p), turn: ref(turn), for: ref(forId)}, when),
    tool: (p, {turn, tool, exitCode, when} = {}) => write('host.tool', {phase: phase(p), turn: ref(turn), tool: ref(tool), exitCode: Number.isSafeInteger(exitCode) ? exitCode : undefined}, when),
    spawn: ({tool, when} = {}) => write('host.spawn', {tool: ref(tool)}, when),
    /** Environment for the spawned CLI so its proc.start names the turn and tool (explicit link). */
    env: ({turn, tool} = {}) => prune({SOUL_TRACE_TURN: ref(turn), SOUL_TRACE_TOOL: ref(tool)}),
    /** Queued mode: resolves when everything queued is written (never rejects). */
    drain: () => sink?.drain() ?? Promise.resolve(),
    /** Queued mode: writes what is still queued synchronously; later records are dropped. */
    close: () => { sink?.closeSync(); if (sink) disabled = true; },
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
