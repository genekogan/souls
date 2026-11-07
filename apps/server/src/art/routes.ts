// W6 HTTP: art for world-engine worlds. Mounted next to the god routes (http.ts), plain app.get/post.
//   GET  /v1/art                  public: every display (frame, screen, gallery wall) and what hangs in it, with makers
//   POST /v1/art/hang             {frame, media, title?, slot?}  god token (world creator) or Soul token (a resident)
//   POST /v1/art/clear            {frame, slot?}                 same rules (residents clear only their own)
//   POST /v1/art/media            raw body (PNG/JPEG/WebP/GIF ≤ 4 MB, MP4/WebM ≤ 16 MB) → {url} to hang; content-addressed
//   GET  /art/<sha256>.<ext>      the stored file (immutable; byte ranges for video)
// A creator's hang is a god edit (journaled, undoable with /v1/god/undo); a resident's is an engine edit noted with
// the Soul. The maker is always derived from the credential (art.ts makerOf).
import type { Context, Hono } from 'hono';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Op, WorldModel } from '@souls/world-compiler';
import { ApiError } from '../souls.ts';
import { listDisplays, planHang, type Caller } from './art.ts';
import { ART_TYPES, ArtRejected, validateUpload, type ArtFormat } from './validate.ts';

type Result = { accepted: boolean; seq?: number; failures?: unknown[] };
export type ArtDeps = {
  model: () => WorldModel;
  /** The world creator's edit (journaled 'god', undoable). */
  godAct: (ops: Op[], note: string) => Result;
  /** A resident's edit (journaled 'engine' with the note). */
  engineAct: (ops: Op[], note: string) => Result;
  isGod: (c: Context) => boolean;
  soulFromBearer: (c: Context) => { id: string; name: string } | null;
  /** The world's owner id (for the creator's maker record). */
  owner: () => string | null;
  /** Public base URL of this world (e.g. https://sim.eden.art/w/eden); the media URL is its path + /art/<file>. */
  baseOf: (c: Context) => string;
  limitIp: (c: Context, key: string, max: number, windowMs: number) => void;
  dir: string;
};

const hangSchema = z.object({ frame: z.string().min(1).max(120), media: z.string().max(480).nullable().optional(), title: z.string().max(400).optional(), slot: z.number().int().min(0).max(7).optional() });
const clearSchema = z.object({ frame: z.string().min(1).max(120), slot: z.number().int().min(0).max(7).optional() });
const EXT: Record<string, ArtFormat> = { png: 'png', jpg: 'jpg', webp: 'webp', gif: 'gif', mp4: 'mp4', webm: 'webm' };

export function mountArtRoutes(app: Hono, d: ArtDeps) {
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const caller = (c: Context): Caller => {
    if (d.isGod(c)) return { kind: 'creator', owner: d.owner() };
    const s = d.soulFromBearer(c); if (s) return { kind: 'soul', id: s.id, name: s.name };
    throw new ApiError(401, 'unauthorized', 'send a god token (the world creator) or a Soul token (a resident) as Bearer');
  };
  const apply = (c: Context, who: Caller, req: { frame: string; media?: string | null; title?: string; slot?: number }) => {
    d.limitIp(c, 'art', 30, 60_000);
    const plan = planHang(d.model(), who, req);
    if (!plan.ok) throw new ApiError(plan.status, plan.code, plan.message);
    const r = who.kind === 'creator' ? d.godAct(plan.ops, plan.note) : d.engineAct(plan.ops, plan.note);
    if (!r.accepted) throw new ApiError(422, 'art.refused', 'the world refused the edit', { failures: r.failures });
    const shown = listDisplays(d.model()).find((x) => x.id === plan.id);
    return c.json({ ok: true, seq: r.seq, frame: plan.id, slot: plan.slot, display: shown });
  };

  app.get('/v1/art', (c) => c.json({ displays: listDisplays(d.model()) }, 200, { 'cache-control': 'no-store' }));
  app.post('/v1/art/hang', async (c) => {
    const who = caller(c), p = hangSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return apply(c, who, p.data);
  });
  app.post('/v1/art/clear', async (c) => {
    const who = caller(c), p = clearSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return apply(c, who, { ...p.data, media: null });
  });
  app.post('/v1/art/media', async (c) => {
    const who = caller(c);
    d.limitIp(c, 'art-media', 20, 60 * 60_000);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > 17 * 1024 * 1024) throw new ApiError(413, 'art.too-big', 'at most 16 MB');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    let v; try { v = validateUpload(bytes); } catch (e) { if (e instanceof ArtRejected) throw new ApiError(e.status, e.code, e.message); throw e; }
    const sha = createHash('sha256').update(bytes).digest('hex'), file = `${sha}.${v.format}`, path = join(d.dir, file);
    if (!existsSync(path)) { mkdirSync(d.dir, { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, bytes); renameSync(tmp, path); }
    const base = new URL(d.baseOf(c)).pathname.replace(/\/$/, '');
    console.log(`[art] media ${file} ${bytes.byteLength}B by ${who.kind === 'soul' ? `soul ${who.id}` : 'creator'}`);
    return c.json({ ok: true, sha, kind: v.kind, type: v.type, bytes: bytes.byteLength, size: v.size ?? null, url: `${base}/art/${file}` });
  });
  app.get('/art/:file{[0-9a-f]{64}\\.(png|jpg|webp|gif|mp4|webm)}', (c) => {
    const file = c.req.param('file'), fmt = EXT[file.split('.')[1]], path = join(d.dir, file);
    if (!fmt || !existsSync(path)) throw new ApiError(404, 'not-found', 'no such art file');
    const size = statSync(path).size, etag = `"${file.split('.')[0]}"`;
    const head = { 'content-type': ART_TYPES[fmt], etag, 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, head);
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    const all = readFileSync(path);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start >= size || start > end) return c.body(null, 416, { ...head, 'content-range': `bytes */${size}` });
      return c.body(all.subarray(start, end + 1) as never, 206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) });
    }
    return c.body(all as never, 200, head);
  });
}
