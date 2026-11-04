// Soul Runs resource ledger: what this run created (owned) versus what it only uses (borrowed). Private to one run
// directory (ledger.jsonl). Only owned entries are ever released; borrowed entries are recorded and left untouched.
import { appendJsonl } from '../lib/jsonl.mjs';

const TIMEOUT = Symbol('timeout');
const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); })]).finally(() => clearTimeout(timer));
};

/** createLedger({file?}) → {own, borrow, releaseAll, entries, summary}. file: ledger.jsonl, appended per event. */
export function createLedger({ file = null, clock = () => new Date().toISOString() } = {}) {
  const entries = [];
  let closed = false;
  const record = (event, entry, extra = {}) => { if (file) appendJsonl(file, { at: clock(), event, seq: entry.seq, kind: entry.kind, id: entry.id, owner: entry.owner, ...extra }); };

  /** Register a resource this run created. release() is called at most once (memoized), by releaseAll or by the
   *  returned handle; the runner's own close step may also stop it, so release functions must tolerate a stopped resource. */
  function own(kind, id, release, meta = {}) {
    if (typeof release !== 'function') throw new Error(`owned ${kind} ${id} needs a release function`);
    const entry = { seq: entries.length + 1, kind, id: String(id), owner: 'run', meta, state: 'held', releasing: null };
    entry.release = () => (entry.releasing ??= Promise.resolve().then(release));
    entries.push(entry);
    record('own', entry, { meta });
    // Registered after cleanup ran (a runner step that was already in flight at cancel): stop it at once, on the record.
    if (closed) { entry.late = true; entry.lateRelease = settle(entry, 15000); }
    return entry;
  }

  /** Record a resource this run uses but did not create (a checkout, an installed browser, another service's port). */
  function borrow(kind, id, meta = {}) {
    const entry = { seq: entries.length + 1, kind, id: String(id), owner: 'borrowed', meta, state: 'untouched' };
    entries.push(entry);
    record('borrow', entry, { meta });
    return entry;
  }

  /** Release one owned entry, bounded by waitMs. A failure or timeout is recorded, never hidden. */
  async function settle(entry, waitMs) {
    const t0 = Date.now();
    try {
      const r = await withTimeout(entry.release(), waitMs);
      if (r === TIMEOUT) { entry.state = 'timed-out'; entry.error = `release exceeded ${waitMs} ms`; }
      else if (r && typeof r === 'object' && r.stopped === false) { entry.state = 'failed'; entry.error = r.reason ?? 'release reported not stopped'; }
      else entry.state = 'released';
    } catch (e) { entry.state = 'failed'; entry.error = String(e?.message ?? e).slice(0, 300); }
    entry.releaseMs = Date.now() - t0;
    record('release', entry, { state: entry.state, releaseMs: entry.releaseMs, ...(entry.late ? { late: true } : {}), ...(entry.error ? { error: entry.error } : {}) });
  }

  /** Release owned entries newest first; one failure does not stop the rest. Borrowed entries stay 'untouched'. */
  async function releaseAll({ waitMs = 15000 } = {}) {
    closed = true;
    for (const entry of [...entries].reverse()) if (entry.owner === 'run' && entry.state === 'held' && !entry.late) await settle(entry, waitMs);
    await Promise.all(entries.filter((e) => e.lateRelease).map((e) => e.lateRelease));
    return summary();
  }

  function summary() {
    const list = entries.map(({ seq, kind, id, owner, meta, state, error, releaseMs, late }) => ({ seq, kind, id, owner, state, ...(late ? { late } : {}), ...(error ? { error } : {}), ...(releaseMs != null ? { releaseMs } : {}), meta }));
    const owned = list.filter((e) => e.owner === 'run');
    return { ok: owned.every((e) => e.state === 'released'), owned: owned.length, released: owned.filter((e) => e.state === 'released').length, failed: owned.filter((e) => e.state !== 'released').map((e) => `${e.kind}:${e.id}:${e.state}`), borrowed: list.filter((e) => e.owner === 'borrowed').length, entries: list };
  }

  return { own, borrow, releaseAll, entries, summary };
}
