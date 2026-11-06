// The bounded asynchronous append queue behind soul-trace (#733). Lines queue in memory and are appended
// asynchronously, one batch in flight. A full queue drops the line; a failed append disables the sink. Neither
// throws into the caller or delays it. Importing this module installs nothing (unlike tap.mjs).
import {appendFile, appendFileSync} from 'node:fs';

export const SINK_LIMITS = Object.freeze({queuedBytes: 512 * 1024, exitBytes: 64 * 1024, flushMs: 1000});

/**
 * `target` is a path or an open fd; `append(target, data, opts, cb)` / `appendSync(target, data, opts)` are
 * injectable so tests can stall or fail them. `onFailure(err)` is called once, when the sink disables itself.
 * `stats` ({dropped, sinkFailures}) may be the caller's own object, so its counts stay live.
 */
export function createSink({target, append = appendFile, appendSync = appendFileSync, limits = SINK_LIMITS, onFailure = () => {}, stats = {dropped: 0, sinkFailures: 0}} = {}) {
  let queue = [], queuedBytes = 0, inFlight = 0, disabled = false, closed = false, timer = null, waiters = [];
  const settle = () => { if (!inFlight && (disabled || !queue.length)) for (const w of waiters.splice(0)) w(); };
  const disable = (n, err) => {
    inFlight = 0; stats.sinkFailures++; stats.dropped += n; disabled = true; queue = []; queuedBytes = 0;
    try { onFailure(err); } catch {}
    settle();
  };
  const flush = () => {
    timer = null;
    if (disabled || inFlight || !queue.length) return settle();
    const batch = queue.join(''), n = queue.length;
    queue = []; queuedBytes = 0; inFlight = n;
    try {
      append(target, batch, {mode: 0o600}, err => {
        if (err) return disable(n, err);
        inFlight = 0;
        if (queue.length) (waiters.length ? flush() : schedule()); else settle();
      });
    } catch (e) { disable(n, e); }
  };
  const schedule = () => { if (!timer && !closed) { timer = setTimeout(flush, limits.flushMs); timer.unref?.(); } };

  /** Queues one line; false when it was dropped (disabled, closed or over the byte bound). */
  const push = line => {
    if (disabled || closed) { stats.dropped++; return false; }
    const bytes = Buffer.byteLength(line);
    if (queuedBytes + bytes > limits.queuedBytes) { stats.dropped++; return false; }
    queue.push(line); queuedBytes += bytes;
    schedule();
    return true;
  };

  /** Resolves once the queue is empty and nothing is in flight (or the sink is disabled). Never rejects. */
  const drain = () => new Promise(resolve => {
    waiters.push(resolve);
    if (timer) { clearTimeout(timer); timer = null; }
    if (!inFlight) flush();
  });

  /** Process exit: writes what is queued (≤ exitBytes) synchronously; a batch still in flight may be lost. */
  const closeSync = () => {
    closed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (disabled || !queue.length) return;
    if (queuedBytes > limits.exitBytes) { stats.dropped += queue.length; queue = []; queuedBytes = 0; return; }
    try { appendSync(target, queue.join(''), {mode: 0o600}); } catch { stats.sinkFailures++; }
    queue = []; queuedBytes = 0;
  };

  return {push, flush, drain, closeSync, stats, get inFlight() { return inFlight; }, get disabled() { return disabled; }, get queued() { return queue.length; }};
}
