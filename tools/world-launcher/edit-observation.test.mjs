import test from 'node:test';
import assert from 'node:assert/strict';
import { MicroCache } from './flood.mjs';
import { SnapshotCache } from '../../apps/server/src/god/snapshot-cache.ts';
import { observeEdit, observeWeather, EDIT_OBSERVATION_BOUND_MS } from '../god-skill/e2e/edit-observation.mjs';

const url = 'http://fixture.test/v1/world/snapshot', entity = { id: 'original-bench', name: 'e2e-bench' };
function fixture({ ttl = 1000, broken = null } = {}) {
  let clock = 0, seq = 1, exists = true, actionCount = 0;
  const c3 = new MicroCache({ now: () => clock });
  const worldCache = new SnapshotCache({ now: () => clock, key: () => String(seq),
    build: () => ({ ...(broken === 'missing-seq' ? { editSeq: seq } : { seq: broken === 'stale-seq' ? 0 : seq }),
      entities: exists ? [{ ...entity, ...(broken === 'wrong-identity' && actionCount ? { id: 'substitute-bench' } : {}) }] : [] }) });
  const fetchImpl = async input => {
    const key = String(input), response = await c3.get(key, ttl, async () => {
      const snapshot = await worldCache.respond(undefined);
      return { status: 200, headers: { age: String(snapshot.ageSeconds), 'cache-control': 'no-store' }, body: snapshot.body };
    });
    return new Response(response.body, { status: response.status, headers: { ...response.headers, 'x-sim-cache': response.cache } });
  };
  const action = present => async () => {
    actionCount++; seq++;
    if (broken !== 'physical') exists = present;
    return { status: broken === 'rejected' ? 409 : 200, body: { accepted: broken !== 'rejected', seq } };
  };
  return { fetchImpl, now: () => clock, sleep: async ms => { clock += ms; }, advance: ms => { clock += ms; }, action,
    prime: () => fetchImpl(url), run: (present, extras = {}) => observeEdit({ snapshotUrl: url, entity, present, action: action(present), fetchImpl,
      now: () => clock, sleep: async ms => { clock += ms; }, ...extras }) };
}

for (const ttl of [1000, 2000]) for (const screenshotDelay of [0, 800, 2200]) {
  test(`primed ${ttl}ms C3: Undo/Redo verdict survives ${screenshotDelay}ms screenshot timing`, async () => {
    const f = fixture({ ttl }); await f.prime();
    const undo = await f.run(false);
    assert.equal(undo.ok, true); assert.equal(undo.ack.body.seq, 2);
    assert.equal(undo.firstSameUrl.cache, 'hit'); assert.equal(undo.firstSameUrl.seq, 1);
    assert.deepEqual(undo.firstSameUrl.entities, [entity], 'the original immediate absence criterion really fails');
    assert.equal(undo.immediateAuthoritative.cache, 'miss'); assert.equal(undo.immediateAuthoritative.seq, 2);
    assert.deepEqual(undo.immediateAuthoritative.entities, []);
    assert.equal(undo.convergedAfterAckMs, ttl);
    f.advance(screenshotDelay); await f.prime(); // explicitly prime Redo too, independent of the screenshot
    const redo = await f.run(true);
    assert.equal(redo.ok, true); assert.equal(redo.firstSameUrl.cache, 'hit'); assert.equal(redo.firstSameUrl.seq, 2);
    assert.deepEqual(redo.firstSameUrl.entities, []);
    assert.equal(redo.immediateAuthoritative.seq, 3); assert.deepEqual(redo.immediateAuthoritative.entities, [entity]);
    assert.equal(redo.convergedAfterAckMs, screenshotDelay < ttl ? ttl - screenshotDelay : ttl);
    assert.ok(redo.convergence.every(s => s.atMs >= redo.ackAtMs && s.endedAtMs <= redo.ackAtMs + EDIT_OBSERVATION_BOUND_MS));
  });
}
for (const broken of ['physical', 'stale-seq', 'missing-seq', 'rejected']) {
  test(`${broken} Undo remains failed despite bounded polling`, async () => {
    const f = fixture({ broken }); await f.prime(); const result = await f.run(false);
    assert.equal(result.ok, false); assert.equal(result.authoritativeOk, false);
    if (broken === 'rejected') { assert.equal(result.firstSameUrl, null); assert.deepEqual(result.convergence, []); }
  });
}
test('Redo rejects a same-name replacement with the wrong identity', async () => {
  const f = fixture({ broken: 'wrong-identity' }); await f.prime(); await f.run(false);
  const result = await f.run(true); assert.equal(result.ok, false); assert.equal(result.authoritativeOk, false);
  assert.equal(result.immediateAuthoritative.entities[0].id, 'substitute-bench');
});
test('a real immediate failure cannot be repaired by later convergence', async () => {
  const f = fixture(); await f.prime();
  const fetchImpl = async input => {
    const r = await f.fetchImpl(input);
    if (String(input).includes('e1-edit=')) return new Response(JSON.stringify({ seq: 2, entities: [entity] }), { headers: { 'x-sim-cache': 'miss' } });
    return r;
  };
  const result = await f.run(false, { fetchImpl });
  assert.equal(result.authoritativeOk, false); assert.equal(result.converged, true); assert.equal(result.ok, false);
});
test('same URL stale beyond the declared bound fails, with the first response preserved', async () => {
  const f = fixture({ ttl: 4000 }); await f.prime(); const result = await f.run(false);
  assert.equal(result.authoritativeOk, true); assert.equal(result.converged, false); assert.equal(result.ok, false);
  assert.equal(f.now(), EDIT_OBSERVATION_BOUND_MS); assert.equal(result.firstSameUrl.seq, 1);
});
test('a correct response arriving after the deadline is not convergence within the bound', async () => {
  const f = fixture(); await f.prime();
  const fetchImpl = async input => { const r = await f.fetchImpl(input); if (String(input).includes('e1-edit=')) f.advance(3100); return r; };
  const result = await f.run(false, { fetchImpl }); assert.equal(result.authoritativeOk, false); assert.equal(result.ok, false);
});
test('page errors fail otherwise-correct Undo/Redo observation', async () => {
  const f = fixture(); await f.prime(); const result = await f.run(false, { pageErrors: () => ['owner UI error'] });
  assert.equal(result.authoritativeOk, true); assert.equal(result.converged, true); assert.equal(result.ok, false);
  assert.deepEqual(result.pageErrors, ['owner UI error']);
});


const rainy = { kind: 'rain', rain: 0.8, intensity: 0.8 };
const automatic = { kind: 'auto', rain: 0, intensity: 1 };
function weatherFixture({ ttl = 1000, broken = null } = {}) {
  let clock = 0, seq = 2, exists = false, weather = automatic, weatherAction = false;
  const c3 = new MicroCache({ now: () => clock });
  const worldCache = new SnapshotCache({ now: () => clock, key: () => String(seq), build: () => ({
    ...(weatherAction && broken === 'missing-seq' ? { editSeq: seq } : { seq: weatherAction && broken === 'stale-seq' ? seq - 1 : seq }),
    entities: exists ? [entity] : [], state: { weather } }) });
  const fetchImpl = async input => {
    const response = await c3.get(String(input), ttl, async () => {
      const snapshot = await worldCache.respond(undefined);
      return { status: 200, headers: { 'cache-control': 'no-store' }, body: snapshot.body };
    });
    return new Response(response.body, { status: response.status, headers: { ...response.headers, 'x-sim-cache': response.cache } });
  };
  const common = { snapshotUrl: url, fetchImpl, now: () => clock, sleep: async ms => { clock += ms; } };
  const action = async () => {
    weatherAction = true;
    if (broken === 'rejected') return { status: 200, body: { accepted: false, seq } };
    seq++; weather = broken === 'physical' ? automatic : { ...rainy,
      ...(broken === 'wrong-kind' ? { kind: 'fog' } : {}), ...(broken === 'wrong-amount' ? { rain: 0 } : {}),
      ...(broken === 'wrong-intensity' ? { intensity: 0.1 } : {}) };
    return { status: 200, body: { accepted: true, seq } };
  };
  return { fetchImpl, prime: () => fetchImpl(url),
    redo: () => observeEdit({ ...common, entity, present: true, action: async () => {
      seq++; exists = true; return { status: 200, body: { accepted: true, seq } };
    } }), rain: (extras = {}) => observeWeather({ ...common, weather: rainy, action, ...extras }) };
}
for (const ttl of [1000, 2000]) {
  test(`E1 Redo then Rain: primed real ${ttl}ms cache preserves both verdicts`, async () => {
    const f = weatherFixture({ ttl }); await f.prime(); const redo = await f.redo();
    assert.equal(redo.ok, true); assert.equal(redo.ack.body.seq, 3);
    assert.equal(redo.convergence.at(-1).cache, 'miss', 'E1 refreshes same-URL cache immediately before F1');
    const rain = await f.rain();
    assert.equal(rain.ok, true); assert.equal(rain.ack.body.seq, 4);
    assert.equal(rain.firstSameUrl.cache, 'hit'); assert.equal(rain.firstSameUrl.seq, 3);
    assert.deepEqual(rain.firstSameUrl.weather, automatic, 'old F1 immediate snapshot assertion fails here');
    assert.equal(rain.immediateAuthoritative.cache, 'miss'); assert.equal(rain.immediateAuthoritative.seq, 4);
    assert.deepEqual(rain.immediateAuthoritative.weather, rainy);
    assert.equal(rain.convergedAfterAckMs, ttl); assert.deepEqual(rain.convergence.at(-1).weather, rainy);
  });
}
for (const broken of ['physical', 'wrong-kind', 'wrong-amount', 'wrong-intensity', 'stale-seq', 'missing-seq', 'rejected']) {
  test(`${broken} Rain remains failed after cache observation`, async () => {
    const f = weatherFixture({ broken }); await f.prime(); const result = await f.rain();
    assert.equal(result.ok, false); assert.equal(result.authoritativeOk, false);
    if (broken === 'rejected') { assert.equal(result.firstSameUrl, null); assert.deepEqual(result.convergence, []); }
  });
}
test('wrong immediate Rain cannot be repaired by eventual correct weather', async () => {
  const f = weatherFixture(); await f.prime();
  const fetchImpl = async input => {
    const r = await f.fetchImpl(input);
    if (String(input).includes('f1-weather=')) return new Response(JSON.stringify({ seq: 3, state: { weather: automatic } }), { headers: { 'x-sim-cache': 'miss' } });
    return r;
  };
  const result = await f.rain({ fetchImpl });
  assert.equal(result.authoritativeOk, false); assert.equal(result.converged, true); assert.equal(result.ok, false);
});
test('Rain unchanged URL beyond the declared bound still fails', async () => {
  const f = weatherFixture({ ttl: 4000 }); await f.prime(); const result = await f.rain();
  assert.equal(result.authoritativeOk, true); assert.equal(result.converged, false); assert.equal(result.ok, false);
  assert.deepEqual(result.firstSameUrl.weather, automatic);
});
test('page errors fail otherwise-correct Rain observation', async () => {
  const f = weatherFixture(); await f.prime(); const result = await f.rain({ pageErrors: () => ['weather UI error'] });
  assert.equal(result.authoritativeOk, true); assert.equal(result.converged, true); assert.equal(result.ok, false);
});
