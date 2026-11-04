// Passive, opt-in local trace of one Soul CLI process (#733, schema soul-trace/1).
// Load with `node --import <this file> eden.mjs <command>` and SOUL_TRACE_FILE=<local .jsonl>.
// Without SOUL_TRACE_FILE this module installs nothing. It observes the process's
// own fetch calls: it never sends a request, changes arguments, retries, delays
// the caller, or records text, observations, credentials or hosts.
import {performance} from 'node:perf_hooks';
import {randomBytes, createHash} from 'node:crypto';
import {readFileSync, appendFile, appendFileSync, lstatSync} from 'node:fs';
import {basename} from 'node:path';

export const SCHEMA = 'soul-trace/1';
export const LIMITS = Object.freeze({records: 2000, queuedBytes: 512 * 1024, recordBytes: 8 * 1024, exitBytes: 64 * 1024, bodyBytes: 1024 * 1024, flushMs: 1000});
const REF = /^[A-Za-z0-9._:~-]{1,100}$/;
const ref = v => (typeof v === 'string' && REF.test(v) ? v : undefined);
const int = v => (Number.isSafeInteger(v) ? v : undefined);
const prune = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Route path only: no origin, world prefix, query values or free-text segments. */
export function routeOf(url) {
  const u = new URL(String(url));
  const path = u.pathname.replace(/^\/w\/[^/]+(?=\/v1\/)/, '').split('/').map(s => (s === '' || REF.test(s) ? s : ':omitted')).join('/');
  const names = [...new Set([...u.searchParams.keys()].filter(k => REF.test(k)))].sort();
  return names.length ? `${path}?${names.join('&')}` : path;
}

const receiptFact = r => (r && typeof r === 'object' && ref(r.id) ? prune({
  id: r.id, soulId: ref(r.soulId), capability: ref(r.capability), phase: ref(r.phase), code: ref(r.code),
  acceptedTick: int(r.acceptedTick), startedTick: int(r.startedTick), endedTick: int(r.endedTick),
}) : undefined);
const messageFact = m => (m && typeof m === 'object' && ref(m.id) ? prune({id: m.id, sentAt: int(m.sentAt), state: ref(m.state)}) : undefined);

/** Whitelisted facts from a JSON response body. Everything else is omitted. */
export function factsOf(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const messages = [...(Array.isArray(data.backlog) ? data.backlog : []), data.inbox?.latest, data.message]
    .map(messageFact).filter(Boolean).slice(0, 20);
  const events = (Array.isArray(data.events) ? data.events : []).map(e => receiptFact(e?.receipt)).filter(Boolean).slice(0, 50);
  return prune({
    accepted: typeof data.accepted === 'boolean' ? data.accepted : undefined,
    code: ref(data.error?.code ?? data.code),
    receipt: receiptFact(data.receipt),
    for: ref(typeof data.for === 'string' ? data.for : data.for?.id),
    channel: ref(data.channel),
    cursor: ref(data.cursor),
    queued: int(data.inbox?.queued),
    messages: messages.length ? messages : undefined,
    events: events.length ? events : undefined,
  });
}

const headerOf = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) return headers.find(([k]) => String(k).toLowerCase() === name)?.[1];
  const key = Object.keys(headers).find(k => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

/**
 * One process's bounded, asynchronous sink. `append` and `appendSync` are injectable
 * so tests can stall or fail them. Failures are counted and disable the sink; they
 * never throw into the caller.
 */
export function createTap({file, env = process.env, argv = process.argv, now = Date.now, mono = () => performance.now(),
  append = appendFile, appendSync = appendFileSync, limits = LIMITS, readScript = p => readFileSync(p)} = {}) {
  const proc = randomBytes(8).toString('hex'), started = mono();
  const stats = {records: 0, dropped: 0, truncated: 0, sinkFailures: 0, inFlightAtExit: 0, bodyOmitted: 0, bodiesPendingAtExit: 0};
  let pendingBodies = 0;
  let seq = 0, queue = [], queuedBytes = 0, inFlight = 0, disabled = false, closed = false, timer = null;
  const attempts = new Map();

  const flush = () => {
    timer = null;
    if (disabled || inFlight || !queue.length) return;
    const batch = queue.join(''), n = queue.length;
    queue = []; queuedBytes = 0; inFlight = n;
    try {
      append(file, batch, {mode: 0o600}, err => {
        inFlight = 0;
        if (err) { stats.sinkFailures++; stats.dropped += n; disabled = true; queue = []; queuedBytes = 0; return; }
        if (queue.length) schedule();
      });
    } catch { inFlight = 0; stats.sinkFailures++; stats.dropped += n; disabled = true; }
  };
  const schedule = () => { if (!timer && !closed) { timer = setTimeout(flush, limits.flushMs); timer.unref?.(); } };

  const record = (kind, fields) => {
    if (closed) return;
    if (disabled || stats.records >= limits.records) { stats.dropped++; return; }
    let line = JSON.stringify({v: SCHEMA, kind, proc, seq: ++seq, at: now(), mono: Math.round((mono() - started) * 1000) / 1000, ...fields}) + '\n';
    if (Buffer.byteLength(line) > limits.recordBytes) {
      stats.truncated++;
      const {facts: _f, ...rest} = fields;
      line = JSON.stringify({v: SCHEMA, kind, proc, seq, at: now(), mono: Math.round((mono() - started) * 1000) / 1000, ...rest, omitted: ['facts:size']}) + '\n';
    }
    if (queuedBytes + Buffer.byteLength(line) > limits.queuedBytes) { stats.dropped++; return; }
    queue.push(line); queuedBytes += Buffer.byteLength(line); stats.records++;
    schedule();
  };

  const start = () => {
    let cliSha256;
    try { cliSha256 = argv[1] ? createHash('sha256').update(readScript(argv[1])).digest('hex') : undefined; } catch { cliSha256 = undefined; }
    const command = typeof argv[2] === 'string' && /^[a-z][a-z-]{0,30}$/.test(argv[2]) ? argv[2] : undefined;
    record('proc.start', prune({
      cli: argv[1] ? ref(basename(argv[1])) : undefined, cliSha256, command,
      argBytes: argv.slice(3).reduce((n, a) => n + Buffer.byteLength(String(a)), 0),
      node: process.version, timeOrigin: Math.round(performance.timeOrigin),
      run: ref(env.SOUL_TRACE_RUN), seat: ref(env.SOUL_TRACE_SEAT), turn: ref(env.SOUL_TRACE_TURN), tool: ref(env.SOUL_TRACE_TOOL),
      clocks: {at: 'local-wall-ms', mono: 'process-monotonic-ms', sentAt: 'server-wall-ms', ticks: 'world-tick'},
      omitted: ['text', 'speech', 'observation-content', 'authorization', 'origin-host', 'query-values'],
    }));
  };

  const wrapFetch = original => async function tracedFetch(input, init) {
    let route, method, op, attempt, t0, requestedFor;
    try {
      t0 = mono();
      route = routeOf(typeof input === 'string' || input instanceof URL ? input : input?.url);
      method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
      op = ref(headerOf(init?.headers ?? input?.headers, 'idempotency-key'));
      if (op) { attempt = (attempts.get(op) ?? 0) + 1; attempts.set(op, attempt); }
      // The owner-message link the CLI asked for (an id only); the rest of the request body is never read.
      if (typeof init?.body === 'string' && init.body.length <= 65536 && init.body.includes('"for"')) requestedFor = ref(JSON.parse(init.body)?.for);
    } catch { route ??= undefined; }
    const base = () => prune({method, route, op, attempt, requestedFor, startMono: t0 === undefined ? undefined : Math.round((t0 - started) * 1000) / 1000});
    let res;
    try { res = await Reflect.apply(original, this, [input, init]); }
    catch (e) { try { record('http', {...base(), status: 0, error: ref(e?.name) ?? 'Error', durationMs: Math.round((mono() - t0) * 1000) / 1000}); } catch {} throw e; }
    try {
      const head = Math.round((mono() - t0) * 1000) / 1000, type = res.headers.get('content-type') ?? '';
      const length = Number(res.headers.get('content-length'));
      if (!type.includes('json') || type.includes('event-stream') || (Number.isFinite(length) && length > limits.bodyBytes)) {
        stats.bodyOmitted++; record('http', {...base(), status: res.status, headMs: head, omitted: ['body']});
      } else {
        pendingBodies++;
        res.clone().text().finally(() => { pendingBodies--; }).then(text => {
          let facts = {};
          try { facts = factsOf(JSON.parse(text)); } catch { facts = {}; }
          record('http', {...base(), status: res.status, headMs: head, durationMs: Math.round((mono() - t0) * 1000) / 1000, bytes: Buffer.byteLength(text), facts});
        }, e => record('http', {...base(), status: res.status, headMs: head, bodyError: ref(e?.name) ?? 'Error'}));
      }
    } catch { stats.dropped++; }
    return res;
  };

  const close = exitCode => {
    if (closed) return;
    record('proc.end', {exitCode: int(exitCode) ?? null, durationMs: Math.round((mono() - started) * 1000) / 1000, stats: {...stats, inFlightAtExit: inFlight, bodiesPendingAtExit: pendingBodies}});
    closed = true;
    if (timer) clearTimeout(timer);
    stats.inFlightAtExit = inFlight; stats.bodiesPendingAtExit = pendingBodies;
    if (disabled || !queue.length) return;
    if (queuedBytes > limits.exitBytes) { stats.dropped += queue.length; queue = []; return; }
    try { appendSync(file, queue.join(''), {mode: 0o600}); } catch { stats.sinkFailures++; }
    queue = [];
  };

  return {proc, stats, record, start, wrapFetch, close, flush};
}

/** Installs the tap into this process when SOUL_TRACE_FILE is set; otherwise nothing. */
export function installFromEnv(env = process.env) {
  const file = env.SOUL_TRACE_FILE;
  if (typeof file !== 'string' || !file || typeof globalThis.fetch !== 'function') return null;
  // Only a regular file (or a new one): a FIFO, device or symlink could block the exit write or redirect it.
  try { const st = lstatSync(file); if (!st.isFile() || st.isSymbolicLink()) return null; } catch (e) { if (e?.code !== 'ENOENT') return null; }
  const tap = createTap({file, env});
  tap.start();
  globalThis.fetch = tap.wrapFetch(globalThis.fetch);
  process.once('exit', code => { try { tap.close(code); } catch {} });
  return tap;
}

installFromEnv();
