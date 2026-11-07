// The launcher's guard over its world processes (lane L1, server-reliability tranche; docs/architecture/load.md §4):
// the numbers it judges by, the world's live.json heartbeat, restart backoff. Pure helpers; children.mjs acts on them.
import { readFileSync } from 'node:fs';

/** LOAD-CONTRACT §4 launcher rules. Tests pass smaller numbers through ChildPool's `guard` option. */
export const GUARD = Object.freeze({
  pollMs: 10_000,          // each running world's /healthz (and live.json) is looked at this often...
  timeoutMs: 5_000,        // ...with this long to answer
  failures: 6,             // this many failed looks in a row: wedged
  liveStaleMs: 30_000,     // live.json `at` older than this: wedged (the watchdog thread or the process is frozen)
  turnAgeMs: 30_000,       // live.json loop.lastTurnAgeMs over this: wedged (the main thread is stuck)
  suspectFailures: 3,      // reported as a problem from here on (host-health), before the kill
  usr2WaitMs: 5_000,       // SIGUSR2 (the world's diagnostic report) -> this long -> SIGTERM
  termGraceMs: 20_000,     // SIGTERM -> this long -> SIGKILL
  bootStallMs: 60_000,     // a boot is killed only when its progress has not moved for this long (never on a deadline)
  silentBootStallMs: 300_000,   // ...or, while it writes no live.json (a release before lane L2's watchdog), this long
                           // without a line of output: today's replay is silent until it is done (36-40 s on 10-31, more on 10-24)
  bootSlowMs: 15_000,      // a boot longer than this is reported (bootSlow), not killed
  backoffBaseMs: 1_000,    // restart backoff: full jitter, base...
  backoffCapMs: 300_000,   // ...and cap
  resetAfterMs: 600_000,   // the backoff counter resets after this long healthy
  breakerN: 5,             // this many failures (crash, failed boot, wedge)...
  breakerWindowMs: 1_800_000,   // ...within this window: held (no more restarts until resumed)
  crashloopN: 2,           // reported as crashloop from this many failures in the window
  wedgeShownMs: 600_000,   // a wedge stays in the problems this long after its restart (sim-watch polls every 5 min)
});

/** Full-jitter backoff: a uniform wait in [0, min(cap, base * 2^n)). */
export function jitterMs(n, { backoffBaseMs = GUARD.backoffBaseMs, backoffCapMs = GUARD.backoffCapMs } = {}, random = Math.random) {
  return Math.floor(random() * Math.min(backoffCapMs, backoffBaseMs * 2 ** Math.max(0, n)));
}

/** The world's live.json (LOAD-CONTRACT §4), or null when absent, unreadable, or written by another process (a previous
 *  run's file must never vouch for, or condemn, this one). */
export function readLive(file, pid) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j?.v !== 1 || !Number.isFinite(j.at)) return null;
    if (Number.isInteger(pid) && j.pid !== pid) return null;
    return j;
  } catch { return null; }
}

/** Why a serving world's live.json says it is wedged, or null. */
export function liveWedge(live, now, g = GUARD) {
  if (!live) return null;
  const age = now - live.at;
  if (age > g.liveStaleMs) return `live.json ${Math.round(age / 1000)} s old`;
  const turn = live.loop?.lastTurnAgeMs;
  if (Number.isFinite(turn) && turn > g.turnAgeMs) return `main thread stuck ${Math.round(turn / 1000)} s`;
  return null;
}

/** What counts as a boot moving: live.json's boot stage/tick when the world writes one, else its output and a 503 body. */
export function bootMark(live, lastOutputAt, body) {
  if (live) return `live:${live.phase ?? ''}:${live.boot?.stage ?? ''}:${live.boot?.tick ?? ''}`;
  return `out:${lastOutputAt ?? 0}:${body ?? ''}`;
}
