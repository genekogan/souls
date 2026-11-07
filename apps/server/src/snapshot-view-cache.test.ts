// Lane L5: a reconnect storm costs one entity copy per world state; any step or accepted input makes a new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

test('snapshotView shares one copy per (tick, seq) and never the live table', (t) => {
  t.mock.method(console, 'log', () => {});
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'view-cache', 1e9, 'view-cache');
  host.boot(); t.after(() => { host.stop(); db.close(); });
  host.tickOnce();
  const a = host.snapshotView(), b = host.snapshotView();
  assert.equal(a.entities, b.entities, 'same state: one copy');
  assert.notEqual(a.entities, host.engine.world.entities, 'a copy, not the live table');
  host.tickOnce();
  const c = host.snapshotView();
  assert.notEqual(c.entities, a.entities, 'a step makes a new copy');
  assert.equal(c.tick, a.tick + 1);
  void host.enqueue('rules', 'world', { note: 'input' }); host.drainInputs();
  assert.notEqual(host.snapshotView().entities, c.entities, 'accepted input makes a new copy');
});
