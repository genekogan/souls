#!/usr/bin/env node
// Reduce GLBs to the god import budget (issue #760): the pipeline that made the littlemartians-two assets
// (scripts/lm-two/optimize-assets.mjs, pinned to one git commit) for any files on disk. Needs this repo's node_modules
// (@gltf-transform, meshoptimizer, sharp, three's Draco decoder); an agent without the repo uses `npx @gltf-transform/cli`
// (SKILL.md "Importing your own models").
//
//   node tools/god-skill/scripts/optimize-glb.mjs <file.glb|dir>… --out <dir> [--kind hero|scene|character|head|prop]
//        [--tris N] [--tex N] [--quality q] [--force]
//
// Per file: decode (Draco too) → dedup → flatten + join (static files only; a skinned or animated file keeps its node
// tree) → weld → prune → edge-collapse simplification to the triangle target with an error bound that steps up
// (0.01 → 0.07) only as far as the target needs → grid clustering only for a static triangle soup that will not collapse →
// textures resized and re-encoded as WebP → quantized → meshopt-compressed. A static output whose bounds moved by more
// than 1 % of its size, or any output over the budget (80 000 tris, 3 MB, 2048 px), is reported as failed, not written.
//
// The inputs are never touched: --out must be a directory outside every input directory, outputs are written under it
// by their own name, and an existing output is kept unless --force. <out>/REPORT.json records source and output sha,
// before/after triangles, bytes and texture size, and the settings, so a library points back to its masters.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** The god import budget (packages/generators/src/creation-limits.ts). */
export const BUDGET = Object.freeze({ tris: 80_000, bytes: 3_000_000, texPx: 2048 });
/** Targets per kind of thing: what littlemartians-two used, by what the viewer shows from the usual distance. */
export const KINDS = Object.freeze({
  hero: { tris: 76_000, tex: 2048, quality: 86, note: 'a landmark scan or sculpture seen up close' },
  scene: { tris: 30_000, tex: 1024, quality: 84, note: 'a room, city or museum scan' },
  character: { tris: 40_000, tex: 1024, quality: 84, note: 'a rigged or static figure' },
  head: { tris: 25_000, tex: 1024, quality: 84, note: 'a head or small object scan' },
  prop: { tris: 10_000, tex: 1024, quality: 80, note: 'furniture, tools, anything placed many times (under 2 000 when repeated a lot)' },
});
const STEPS = [0.01, 0.03, 0.05, 0.07];

// ---------------------------------------------------------------- arguments
export function parseArgs(argv) {
  const o = { inputs: [], kind: 'scene', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '--kind' || a === '--tris' || a === '--tex' || a === '--quality') { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); o[a.slice(2)] = argv[++i]; }
    else if (a === '--force') o.force = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.inputs.push(a);
  }
  if (!o.inputs.length || !o.out) throw new Error('usage: optimize-glb.mjs <file.glb|dir>… --out <dir> [--kind hero|scene|character|head|prop] [--tris N] [--tex N] [--quality q] [--force]');
  if (!KINDS[o.kind]) throw new Error(`--kind is one of ${Object.keys(KINDS).join(', ')}`);
  const k = KINDS[o.kind];
  const num = (v, name, lo, hi) => { if (v === undefined) return undefined; const n = Number(v); if (!(Number.isFinite(n) && n >= lo && n <= hi)) throw new Error(`--${name} takes a number in ${lo}..${hi}`); return n; };
  o.targets = { tris: num(o.tris, 'tris', 12, BUDGET.tris) ?? k.tris, tex: num(o.tex, 'tex', 64, BUDGET.texPx) ?? k.tex, quality: num(o.quality, 'quality', 40, 100) ?? k.quality };
  return o;
}

/** The .glb files under the inputs, and the refusal when --out would touch them. `skip` lists those whose output exists (empty with force). */
export function planFiles(inputs, out, force = false) {
  const files = [], dirs = new Set();
  for (const input of inputs) {
    const p = resolve(input);
    if (!existsSync(p)) throw new Error(`no such file or directory: ${input}`);
    if (statSync(p).isDirectory()) { dirs.add(p); for (const f of walk(p)) files.push(f); }
    else { if (!/\.glb$/i.test(p)) throw new Error(`${input}: only .glb files (convert .obj/.fbx/.blend to glTF 2.0 binary first)`); files.push(p); dirs.add(dirname(p)); }
  }
  if (!files.length) throw new Error('no .glb files under the inputs');
  const o = resolve(out);
  for (const d of dirs) if (o === d || o.startsWith(d + sep)) throw new Error(`--out ${out} is an input directory or inside one (${relative(process.cwd(), d) || '.'}): the masters are never written to; choose a directory outside them`);
  const outputs = new Map();
  for (const f of files) {
    const dest = join(o, basename(f));
    if (files.includes(dest)) throw new Error(`${relative(process.cwd(), dest)} is an input: refusing to overwrite it`);
    if (outputs.has(basename(f))) throw new Error(`two inputs are both named ${basename(f)} (${relative(process.cwd(), outputs.get(basename(f)))} and ${relative(process.cwd(), f)}): give them distinct names`);
    outputs.set(basename(f), f);
  }
  const skip = force ? [] : files.filter((f) => existsSync(join(o, basename(f))));   // an existing output is kept unless --force
  return { files, out: o, skip };
}
function* walk(dir) { for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.glb$/i.test(e.name)) yield p; } }

// ---------------------------------------------------------------- tools (from the workspace's node_modules)
async function tools() {
  const server = createRequire(join(ROOT, 'apps/server/package.json'));
  const fnReq = createRequire(server.resolve('@gltf-transform/functions'));
  const core = fnReq('@gltf-transform/core'), ext = fnReq('@gltf-transform/extensions'), fn = fnReq('@gltf-transform/functions');
  const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = fnReq('meshoptimizer');
  const sharp = fnReq('sharp');
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  // three's Draco decoder is an emscripten CommonJS file inside an ESM package: load a private copy as .cjs
  const web = createRequire(join(ROOT, 'apps/web/package.json'));
  const dracoCjs = join(mkdtempSync(join(tmpdir(), 'optimize-glb-')), 'draco_decoder.cjs');
  writeFileSync(dracoCjs, readFileSync(web.resolve('three/examples/jsm/libs/draco/gltf/draco_decoder.js')));
  const draco = await createRequire(import.meta.url)(dracoCjs)();
  const io = new core.NodeIO().setLogger(new core.Logger(core.Logger.Verbosity.ERROR)).registerExtensions(ext.ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': draco, 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  return { io, core, ext, fn, sharp, MeshoptEncoder, MeshoptSimplifier };
}

/** Triangles the way the server counts them (per mesh primitive, indexed or not). */
export function triangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if ((p.getMode?.() ?? 4) === 4) { const i = p.getIndices(); n += Math.floor((i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3); }
  return n;
}
const texPxOf = (doc) => Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0, 0]))));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sceneBounds = (T, doc) => { const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; for (const sc of doc.getRoot().listScenes()) { const x = T.core.getBounds(sc); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], x.min[k]); b.max[k] = Math.max(b.max[k], x.max[k]); } } return b; };
const boundsGap = (a, b) => { const size = Math.max(...a.max.map((v, k) => v - a.min[k])) || 1; return Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(a.min[k] - b.min[k]), Math.abs(a.max[k] - b.max[k])])) / size; };

/** One file in memory: { out: Uint8Array, before, after, … } or a thrown Error naming why it cannot meet the targets. */
export async function optimizeGlb(T, bytes, targets, { budget = BUDGET } = {}) {
  const { io, fn, ext, sharp, MeshoptEncoder, MeshoptSimplifier } = T;
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  const before = { tris: triangles(doc), bytes: bytes.byteLength, texPx: texPxOf(doc) };
  const animated = root.listSkins().length > 0 || root.listAnimations().length > 0;
  const want = animated ? null : sceneBounds(T, doc);
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();   // decoded on read; re-encoded with meshopt below
  await doc.transform(fn.dedup(), ...(animated ? [] : [fn.flatten(), fn.join({ keepNamed: false })]), fn.weld(), fn.prune());
  let t = triangles(doc), passes = 0, mode = 'none';
  if (t > targets.tris) {
    let ratio = targets.tris / t;
    for (const error of STEPS) {
      if (t <= targets.tris) break;
      await doc.transform(fn.simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(0.98, ratio), error, lockBorder: false }), fn.prune());
      const now = triangles(doc); passes++; mode = 'edge-collapse';
      ratio = Math.min(0.98, ratio * (targets.tris / Math.max(1, now)) * 0.97); t = now;
    }
  }
  if (t > targets.tris * 1.1 && !animated) {
    // an unwelded scan ("triangle soup") does not collapse along edges: cluster it instead (the look stays in the texture)
    const k = targets.tris / t;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION'); let idx = p.getIndices();
      if (!idx) { const a = new Uint32Array(pos.getCount()); for (let j = 0; j < a.length; j++) a[j] = j; idx = doc.createAccessor().setType('SCALAR').setArray(a); p.setIndices(idx); }
      const src = new Uint32Array(idx.getArray()), xyz = new Float32Array(pos.getCount() * 3);
      for (let j = 0, v = [0, 0, 0]; j < pos.getCount(); j++) { pos.getElement(j, v); xyz.set(v, j * 3); }
      const target = Math.max(3, Math.floor((src.length * k) / 3) * 3);
      const [dst] = MeshoptSimplifier.simplifySloppy(src, xyz, 3, null, target, 0.05);
      idx.setArray(new Uint32Array(dst)); fn.compactPrimitive(p);
    }
    t = triangles(doc); mode = 'cluster';
  }
  if (t > targets.tris * 1.1) throw new Error(`target missed: ${t} triangles after simplification (target ${targets.tris}); ${animated ? 'an animated file is never clustered — ' : ''}try a larger --tris or split the model`);
  let tex = targets.tex, quality = targets.quality, out, gap = 0;
  for (let round = 0; round < 3; round++) {
    await doc.transform(
      fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality }),
      fn.prune(), fn.reorder({ encoder: MeshoptEncoder }), fn.quantize(), fn.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    out = await io.writeBinary(doc);
    if (out.byteLength <= Math.min(budget.bytes, 2_900_000) || tex <= 256) break;
    tex = Math.max(256, tex / 2); quality = Math.max(60, quality - 8);   // over 3 MB: smaller textures before touching geometry again
  }
  const after = await io.readBinary(out);
  const afterM = { tris: triangles(after), bytes: out.byteLength, texPx: texPxOf(after) };
  if (want) { gap = boundsGap(want, sceneBounds(T, after)); if (gap > 0.01) throw new Error(`bounds moved by ${(gap * 100).toFixed(1)} % of the size (a thin part collapsed); try a larger --tris`); }
  if (afterM.tris > budget.tris || afterM.bytes > budget.bytes || afterM.texPx > budget.texPx) throw new Error(`still over budget: ${afterM.tris} tris, ${(afterM.bytes / 1e6).toFixed(2)} MB, ${afterM.texPx} px`);
  const kept = { skins: after.getRoot().listSkins().length, clips: after.getRoot().listAnimations().map((a) => a.getName()) };
  return { out, before, after: afterM, animated, passes, mode, boundsGap: +gap.toFixed(4), settings: { tris: targets.tris, tex, quality }, kept };
}

// ---------------------------------------------------------------- main
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  let o; try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  let plan; try { plan = planFiles(o.inputs, o.out, o.force); } catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(2); }
  mkdirSync(plan.out, { recursive: true });
  const reportFile = join(plan.out, 'REPORT.json');
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : { schema: 'optimize-glb-report/1', files: {} };
  report.kind = o.kind; report.targets = o.targets; report.budget = BUDGET; report.at = new Date().toISOString();
  const T = await tools();
  let i = 0, done = 0, failed = 0, skipped = 0;
  for (const f of plan.files) {
    i++;
    const name = basename(f), dest = join(plan.out, name), rel = relative(process.cwd(), f);
    if (plan.skip.includes(f)) { skipped++; console.log(`${i}/${plan.files.length} ${name}: kept (${relative(process.cwd(), dest)} exists; --force to overwrite)`); continue; }
    const bytes = new Uint8Array(readFileSync(f)), srcSha = sha256(bytes);
    const t0 = Date.now();
    try {
      const r = await optimizeGlb(T, bytes, o.targets);
      writeFileSync(dest, r.out);
      report.files[name] = { source: rel, sourceSha256: srcSha, out: relative(process.cwd(), dest), sha256: sha256(r.out), before: r.before, after: r.after, animated: r.animated, kept: r.kept, passes: r.passes, mode: r.mode, boundsGap: r.boundsGap, settings: r.settings };
      done++;
      console.log(`${i}/${plan.files.length} ${name}: ${r.before.tris.toLocaleString('en-US')} → ${r.after.tris.toLocaleString('en-US')} tris, ${(r.before.bytes / 1e6).toFixed(1)} → ${(r.after.bytes / 1e6).toFixed(2)} MB, tex ${r.before.texPx} → ${r.after.texPx} px${r.animated ? ` (animated: ${r.kept.clips.length} clips kept)` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      failed++;
      report.files[name] = { source: rel, sourceSha256: srcSha, error: String(e.message ?? e).slice(0, 300) };
      console.log(`${i}/${plan.files.length} ${name}: FAILED ${e.message}`);
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
  }
  writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
  console.log(`${done} written, ${skipped} kept, ${failed} failed → ${relative(process.cwd(), plan.out)}/ (REPORT.json)`);
  process.exit(failed ? 1 : 0);
}
