// Pure parts of the continuity family driver (#487): read ordering, the idle bracket, the export allowlist
// and process-tree cleanup. No world, no model and no clock of its own, so each one replays in a test.
import { execFileSync } from 'node:child_process';
import { inspectOwnedProcess } from '../../soul-runtime/controller-ownership.mjs';

/** Order samples by when each read was issued (#484). A slow read finishes late, but what it saw is as old as its request. */
export const byIssueTime = (samples) => [...samples].sort((a, b) => a.requestedAt - b.requestedAt || a.receivedAt - b.receivedAt);

/** Reads whose tick goes backwards in issue order. Those are real regressions; a slow read arriving late is not one of them. */
export function staleReads(samples) {
  const stale = []; let newest = -Infinity;
  for (const s of byIssueTime(samples)) { if (s.tick < newest) stale.push(s); else newest = s.tick; }
  return stale;
}

/**
 * The idle bracket (#484): the last sample at or before the window and the first at or after it, in issue order.
 * Conclusive when both exist and agree the body stayed idle, whatever order the answers came back in.
 */
export function idleBracket(samples, { from, to, idle = (s) => s.activity === 'idle' }) {
  const ordered = byIssueTime(samples);
  const before = ordered.filter((s) => s.requestedAt <= from).at(-1) ?? null, after = ordered.find((s) => s.requestedAt >= to) ?? null;
  if (!before || !after) return { status: 'inconclusive', before, after };
  return { status: idle(before) && idle(after) ? 'idle' : 'not-idle', before, after };
}

/** The furthest a body moved from its first sample, in metres. Ground plane only: pos is [x, z] or [x, y, z]. */
export function drift(positions) {
  const flat = (p) => (p.length === 3 ? [p[0], p[2]] : p), [x0, z0] = flat(positions[0] ?? [0, 0]);
  return positions.reduce((most, p) => { const [x, z] = flat(p); return Math.max(most, Math.hypot(x - x0, z - z0)); }, 0);
}

// The only fields that leave a run directory. A new field is added here on purpose, with its reason, or it stays behind.
const EXPORT_FIELDS = {
  schema: 'string', family: 'string', pass: 'boolean', failure: 'code', startedAt: 'time', endedAt: 'time', forcedFailure: 'boolean',
  restart: { journalSame: 'boolean', threadSame: 'boolean', generationBefore: 'count', generationAfter: 'count', killedWithOpenOperation: 'boolean', recoveryMs: 'count' },
  effects: { spoken: 'count', spokenAfterRestart: 'count', duplicates: 'count' },
  placedBody: { samples: 'count', driftMetres: 'number', facts: 'count', wakeEligible: 'count' },
  reads: { samples: 'count', stale: 'count', bracket: 'code' },
  cleanup: { listening: 'boolean', survivors: 'count' },
};
const KINDS = {
  string: (v) => typeof v === 'string' && /^[a-z][a-z0-9/-]{0,63}$/.test(v),
  code: (v) => v === null || (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v)),
  time: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v),
  boolean: (v) => typeof v === 'boolean',
  count: (v) => Number.isSafeInteger(v) && v >= 0,
  number: (v) => Number.isFinite(v) && v >= 0,
};
function pick(value, shape) {
  const out = {};
  for (const [key, kind] of Object.entries(shape)) {
    if (!Object.hasOwn(value ?? {}, key)) continue;
    if (typeof kind === 'object') { if (value[key] && typeof value[key] === 'object') out[key] = pick(value[key], kind); } else if (KINDS[kind](value[key])) out[key] = value[key];
  }
  return out;
}
/** What may leave the run: named fields of the right shape only. Everything else, tokens and paths included, is dropped. */
export const exportReport = (report) => pick(report, EXPORT_FIELDS);

/** A run passes only with every part present: a missing section fails it, and so does a run that spoke too little to show anything. */
export function verdict({ failure, restart: r, effects: f, reads: d, cleanup: c }) {
  return !failure && r?.journalSame === true && r.threadSame === true && r.generationAfter > r.generationBefore
    && f?.spoken >= 2 && f.spokenAfterRestart >= 1 && f.duplicates === 0
    && d?.stale === 0 && d.bracket !== undefined && d.bracket !== 'inconclusive' && c?.listening === false && c.survivors === 0;
}

/** Every descendant of the given pids, from one `ps` table. Pass `table` in a test. */
export function descendants(roots, table = processTable()) {
  const children = new Map(); for (const { pid, ppid } of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const seen = new Set(), walk = [...roots];
  while (walk.length) for (const child of children.get(walk.pop()) ?? []) if (!seen.has(child)) { seen.add(child); walk.push(child); }
  return [...seen];
}
export function processTable() {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').map((l) => { const [pid, ppid] = l.trim().split(/\s+/).map(Number); return { pid, ppid }; });
}
export const alive = (pid, kill = process.kill) => { try { kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Everything this run started, held by pid and start token (#368). `note` is called while the tree is whole, because a
 * detached child loses its parent link once that parent exits. `sweep` signals only a process that is still the one noted,
 * so a reused pid is left alone, and returns what is still alive.
 */
export function createProcessWatch({ root = process.pid, inspect = inspectOwnedProcess, table = processTable, kill = process.kill, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const owned = new Map();
  const same = (pid, token) => { try { return inspect(pid)?.startToken === token; } catch { return false; } };
  const live = () => [...owned].filter(([pid, token]) => same(pid, token)).map(([pid]) => pid);
  return {
    note() { for (const pid of descendants([root], table())) { if (owned.has(pid)) continue; try { const p = inspect(pid); if (p) owned.set(pid, p.startToken); } catch { /* gone, or unknown: never ours to signal */ } } return owned.size; },
    async sweep({ graceMs = 2000 } = {}) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        for (const pid of live()) { try { kill(pid, signal); } catch { /* it went first */ } }
        for (const end = Date.now() + graceMs; Date.now() < end && live().length;) await sleep(50);
      }
      return live();
    },
  };
}
