// World thumbnails (#887): the picture each card on the world list shows. The owner sets it from god mode
// (`eden-god thumbnail`, or any 16:9 JPEG) with POST <base>/__sim/worlds/<slug>/thumbnail; a world without one shows
// the default of the template it started from (worlds/templates/thumbs/<template>.jpg, pulled from the asset CDN by
// `pnpm assets:pull`, never committed), or nothing when that file is not in place.
//
// The bytes pass the same G8 gate as every other upload (apps/server/src/moderation: format by magic bytes, malformed
// containers refused, EXIF/XMP/comments and trailing bytes stripped, then the classifier hook). A thumbnail is public on
// the root page, so a quarantine verdict is refused here instead of being stored hidden.
//
// Files are content-addressed and served immutable: <data>/worlds/<slug>/thumbs/<sha>.jpg at
// <base>/__sim/thumbs/<slug>/<sha>.jpg, and a template's default at <base>/__sim/thumbs/_template/<sha>.jpg (one URL per
// template, so every world on the same default shares one cached image). Nothing here touches a world's process.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { UploadRejected, validateUpload } from '../../apps/server/src/moderation/validate.ts';
import { classify } from '../../apps/server/src/moderation/classifier.ts';

export const THUMB = Object.freeze({ maxBytes: 512 * 1024, minWidth: 640, maxWidth: 1920, aspect: 16 / 9, aspectTolerance: 0.02, writesPerWindow: 6, windowMs: 10 * 60_000 });
export const THUMB_CACHE = 'public, max-age=31536000, immutable';
export const THUMB_PATH = /^\/__sim\/thumbs\/(_template|[a-z][a-z0-9-]{0,31})\/([0-9a-f]{64})\.jpg$/;
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIX = {
  type: 'Send a JPEG as the request body (content-type image/jpeg); `eden-god thumbnail` makes one from the god view.',
  size: `Save it as a 1280×720 JPEG at quality 80 or lower (usually 100–250 KB); the limit is ${THUMB.maxBytes / 1024} KB.`,
  dimensions: 'Crop or resize it to 16:9, 640–1920 px wide; 1280×720 is the default.',
  invalid: 'Re-save the image as a standard (baseline or progressive) JPEG and send it again.',
  moderation: 'Choose a different view of the world; the content check did not accept this image.',
};
const refusal = (status, code, message, fix) => ({ ok: false, status, body: { ok: false, code, message, fix } });

/**
 * Check one thumbnail upload. Returns {ok: true, sha, bytes, width, height, stripped, verdict} for the stripped bytes,
 * or {ok: false, status, body} with a `fix` sentence the uploader can act on.
 */
export async function intakeThumbnail(input, { words = [] } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? []);
  if (!bytes.length) return refusal(400, 'thumbnail.empty', 'The request carried no image', FIX.type);
  if (bytes.length > THUMB.maxBytes) return refusal(413, 'thumbnail.size', `The image is ${bytes.length} bytes; a thumbnail is at most ${THUMB.maxBytes}`, FIX.size);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return refusal(415, 'thumbnail.type', 'A thumbnail is a JPEG image', FIX.type);
  let up;
  try { up = validateUpload(bytes, { formats: ['jpg'], maxBytes: THUMB.maxBytes, maxTris: 0, maxTextures: 1, maxTexPx: 16384, maxImageBytes: THUMB.maxBytes }); }
  catch (e) {
    if (!(e instanceof UploadRejected)) throw e;
    return e.code === 'upload.image-format' ? refusal(415, 'thumbnail.type', e.message, FIX.type) : refusal(400, 'thumbnail.invalid', e.message, FIX.invalid);
  }
  const { w, h } = up.images[0];
  if (w < THUMB.minWidth || w > THUMB.maxWidth || Math.abs(w / h - THUMB.aspect) / THUMB.aspect > THUMB.aspectTolerance)
    return refusal(400, 'thumbnail.dimensions', `The image is ${w}×${h}; a thumbnail is 16:9 and ${THUMB.minWidth}–${THUMB.maxWidth} px wide`, FIX.dimensions);
  const verdict = await classify({ surface: 'thumbnail', format: 'jpg', sha: up.sha, bytes: up.bytes.length, tris: 0, textures: 1, texPx: Math.max(w, h), text: [...words.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 300)), ...up.text], images: up.images });
  if (verdict.action !== 'allow') return { ...refusal(422, 'thumbnail.moderation', 'The content check did not accept this image', FIX.moderation), verdict };
  return { ok: true, sha: up.sha, bytes: up.bytes, width: w, height: h, stripped: { segments: up.stripped.segments, bytes: up.stripped.bytes }, verdict };
}

/** At most THUMB.writesPerWindow writes per world per window: null, or the seconds to wait. */
export function thumbnailRate({ limit = THUMB.writesPerWindow, windowMs = THUMB.windowMs, now = Date.now } = {}) {
  const seen = new Map();
  return (slug) => {
    const t = now(), recent = (seen.get(slug) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) { seen.set(slug, recent); return Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)); }
    recent.push(t); seen.set(slug, recent); return null;
  };
}
export const rateRefusal = (s) => ({ ...refusal(429, 'thumbnail.rate', `At most ${THUMB.writesPerWindow} thumbnail changes per world every ${THUMB.windowMs / 60_000} minutes`, `Wait ${s} s and send it once; a thumbnail rarely needs to change.`).body });

// ---------- the owner's file, in the world's own folder (it moves with the world on archive and restore)
const thumbsDir = (worldDir) => join(worldDir, 'thumbs');
/** Write the new file atomically; the caller records it, then prunes the old one (a crash never orphans the row). */
export function writeThumbnail(worldDir, sha, bytes) {
  const dir = thumbsDir(worldDir); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sha}.jpg`), tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes); renameSync(tmp, file);
  return file;
}
/** Keep exactly one thumbnail: the one the row names. */
export function pruneThumbnails(worldDir, keepSha) {
  const dir = thumbsDir(worldDir);
  for (const f of readdirSync(dir)) if (f !== `${keepSha}.jpg`) rmSync(join(dir, f), { force: true });
}
export function clearThumbnail(worldDir) { rmSync(thumbsDir(worldDir), { recursive: true, force: true }); }
export function thumbnailFile(worldDir, sha) { const f = join(thumbsDir(worldDir), `${sha}.jpg`); return existsSync(f) ? f : null; }

// ---------- template defaults (worlds/templates/thumbs/<id>.jpg; `empty.jpg` is the empty plain)
/** Hashes of the default images, re-read at most every `ttlMs` and re-hashed only when a file changes. */
export function templateThumbs(dir, { ttlMs = 5000 } = {}) {
  let at = -Infinity, byId = new Map(), bySha = new Map();
  const known = new Map();   // name → {size, mtimeMs, sha}
  const scan = () => {
    if (Date.now() - at < ttlMs) return; at = Date.now();
    const id = new Map(), sha = new Map();
    let names = []; try { names = readdirSync(dir); } catch { /* not pulled: no defaults */ }
    for (const name of names) {
      const m = /^(.+)\.jpg$/.exec(name); if (!m || !TEMPLATE_ID.test(m[1])) continue;
      const file = join(dir, name);
      let st; try { st = statSync(file); } catch { continue; }
      if (!st.isFile() || !st.size || st.size > THUMB.maxBytes) continue;
      let k = known.get(name);
      if (!k || k.size !== st.size || k.mtimeMs !== st.mtimeMs) { k = { size: st.size, mtimeMs: st.mtimeMs, sha: createHash('sha256').update(readFileSync(file)).digest('hex') }; known.set(name, k); }
      id.set(m[1], { sha: k.sha, file }); sha.set(k.sha, file);
    }
    byId = id; bySha = sha;
  };
  return {
    forTemplate(template) { scan(); return typeof template === 'string' ? byId.get(template) ?? null : null; },
    file(sha) { scan(); return bySha.get(sha) ?? null; },
  };
}

/** The card's picture: the owner's, else the template's default, else none. */
export function thumbnailOf(w, { base = '', defaults }) {
  const sha = w.thumbnail?.sha;
  if (typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha)) return { thumbnail: `${base}/__sim/thumbs/${w.slug}/${sha}.jpg`, thumbnailSource: 'owner' };
  const d = w.fork ? null : defaults?.forTemplate(w.template ?? 'empty');
  return d ? { thumbnail: `${base}/__sim/thumbs/_template/${d.sha}.jpg`, thumbnailSource: 'template' } : { thumbnail: null, thumbnailSource: null };
}
