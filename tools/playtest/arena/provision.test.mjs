import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processAlive, stopWorld } from './provision.mjs';

test('a zombie is exited even when kill(pid, 0) succeeds', () => {
  const signal = () => {};
  assert.equal(processAlive(123, { platform: 'linux', signal, read: () => '123 (world (worker)) Z 1 2 3' }), false);
  assert.equal(processAlive(123, { platform: 'linux', signal, read: () => '123 (world (worker)) S 1 2 3' }), true);
});

test('missing proc data retains signal result; a missing process is not alive', () => {
  assert.equal(processAlive(123, { platform: 'linux', signal() {}, read() { throw Error('proc unavailable'); } }), true);
  assert.equal(processAlive(123, { signal() { throw Error('ESRCH'); } }), false);
  assert.equal(processAlive(123, { platform: 'darwin', signal() {}, read() { throw Error('must not read'); } }), true);
});

test('stopWorld without a pid does not target another process', async () => {
  assert.deepEqual(await stopWorld({}), { stopped: false, reason: 'no pid' });
});
