const WORLD_ID = 'toy-1';
// Fair mid-brain scheduling: with a budget that affords few calls, every Soul
// should get its turn; a fixed iteration order must not starve anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@souls/engine-toy';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

test('mid-brain calls are shared fairly across Souls', async () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-fair-')), 't.db'));
  const host = new WorldHost(db, toyFactory, 'fair', 1e9); host.boot();
  const brain = new Brain(host, db, { ...config, brainMode: 'fake', typesafeKey: undefined, anthropicKey: undefined }, { onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, clients: () => 0 });
  const names = Array.from({ length: 12 }, (_, i) => `s${i}`);
  for (const n of names) void host.enqueue('birth', 'test', { soulId: `s_${n}`, entityId: `h_${n}`, name: n, description: 'x', owner: 'system' });
  for (let i = 0; i < 20 * 120; i++) { host.tickOnce(); if (i % 5 === 0) await new Promise((r) => setImmediate(r)); }
  const counts = new Map<string, number>();
  for (const c of db.brainCalls(5000, { tier: 'mid' })) counts.set(c.subject, (counts.get(c.subject) ?? 0) + 1);
  const n = names.map((x) => counts.get(x) ?? 0);
  assert.ok(Math.min(...n) >= 1, `every soul thought at least once: ${n}`);
  // Souls that are spoken to think more often (that is by design); nobody may be starved by iteration order
  assert.ok(Math.min(...n) >= 2 && Math.max(...n) <= Math.min(...n) * 6, `no soul is starved: ${n}`);
  assert.ok(db.countEvents(WORLD_ID) > 12);
  void brain; await new Promise((r) => setTimeout(r, 100)); db.close(); // let in-flight speech rendering settle
});
