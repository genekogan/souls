#!/usr/bin/env node
// PERF-MUSIC: uploads the rendered playlist audio (tools/score/render-playlist.mjs) to the asset CDN as immutable,
// content-addressed objects, the way tools/cdn/publish.mjs publishes everything else (same keys, headers, signing,
// HEAD-before-PUT, read-back verification, receipt), and proves them from the public origin. The pieces are Gene's own
// Sim Score renders (licence own-work); the index apps/web/src/score/playlist/playlist-audio.json is the record of what
// was published (committed with the code, never uploaded).
//
//   node tools/score/publish-playlist-audio.mjs [--out .local/score-audio]                      dry run: the plan
//   EDEN_ASSETS_CREDENTIALS=<0600 file> node tools/score/publish-playlist-audio.mjs --apply --receipt <new file>
//   node tools/score/publish-playlist-audio.mjs --verify [--out <dir>] [--origin https://souls.game]   public GETs
//
// --apply needs CF_ACCOUNT_ID (environment or deploy.env; SIM_DEPLOY_ENV names another deploy.env). Existing objects are
// verified and skipped, never overwritten. Receipts hold keys, hashes and dispositions, never credentials.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE, validKey } from '../cdn/inventory.mjs';
import { loadCredentials, requireAccount, signRequest } from '../cdn/publish.mjs';
import { withNewReceipt } from '../cdn/receipt.mjs';
import { INDEX, readIndex, upgradeIndex } from './render-playlist.mjs';

const TYPES = { m4a: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg' };
export const LICENCE = 'own-work';
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The objects to publish: every performance of every piece in the index whose file is in `out`, rehashed (ids
 *  `<piece>#<k>`; objects already in the bucket are verified and skipped by publish()). */
export function plan({ out, index = readIndex(INDEX) }) {
  const objects = [], missing = [];
  const all = Object.entries(upgradeIndex(index).pieces).sort().flatMap(([piece, e]) => e.performances.map((p, k) => [`${piece}#${k}`, p]));
  for (const [id, e] of all) {
    const key = new URL(e.url).pathname.slice(1), ext = key.split('.').at(-1), file = resolve(out, `${e.sha256}.${ext}`);
    if (!validKey(key, e.sha256) || !TYPES[ext]) throw Error(`${id}: bad key ${key}`);
    if (!existsSync(file)) { missing.push({ id, file }); continue; }
    const body = readFileSync(file);
    if (body.length !== e.bytes || sha(body) !== e.sha256) throw Error(`${id}: ${file} is not the index's bytes (re-render, or an edited index)`);
    objects.push({ id, key, file, bytes: e.bytes, sha256: e.sha256, contentType: TYPES[ext], cacheControl: CACHE, licence: LICENCE, url: e.url });
  }
  return { version: 1, bucket: 'eden-assets', objects, missing, totals: { objects: objects.length, bytes: objects.reduce((s, o) => s + o.bytes, 0) } };
}

function metadataErrors(h, o) {
  const errors = [];
  for (const [header, expected] of [['content-length', String(o.bytes)], ['content-type', o.contentType], ['cache-control', CACHE], ['x-amz-meta-sha256', o.sha256], ['x-amz-meta-licence', o.licence]]) if (h.get(header) !== expected) errors.push(`${header}=${h.get(header)}`);
  return errors;
}
/** Upload (HEAD, PUT if absent, read back and hash) every object; `fetcher` and `credentials` are for tests. */
export async function publish(p, { fetcher = fetch, credentials, onProgress = () => {} } = {}) {
  if (!p.objects.length) throw Error('nothing to publish (render first)');
  if (fetcher === fetch) requireAccount();
  credentials ??= await loadCredentials();
  const request = async (method, o, body, headers = {}, unsigned = {}) => {
    const signed = signRequest({ method, key: o.key, credentials, body, headers });
    return fetcher(signed.url, { method, headers: { ...signed.headers, ...unsigned }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(300_000) });
  };
  const results = [];
  for (const o of p.objects) {
    const body = readFileSync(o.file);
    if (body.length !== o.bytes || sha(body) !== o.sha256) throw Error(`${o.id}: file changed since the plan`);
    let disposition = 'existing';
    const head = await request('HEAD', o);
    if (head.status === 404) {
      const put = await request('PUT', o, body, { 'if-none-match': '*', 'content-type': o.contentType, 'cache-control': CACHE, 'x-amz-meta-sha256': o.sha256, 'x-amz-meta-licence': o.licence });
      if (put.status === 412) { const raced = await request('HEAD', o); if (raced.status !== 200 || metadataErrors(raced.headers, o).length) throw Error(`${o.id}: immutable key conflict after a racing PUT`); }
      else if (!put.ok) throw Error(`${o.id}: PUT failed (${put.status})`);
      else disposition = 'uploaded';
      await put.body?.cancel();
    } else if (head.status !== 200) throw Error(`${o.id}: HEAD failed (${head.status})`);
    else if (metadataErrors(head.headers, o).length) throw Error(`${o.id}: refusing immutable overwrite: metadata differs (${metadataErrors(head.headers, o).join(', ')})`);
    const back = await request('GET', o, undefined, {}, { 'accept-encoding': 'identity' });
    if (back.status !== 200 || metadataErrors(back.headers, o).length) throw Error(`${o.id}: readback metadata failed`);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of back.body) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== o.bytes || hash.digest('hex') !== o.sha256) throw Error(`${o.id}: readback bytes differ`);
    const r = { id: o.id, key: o.key, disposition, bytes, sha256: o.sha256, verified: true }; results.push(r); onProgress(r);
  }
  return { version: 1, at: new Date().toISOString(), bucket: p.bucket, licence: LICENCE, index: INDEX, ok: true, results, totals: p.totals };
}
/** Public proof, no credentials: each object from the CDN origin, with the app origin's CORS, right type and cache policy,
 *  and the exact bytes. */
export async function verify(p, { cdn = 'https://assets.eden.art', origin = 'https://souls.game', fetcher = fetch, onProgress = () => {} } = {}) {
  const results = [];
  for (const o of p.objects) {
    const r = await fetcher(`${cdn}/${o.key}`, { headers: { origin, 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(300_000) });
    const h = r.headers, problems = [];
    if (r.status !== 200) problems.push(`status ${r.status}`);
    if (h.get('content-type') !== o.contentType) problems.push(`content-type ${h.get('content-type')}`);
    if (h.get('cache-control') !== CACHE) problems.push(`cache-control ${h.get('cache-control')}`);
    if (h.get('access-control-allow-origin') !== origin && h.get('access-control-allow-origin') !== '*') problems.push(`cors ${h.get('access-control-allow-origin')}`);
    const hash = createHash('sha256'); let bytes = 0;
    if (r.body) for await (const chunk of r.body) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== o.bytes || hash.digest('hex') !== o.sha256) problems.push(`bytes ${bytes}`);
    const res = { id: o.id, url: `${cdn}/${o.key}`, ok: !problems.length, problems, cf: h.get('cf-cache-status'), age: h.get('age') }; results.push(res); onProgress(res);
  }
  return { at: new Date().toISOString(), cdn, origin, ok: results.every((r) => r.ok), results };
}

async function main() {
  const args = process.argv.slice(2), value = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const out = resolve(value('--out', '.local/score-audio')), p = plan({ out });
  const mb = (b) => (b / 1e6).toFixed(1) + ' MB';
  if (p.missing.length) console.log(`missing files for ${p.missing.length} pieces (not rendered yet): ${p.missing.map((m) => m.id).join(', ')}`);
  if (args.includes('--apply')) {
    const receipt = resolve(value('--receipt', '')); if (!value('--receipt')) throw Error('--apply needs --receipt <new file>');
    const r = await withNewReceipt(receipt, () => publish(p, { onProgress: (x) => console.log(`  ${x.disposition} ${x.id} ${x.key.slice(-20)} ${mb(x.bytes)}`) }));
    console.log(JSON.stringify({ ok: r.ok, objects: r.results.length, uploaded: r.results.filter((x) => x.disposition === 'uploaded').length, ...p.totals, receipt }));
  } else if (args.includes('--verify')) {
    const r = await verify(p, { origin: value('--origin', 'https://souls.game'), onProgress: (x) => console.log(`  ${x.ok ? 'ok ' : 'BAD'} ${x.id} ${x.cf ?? ''} ${x.problems.join(', ')}`) });
    console.log(JSON.stringify({ ok: r.ok, objects: r.results.length, ...p.totals }));
    if (!r.ok) process.exitCode = 1;
  } else {
    for (const o of p.objects) console.log(`  ${o.id}: ${o.key} ${mb(o.bytes)}`);
    console.log(JSON.stringify({ dryRun: true, ...p.totals, index: INDEX }));
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
