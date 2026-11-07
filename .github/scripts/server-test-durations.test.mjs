import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, fileTimes } from './server-test-durations.mjs';

test('file times from a server job log: tests attributed in file order, each file from the previous report to its own', () => {
  const at = (s) => `server-0\tUNKNOWN STEP\t2026-11-04T10:00:${String(s).padStart(2, '0')}.0000000Z`;
  const log = [
    `${at(0)} {"shard":0,"totalServerFiles":3,"files":["src/a.test.ts","src/b.test.ts","src/c.test.ts"]}`,
    `${at(3)} # Subtest: alpha one`, `${at(3)} ok 1 - alpha one`, `${at(4)} ok 2 - alpha two`,
    `${at(4)}   ok 1 - a nested subtest does not count`,
    `${at(10)} ok 3 - computed name \${x}`,   // found nowhere: stays with the current file (a)... until c's own test
    `${at(25)} not ok 4 - gamma`,
  ].join('\n');
  const src = { 'src/a.test.ts': "test('alpha one'); test('alpha two')", 'src/b.test.ts': '', 'src/c.test.ts': "test('gamma')" };
  const times = fileTimes(parseLog(log), (f) => src[f]);
  assert.deepEqual(times, { 'src/a.test.ts': 10, 'src/c.test.ts': 15 });
  assert.equal(parseLog('no header'), null);
});
