// #803: process cost by class from `ps`, with a fake ps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseCpuTime, parsePs, startProcessSampler } from './proc-cost.mjs';

test('ps TIME and rows parse; commands map to classes', () => {
  assert.equal(parseCpuTime('0:01.50'), 1.5);
  assert.equal(parseCpuTime('12:03.25'), 723.25);
  assert.equal(parseCpuTime('1:02:03'), 3723);
  assert.equal(parseCpuTime('2-00:00:01'), 172801);
  assert.equal(parseCpuTime('bad'), null);
  assert.deepEqual(parsePs('  10   1  2048  0:01.00 /usr/bin/node a b\n'), [{ pid: 10, ppid: 1, rssKb: 2048, cpuSec: 1, command: '/usr/bin/node a b' }]);
  assert.equal(classify('/x/chrome-headless-shell --type=renderer'), 'browser');
  assert.equal(classify('/x/ffmpeg-mac -f matroska'), 'encoder');
  assert.equal(classify('node --env-file=.env apps/server/src/main.ts'), 'world');
  assert.equal(classify('node eden.mjs'), 'other');
});

test('the sampler sums descendants by class, subtracts a pre-run baseline, keeps exited processes and no commands', async () => {
  const row = (pid, ppid, kb, t, cmd) => `${pid} ${ppid} ${kb} ${t} ${cmd}`;
  const tables = [
    // before the run: the world (pid 11) already used 2 s; an unrelated process (pid 99, not a descendant)
    [row(11, 1, 1000, '0:02.00', 'node apps/server/src/main.ts'), row(99, 5, 9000, '9:00.00', '/x/chrome')],
    [row(11, 1, 1000, '0:03.00', 'node apps/server/src/main.ts'), row(20, 1, 4096, '0:05.00', '/x/chrome-headless-shell'), row(21, 20, 4096, '0:10.00', '/x/chrome-headless-shell --type=renderer'), row(30, 1, 512, '0:04.00', '/x/ffmpeg -c:v libvpx-vp9')],
    // the encoder exited; its last seen 4 s still counts
    [row(11, 1, 1000, '0:04.00', 'node apps/server/src/main.ts'), row(20, 1, 4096, '0:06.00', '/x/chrome-headless-shell'), row(21, 20, 8192, '0:20.00', '/x/chrome-headless-shell --type=renderer')],
  ];
  let i = 0;
  const s = startProcessSampler({ rootPid: 1, intervalMs: 5, ps: async () => tables[Math.min(i++, tables.length - 1)].join('\n') });
  await new Promise((r) => setTimeout(r, 40));
  const out = await s.stop();
  assert.equal(out.status, 'measured');
  assert.deepEqual(out.classes.world, { cpuSec: 2, peakRssMb: 1, processes: 1 }, 'baseline subtracted');
  assert.deepEqual(out.classes.browser, { cpuSec: 26, peakRssMb: 12, processes: 2 }, 'renderer is a descendant; RSS summed per sample');
  assert.deepEqual(out.classes.encoder, { cpuSec: 4, peakRssMb: 1, processes: 1 });
  assert.equal(out.classes.other.processes, 0, 'non-descendants are ignored');
  assert.doesNotMatch(JSON.stringify(out), /headless|ffmpeg|main\.ts|\/x\//, 'no command line is kept');
});

test('a failing ps leaves the cost unavailable with the reason', async () => {
  const s = startProcessSampler({ intervalMs: 5, ps: async () => { throw new Error('spawn ps ENOENT'); } });
  const out = await s.stop();
  assert.deepEqual(out, { status: 'unavailable', reason: 'ps failed: spawn ps ENOENT' });
});
