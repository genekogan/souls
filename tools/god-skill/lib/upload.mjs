// `upload` (issue #760): a model, image or manifest of them from disk into this world through POST /v1/god/assets.
// Measures first (lib/glb.mjs) and refuses before the network with the server's numbers; posts multipart with the god
// token; prints the server's report, the proposed def and, with --define, the place line. A manifest
// (god-upload-manifest/1) uploads in order and continues past a refused entry. --dry measures and posts nothing.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { load } from './state.mjs';
import { holder } from './locks.mjs';
import { fetchWithRetry } from './retry.mjs';
import { wireFetch } from './wire.mjs';
import { DEFAULT_BUDGET, FIX, IMAGE_BUDGET, MANIFEST_SCHEMA, UPLOAD_FIELDS, adviceFor, budgetRefusals, describeMeasure, imageSize, measureGlb, readManifest, sniff } from './glb.mjs';

const FOOTPRINT_BYTES = 1_000_000;
const MIME = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg' };
const USAGE = 'usage: upload <file.glb|png|jpg> --name <n> [--height m] [--tags a,b] [--license …] [--source …] [--description …] [--layer solid|decor] [--footprint fp.json] [--define] [--dry]  |  upload <manifest.json> [--dry]';
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

/** Everything the server would refuse that can be seen from the file; [] when it may be sent. */
export function inspectFile(bytes, { footprint } = {}, budget = DEFAULT_BUDGET) {
  const kind = sniff(bytes), refusals = [], advice = [];
  let measure = null, mime;
  if (kind === 'glb') {
    try { measure = measureGlb(bytes); } catch (e) { return { kind, refusals: [{ code: 'asset.invalid', field: 'file', message: e.message, fix: /extension|self-contained|embed/.test(e.message) ? FIX : 'export a valid self-contained binary glTF 2.0 file' }], advice, measure: null }; }
    refusals.push(...budgetRefusals(measure, budget).map((r) => ({ ...r, fix: FIX })));
    advice.push(...adviceFor(measure));
    mime = MIME.glb;
  } else if (kind === 'png' || kind === 'jpg') {
    const s = imageSize(bytes);
    measure = { tris: 0, bytes: bytes.byteLength, textures: 1, texPx: Math.max(s.w, s.h), box: [s.w, s.h, 0], animations: [], skins: 0, image: s };
    if (!(s.w > 0 && s.h > 0)) refusals.push({ code: 'asset.invalid', field: 'file', message: 'image has no readable dimensions' });
    if (bytes.byteLength > Math.min(budget.bytes, IMAGE_BUDGET.bytes)) refusals.push({ code: 'asset.budget', field: 'bytes', measured: bytes.byteLength, allowed: Math.min(budget.bytes, IMAGE_BUDGET.bytes), message: `image ${(bytes.byteLength / 1e6).toFixed(2)} MB > ${(Math.min(budget.bytes, IMAGE_BUDGET.bytes) / 1e6).toFixed(2)} MB`, fix: 'resize or recompress the image (JPEG quality 85 is plenty for a sign or a picture)' });
    if (measure.texPx > budget.texPx) refusals.push({ code: 'asset.budget', field: 'texPx', measured: measure.texPx, allowed: budget.texPx, message: `image ${s.w}×${s.h} > ${budget.texPx} px`, fix: `resize so the longer side is at most ${budget.texPx} px` });
    mime = MIME[kind];
  } else {
    refusals.push({ code: 'asset.type', field: 'file', message: `${kind === 'webp' ? 'a standalone WebP' : kind === 'json' ? 'JSON that is not a god-upload-manifest/1' : 'an unknown file type'}; accepted: GLB (binary glTF 2.0), PNG, JPEG`, fix: kind === 'webp' ? 'WebP is fine inside a GLB; a standalone image must be PNG or JPEG' : 'export .glb (not .gltf/.obj/.fbx), .png or .jpg' });
  }
  if (footprint !== undefined) {
    if (footprint.byteLength > FOOTPRINT_BYTES) refusals.push({ code: 'asset.budget', field: 'footprint', measured: footprint.byteLength, allowed: FOOTPRINT_BYTES, message: `footprint ${footprint.byteLength} bytes > ${FOOTPRINT_BYTES}` });
    try { const fp = JSON.parse(new TextDecoder().decode(footprint)); if (!fp || typeof fp !== 'object' || Array.isArray(fp)) throw 0; if (fp.schema && fp.schema !== 'lm-building-footprint/1') throw new Error(`schema ${fp.schema}`); }
    catch (e) { refusals.push({ code: 'asset.invalid', field: 'footprint', message: `footprint is not an lm-building-footprint/1 object${e?.message ? ` (${e.message})` : ''}` }); }
    if (kind !== 'glb') refusals.push({ code: 'asset.invalid', field: 'footprint', message: 'a footprint goes with a GLB, not an image' });
  }
  return { kind, mime, measure, refusals, advice };
}

const refusalLine = (file, r) => `REFUSED ${file}: ${r.code}${r.field ? ` ${r.field}` : ''}: ${r.message}${r.measured !== undefined && typeof r.measured !== 'object' ? ` (measured ${r.measured}, allowed ${r.allowed})` : ''}${r.fix ? `\n  fix: ${r.fix}` : ''}`;

/** One asset: measure, refuse or post; returns { ok, refused?, lines[], response? }. */
export async function uploadOne(entry, { dry = false, budget = DEFAULT_BUDGET, send = postAsset } = {}) {
  const file = entry.file, label = basename(file);
  if (!existsSync(file)) return { ok: false, refused: true, lines: [`REFUSED ${label}: no such file ${file}`] };
  const bytes = new Uint8Array(readFileSync(file));
  if (!bytes.byteLength) return { ok: false, refused: true, lines: [`REFUSED ${label}: the file is empty`] };
  let footprint;
  if (entry.footprint) {
    if (!existsSync(entry.footprint)) return { ok: false, refused: true, lines: [`REFUSED ${label}: no such footprint ${entry.footprint}`] };
    footprint = new Uint8Array(readFileSync(entry.footprint));
  }
  const height = entry.height !== undefined && entry.height !== '' ? Number(entry.height) : undefined;
  if (height !== undefined && !(height > 0 && height < 400)) return { ok: false, refused: true, lines: [`REFUSED ${label}: --height must be metres in (0, 400), got ${entry.height}`] };
  const insp = inspectFile(bytes, { footprint }, budget);
  if (insp.refusals.length) return { ok: false, refused: true, measure: insp.measure, lines: insp.refusals.map((r) => refusalLine(label, r)) };
  const fields = {};
  for (const k of UPLOAD_FIELDS) { const v = entry[k]; if (v === undefined || v === '' || v === false) continue; fields[k] = k === 'define' ? '1' : String(v); }
  const what = `${insp.measure.tris !== undefined && insp.kind === 'glb' ? 'mesh' : 'image'} ${label}: ${describeMeasure(insp.measure)}`;
  const meta = [fields.name && `as ${fields.name}`, height !== undefined && `height ${height} m`, footprint && 'with footprint', fields.define && 'define'].filter(Boolean).join(', ');
  if (dry) return { ok: true, dry: true, measure: insp.measure, lines: [`would upload ${what}${meta ? ` (${meta})` : ''}`, ...insp.advice.map((a) => `  note: ${a}`)] };
  const r = await send({ bytes, mime: insp.mime, filename: label, footprint, fields });
  if (!r.ok) {
    const d = r.data ?? {};
    const detail = d.measured !== undefined || d.allowed !== undefined ? `\n  measured ${JSON.stringify(d.measured)} allowed ${JSON.stringify(d.allowed)}` : '';
    return { ok: false, response: r, lines: [`REFUSED ${label}: HTTP ${r.status} ${d.code ?? ''}${d.field ? ` ${d.field}` : ''}: ${d.message ?? d.raw ?? ''}${detail}${d.fix ? `\n  fix: ${d.fix}` : ''}`] };
  }
  const d = r.data, lines = [`uploaded ${what}${meta ? ` (${meta})` : ''}`, `  ${d.asset?.url ?? ''}  sha ${d.asset?.sha ?? '?'}`];
  if (d.footprint) lines.push(`  footprint: ${d.footprint.rooms} rooms, ${d.footprint.openings} openings, ${d.footprint.links} links, ${d.footprint.colliders} colliders`);
  if (d.def) {
    const ref = `${d.def.name}@${d.def.version ?? 1}`;
    if (d.defined?.accepted) lines.push(`  defined ${ref} (${d.def.size.box.map((v) => Math.round(v * 100) / 100).join(' × ')} m, layer ${d.def.layer}) — place it with: place ${ref} --at …`);
    else if (d.defined) lines.push(`  define REFUSED: ${(d.defined.failures ?? []).map((f) => `${f.code}${f.field ? ` ${f.field}` : ''}: ${f.message}`).join('; ')}`);
    else lines.push(`  def ${ref} proposed, not defined: rerun with --define, or edit it and run define`);
  } else if (!fields.name && insp.kind === 'glb') lines.push('  no --name: stored only; give --name (and --define) to make it placeable');
  for (const w of d.warnings ?? []) lines.push(`  note: ${w}`);
  // the server warns about triangles and height too; say each thing once
  const said = (s) => s.replace(/[,\s]/g, '').slice(0, 24);
  for (const a of insp.advice) if (!(d.warnings ?? []).some((w) => said(w) === said(a))) lines.push(`  note: ${a}`);
  return { ok: true, response: r, measure: insp.measure, lines };
}

/** The multipart POST, with the god token, through the relay when one is running (lib/wire.mjs). */
export async function postAsset({ bytes, mime, filename, footprint, fields }, { timeoutMs = Number(process.env.EDEN_GOD_TIMEOUT_MS ?? 180_000) } = {}) {
  const s = load();
  if (!s.world) throw new Error('Run: node eden-god.mjs register <world-url>');
  if (!s.token) throw new Error('no god token: run pair (or mint on a dev server)');
  const fd = new FormData();
  fd.set('file', new Blob([bytes], { type: mime }), filename);
  if (footprint) fd.set('footprint', new Blob([footprint], { type: 'application/json' }), 'footprint.json');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const headers = { authorization: `Bearer ${s.token}`, 'x-eden-god-holder': JSON.stringify(holder('eden-god CLI')) };
  const r = await fetchWithRetry(`${s.world}/v1/god/assets`, { method: 'POST', headers, body: fd, timeoutMs }, { fetch: wireFetch });
  const text = await r.text(); let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  return { ok: r.ok, status: r.status, data };
}

/** The command. One file with flags, or a manifest; `--json` returns the structured results. */
export async function upload(path, flags = {}, deps = {}) {
  if (!path) throw new Error(USAGE);
  if (!existsSync(path)) throw new Error(`upload: no such file ${path}`);
  const bytes = new Uint8Array(readFileSync(path));
  const dry = !!flags.dry;
  let entries;
  if (sniff(bytes) === 'json') {
    let doc; try { doc = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error(`upload: ${path} is not JSON`); }
    if (doc?.schema !== MANIFEST_SCHEMA) throw new Error(`upload: a JSON argument must be a ${MANIFEST_SCHEMA} (schema: "${MANIFEST_SCHEMA}", assets: [{ file, name, height, … }]); a footprint goes with --footprint beside its GLB`);
    for (const k of UPLOAD_FIELDS) if (flags[k] !== undefined) throw new Error(`upload <manifest>: --${k} belongs in the manifest's entries, not on the command`);
    const dir = dirname(resolve(path));
    entries = readManifest(doc).map((a) => ({ ...a, file: resolve(dir, a.file), ...(a.footprint ? { footprint: resolve(dir, a.footprint) } : {}) }));
  } else {
    const entry = { file: path };
    for (const k of UPLOAD_FIELDS) if (flags[k] !== undefined) entry[k] = k === 'tags' ? [].concat(flags[k]).join(',') : one(flags[k]);
    if (flags.footprint !== undefined) entry.footprint = one(flags.footprint);
    if (entry.layer !== undefined && !['solid', 'decor'].includes(entry.layer)) throw new Error('--layer is solid or decor');
    entries = [entry];
  }
  const results = [];
  for (const e of entries) results.push({ file: e.file, ...(await uploadOne(e, { dry, send: deps.send })) });
  if (flags.json) return results.map(({ lines, ...r }) => ({ ...r, text: lines.join('\n') }));
  const out = results.flatMap((r) => r.lines);
  if (entries.length > 1) {
    const sent = results.filter((r) => r.ok).length, refused = results.filter((r) => !r.ok);
    out.push(`${dry ? 'would upload' : 'uploaded'} ${sent} of ${entries.length}${refused.length ? `; refused ${refused.length}: ${refused.map((r) => basename(r.file)).join(', ')}` : ''}`);
  }
  return out.join('\n');
}
