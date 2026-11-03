import test from 'node:test';
import assert from 'node:assert/strict';
import { statusPoll } from './status-poll.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('two status views share each poll and stop only when the last view closes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  let requests = 0;
  const status = statusPoll(async () => ++requests);
  const bolt: number[] = [], panel: number[] = [];
  const closeBolt = status.subscribe((value) => bolt.push(value));
  const closePanel = status.subscribe((value) => panel.push(value));
  await flush();
  assert.equal(requests, 1);
  assert.deepEqual(bolt, [1]); assert.deepEqual(panel, [1]);

  t.mock.timers.tick(8000); await flush();
  assert.equal(requests, 2);
  assert.deepEqual(bolt, [1, 2]); assert.deepEqual(panel, [1, 2]);
  closeBolt();
  t.mock.timers.tick(8000); await flush();
  assert.equal(requests, 3); assert.deepEqual(bolt, [1, 2]);
  assert.deepEqual(panel, [1, 2, 3]);
  closePanel();
  t.mock.timers.tick(12000); await flush();
  assert.equal(requests, 3);
});

test('a slow request is coalesced across timers, title reads and mutation refreshes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  let requests = 0, resolve!: (value: string) => void;
  const status = statusPoll(() => { requests++; return new Promise<string>((yes) => { resolve = yes; }); });
  const title = status.refresh();
  const values: string[] = [];
  const close = status.subscribe((value) => values.push(value));
  assert.equal(status.refresh(), title);
  t.mock.timers.tick(12000);
  assert.equal(requests, 1);
  resolve('ready'); await title;
  assert.deepEqual(values, ['ready']);
  t.mock.timers.tick(8000);
  assert.equal(requests, 2);
  resolve('approved'); await status.refresh();
  assert.deepEqual(values, ['ready', 'approved']);
  close();
});

test('a newly mounted panel reuses a fresh shell result but later subscriptions refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  let requests = 0;
  const status = statusPoll(async () => ++requests);
  await status.refresh();
  const values: number[] = [];
  const close = status.subscribe((value) => values.push(value));
  await flush(); assert.equal(requests, 1); assert.deepEqual(values, [1]);
  close(); t.mock.timers.tick(9000);
  const closeLater = status.subscribe((value) => values.push(value));
  await flush(); assert.equal(requests, 2); assert.deepEqual(values, [1, 1, 2]);
  closeLater();
});

test('a failed fetch does not poison future polling', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  let requests = 0;
  const status = statusPoll(async () => { if (++requests === 1) throw Error('offline'); return 'ready'; });
  const values: string[] = [];
  const close = status.subscribe((value) => values.push(value));
  await flush(); assert.deepEqual(values, []);
  t.mock.timers.tick(8000); await flush();
  assert.equal(requests, 2); assert.deepEqual(values, ['ready']);
  close();
});

test('an account reset clears cached owner data before another view subscribes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  let account = 'owner', requests = 0;
  const status = statusPoll<string | null>(async () => { requests++; return account; });
  const owner: (string | null)[] = [];
  const closeOwner = status.subscribe((value) => owner.push(value));
  await flush(); assert.deepEqual(owner, ['owner']);
  closeOwner();
  account = 'visitor'; status.reset(null);
  const visitor: (string | null)[] = [];
  const closeVisitor = status.subscribe((value) => visitor.push(value));
  assert.deepEqual(visitor, [null]);
  await flush(); assert.deepEqual(visitor, [null, 'visitor']); assert.equal(requests, 2);
  t.mock.timers.tick(8000); await flush(); assert.equal(requests, 3);
  closeVisitor();
});

test('a previous account request cannot refill the cache, reach a waiter or clear the new pending request', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100 });
  const finish: ((value: string | null) => void)[] = [];
  const status = statusPoll<string | null>(() => new Promise((resolve) => finish.push(resolve)));
  const values: (string | null)[] = [];
  const close = status.subscribe((value) => values.push(value));
  const old = status.refresh();
  status.reset(null);
  const current = status.refresh(); assert.notEqual(current, old); assert.equal(finish.length, 2);
  finish[0]('owner-private-codes'); assert.equal(await old, null);
  assert.deepEqual(values, [null]); assert.equal(status.refresh(), current);
  t.mock.timers.tick(8000); assert.equal(finish.length, 2);
  finish[1]('visitor'); await current; assert.deepEqual(values, [null, 'visitor']);
  const remounted: (string | null)[] = [];
  const closeRemount = status.subscribe((value) => remounted.push(value));
  assert.deepEqual(remounted, ['visitor']);
  closeRemount(); close();
});
