// The stock observer must import: playtest.mjs loads it optionally, so a parse error silently disables every camera (#633).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('observer/browser.mjs imports and exports its browser entry point', async () => {
  const m = await import('./browser.mjs');
  assert.equal(typeof m.openBrowser, 'function');
  assert.equal(typeof m.openCamera, 'function');
});

test('a camera whose post-arrival setup throws closes its context and keeps its video for the open-failed sidecar', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openCamera, writeRecording } = await import('./browser.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cam-fail-')), raw = join(dir, 'raw-video.webm');
  writeFileSync(raw, 'video bytes');
  let closed = 0;
  const page = { on() {}, goto: async () => {}, waitForFunction: async () => {}, evaluate: async () => ({ mode: 'broadcast' }),
    locator: () => ({ count: async () => 1, first: () => ({ click: async () => { throw new Error('element is detached'); } }) }),
    video: () => ({ path: async () => raw }) };
  const ctx = { addInitScript: async () => {}, newPage: async () => page, close: async () => { closed++; } };
  const browser = { newContext: async () => ctx };
  const o = { base: 'http://world.test', kind: 'free', name: 'free', record: { dir } };
  const e = await openCamera({ browser, ...o }).then(() => null, (x) => x);
  assert.match(e?.message ?? '', /detached/);
  assert.equal(closed, 1, 'the context is closed, not left open until browser.close()');
  assert.equal(e.video, raw);
  assert.ok(e.opened?.at);
  const meta = writeRecording({ name: 'free', o, r: { video: e.video, opened: e.opened, closed: { at: new Date().toISOString(), mono: 1 } }, closedBy: 'open-failed', error: e.message });
  assert.deepEqual({ file: meta.file, partial: meta.partial, closedBy: meta.closedBy }, { file: 'free.webm', partial: true, closedBy: 'open-failed' });
  assert.ok(existsSync(join(dir, 'free.webm')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'free.webm.json'), 'utf8')).file, 'free.webm');
});

test('recording size (#802): compact fits the encoder floor, viewport keeps full size, and the sidecar records both', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openCamera, writeRecording, recordEncoding, RECORD_FLOOR_AREA } = await import('./browser.mjs');
  const vp = { width: 1280, height: 800 };
  const c = recordEncoding('compact', vp);
  assert.ok(c.size.width * c.size.height <= RECORD_FLOOR_AREA && c.size.width % 2 === 0 && c.size.height % 2 === 0, JSON.stringify(c));
  assert.ok(Math.abs(c.size.width / c.size.height - 1.6) < 0.01, 'aspect kept');
  assert.equal(c.targetKbps, 1000);
  assert.deepEqual(recordEncoding('viewport', vp), { setting: 'viewport', size: vp, fps: 25, targetKbps: 2844 });
  assert.deepEqual(recordEncoding({ width: 640, height: 400 }, vp).setting, 'explicit');
  assert.deepEqual(recordEncoding('compact', { width: 400, height: 300 }).size, { width: 400, height: 300 }, 'a small viewport is not upscaled');
  // The size reaches Playwright's recordVideo, and the sidecar names the setting and MB per minute.
  const dir = mkdtempSync(join(tmpdir(), 'cam-size-')), raw = join(dir, 'raw.webm');
  writeFileSync(raw, Buffer.alloc(3e6));
  let asked = null;
  const page = { on() {}, goto: async () => {}, waitForFunction: async () => {}, evaluate: async () => ({ mode: 'broadcast' }), video: () => ({ path: async () => raw }) };
  const browser = { newContext: async (o) => { asked = o; return { addInitScript: async () => {}, newPage: async () => page, close: async () => {} }; } };
  const o = { base: 'http://world.test', kind: 'wide', name: 'wide', viewport: vp, record: { dir, size: 'compact' } };
  const cam = await openCamera({ browser, ...o });
  assert.deepEqual(asked.recordVideo.size, c.size);
  assert.deepEqual(asked.viewport, vp, 'the page keeps its viewport; only the recording is scaled');
  const r = await cam.close();
  r.opened = { at: 'a', mono: 0 }; r.closed = { at: 'b', mono: 30000 };
  const meta = writeRecording({ name: 'wide', o, cam, r });
  assert.deepEqual(meta.encoding, c);
  assert.equal(meta.bytes, 3e6);
  if (meta.videoSec == null) assert.equal(meta.mbPerMin, 6, '3 MB over 30 s');
});
