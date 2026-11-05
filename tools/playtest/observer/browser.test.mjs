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
