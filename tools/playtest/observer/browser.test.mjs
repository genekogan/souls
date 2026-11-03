import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCamera } from './browser.mjs';

test('failed navigation closes the newly created context and preserves its error', async () => {
  const failure = new Error('navigation failed');
  let closed = 0;
  const page = { on() {}, goto: async () => { throw failure; }, evaluate: async () => ({ arrival: 'Arriving in fixture' }) };
  const ctx = { addInitScript: async () => {}, newPage: async () => page, close: async () => { closed++; } };
  await assert.rejects(openCamera({ browser: { newContext: async () => ctx }, base: 'http://fixture/w/local' }), error => {
    assert.equal(error, failure);
    assert.equal(error.observer.legible.arrival, 'Arriving in fixture');
    return true;
  });
  assert.equal(closed, 1);
});

test('arrival timeout closes context even when page diagnostics and close fail', async () => {
  const failure = new Error('arrival timed out');
  let closed = 0;
  const page = { on() {}, goto: async () => {}, bringToFront: async () => {}, waitForFunction: async () => { throw failure; }, evaluate: async () => { throw Error('page closed'); } };
  const ctx = { addInitScript: async () => {}, newPage: async () => page, close: async () => { closed++; throw Error('close failed'); } };
  await assert.rejects(openCamera({ browser: { newContext: async () => ctx }, base: 'http://fixture/w/local' }), error => {
    assert.equal(error, failure);
    assert.equal(error.observer.legible, null);
    return true;
  });
  assert.equal(closed, 1);
});

test('page creation failure closes context before the camera can be registered', async () => {
  let closed = 0;
  const failure = new Error('newPage failed');
  const ctx = { addInitScript: async () => {}, newPage: async () => { throw failure; }, close: async () => { closed++; } };
  await assert.rejects(openCamera({ browser: { newContext: async () => ctx }, base: 'http://fixture/w/local' }), error => error === failure);
  assert.equal(closed, 1);
});
