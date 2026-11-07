// W6 art: who may hang what where, provenance from the credential, gallery slots, video, uploads and the routes.
//   node --test apps/server/src/art/art.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Op } from '@souls/world-compiler';
import { ApiError } from '../souls.ts';
import { listDisplays, mediaKind, planHang, type Caller } from './art.ts';
import { mountArtRoutes } from './routes.ts';
import { imageSize, sniffArt, validateUpload } from './validate.ts';

function world() {
  const m = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'art' });
  for (const d of CORE_KIT) m.defineDef(d, 'core', 0);
  const god = (ops: unknown[]) => { const r = applyBatch(m, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return r; };
  god([
    { op: 'place', def: coreRef('picture-frame'), name: 'frame', p: [0, 0] },
    { op: 'place', def: coreRef('gallery-wall'), name: 'gallery', p: [10, 0] },
    { op: 'place', def: coreRef('screen'), name: 'cinema', p: [20, 0], owner: 'soul:Ana' },
  ]);
  const id = (n: string) => m.get(n)!.id;
  const run = (caller: Caller, req: Parameters<typeof planHang>[2]) => {
    const p = planHang(m, caller, req); if (!p.ok) return p;
    const r = applyBatch(m, { ops: p.ops }, caller.kind === 'creator' ? 'god' : 'engine', 2, { trusted: caller.kind === 'soul' });
    assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return p;
  };
  return { m, id, run };
}
const creator: Caller = { kind: 'creator', owner: 'u_owner' }, ana: Caller = { kind: 'soul', id: 's_ana', name: 'Ana' }, ben: Caller = { kind: 'soul', id: 's_ben', name: 'Ben' };

test('media references: https, same-site paths, videos by extension; never data:, javascript:, protocol-relative or spaces', () => {
  assert.equal(mediaKind('https://x.org/a.png'), 'image');
  assert.equal(mediaKind('/w/eden/art/ab.mp4'), 'video');
  assert.equal(mediaKind('https://x.org/loop.webm?v=2'), 'video');
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.org/a.png', 'https://x.org/a b.png', 'ftp://x/a.png', '']) assert.equal(mediaKind(bad), null, bad);
});

test('the creator hangs an image with a title; the maker is written from the credential', () => {
  const { m, id, run } = world();
  const p = run(creator, { frame: 'frame', media: 'https://x.org/sun.png', title: 'Sun\nover the bay', slot: 0 });
  assert.equal(p.ok, true);
  const st = m.entities.get(id('frame'))!.state!;
  assert.equal(st.media, 'https://x.org/sun.png'); assert.equal(st.title, 'Sun over the bay'); assert.equal(st.maker, 'creator:u_owner:');
});

test('a gallery wall holds four pieces, one per slot, each with its own maker; residents fill empty slots only', () => {
  const { m, id, run } = world();
  run(creator, { frame: 'gallery', media: 'https://x.org/one.png', title: 'One', slot: 0 });
  assert.equal(run(ana, { frame: 'gallery', media: '/art/loop.mp4', title: 'Tide', slot: 2 }).ok, true);
  const shown = listDisplays(m).find((d) => d.id === id('gallery'))!;
  assert.equal(shown.slots, 4);
  assert.deepEqual(shown.art.map((a) => [a.slot, a.kind, a.title, a.maker]), [[0, 'image', 'One', 'creator:u_owner:'], [2, 'video', 'Tide', 'soul:s_ana:Ana']]);
  const taken = planHang(m, ben, { frame: 'gallery', media: 'https://x.org/mine.png', slot: 2 });
  assert.equal(taken.ok, false); assert.equal((taken as { code: string }).code, 'art.not-yours');
  assert.equal(planHang(m, ben, { frame: 'gallery', slot: 0, media: null }).ok, false, 'Ben may not clear the creator\'s piece');
  assert.equal(run(ana, { frame: 'gallery', media: 'https://x.org/tide2.mp4', title: 'Tide II', slot: 2 }).ok, true, 'Ana changes her own');
  assert.equal(run(ana, { frame: 'gallery', media: null, slot: 2 }).ok, true, 'and clears it');
  assert.equal(listDisplays(m).find((d) => d.id === id('gallery'))!.art.length, 1);
  assert.equal(planHang(m, ana, { frame: 'gallery', media: 'https://x.org/a.png', slot: 4 }).ok, false, 'slot out of range');
});

test('a resident whose Soul owns a display may replace anything on it; the creator may replace anything anywhere', () => {
  const { m, id, run } = world();
  run(ben, { frame: 'cinema', media: 'https://x.org/ben.mp4', title: 'Ben' });
  assert.equal(run(ana, { frame: 'cinema', media: 'https://x.org/ana.mp4', title: 'Ana' }).ok, true, 'Ana owns the cinema');
  assert.equal(run(creator, { frame: 'cinema', media: 'https://x.org/god.png' }).ok, true);
  assert.equal(m.entities.get(id('cinema'))!.state!.maker, 'creator:u_owner:');
});

test('refusals: unknown frame, not a display, bad media, spoofed maker ignored', () => {
  const { m, run } = world();
  applyBatch(m, { ops: [{ op: 'place', def: coreRef('chair'), name: 'chair', p: [30, 0] }] }, 'god', 1);
  assert.equal((planHang(m, creator, { frame: 'nope', media: 'https://x.org/a.png' }) as { code: string }).code, 'art.no-frame');
  assert.equal((planHang(m, creator, { frame: 'chair', media: 'https://x.org/a.png' }) as { code: string }).code, 'art.not-display');
  assert.equal((planHang(m, creator, { frame: 'frame', media: 'javascript:alert(1)' }) as { code: string }).code, 'art.media');
  run(ana, { frame: 'frame', media: 'https://x.org/a.png', title: 'x', maker: 'creator:evil' } as never);
  assert.equal(m.get('frame')!.state!.maker, 'soul:s_ana:Ana');
});

const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b; };
const mp4 = () => { const b = new Uint8Array(64); b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); return b; };

test('upload seam: format from the bytes, sizes and dimensions capped', () => {
  assert.equal(sniffArt(png(10, 10)), 'png'); assert.deepEqual(imageSize(png(640, 480), 'png'), [640, 480]);
  assert.equal(validateUpload(mp4()).kind, 'video');
  assert.throws(() => validateUpload(png(5000, 10)), /4096/);
  assert.throws(() => validateUpload(new TextEncoder().encode('<svg onload=alert(1)></svg>.......')), /PNG, JPEG/);
  assert.throws(() => validateUpload(new Uint8Array(0)), /raw request body/);
});

test('routes: public list, creator and resident hangs, upload then serve with byte ranges', async () => {
  const { m, id } = world();
  const dir = mkdtempSync(join(tmpdir(), 'art-')), notes: string[] = [];
  try {
    const app = new Hono();
    const act = (by: 'god' | 'engine') => (ops: Op[], note: string) => { notes.push(`${by}: ${note}`); return applyBatch(m, { ops }, by, 3, { trusted: by === 'engine' }).result; };
    mountArtRoutes(app, { model: () => m, godAct: act('god'), engineAct: act('engine'), owner: () => 'u_owner', dir, baseOf: () => 'http://127.0.0.1:6031/w/artsound', limitIp: () => {},
      isGod: (c) => c.req.header('authorization') === 'Bearer god_x', soulFromBearer: (c) => (c.req.header('authorization') === 'Bearer soul_ana' ? { id: 's_ana', name: 'Ana' } : null) });
    app.onError((e, c) => (e instanceof ApiError ? c.json({ code: e.code, message: e.message }, e.status as 400) : c.json({ code: 'error', message: String(e) }, 500)));
    const post = (path: string, auth: string, body: unknown, raw = false) => app.request(path, { method: 'POST', headers: { authorization: auth, ...(raw ? {} : { 'content-type': 'application/json' }) }, body: raw ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body) });
    assert.equal((await post('/v1/art/hang', 'Bearer nobody', { frame: 'frame', media: 'https://x.org/a.png' })).status, 401);
    const up = await (await post('/v1/art/media', 'Bearer soul_ana', mp4(), true)).json() as { url: string; kind: string };
    assert.equal(up.kind, 'video'); assert.match(up.url, /^\/w\/artsound\/art\/[0-9a-f]{64}\.mp4$/);
    const file = up.url.replace('/w/artsound', '');
    const full = await app.request(file); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4');
    const part = await app.request(file, { headers: { range: 'bytes=0-9' } }); assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 10);
    const r1 = await post('/v1/art/hang', 'Bearer soul_ana', { frame: 'gallery', media: up.url, title: 'Tide', slot: 1 });
    assert.equal(r1.status, 200, await r1.clone().text());
    const r2 = await post('/v1/art/hang', 'Bearer god_x', { frame: 'gallery', media: 'https://x.org/one.png', title: 'One', slot: 0 });
    assert.equal(r2.status, 200);
    assert.equal((await post('/v1/art/clear', 'Bearer soul_ana', { frame: 'gallery', slot: 0 })).status, 403);
    const list = await (await app.request('/v1/art')).json() as { displays: { id: string; art: { maker: string }[] }[] };
    assert.deepEqual(list.displays.find((d) => d.id === id('gallery'))!.art.map((a) => a.maker), ['creator:u_owner:', 'soul:s_ana:Ana']);
    assert.ok(notes[0].startsWith('engine: art: Ana (s_ana) hung') && notes[1].startsWith('god: art: the world creator hung'), notes.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
