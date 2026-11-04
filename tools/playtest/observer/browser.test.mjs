// The stock observer must import: playtest.mjs loads it optionally, so a parse error silently disables every camera (#633).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('observer/browser.mjs imports and exports its browser entry point', async () => {
  const m = await import('./browser.mjs');
  assert.equal(typeof m.openBrowser, 'function');
  assert.equal(typeof m.openCamera, 'function');
});
