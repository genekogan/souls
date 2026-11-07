#!/usr/bin/env node
// What presence wakes cost in a busy room (#486). One real fake-mind world, no model, no host: N Souls wait in one room, visitors come
// and go, one Soul waits elsewhere. Each waiting Soul's real event stream goes through the runtime's own attention rule and cooldown,
// and a wake reads `here` once, so "reads per wake" is 1 by construction: a live agent may read more.
//   node tools/playtest/scenarios/continuity/wake-cost.mjs --souls 6 [--seconds 300] [--every 30] [--port 4495] [--runtime <root>] [--out dir]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { startWorld, stopWorld } from '../../arena/provision.mjs';

const { values: o } = parseArgs({ options: { souls: { type: 'string', default: '2' }, seconds: { type: 'string', default: '300' }, every: { type: 'string', default: '30' }, port: { type: 'string', default: '4495' }, runtime: { type: 'string', default: '.' }, out: { type: 'string', default: '.local/wake-cost' } } });
const souls = Number(o.souls), seconds = Number(o.seconds), every = Number(o.every), root = resolve('.'), runtime = resolve(o.runtime);
const ROOM = 'walk:lab-pond-hall', ELSEWHERE = 'walk:cottage', FAR = 'walk:flag-orchard', VISITORS = 3, SETTLE_MS = 250;
const { presenceCooldown, attentionPriority } = await import(pathToFileURL(join(runtime, 'tools/soul-runtime/supervisor.mjs')).href);
const { createWorldClient } = await import(pathToFileURL(join(runtime, 'tools/soul-runtime/world-client.mjs')).href);
const out = resolve(o.out, `${souls}-souls`); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const isPresence = (e) => e.kind === 'arrive.here' || e.kind === 'leave.here';
function seat(name) {
  const dir = join(out, name); mkdirSync(dir); copyFileSync('tools/world-launcher/soul/eden.mjs', join(dir, 'eden.mjs'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ identity: `agent-${randomBytes(12).toString('hex')}` }), { mode: 0o600 });
  const eden = (...a) => new Promise((ok) => execFile(process.execPath, ['eden.mjs', ...a], { cwd: dir, timeout: 150_000, maxBuffer: 1 << 24 }, (e, so) => { let json = null; try { json = JSON.parse(so); } catch { /* text */ } ok(json); }));
  return { name, dir, eden };
}
/** One waiting Soul: its stream, the runtime's rule, one `here` per wake. */
function watcher(s, base, stop, started) {
  const { token } = JSON.parse(readFileSync(join(s.dir, '.eden-agent.json'), 'utf8')), client = createWorldClient({ world: base, token }), cooldown = presenceCooldown();
  const r = { name: s.name, wakes: 0, otherWakes: {}, hereBytes: 0, seen: { arrive: 0, leave: 0 }, suppressed: 0, wakeTimes: [], hereMs: [] };
  let pending = [], timer = null, sequence = 0; const woke = new Set();
  const wake = async () => {
    timer = null; const facts = pending; pending = []; if (!facts.length) return;
    const at = Date.now(), byPresence = facts.some((f) => isPresence(f.event) && woke.has(f.sequence)); cooldown.delivered(facts, 'nearby', at);
    if (!byPresence) { for (const f of facts) if (woke.has(f.sequence)) r.otherWakes[f.event.kind] = (r.otherWakes[f.event.kind] ?? 0) + 1; return; }
    r.wakes++; r.wakeTimes.push(at);
    const t0 = performance.now(), here = await client.read('here', {}, stop.signal).catch(() => null); r.hereMs.push(Math.round(performance.now() - t0)); r.hereBytes += Buffer.byteLength(JSON.stringify(here ?? ''));
  };
  const pump = (async () => {
    let after = 'c_0';
    while (!stop.signal.aborted) {
      const page = await client.eventPage({ after, signal: stop.signal }).catch(() => null); if (!page) { if (!stop.signal.aborted) await new Promise((x) => setTimeout(x, 500)); continue; }
      after = page.cursor;
      for (const event of page.events) {
        if (!started.live) continue;   // the stream starts at the world's beginning: history isn't a wake
        const fact = { source: 'world', event, receivedAt: Date.now(), sequence: ++sequence }, presence = isPresence(event);
        if (presence) r.seen[event.kind === 'arrive.here' ? 'arrive' : 'leave']++;
        const priority = cooldown.priority(fact, 'nearby'); pending.push(fact);
        if (priority >= 1) { woke.add(fact.sequence); timer ??= setTimeout(wake, SETTLE_MS); } else if (presence && attentionPriority(fact, 'nearby') >= 1) r.suppressed++;
      }
    }
  })();
  return { r, pump };
}

const w = await startWorld({ serverRoot: root, slug: 'w', port: Number(o.port), genesis: 'worlds/templates/hello-hamlet.json', dataDir: join(out, 'data'), log: join(out, 'world.log') });
const stop = new AbortController(), result = { schema: 'wake-cost/1', souls, seconds, everySec: every, startedAt: new Date().toISOString(), runtime: o.runtime };
try {
  const room = Array.from({ length: souls }, (_, i) => seat(`room-${i}`)), far = seat('far'), visitors = Array.from({ length: VISITORS }, (_, i) => seat(`visitor-${i}`));
  for (const s of [...room, far, ...visitors]) { await s.eden('register', w.base); await s.eden('create', s.name); }
  await Promise.all([...room.map((s) => s.eden('act', ROOM, '--wait', '120', '--for', 'none')), far.eden('act', FAR, '--wait', '120', '--for', 'none'), ...visitors.map((s) => s.eden('act', ELSEWHERE, '--wait', '120', '--for', 'none'))]);
  const pos = async (s) => (await s.eden('here'))?.me?.pos ?? null, [a, b] = [await pos(room[0]), await pos(far)]; result.farMetres = a && b ? Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])) : null;
  const started = { live: false }, watchers = [...room, far].map((s) => watcher(s, w.base, stop, started)); await new Promise((x) => setTimeout(x, 5000)); started.live = true;
  const t0 = Date.now(), moves = []; let k = 0;
  while (Date.now() - t0 < seconds * 1000) { const v = visitors[k % VISITORS], back = Math.floor(k / VISITORS) % 2; moves.push(v.eden('act', back ? ELSEWHERE : ROOM, '--wait', '60', '--for', 'none')); k++; await new Promise((x) => setTimeout(x, every * 1000)); }
  stop.abort(); await Promise.all(moves); await Promise.allSettled(watchers.map((x) => x.pump));
  const minutes = seconds / 60, rs = watchers.map((x) => x.r), inRoom = rs.filter((x) => x.name !== 'far'), sum = (f) => inRoom.reduce((n, x) => n + f(x), 0), wakes = sum((x) => x.wakes);
  const maxPerMin = Math.max(...inRoom.map((x) => { let m = 0; for (const t of x.wakeTimes) m = Math.max(m, x.wakeTimes.filter((u) => u >= t && u < t + 60000).length); return m; }));
  Object.assign(result, { moves: k, wakes, wakesPerSoulMinute: +(wakes / souls / minutes).toFixed(2), readsPerWake: wakes ? 1 : null, hereBytesPerWake: wakes ? Math.round(sum((x) => x.hereBytes) / wakes) : null, maxWakesPerSoulMinute: maxPerMin, presenceSeenPerSoul: +(sum((x) => x.seen.arrive + x.seen.leave) / souls).toFixed(1), suppressedPerSoul: +(sum((x) => x.suppressed) / souls).toFixed(1), farWakes: rs.find((x) => x.name === 'far').wakes, otherWakes: Object.assign({}, ...rs.map((x) => x.otherWakes)), hereMsMedian: inRoom.flatMap((x) => x.hereMs).sort((p, q) => p - q)[Math.floor(wakes / 2)] ?? null, finishedAt: new Date().toISOString() });
} catch (e) { result.error = e.message; stop.abort(); } finally { await stopWorld({ pid: w.pid }); }
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1)); console.log(JSON.stringify(result)); process.exit(result.error ? 1 : 0);
