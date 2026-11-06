// #824 (2.8.0): a refused act prints the world's `alternatives` (at most 3) beside did_you_mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));

test('act: a refusal prints alternatives (at most 3); none when the world sends none', async t => {
  const alts = [{id: 'walk:field', label: 'Green field'}, {id: 'gather:field', label: 'Gather'}, {id: 'jog:field', label: 'Jog'}, {id: 'sit:here', label: 'Sit'}];
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = JSON.parse(b || '{}'); res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify(body.capability === 'fly up to the field' ? {accepted: false, code: 'ride.unavailable', reason: 'No matching ride.', did_you_mean: [], alternatives: alts} : {accepted: false, code: 'capability.params', reason: 'Bad params.'}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'eden-cli-alternatives-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok'}));
  const cli = (...args) => new Promise((res, rej) => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, out, err) => e ? rej(new Error(err || e.message)) : res(JSON.parse(out))));
  const fly = await cli('act', 'fly up to the field');
  assert.equal(fly.code, 'ride.unavailable'); assert.deepEqual(fly.alternatives, alts.slice(0, 3)); assert.equal(fly.did_you_mean, undefined);
  const bad = await cli('act', 'walk:field');
  assert.equal(bad.code, 'capability.params'); assert.equal(bad.alternatives, undefined);
});
