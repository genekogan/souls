// CTX-6 (#1139): the cross-world identity is on the wire, and memory's pointers stay readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';

test('traveller: here, around, inspect and the public record carry it; a visitor shows its home identity', {timeout: 300000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls, slug = process.env.WORLD_KEY ?? w.f.host.worldId;
  await w.put(a, [14, 14]); const [ax, az] = w.pos(a); await w.put(b, [ax + 3, az]);
  const self = `${slug}/${b.soulId}`;
  const near = async () => (await w.http(a, 'GET', '/v1/edge/here')).body.here.near.find((n: {id: string}) => n.id === b.soulId);
  assert.equal((await near()).traveller, self, 'never travelled: this world and its id');
  const around = (await w.http(a, 'GET', '/v1/edge/around')).body.around;
  assert.deepEqual(around.souls.find((s: {id: string}) => s.id === b.soulId), {id: b.soulId, traveller: self});
  assert.equal((await w.http(a, 'GET', `/v1/edge/inspect/${b.soulId}`)).body.inspect.traveller, self);
  assert.equal((await w.http(a, 'GET', `/v1/edge/public/souls/${b.soulId}`)).body.soul.traveller, self);
  // a visiting incarnation: the row travel writes on arrival names its home
  const db = w.f.db.db;
  db.exec('CREATE TABLE IF NOT EXISTS travel_incarnations_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, traveller TEXT NOT NULL, home TEXT NOT NULL, state TEXT NOT NULL, at TEXT, request_id TEXT, log TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id))');
  db.prepare('INSERT INTO travel_incarnations_v1 (world_id, soul_id, traveller, home, state, at, request_id, log, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(w.f.host.worldId, b.soulId, 'birch/s_home1', 'birch', 'present', null, null, '[]', 1);
  assert.equal((await near()).traveller, 'birch/s_home1');
  assert.equal((await w.http(a, 'GET', `/v1/edge/inspect/${b.soulId}`)).body.inspect.traveller, 'birch/s_home1');
});

test('long tail: alone, around adds nothing; near, one short field per Soul', {timeout: 300000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls;
  await w.put(a, [14, 14]); await w.put(b, [40, 40]);
  const around = (await w.http(a, 'GET', '/v1/edge/around')).body.around;
  assert.equal(around.souls, undefined);
});

test('durable reads: a receipt stays readable, and a removed object answers with its last name', {timeout: 300000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls;
  const r: any = await w.act(a, 'stand:here');
  const id = r.receipt?.id ?? r.id;
  await w.ticks(600);
  assert.equal((await w.http(a, 'GET', `/v1/edge/receipts/${id}`)).status, 200);
  const objects = w.comms.objects;
  objects.create({id: 'old-calendar', kind: 'calendar-item', name: 'The old calendar', placeId: 'nowhere', params: {startsAtTick: 10000, durationTicks: 100}});
  objects.create({id: 'private-mark', kind: 'mark', name: 'A private mark', placeId: 'nowhere', params: {author: a.soulId, title: 'A private mark', text: 'kept', at: [0, 0]}});
  for (const x of ['old-calendar', 'private-mark']) objects.remove(x);
  const gone = await w.http(a, 'GET', '/v1/edge/objects/old-calendar');
  assert.equal(gone.status, 200); assert.equal(gone.body.object, null);
  assert.equal(gone.body.tombstone.lastName, 'The old calendar'); assert.equal(gone.body.tombstone.kind, 'calendar-item');
  assert.ok(Number.isFinite(gone.body.tombstone.goneTick));
  assert.equal((await w.http(b, 'GET', '/v1/edge/objects/private-mark')).status, 404, 'an unlisted kind tells no stranger its name');
  assert.equal((await w.http(a, 'GET', '/v1/edge/objects/never-was')).status, 404);
  objects.create({id: 'old-calendar', kind: 'calendar-item', name: 'The new calendar', placeId: 'nowhere', params: {startsAtTick: 10000, durationTicks: 100}});
  assert.equal((await w.http(a, 'GET', '/v1/edge/objects/old-calendar')).body.object.name, 'The new calendar', 'restored: the tombstone is gone');
});
