#!/usr/bin/env node
// Manual smoke against a running dev world (default: the pttest world on 4981). ~40 s. Prints compact JSON.
//   node tools/playtest/observer/smoke.mjs [--base URL] [--soul s_…] [--identity agent-…] [--out DIR] [--gpu metal|swiftshader]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBrowser, sampler } from './browser.mjs';
import { snapshotSoul, godSlice, healthz } from './world-truth.mjs';
import { sleep } from '../lib/clock.mjs';
import { readJsonl } from '../lib/jsonl.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:4981/w/pttest'), soulId = arg('soul', 's_6021854a99');
const identity = arg('identity', 'agent-9d79ef9693ca72b672a29bf8'); // a public dev user id, not a secret
const out = arg('out', join(tmpdir(), `playtest-observer-smoke-${Date.now()}`)); mkdirSync(out, { recursive: true });
const log = (...a) => console.error('[smoke]', ...a);
const timeoutSeconds = Number(arg('timeout-seconds', '180'));
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw Error('--timeout-seconds must be positive');
const dimensions = arg('viewport', '1280x800').match(/^(\d+)x(\d+)$/);
const viewport = dimensions && { width: Number(dimensions[1]), height: Number(dimensions[2]) };
if (!viewport || viewport.width < 320 || viewport.height < 240 || viewport.width > 3840 || viewport.height > 2160) throw Error('--viewport must be WIDTHxHEIGHT between 320x240 and 3840x2160');
const deadline = Date.now() + timeoutSeconds * 1000;

const h = await healthz(base); log('healthz', h.ok, 'tick', h.tick);
const b = await openBrowser({ gpu: arg('gpu', 'metal') });
let samples = null;
const summary = { ok: false, out, timeoutSeconds, viewport };
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; void b.close().catch(() => {}); }, timeoutSeconds * 1000);
try {
  if (!h.ok) throw Error('world health check failed');
  const diagnosticsDir = join(out, 'diagnostics');
  const follow = await b.openCamera({ base, identity, kind: 'follow', soulId, diagnosticsDir, viewport });
  const wide = await b.openCamera({ base, identity, kind: 'wide', diagnosticsDir, viewport });
  log('arrived follow', follow.arrivedMs, 'ms; wide', wide.arrivedMs, 'ms; follow', JSON.stringify(follow.follow));
  if (!follow.follow?.ok) throw Error(`follow failed: ${follow.follow?.reason ?? 'unknown'}`);
  samples = sampler({ cameras: [follow, wide], everySec: 5, runDir: out });
  for (;;) {
    const current = readJsonl(join(out, 'shots', 'index.jsonl'));
    if (current.some(r => r.error)) throw Error(`screenshot failed: ${current.find(r => r.error).error}`);
    if ([follow.name, wide.name].every(cam => current.filter(r => r.cam === cam && r.path).length >= 3)) break;
    if (Date.now() >= deadline) throw Error('observer smoke timed out waiting for three successful shots per camera');
    await sleep(250);
  }
  await samples.stop();
  const shots = readJsonl(join(out, 'shots', 'index.jsonl'));
  const leg = await follow.legible(); leg.raw = leg.raw.slice(0, 300) + (leg.raw.length > 300 ? '…' : '');
  const snap = await snapshotSoul({ base, soulId, admin: true });
  const at = snap.pos ? [snap.pos.x, snap.pos.z] : [0, 0];
  const god = await godSlice({ base, godDir: join(out, 'observer-god'), around: at, radius: 10 });
  Object.assign(summary, { follow: follow.follow, arrivedMs: { follow: follow.arrivedMs, wide: wide.arrivedMs },
    shots: shots.map((r) => ({ cam: r.cam, mono: r.mono, ms: r.ms, mode: r.mode, path: r.path, error: r.error })),
    legible: leg, snapshotSoul: snap,
    godSlice: god && { ms: god.ms, ground: god.ground, insideSolid: god.insideSolid, footprints: god.footprints, entities: god.entities.map((e) => ({ path: e.path, def: e.def, dist: e.dist, layer: e.layer, footprint: e.footprint, slots: e.slots.length, soul: e.soul })) },
    pageErrors: [...follow.errors, ...wide.errors].slice(0, 5) });
  if (summary.pageErrors.length) throw Error('observer pages reported errors');
  if (!snap.name || snap.http.public !== 200 || snap.http.owner !== 200) throw Error('Soul truth routes unavailable');
  if (timedOut) throw Error('observer smoke exceeded its deadline');
  summary.ok = true;
} catch (error) {
  summary.error = String(error);
  if (error.observer) summary.observer = error.observer;
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await b.close();
  if (samples) await samples.stop();
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}
