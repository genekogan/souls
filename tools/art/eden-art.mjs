#!/usr/bin/env node
// W6: hang art in a Souls world from your agent. Works with the world creator's god token or a resident's Soul token.
//
//   eden-art.mjs <world-url> list
//   eden-art.mjs <world-url> hang <frame> <https-url | /path | ./local-file> [--title "…"] [--slot n]
//   eden-art.mjs <world-url> clear <frame> [--slot n]
//   eden-art.mjs <world-url> upload <./local-file>          → prints the URL to hang
//
// <world-url> is the world's base, e.g. https://sim.eden.art/w/eden. The token comes from $SIM_TOKEN or
// --token-file <path> (a raw token, or your agent folder's .eden-god.json / .eden-agent.json; read at run time, never printed). Frames are picture frames, screens and gallery walls
// (4 slots, 0–3); place them first with the god CLI (`place core/gallery-wall@1 …`). A local file is uploaded
// (PNG/JPEG/WebP/GIF ≤ 4 MB, MP4/WebM ≤ 16 MB) and then hung. A web link is drawn only if its host sends a CORS header
// (Access-Control-Allow-Origin); `hang` warns when it does not — the frame then reads "Can't show this link here". Residents may fill empty slots and change their own art.
import { existsSync, readFileSync } from 'node:fs';

/** Browsers draw a web link on a frame only if its host sends a CORS header (WebGL needs it); a link from a host
 *  that does not shows "Can't show this link here" in the world. Checked from this machine, never by the world. */
export async function embedWarning(media, worldBase, f = fetch) {
  if (!/^https?:\/\//i.test(media)) return null;
  let origin; try { origin = new URL(worldBase).origin; if (new URL(media).origin === origin) return null; } catch { return null; }
  try {
    const r = await f(media, { headers: { origin, range: 'bytes=0-0' }, signal: AbortSignal.timeout(8000) });
    try { await r.body?.cancel(); } catch { /* ignore */ }
    if (!r.ok) return `warning: ${media} answered ${r.status}; the frame will show "Can't show this link here". Check the link, or upload the file: eden-art.mjs <world> upload <file>`;
    const acao = r.headers.get('access-control-allow-origin');
    if (acao !== '*' && acao !== origin) return `warning: ${new URL(media).host} does not let other sites show its files (no Access-Control-Allow-Origin header), so the frame will show "Can't show this link here". Upload the file instead: eden-art.mjs <world> upload <file>, then hang the path it prints.`;
    return null;
  } catch (e) { return `warning: could not reach ${media} from here (${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}); visitors may see "Can't show this link here".`; }
}

export async function run(argv, { fetch: f = fetch, env = process.env, log = console.log, warn: warnLog } = {}) {
  const [base, cmd, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(`--${k}`); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
  const tokenFile = flag('token-file'), title = flag('title'), slotRaw = flag('slot');
  const slot = slotRaw === undefined ? undefined : Number(slotRaw);
  if (!base || !/^https?:\/\//.test(base) || !cmd) throw new Error('usage: eden-art.mjs <world-url> list|hang|clear|upload …');
  // a raw token, or an agent's state file (.eden-god.json / .eden-agent.json): its `token` field, never printed
  const readToken = (f) => { const t = readFileSync(f, 'utf8').trim(); if (!t.startsWith('{')) return t; try { return JSON.parse(t).token; } catch { return undefined; } };
  const token = tokenFile ? readToken(tokenFile) : env.SIM_TOKEN;
  const root = base.replace(/\/$/, '');
  const call = async (path, init = {}) => {
    const r = await f(root + path, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${j.code ?? ''}: ${j.message ?? 'request failed'}`);
    return j;
  };
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const upload = async (file) => call('/v1/art/media', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: readFileSync(file) });
  if (cmd === 'list') {
    const { displays } = await call('/v1/art');
    for (const d of displays) {
      log(`${d.id}${d.name ? ` (${d.name})` : ''}  ${d.def}  ${d.slots} slot${d.slots > 1 ? 's' : ''}  at ${d.p.join(',')}`);
      for (const a of d.art) log(`  [${a.slot}] ${a.kind} ${a.title ? `"${a.title}" ` : ''}${a.media}  maker ${a.maker || '?'}`);
    }
    return displays;
  }
  if (cmd === 'upload') { const u = await upload(rest[0]); log(u.url); return u; }
  if (!token) throw new Error('set SIM_TOKEN or pass --token-file (a god token or a Soul token)');
  if (cmd === 'hang') {
    let [frame, media] = rest;
    if (!frame || !media) throw new Error('hang <frame> <media> [--title …] [--slot n]');
    if (!/^https?:\/\//.test(media) && existsSync(media)) media = (await upload(media)).url;   // a local file wins over a same-site path
    const r = await call('/v1/art/hang', json({ frame, media, title, slot }));
    log(`hung ${media} in ${r.frame} slot ${r.slot} (edit ${r.seq})`);
    const warn = await embedWarning(media, root, f); if (warn) (warnLog ?? console.error)(warn);
    return r;
  }
  if (cmd === 'clear') { const r = await call('/v1/art/clear', json({ frame: rest[0], slot })); log(`cleared ${r.frame} slot ${r.slot}`); return r; }
  throw new Error(`unknown command ${cmd}`);
}

if (import.meta.url === `file://${process.argv[1]}`) run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
