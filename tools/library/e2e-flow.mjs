#!/usr/bin/env node
// The shared library's CLI flow, end to end on two fresh dev worlds (fake minds, $0), one server at a time:
//   alpha (:6120) — a creator defines a reading corner from core parts, places it, publishes it (v1), changes it and
//                   publishes again (v2); a def drawing a Little Martians model is refused.  alpha stops.
//   beta  (:6121) — find "reading corner" from beta, place v1 and v2 through the CLI, read the god snapshot back:
//                   each placement pins the version it placed. Optional: --shots <dir> takes real-Chrome screenshots of
//                   beta (Chrome lease, dpr 1 and 2).
//   node tools/library/e2e-flow.mjs <outDir> [--shots <dir>] [--ports <alpha>,<beta>]   (default 6120,6121)
// Only stops the two world processes it started itself.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startWorld } from '../god-skill/dev-world.mjs';
import { totemGlb } from './fixture-glb.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] ?? `${root}/.lane/library-e2e`);
const shotsAt = process.argv.indexOf('--shots'), shots = shotsAt > 0 ? resolve(process.argv[shotsAt + 1]) : null;
const portsAt = process.argv.indexOf('--ports'), [alphaPort, betaPort] = portsAt > 0 ? process.argv[portsAt + 1].split(',').map(Number) : [6120, 6121];
mkdirSync(out, { recursive: true });
const libDir = join(out, 'lib'), report = { at: new Date().toISOString(), steps: [], checks: {} };
process.env.SIM_LIBRARY_DIR = libDir;   // the worlds this flow starts serve the same library from inside Godmode (/v1/god/library…)
const step = (name, data) => { report.steps.push({ name, ...data }); console.log(`· ${name}${data?.stdout ? '\n' + data.stdout.trim().split('\n').map((l) => '    ' + l).join('\n') : ''}`); };
const cli = (...args) => {
  const r = spawnSync(process.execPath, [join(root, 'tools/library/library.mjs'), ...args, '--lib', libDir], { encoding: 'utf8', env: { ...process.env, SIM_GOD_TOKEN: '' } });
  return { code: r.status, stdout: r.stdout + r.stderr };
};
const started = [];
const stop = async (w) => { if (w.child.exitCode === null) { w.child.kill('SIGTERM'); for (let i = 0; i < 100 && w.child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 50)); if (w.child.exitCode === null) w.child.kill('SIGKILL'); } };
const god = async (w) => {
  const m = await fetch(`${w.base}/v1/god/mint`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: '{"label":"e2e"}' });
  const token = (await m.json()).token;
  return async (path, body) => { const r = await fetch(w.base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
};
const check = (k, ok, detail) => { report.checks[k] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) }; console.log(`  ${ok ? 'ok ' : 'FAIL'} ${k}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

const corner = (extra = []) => ({ schema: 'def/1', name: 'reading-corner', version: 1, description: 'A reading corner: a bench under a lamp post, with a little table. Sit and read in the evening.', tags: ['reading', 'corner', 'seat'], form: 'point',
  make: { kind: 'parts', parts: [{ id: 'bench', def: 'core-bench@1', p: [0, 0] }, { id: 'lamp', def: 'core-lamp-post@1', p: [1.8, -0.6] }, { id: 'table', def: 'core-table@1', p: [-1.9, 0.2] }, ...extra] },
  size: { box: [6, 3, 3] }, layer: 'solid', anchor: 'base' });

try {
  // ---------------------------------------------------------------- alpha: the creator's world
  const alpha = await startWorld({ slug: 'alpha', port: alphaPort, data: join(out, 'data-alpha'), fresh: true, log: join(out, 'alpha.log') }); started.push(alpha);
  const ga = await god(alpha);
  const lmAsset = JSON.parse(readFileSync(join(root, 'worlds/core-assets/littlemartians-two.index.json'), 'utf8')).assets;
  const lmSha = Object.keys(lmAsset)[0];
  let r = await ga('/v1/god/act', { ops: [
    { op: 'define', def: corner() },
    { op: 'place', def: 'reading-corner@1', name: 'corner', p: [0, 0, 0] },
    { op: 'define', def: { schema: 'def/1', name: 'my-martian', version: 1, description: 'A martian I like.', form: 'point', make: { kind: 'mesh', asset: lmSha }, size: { box: [1, 1.5, 1] }, layer: 'solid', anchor: 'base' } },
  ], note: 'e2e: a creator builds a reading corner' });
  check('alpha.define+place', r.data.accepted, r.data.failures);
  let c = cli('publish', '--from', alpha.base, '--dev', '--ref', 'reading-corner@1', '--author-name', 'Ana (alpha owner)', '--title', 'Reading corner');
  step('publish v1 from alpha', c); check('publish.v1', c.code === 0 && /published alpha\/reading-corner@1/.test(c.stdout));
  c = cli('publish', '--from', alpha.base, '--dev', '--ref', 'reading-corner@1');
  check('publish.idempotent', c.code === 0 && /unchanged/.test(c.stdout));
  c = cli('publish', '--from', alpha.base, '--dev', '--ref', 'my-martian@1');
  step('publish a Little Martians model (refused)', c); check('publish.restricted-refused', c.code === 1 && /library\.restricted/.test(c.stdout));
  r = await ga('/v1/god/act', { ops: [{ op: 'define', def: corner([{ id: 'bench2', def: 'core-bench@1', p: [0, 1.6], r: 3.142 }]) }], note: 'e2e: a second bench' });
  check('alpha.redefine', r.data.accepted, r.data.failures);
  c = cli('publish', '--from', alpha.base, '--dev', '--ref', 'reading-corner@1', '--author-name', 'Ana (alpha owner)', '--title', 'Reading corner');
  step('publish v2 from alpha', c); check('publish.v2', c.code === 0 && /published alpha\/reading-corner@2/.test(c.stdout));
  // a model the creator made themselves (CC0): uploaded to alpha, defined, published; the GLB travels with it
  const up = await fetch(`${alpha.base}/v1/god/assets?${new URLSearchParams({ name: 'totem', height: '1.8', license: 'CC0-1.0', source: 'made by Ana in alpha', define: '1', description: 'A painted three-block totem. A landmark to meet at.', tags: 'totem,landmark' })}`, { method: 'POST', headers: { authorization: `Bearer ${(await (await fetch(`${alpha.base}/v1/god/mint`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: '{}' })).json()).token}`, 'content-type': 'model/gltf-binary' }, body: totemGlb() });
  const upj = await up.json(); check('alpha.model-upload', up.status === 200 && upj.asset?.sha, upj.error ?? upj.asset?.sha?.slice(0, 12));
  c = cli('publish', '--from', alpha.base, '--dev', '--ref', 'totem@1', '--author-name', 'Ana (alpha owner)', '--title', 'Painted totem');
  step('publish a self-made model from alpha', c); check('publish.model', c.code === 0 && /published alpha\/totem@1/.test(c.stdout) && /1 model\(s\)/.test(c.stdout));
  await stop(alpha);
  check('alpha.stopped', alpha.child.exitCode !== null || alpha.child.signalCode !== null);

  // ---------------------------------------------------------------- beta: another world
  const beta = await startWorld({ slug: 'beta', port: betaPort, data: join(out, 'data-beta'), fresh: true, log: join(out, 'beta.log') }); started.push(beta);
  c = cli('find', 'reading', 'corner', '--for', beta.base);
  step('find from beta', c); check('find.from-beta', c.code === 0 && /alpha\/reading-corner@2/.test(c.stdout) && /versions 1,2/.test(c.stdout));
  c = cli('find', 'martian', '--for', beta.base);
  check('find.restricted-absent', c.code === 0 && /nothing in the shared library matches/.test(c.stdout));
  c = cli('place', 'alpha/reading-corner@1', '--into', beta.base, '--dev', '--name', 'corner-v1', '--at', '-5,0');
  step('place v1 into beta', c); check('place.v1', c.code === 0);
  c = cli('place', 'alpha/reading-corner', '--into', beta.base, '--dev', '--name', 'corner-v2', '--at', '5,0', '--r', '0');
  step('place latest (v2) into beta', c); check('place.v2', c.code === 0);
  c = cli('place', 'alpha/reading-corner@1', '--into', beta.base, '--dev', '--name', 'corner-v1b', '--at', '-5,-8');
  check('place.v1-again-reuses-def', c.code === 0 && /0 define\(s\)/.test(c.stdout), c.stdout.trim());
  c = cli('place', 'alpha/totem', '--into', beta.base, '--dev', '--name', 'totem', '--at', '0,-5');
  step('place the totem (uploads its model) into beta', c); check('place.model', c.code === 0 && /1 model\(s\) uploaded/.test(c.stdout));
  const gb = await god(beta), snap = (await gb('/v1/god/snapshot')).data;
  const lib = JSON.parse(readFileSync(join(libDir, 'entries/alpha/reading-corner/1.json'), 'utf8')), lib2 = JSON.parse(readFileSync(join(libDir, 'entries/alpha/reading-corner/2.json'), 'utf8'));
  const byName = (n) => snap.entities.find((e) => e.name === n), defOf = (e) => snap.library.find((d) => d.ref === e.def || 'sha:' + d.hash === e.def);
  const v1 = byName('corner-v1'), v2 = byName('corner-v2');
  check('beta.v1-pinned', v1 && defOf(v1)?.hash === lib.hash, { def: v1?.def, hash: defOf(v1)?.hash?.slice(0, 12), want: lib.hash.slice(0, 12) });
  check('beta.v2-pinned', v2 && defOf(v2)?.hash === lib2.hash, { def: v2?.def, hash: defOf(v2)?.hash?.slice(0, 12), want: lib2.hash.slice(0, 12) });
  check('beta.parts-expanded', snap.entities.filter((e) => e.in?.parent === v2?.id).length === 4, snap.entities.filter((e) => e.in?.parent === v2?.id).map((e) => e.def));
  check('record.author+licence', lib2.author.world === 'alpha' && lib2.author.name === 'Ana (alpha owner)' && lib2.licence.spdx === 'CC0-1.0', { author: lib2.author, licence: lib2.licence });
  const totem = byName('totem'), tlib = JSON.parse(readFileSync(join(libDir, 'entries/alpha/totem/1.json'), 'utf8'));
  check('beta.model-pinned', totem && defOf(totem)?.hash === tlib.hash && defOf(totem)?.make?.asset === tlib.assets[0].sha && (await fetch(`${beta.base}/assets/${tlib.assets[0].sha}.glb`)).status === 200, { asset: tlib.assets[0].sha.slice(0, 12), licence: tlib.assets[0].licence });
  // from inside beta's Godmode (the god's own routes, same library, the same moderation seam)
  const rf = await gb('/v1/god/library?q=reading%20corner');
  check('route.find', rf.status === 200 && rf.data.hits[0]?.id === 'alpha/reading-corner' && rf.data.hits[0]?.placedHere === true, rf.data.hits?.map((h) => `${h.id}@${h.version}`));
  const rp = await gb('/v1/god/library/place', { item: 'alpha/reading-corner@2', at: [0, 8], name: 'corner-route' });
  check('route.place', rp.status === 200 && rp.data.accepted && rp.data.defines === 0 && rp.data.item.version === 2, { status: rp.status, defines: rp.data.defines, code: rp.data.code });
  const rx = await gb('/v1/god/library/place', { item: 'alpha/my-martian', at: [0, 0] });
  check('route.restricted-absent', rx.status === 404 && rx.data.code === 'library.missing', rx.data.code);
  report.ledger = readFileSync(join(libDir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  // ---------------------------------------------------------------- what a visitor sees in beta (real Chrome)
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
    const { chromium } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('@playwright/test');
    const release = await chromeLease('library');
    try {
      const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
      try {
        for (const dpr of [1, 2]) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: dpr });
          const page = await ctx.newPage(), errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          await page.goto(`${beta.base}/?dev=1`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => !!window.__soulsEntity?.layer.active, null, { timeout: 120000 });
          await page.locator('.viewer-arrival').waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
          await page.waitForTimeout(2500);
          const stats = await page.evaluate(() => window.__soulsEntity.stats());
          const f = join(shots, `beta-library-dpr${dpr}.png`); await page.screenshot({ path: f });
          step(`screenshot dpr ${dpr}`, { file: f, stats, errors });
          check(`shot.dpr${dpr}`, stats.entities >= 10 && !errors.length, { entities: stats.entities, errors: errors.slice(0, 2) });
          // closer: the corners placed from the library (v1 left, v2 with its second bench right, v1 again behind,
          // the route-placed v2 in front, the uploaded totem in the middle)
          const frame = () => page.evaluate(() => { const s = window.__soulsEntity; s.controls.target.set(0, 0.6, -1); s.camera.position.set(2, 8.5, 15); s.controls.update?.(); });
          await frame(); await page.waitForTimeout(1000); await frame(); await page.waitForTimeout(1500);   // twice: an arrival glide may still own the camera
          const fc = join(shots, `beta-library-close-dpr${dpr}.png`); await page.screenshot({ path: fc });
          step(`close-up dpr ${dpr}`, { file: fc });
          await ctx.close();
        }
      } finally { await browser.close(); }
    } finally { release(); }
  }
  await stop(beta);
} catch (e) { report.error = String(e?.stack ?? e); console.error(e); }
finally { for (const w of started) await stop(w); }
const failed = Object.entries(report.checks).filter(([, v]) => !v.ok).map(([k]) => k);
report.ok = !report.error && !failed.length; report.failed = failed;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`\n${report.ok ? 'PASS' : 'FAIL'} ${Object.keys(report.checks).length - failed.length}/${Object.keys(report.checks).length} checks → ${join(out, 'report.json')}${failed.length ? `\nfailed: ${failed.join(', ')}` : ''}`);
process.exit(report.ok ? 0 : 1);
