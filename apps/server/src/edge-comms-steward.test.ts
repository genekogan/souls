// C10: steward work queue (digest schedule, claim/complete, narration) and GET /v1/edge/digest.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DAY_TICKS} from '@souls/brain';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {commsFixture} from './edge/comms/testing.ts';

const TOKEN = 'steward-test-token-0123456789';
const HOUR = DAY_TICKS / 24;                         // tick 0 is 06:00 in-world
function world(token: string | null = TOKEN) {
  const f = commsFixture(['Alice', 'Bob'], {stewardToken: token ?? undefined});
  (f.host as any).engine.world.tick = 0;
  const steward = async (method: string, path: string, body?: unknown, auth: string | null = token) => {
    const res = await f.app.request(path, {method, headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: res.status, body: await res.json() as any};
  };
  return {f, steward, setHour: (h: number) => { (f.host as any).engine.world.tick = Math.round((h - 6) * HOUR); }};
}

test('steward endpoints need the configured token', async () => {
  const none = world(null);
  try { assert.equal((await none.steward('GET', '/v1/edge/steward/work', undefined, 'x')).status, 503); } finally { none.f.destroy(); }
  const w = world();
  try {
    const bad = await w.steward('GET', '/v1/edge/steward/work', undefined, 'wrong');
    assert.equal(bad.status, 401); assert.equal(bad.body.contract, EDGE_CONTRACT); assert.equal(bad.body.error.code, 'unauthorized');
    assert.equal((await w.f.app.request('/v1/edge/steward/work')).status, 401);
  } finally { w.f.destroy(); }
});

test('digests are queued once per in-world morning and evening; completing one serves it to every Soul', async () => {
  const w = world();
  try {
    assert.deepEqual((await w.steward('GET', '/v1/edge/steward/work')).body.work, [], '06:00 is still night');
    assert.equal((await w.f.get('Alice', '/v1/edge/digest')).body.digest, null);
    w.setHour(8);
    const first = await w.steward('GET', '/v1/edge/steward/work');
    assert.equal(first.body.work.length, 1);
    const item = first.body.work[0];
    assert.deepEqual([item.kind, item.body.phase, item.body.day, item.state], ['digest', 'morning', 0, 'open']);
    assert.equal((await w.steward('GET', '/v1/edge/steward/work')).body.work.length, 1, 'idempotent per slot');
    const claimed = await w.steward('POST', `/v1/edge/steward/work/${item.id}/claim`, {by: 'steward-1'});
    assert.equal(claimed.body.work.state, 'claimed');
    assert.equal((await w.steward('POST', `/v1/edge/steward/work/${item.id}/claim`, {by: 'steward-2'})).status, 409);
    assert.equal((await w.steward('GET', '/v1/edge/steward/work')).body.work.length, 0, 'claimed items are hidden');
    assert.equal((await w.steward('POST', `/v1/edge/steward/work/${item.id}/complete`, {result: {text: ''}})).status, 400);
    const done = await w.steward('POST', `/v1/edge/steward/work/${item.id}/complete`, {result: {text: '# Morning\nMist on the pond.'}});
    assert.equal(done.body.work.state, 'done');
    const digest = (await w.f.get('Bob', '/v1/edge/digest')).body.digest;
    assert.deepEqual([digest.text, digest.day, digest.phase], ['# Morning\nMist on the pond.', 0, 'morning']);
    assert.ok((await w.f.drain('Alice')).events.some((e: any) => e.kind === 'world' && e.digest?.phase === 'morning'));
    w.setHour(19);
    const evening = (await w.steward('GET', '/v1/edge/steward/work')).body.work;
    assert.deepEqual(evening.map((x: any) => [x.body.phase, x.body.since > 0]), [['evening', true]]);
  } finally { w.f.destroy(); }
});

test('a stale claim can be taken over after ten minutes', async () => {
  const w = world();
  try {
    w.setHour(9);
    const id = (await w.steward('GET', '/v1/edge/steward/work')).body.work[0].id;
    await w.steward('POST', `/v1/edge/steward/work/${id}/claim`, {by: 'a'});
    w.f.clock.now += 10 * 60_000 + 1;
    assert.equal((await w.steward('GET', '/v1/edge/steward/work')).body.work.length, 1);
    assert.equal((await w.steward('POST', `/v1/edge/steward/work/${id}/claim`, {by: 'b'})).body.work.claimedBy, 'b');
  } finally { w.f.destroy(); }
});

test('narration reaches its Soul; the log shows public speech and object acts but no private turns', async () => {
  const w = world();
  try {
    const nid = w.f.runtime.steward.narrate({soulId: w.f.id('Alice'), what: 'reclaimed after fading'})!;
    await w.steward('POST', `/v1/edge/steward/work/${nid}/claim`, {});
    await w.steward('POST', `/v1/edge/steward/work/${nid}/complete`, {result: {text: 'Alice falls gently from the sky onto the green.'}});
    assert.ok((await w.f.drain('Alice')).events.some((e: any) => e.kind === 'world' && e.narration && /falls gently/.test(e.text)));
    assert.equal((await w.f.drain('Bob')).events.length, 0);
    w.f.at('Alice', 0, 0); w.f.at('Bob', 2, 0);
    await w.f.post('Alice', '/v1/edge/say', {text: 'Good morning'});
    const cv = (await w.f.post('Alice', '/v1/edge/converse', {op: 'start', with: [w.f.id('Bob')], text: 'secret plan'})).body.conversation.id;
    await w.f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    await w.f.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'also secret'});
    const log = (await w.steward('GET', '/v1/edge/steward/log?since=0')).body;
    assert.deepEqual(log.speech.map((s: any) => [s.from.name, s.text, s.heardBy]), [['Alice', 'Good morning', 1]]);
    assert.ok(!JSON.stringify(log).includes('secret'), 'private conversation text never reaches the steward');
  } finally { w.f.destroy(); }
});
