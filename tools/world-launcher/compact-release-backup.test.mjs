import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./deploy/ship/compact-copy.py', import.meta.url));
const python = (code, ...args) => spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'souls-compact-release-')), source = join(root, 'source.db');
  const p = python(`import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.executescript("""
PRAGMA user_version=7;
PRAGMA application_id=123;
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, payload BLOB);
INSERT INTO events(id,payload) VALUES(8,x'000102ff');
DELETE FROM events;
INSERT INTO events(payload) VALUES(x'000102ff');
CREATE TABLE pairs(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID;
INSERT INTO pairs VALUES('hello',5);
CREATE TABLE audit(n INTEGER);
CREATE TRIGGER event_insert AFTER INSERT ON events BEGIN INSERT INTO audit VALUES(new.id); END;
CREATE TABLE take_chunks(to_tick INTEGER,payload BLOB);
INSERT INTO take_chunks VALUES(100,x'0102');
CREATE TABLE take_archives(payload TEXT);
INSERT INTO take_archives VALUES('recording');
CREATE INDEX pair_b ON pairs(b);
""")
c.commit();c.close()`, source);
  assert.equal(p.status, 0, p.stderr); return { root, source };
}
test('release compact copy preserves all rows, schema, rowids and sequence without changing source', () => {
  const { root, source } = fixture(), dest = join(root, 'backup.db');
  const before = createHash('sha256').update(readFileSync(source)).digest('hex');
  const result = spawnSync('python3', [helper, source, dest, '--keep-takes'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).dropped, {});
  const check = python(`import sqlite3,sys
a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect('file:'+sys.argv[2]+'?mode=ro',uri=True)
queries=["SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name", "SELECT * FROM events", "SELECT * FROM pairs", "SELECT * FROM audit", "SELECT * FROM take_chunks", "SELECT * FROM take_archives", "SELECT * FROM sqlite_sequence", "PRAGMA user_version", "PRAGMA application_id", "PRAGMA quick_check"]
for q in queries: assert a.execute(q).fetchall()==b.execute(q).fetchall(),q
print('all rows and schema match')`, source, dest);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), before);
});
test('compact copy retains existing complete and partial evidence instead of deleting or overwriting', () => {
  for (const suffix of ['', '.part', '.part-journal', '.part-wal', '.part-shm']) {
    const { root, source } = fixture(), dest = join(root, 'backup.db'), occupied = dest + suffix;
    writeFileSync(occupied, 'retained evidence');
    const result = spawnSync('python3', [helper, source, dest, '--keep-takes'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /destination already exists/);
    assert.equal(readFileSync(occupied, 'utf8'), 'retained evidence');
  }
});
