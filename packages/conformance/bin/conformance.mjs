#!/usr/bin/env node
// nice -n 10 node packages/conformance/bin/conformance.mjs --k 32 --out /tmp/conformance.json
// Geometry uses the gallery's complete mesh registry bundle; GPU screenshots are a separate qualification.
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { coreLibrary } from '@sim/world-compiler';
import { conformance } from '../src/conformance.ts';
const args = process.argv.slice(2), flag = (k, fallback) => { const i = args.indexOf(`--${k}`); return i < 0 ? fallback : args[i + 1]; };
const k = Number(flag('k', 32));
if (!Number.isSafeInteger(k) || k < 0 || k > 10_000) throw Error('--k needs an integer 0..10000');
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'eden-conformance-'));
try {
  const mesh = join(root, 'apps/web/src/gen-mesh'), files = [];
  const walk = dir => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mesh.ts')) files.push(p); } }; walk(mesh);
  const source = files.map(p => `import ${JSON.stringify(p)};`).join('\n') + `\nexport { meshFor } from ${JSON.stringify(join(mesh, 'registry.ts'))};\nexport { MaterialLib } from ${JSON.stringify(join(mesh, 'materials.ts'))};\nexport { removeShadowProxies } from ${JSON.stringify(join(mesh, 'shadow-proxy.ts'))};`;
  const esbuild = createRequire(join(root, 'mars/viewer/package.json'))('esbuild'), output = join(temp, 'gallery.mjs');
  await esbuild.build({ stdin: { contents: source, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'error', define: { 'import.meta.env': '{}' } });
  globalThis.location = new URL('http://127.0.0.1:5366/');
  globalThis.window = globalThis;
  const gallery = await import(pathToFileURL(output));
  const shard = String(flag('shard', '1/1')).match(/^(\d+)\/(\d+)$/);
  if (!shard || +shard[1] < 1 || +shard[1] > +shard[2] || +shard[2] > 776) throw Error('--shard needs i/n, 1 <= i <= n <= 776');
  const defs = coreLibrary().all().filter((_, i) => i % +shard[2] === +shard[1] - 1).filter(d => !flag('filter', '') || d.ref.includes(flag('filter', '')));
  const gaps = new Map();
  const render = (def, params, baked, model, scale, state) => {
    if (def.make.kind === 'gen' && /^(landform|brush)\/1$/.test(def.make.gen)) { gaps.set(def.ref, { def: def.ref, kind: 'ground', reason: 'terrain mutation is drawn by shared ground, not standalone gallery geometry' }); return; }
    if (def.make.kind === 'none' || def.make.kind === 'parts' || def.make.kind === 'mesh') return; // semantic, prefab and async GLB: reported as qualification gaps below
    const builder = gallery.meshFor(def);
    if (!builder) throw Error(`no gallery builder for ${def.make.gen}`);
    const materials = new gallery.MaterialLib();
    // Canonical buildings retain source faces without auxiliary render-time shadow copies.
    let obj; try { obj = builder.build({ ...(builder.gen === 'building/1' ? { canonicalContext: true } : {}), def, params, baked, model, materials, entity: { id: 'sweep', def: def.ref, in: { parent: 'world' }, p: [0, 0], seed: 7, params, ...(state ? { state } : {}) }, args: def.make.args ?? {}, tint: (key, fallback) => params[key] ?? def.palette?.[key] ?? fallback }); } catch (e) { if (/document is not defined|window is not defined/.test(String(e))) { gaps.set(def.ref, { def: def.ref, kind: 'browser-only', reason: String(e) }); return; } throw e; }
    if (!obj && (baked.parts?.length || def.form !== 'point')) { gaps.set(def.ref, { def: def.ref, kind: 'world-fixture', reason: 'expanded children/shared surfaces require a world gallery fixture' }); return; }
    if (!obj) throw Error('gallery returned no object');
    // Other builders keep their normal context; their owned shadow copies are auxiliary to this geometry measurement too.
    gallery.removeShadowProxies(obj);
    try { let tris = 0, draws = 0; const mats = new Set(); obj.scale.multiplyScalar(scale); obj.updateMatrixWorld(true); obj.traverse(o => { if (o.isMesh) { tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; draws++; for (const m of [].concat(o.material)) mats.add(m); } }); obj.traverse(o => { const p = o.geometry?.attributes?.position; if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) throw Error('nonfinite gallery vertex'); }); return { tris, draws, materials: mats.size }; }
    finally { obj.traverse(o => { o.geometry?.dispose(); }); materials.dispose?.(); }
  };
  let n = 0;
  const report = await conformance({ defs, k, seed: flag('seed', 'EF4'), render, onDef: ref => { if (++n % 100 === 0) console.error(`${n}/${defs.length} ${ref}`); } });
  report.qualificationGaps = [...gaps.values(), ...defs.filter(d => ['mesh', 'none', 'parts'].includes(d.make.kind)).map(d => ({ def: d.ref, kind: d.make.kind, reason: d.make.kind === 'mesh' ? 'GPU/async asset rendering requires lead browser qualification' : 'semantic/prefab has no standalone gallery object' }))];
  writeFileSync(flag('out', '/tmp/eden-library-conformance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, findings: report.findings.length, qualificationGaps: report.qualificationGaps.length }));
  if (report.findings.length && !args.includes('--report-only')) process.exitCode = 1;
} finally { rmSync(temp, { recursive: true, force: true }); }
