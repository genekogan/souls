// #832 (S3 demo, #831): an owner card ended `act "walk to the pond hall" --wait` just before the walk's receipt ended,
// and the brief output dropped the receipt to stay within 600 characters, so the seat could not tell the act was still
// going. 2.8.1 shortens the owner message texts instead (stderr keeps them in full) and never drops the receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brief} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const open = {id: 'r_d1dc4df4-5de9-4d6e-b2bc-3a00f24a9507', capability: 'walk:lab-pond-hall', phase: 'started', now: 'walking to Waterside Hall, 0 m left; not there yet'};
const card = (n, len) => ({id: `msg_${String(n).padStart(36, '0')}`, text: `Your turn: ${'t'.repeat(len)}`, sentAt: 1793808639771 + n});
const size = ({events, eventWindow, ...action}) => JSON.stringify(action).length;

test('brief: an owner message that ends a wait never pushes the receipt out; its text is shortened instead', () => {
  for (const len of [10, 290, 1000]) {
    const o = brief({accepted: true, waited: '32s', receipt: open, for: 'msg_e407ecea-4ece-420a-bd64-b35c6bb44721', open: true, ownerMessages: [card(1, len)], events: [{kind: 'receipt'}]});
    assert.deepEqual(o.receipt, {id: open.id, capability: open.capability, phase: 'started'}, `owner text of ${len}: the receipt stays`);
    assert.equal(o.done, false); assert.match(o.now, /not there yet/);
    assert.equal(o.ownerMessages.length, 1); assert.equal(o.ownerMessages[0].id, card(1, 0).id);
    assert.ok(size(o) <= 600, String(size(o)));
    if (len >= 290) { assert.equal(o.ownerMessages[0].textShortened, true); assert.equal(o.ownerMessages[0].text.length, 101); }
    else assert.equal(o.ownerMessages[0].text, card(1, len).text, 'a short message is printed as it is');
  }
  const many = brief({waited: '5s', receipt: open, ownerMessages: [card(1, 400), card(2, 400), card(3, 400), card(4, 400)]});
  assert.equal(many.receipt.id, open.id); assert.equal(many.ownerMessagesOmitted, 3); assert.equal(many.ownerMessages[0].id, card(4, 0).id, 'the newest is kept');
  assert.ok(size(many) <= 600, String(size(many)));
});

test('brief: without owner messages the output is unchanged (receipt and resolved kept as before)', () => {
  const o = brief({accepted: true, waited: '3s', receipt: open, resolved: {from: 'walk to the pond hall', to: 'walk:lab-pond-hall'}});
  assert.deepEqual(o, {accepted: true, waited: '3s', now: open.now, done: false, receipt: {id: open.id, capability: open.capability, phase: 'started'}, resolved: 'walk:lab-pond-hall'});
  const long = brief({accepted: true, waited: '3s', receipt: {...open, now: 'n'.repeat(616)}, resolved: {from: 'x', to: 'walk:lab-pond-hall'}});
  assert.equal(long.receipt, undefined, 'a long sentence without owner messages still drops resolved, then receipt, as 2.8.0 did'); assert.equal(long.resolved, undefined);
});

test('act --wait woken by a long owner card prints the open receipt (CLI end to end)', async t => {
  const long = card(1, 1000), seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const reply = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (req.url === '/v1/edge/act') return reply(200, {accepted: true, channel: 'body', receipt: {...open, now: 'walking to Waterside Hall, 32 m left; not there yet'}});
      if (req.url.startsWith('/v1/edge/wait')) return reply(200, {events: [], cursor: 'c_13', ownerMark: 7, ownerWrote: 1});
      if (req.url.startsWith('/v1/edge/receipts/')) return reply(200, {receipt: open});
      if (req.url.startsWith('/v1/edge/inbox/listen')) return reply(200, {backlog: [{...long, state: 'delivered'}]});
      reply(404, {error: {code: 'not-found', message: req.url}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'eden-cli-owner-wake-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok'}));
  const {out, err} = await new Promise((res, rej) => execFile(process.execPath, [CLI, 'act', 'walk:lab-pond-hall', '--wait', '60'], {cwd: dir}, (e, out, err) => e ? rej(new Error(err || e.message)) : res({out: JSON.parse(out), err})));
  assert.equal(out.receipt.id, open.id); assert.equal(out.receipt.phase, 'started'); assert.equal(out.done, false);
  assert.equal(out.ownerMessages[0].id, long.id); assert.equal(out.ownerMessages[0].textShortened, true);
  assert.ok(err.includes(long.text), 'stderr keeps the owner message in full');
  assert.equal(seen.filter(u => u.startsWith('/v1/edge/wait')).length, 1, 'the owner wake still ends the wait at once');
});
