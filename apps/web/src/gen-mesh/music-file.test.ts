// PERF-MUSIC: the file player's scheduling (prefetch, fade, crossfade, end), resume at a position, volume ramps and the
// fallback signal, driven with fake media elements, fake gain nodes and a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FilePlayer, fileUrl, type AudioEl, type CtxLike, type FileEnv, type FileIndex, type GainLike } from './music-file.ts';
import type { MusicEvent } from './music.ts';

type Ramp = { from: number; to: number; at: number; until: number };
class FakeParam { value = 0; ramps: Ramp[] = []; constructor(private ctx: FakeCtx) {} cancelScheduledValues() {} setValueAtTime(v: number) { this.value = v; } linearRampToValueAtTime(v: number, t: number) { this.ramps.push({ from: this.value, to: v, at: this.ctx.currentTime, until: t }); this.value = v; } }
class FakeGain implements GainLike { gain: FakeParam; connected: unknown[] = []; disconnected = false; constructor(ctx: FakeCtx) { this.gain = new FakeParam(ctx); } connect(n: unknown) { this.connected.push(n); return n; } disconnect() { this.disconnected = true; } }
class FakeEl implements AudioEl {
  src = ''; crossOrigin: string | null = 'anonymous'; preload = 'auto'; currentTime = 0; duration = NaN; readyState = 0; paused = true;
  loads = 0; plays = 0; playFails: string | null = null; seekAtPlay = -1; removed = false;
  private ls = new Map<string, Set<() => void>>();
  play() { this.plays++; if (this.playFails) return Promise.reject(Error(this.playFails)); this.paused = false; this.seekAtPlay = this.currentTime; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.loads++; }
  removeAttribute(n: string) { if (n === 'src') { this.src = ''; this.removed = true; } }
  addEventListener(t: string, fn: () => void) { (this.ls.get(t) ?? this.ls.set(t, new Set()).get(t)!).add(fn); }
  removeEventListener(t: string, fn: () => void) { this.ls.get(t)?.delete(fn); }
  emit(t: string) { for (const fn of [...(this.ls.get(t) ?? [])]) fn(); }
  /** The browser read the metadata: duration known, seekable. */
  metadata(duration = 240) { this.duration = duration; this.readyState = 1; this.emit('loadedmetadata'); }
}
class FakeCtx implements CtxLike {
  currentTime = 0; state = 'running'; destination = { name: 'destination' }; gains: FakeGain[] = []; sources: { el: AudioEl; disconnected: boolean }[] = []; resumed = 0;
  createGain() { const g = new FakeGain(this); this.gains.push(g); return g; }
  createMediaElementSource(el: AudioEl) { const s = { el, disconnected: false, connect: (n: unknown) => n, disconnect: () => { s.disconnected = true; } }; this.sources.push(s); return s; }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
}
const INDEX: FileIndex = { version: 1, format: 'audio/mp4', seconds: 240, pieces: {
  a: { url: 'https://assets.eden.art/assets/aa/aaaa.m4a', seconds: 240, seed: 1, bytes: 10, sha256: 'aaaa' },
  b: { url: 'https://assets.eden.art/assets/bb/bbbb.m4a', seconds: 240, seed: 2, bytes: 10, sha256: 'bbbb' },
  c: { url: 'https://assets.eden.art/assets/cc/cccc.m4a', seconds: 240, seed: 3, bytes: 10, sha256: 'cccc' },
} };
function rig(index: FileIndex = INDEX, rolls: number[] = []) {
  const ctx = new FakeCtx(), els: FakeEl[] = [], log: Omit<MusicEvent, 't'>[] = [];
  let now = 1000;
  const env: FileEnv = { ctx: () => ctx, audio: () => { const e = new FakeEl(); els.push(e); return e; }, now: () => now, random: () => rolls.shift() ?? 0 };
  const player = new FilePlayer(env, index, (e) => log.push(e));
  const tick = (ms: number, next: string | null) => { now += ms; ctx.currentTime += ms / 1000; return player.tick(now, next); };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { ctx, els, log, player, tick, flush, now: () => now };
}

test('a piece starts after its metadata, fades in, and ends TRACK_S later', async () => {
  const { ctx, els, log, player, tick, flush } = rig();
  const p = player.play('a', { reason: 'first' });
  assert.equal(els.length, 1); assert.equal(els[0].src, INDEX.pieces.a.url); assert.equal(els[0].loads, 1); assert.equal(els[0].plays, 0);
  assert.deepEqual(ctx.gains.map((g) => g.gain.value), [0, 0]);   // master at the (unset) volume, the deck at 0
  els[0].metadata(); await p;
  assert.equal(els[0].plays, 1);
  assert.deepEqual(log, [{ ev: 'start', piece: 'a', reason: 'first' }]);
  assert.deepEqual(ctx.gains[1].gain.ramps.at(-1), { from: 0, to: 1, at: 0, until: 0.5 });
  assert.equal(player.playing()?.endsAt, 1000 + 240_000);
  assert.equal(tick(239_000, null), null);     // inside the fade, not yet over
  assert.ok(player.playing()?.fading);
  assert.equal(tick(1_000, null), 'ended');
  assert.equal(player.playing(), null); assert.ok(els[0].paused && els[0].removed);
  assert.deepEqual(log.map((e) => e.ev), ['start', 'fade', 'stop']);
  await flush();
});

test('a shorter track length ends the piece earlier', async () => {
  const { els, player, tick } = rig();
  player.trackS = 30;
  const p = player.play('a'); els[0].metadata(); await p;
  assert.equal(player.playing()?.endsAt, 1000 + 30_000);
  player.setTrackSeconds(10);
  assert.equal(player.playing()?.endsAt, 1000 + 10_000);
  assert.equal(tick(10_000, null), 'ended');
});

test('the next file is prefetched 20 s before the end, fades in 3 s before it while the current fades over 4 s, and the old deck retires at its end', async () => {
  const { ctx, els, log, player, tick, flush } = rig();
  const p = player.play('a'); els[0].metadata(); await p;
  assert.equal(tick(219_000, 'b'), null); assert.equal(els.length, 1);   // 21 s left: nothing yet
  assert.equal(tick(1_500, 'b'), null);                                   // 19.5 s left: prefetch
  assert.equal(els.length, 2); assert.equal(els[1].src, INDEX.pieces.b.url); assert.equal(els[1].loads, 1); assert.equal(els[1].plays, 0);
  assert.deepEqual(log.at(-1), { ev: 'load', piece: 'b', reason: 'prefetch file' });
  els[1].metadata();
  assert.equal(tick(15_600, 'b'), null);                                   // 3.9 s left: the fade has begun, no crossfade yet
  assert.deepEqual(log.at(-1), { ev: 'fade', piece: 'a' });
  assert.deepEqual(ctx.gains[1].gain.ramps.at(-1)?.to, 0); assert.equal(ctx.gains[1].gain.ramps.at(-1)!.until - ctx.gains[1].gain.ramps.at(-1)!.at, 4);
  assert.equal(tick(1_000, 'b'), 'crossfade');                             // 2.9 s left: b starts on the prefetched element
  assert.ok(player.busy); assert.equal(els.length, 2, 'the prefetched element is reused');
  await flush();
  assert.equal(els[1].plays, 1); assert.ok(!player.busy);
  assert.deepEqual(log.at(-1), { ev: 'start', piece: 'b', reason: 'crossfade' });
  const inRamp = ctx.gains[2].gain.ramps.at(-1)!; assert.equal(inRamp.to, 1); assert.equal(+(inRamp.until - inRamp.at).toFixed(3), 3);
  assert.equal(player.playing()?.id, 'b'); assert.equal(player.playing()?.endsAt, player.playing()!.endsAt);
  assert.ok(!els[0].paused, 'a keeps sounding through its fade');
  assert.equal(tick(2_000, 'c'), null); assert.ok(!els[0].paused);
  assert.equal(tick(1_100, 'c'), null);                                    // a's end passed: retired
  assert.ok(els[0].paused && els[0].removed && ctx.sources[0].disconnected);
  assert.deepEqual(log.at(-1), { ev: 'stop', piece: 'a', reason: 'end' });
  assert.equal(player.playing()?.id, 'b');
});

test('a crossfade whose file fails reports the error and leaves no successor, so the caller falls back', async () => {
  const { els, log, player, tick, flush } = rig();
  const p = player.play('a'); els[0].metadata(); await p;
  tick(230_000, 'b'); assert.equal(els.length, 2);
  els[1].playFails = 'NotSupportedError'; els[1].metadata();
  assert.equal(tick(7_500, 'b'), 'crossfade');
  await flush(); await flush();
  assert.equal(log.at(-1)?.ev, 'error'); assert.equal(log.at(-1)?.piece, 'b'); assert.match(log.at(-1)!.reason!, /NotSupportedError/);
  assert.equal(player.playing(), null); assert.ok(!player.busy);
  assert.ok(els[1].removed, 'the failed deck is released');
  assert.equal(tick(3_000, 'b'), null); assert.deepEqual(log.at(-1), { ev: 'stop', piece: 'a', reason: 'end' });
});

test('a media error before the metadata rejects play()', async () => {
  const { els, player } = rig();
  const p = player.play('a');
  els[0].emit('error');
  await assert.rejects(p, /media error/);
  assert.ok(els[0].removed);
});

test('stop() remembers the position, and a resume seeks there after the metadata and ends the remaining time later', async () => {
  const { els, player, tick, now } = rig();
  const p = player.play('a'); els[0].metadata(); await p;
  tick(65_000, null); els[0].currentTime = 65.2;
  const place = player.stop();
  assert.deepEqual(place, { id: 'a', perf: 0, positionS: 65.2, remainingMs: 240_000 - 65_000 });
  assert.equal(player.playing(), null); assert.ok(els[0].paused && els[0].removed);
  const q = player.play('a', { positionS: 65.2, reason: 'resume' });
  assert.equal(els[1].seekAtPlay, -1);
  els[1].metadata(); await q;
  assert.equal(els[1].seekAtPlay, 65.2, 'seeks once the file is seekable, before play');
  assert.equal(player.playing()?.endsAt, now() + (240 - 65.2) * 1000);
  assert.equal(player.position(), 65.2 + 0);   // the element's own clock once it reports one
});

test('volume ramps the master in linear amplitude; the context is resumed before play when suspended', async () => {
  const { ctx, els, player } = rig();
  player.setVolume(-20, 0.01);
  ctx.state = 'suspended';
  const p = player.play('a'); els[0].metadata(); await p;
  assert.equal(ctx.resumed, 1);
  assert.ok(Math.abs(ctx.gains[0].gain.value - 0.1) < 1e-9);
  player.setVolume(-60, 0.8);
  const r = ctx.gains[0].gain.ramps.at(-1)!; assert.ok(Math.abs(r.to - 0.001) < 1e-9); assert.equal(+(r.until - r.at).toFixed(3), 0.8);
  player.setVolume(-Infinity, 0.9); assert.equal(ctx.gains[0].gain.value, 0);
});

test('play() while a piece sounds crossfades it out; has() and a missing piece', async () => {
  const { els, log, player } = rig();
  const p = player.play('a'); els[0].metadata(); await p;
  const q = player.play('c', { reason: 'next' }); els[1].metadata(); await q;
  assert.deepEqual(log.map((e) => `${e.ev}:${e.piece}`), ['start:a', 'fade:a', 'start:c']);
  assert.equal(player.playing()?.id, 'c');
  assert.ok(player.has('a') && !player.has('zz'));
  await assert.rejects(player.play('zz'), /no file/);
});

test('fileUrl rebases a CDN key onto the ?musicAudio origin, flat by file name', () => {
  assert.equal(fileUrl('https://assets.eden.art/assets/aa/aaaa.m4a', ''), 'https://assets.eden.art/assets/aa/aaaa.m4a');
  assert.equal(fileUrl('https://assets.eden.art/assets/aa/aaaa.m4a', '?musicAudio=http://localhost:5213'), 'http://localhost:5213/aaaa.m4a');
  assert.equal(fileUrl('https://assets.eden.art/assets/aa/aaaa.m4a', '?x=1&musicAudio=http://localhost:5213/files/'), 'http://localhost:5213/files/aaaa.m4a');
});

// perf-music-seeds: several performances (seeds) per piece; each start picks one at random, a resume keeps its own
const perf = (id: string, k: number) => ({ seed: k, url: `https://assets.eden.art/assets/${id}${k}/${id}${k}.m4a`, bytes: 10, sha256: `${id}${k}` });
const INDEX2: FileIndex = { version: 2, format: 'audio/mp4', seconds: 240, pieces: {
  a: { seconds: 240, performances: [perf('a', 0), perf('a', 1), perf('a', 2)] },
  b: { seconds: 240, performances: [perf('b', 0), perf('b', 1), perf('b', 2)] },
  c: { seconds: 240, performances: [perf('c', 0)] },
} };

test('each start picks a random performance; the log and playing() name it', async () => {
  const { els, log, player, flush } = rig(INDEX2, [0.5, 0.99, 0.1]);
  assert.equal(player.performances('a'), 3); assert.equal(player.performances('c'), 1); assert.ok(player.has('c')); assert.ok(!player.has('z'));
  let p = player.play('a', { reason: 'first' }); els[0].metadata(); await p;
  assert.equal(els[0].src, perf('a', 1).url); assert.equal(player.playing()?.perf, 1);
  assert.deepEqual(log.at(-1), { ev: 'start', piece: 'a', reason: 'first', performance: 1, performances: 3 });
  p = player.play('a', { reason: 'next' }); els[1].metadata(); await p; await flush();
  assert.equal(els[1].src, perf('a', 2).url);   // a replay picks afresh (0.99 -> the last)
  p = player.play('c', { reason: 'next' }); els[2].metadata(); await p;
  assert.equal(els[2].src, perf('c', 0).url); assert.equal(log.at(-1)?.reason, 'next');   // one performance: no roll, no suffix
});

test('stop() returns the performance, and a resume plays that one at its position (no roll)', async () => {
  const { els, log, player, tick } = rig(INDEX2, [0.7]);
  const p = player.play('b'); els[0].metadata(); await p;
  assert.equal(player.playing()?.perf, 2);
  tick(30_000, null); els[0].currentTime = 30;
  const place = player.stop();
  assert.deepEqual({ id: place?.id, perf: place?.perf, positionS: place?.positionS }, { id: 'b', perf: 2, positionS: 30 });
  const r = player.play('b', { positionS: place!.positionS, perf: place!.perf, reason: 'resume' }); els[1].metadata(); await r;
  assert.equal(els[1].src, perf('b', 2).url); assert.equal(els[1].seekAtPlay, 30); assert.equal(player.playing()?.perf, 2);
  assert.deepEqual(log.at(-1), { ev: 'start', piece: 'b', reason: 'resume', performance: 2, performances: 3, positionS: 30 });
});

test('the prefetched next piece rolls its performance once, and the crossfade plays that file', async () => {
  const { els, log, player, tick, flush } = rig(INDEX2, [0, 0.4]);
  const p = player.play('a'); els[0].metadata(); await p;
  tick(220_000, 'b');                       // 20 s before the end: prefetch b, rolling 0.4 -> performance 1
  assert.equal(els.length, 2); assert.equal(els[1].src, perf('b', 1).url);
  els[1].metadata();
  assert.equal(tick(17_000, 'b'), 'crossfade'); await flush(); await flush();
  assert.equal(els.length, 2);              // the prefetched element plays: no second roll, no new file
  assert.equal(player.playing()?.id, 'b'); assert.equal(player.playing()?.perf, 1);
  assert.deepEqual(log.filter((e) => e.ev === 'start').at(-1), { ev: 'start', piece: 'b', reason: 'crossfade', performance: 1, performances: 3 });
});

test('a resume naming a performance the prefetch did not roll replaces the prefetched deck', async () => {
  const { els, player, tick } = rig(INDEX2, [0, 0.9]);
  const p = player.play('a'); els[0].metadata(); await p;
  tick(220_000, 'b'); assert.equal(els[1].src, perf('b', 2).url);
  const r = player.play('b', { perf: 0, positionS: 10, reason: 'resume' });
  assert.equal(els.length, 3); assert.equal(els[2].src, perf('b', 0).url); assert.ok(els[1].removed);
  els[2].metadata(); await r; assert.equal(player.playing()?.perf, 0);
});
