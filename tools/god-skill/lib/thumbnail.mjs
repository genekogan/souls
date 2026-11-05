// `thumbnail` (#887): the picture this world shows on the world list. By default a look framed for a card — a
// three-quarter view from the south-west and above, the centre of what is built in the middle of the frame, at midday
// in clear weather, 1280×720 — re-encoded as a JPEG and sent to the launcher with this folder's god token
// (POST <launcher>/__sim/worlds/<slug>/thumbnail). --file sends an image you already have (PNG is re-encoded), --clear
// goes back to the template's default, --out keeps the JPEG, --dry renders and sends nothing.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from './state.mjs';
import { decodePng, encodeJpeg } from './jpeg.mjs';

export const THUMB_SIZE = Object.freeze({ width: 1280, height: 720 });
/** The server's limit is 512 KB; leave room so a re-encode is rarely needed. */
const TARGET_BYTES = 480 * 1024, QUALITIES = [82, 72, 62, 50];
export const THUMBNAIL_HELP = 'thumbnail [--from sw] [--at ref|x,z] [--dist m] [--span m] [--hour 12:00] [--weather clear] [--remote] [--out file.jpg] [--dry] · thumbnail --file <image.jpg|png> · thumbnail --clear  (the world list picture: a 16:9 look sent as a JPEG; SKILL.md "Thumbnail")';
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

/** Where the world list lives for this world: `<base>/w/<slug>` → `<base>/__sim/worlds/<slug>/thumbnail`. */
export function thumbnailEndpoint(worldUrl) {
  const m = /^(https?:\/\/[^/?#]+(?:\/[^?#]*?)?)\/w\/([a-z][a-z0-9-]{0,31})\/?$/.exec(String(worldUrl ?? '').split(/[?#]/)[0]);
  if (!m) throw Error(`thumbnail: ${worldUrl || 'this folder'} is not a world served by a world launcher (<site>/w/<slug>); thumbnails belong to the world list`);
  return { url: `${m[1]}/__sim/worlds/${m[2]}/thumbnail`, slug: m[2], site: `${m[1]}/` };
}

/** PNG or JPEG bytes → JPEG bytes the world list takes (a JPEG is sent as it is; the launcher checks the rest). */
export function toJpeg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { jpeg: b, width: null, height: null, quality: null };
  if (b[0] !== 0x89 || b[1] !== 0x50) throw Error('thumbnail: --file takes a JPEG or PNG image');
  const img = decodePng(b);
  let jpeg, quality;
  for (quality of QUALITIES) { jpeg = encodeJpeg(img, { quality }); if (jpeg.length <= TARGET_BYTES) break; }
  return { jpeg, width: img.width, height: img.height, quality };
}

/** The look flags of a card picture: defaults that frame the world well, overridable one by one. */
export function framing(flags = {}) {
  const out = { from: one(flags.from) ?? 'sw', hour: one(flags.hour) ?? '12:00', weather: one(flags.weather) ?? 'clear', width: String(THUMB_SIZE.width), h: String(THUMB_SIZE.height), json: true };
  for (const k of ['at', 'dist', 'span', 'remote']) if (flags[k] !== undefined) out[k] = one(flags[k]);
  return out;
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
const refused = (verb, r, e) => Error(`thumbnail ${verb} refused: ${e.code ?? r.status}: ${e.message ?? 'the launcher refused it'}${e.fix ? `\n  fix: ${e.fix}` : ''}`);

export async function thumbnail(flags = {}, runtime = {}) {
  const st = (runtime.load ?? load)(), send = runtime.fetch ?? fetch;
  const { url, slug, site } = thumbnailEndpoint(st.world);
  if (!st.token && !flags.dry) throw Error('thumbnail: this folder has no god token; run pair first');
  const headers = { authorization: `Bearer ${st.token}` };
  if (flags.clear) {
    const r = await send(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) });
    const e = await r.json().catch(() => ({}));
    if (!r.ok) throw refused('clear', r, e);
    return `thumbnail: cleared for ${slug}; the world list shows ${e.thumbnailSource === 'template' ? "the template's default picture" : 'no picture'} (${site})`;
  }
  let jpeg, how;
  if (flags.file) {
    const file = resolve(String(one(flags.file)));
    const t = toJpeg(readFileSync(file));
    jpeg = t.jpeg; how = t.quality ? `${file}, re-encoded as JPEG q${t.quality}` : file;
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'eden-god-thumb-'));
    try {
      const shot = await runtime.look({ ...framing(flags), out: join(dir, 'look.png') });
      const t = toJpeg(readFileSync(shot.file));
      jpeg = t.jpeg; how = `a look from the ${framing(flags).from} at ${framing(flags).hour} toward (${(shot.at ?? []).join(', ')}), ${t.width}×${t.height}, JPEG q${t.quality}`;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const out = flags.out ? resolve(String(one(flags.out))) : null;
  if (out) writeFileSync(out, jpeg);
  if (flags.dry) return `thumbnail (dry): ${how}, ${kb(jpeg.length)}${out ? ` → ${out}` : ''}; nothing sent`;
  const r = await send(url, { method: 'POST', headers: { ...headers, 'content-type': 'image/jpeg' }, body: jpeg, signal: AbortSignal.timeout(60_000) });
  const e = await r.json().catch(() => ({}));
  if (!r.ok) throw refused('upload', r, e);
  return `thumbnail: set for ${slug} from ${how}, ${e.width}×${e.height}, ${kb(e.bytes)}${out ? ` (kept at ${out})` : ''}\n  the world list (${site}) shows it on its next refresh; retake any time, or thumbnail --clear for the template's default`;
}
