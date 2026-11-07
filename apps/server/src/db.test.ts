// The canonical file is shared with other processes (Litestream replication, backups). A write must wait for a
// briefly held lock, not fail: in production the tick loop was dying about fifteen times a day on "database is locked".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from './db.ts';

test('a write waits for another process holding the lock', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'souls-lock-')), 't.db');
  const db = new Db(path);
  db.createWorld({ id: 'w', schema: 's', rules_version: 'r', dt: 0.05, seed: 'x' });
  const holder = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(${JSON.stringify(path)});
    d.exec('BEGIN IMMEDIATE'); console.log('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
    d.exec('COMMIT'); d.close();`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise<void>((resolve) => holder.stdout.on('data', (b) => { if (String(b).includes('locked')) resolve(); }));
  const t0 = Date.now();
  db.appendEvent('w', { seq: 1, tick: 1, kind: 'admin', author: 'test', payload: {}, at: Date.now() });
  const waited = Date.now() - t0;
  assert.ok(waited >= 300, `the write waited for the lock (${waited} ms)`);
  assert.equal(db.countEvents('w'), 1);
  await new Promise((r) => holder.on('exit', r));
  db.close();
});
