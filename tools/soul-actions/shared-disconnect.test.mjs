// PC09 (#688): a mind disconnect during a shared carry (docs/design/shared-execution.md §3 "Mind disconnect and fade").
// Two forms of absence: the agent stops listening (the LINK body rule makes the body `zombie`, then `asleep`), and the
// beam-up fade (`SIM_BEAM`, an hour without an accepted action). A disconnected mind's body keeps its accepted manoeuvre
// to its end and never joins anything new; a fade during the operation is that member's stop with the supported cleanup.
// On reconnect the same receipt says what really happened, and a stale retry moves nobody.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

const MIN = 60_000, HOUR = 60 * MIN, STEP_MS = 50;
/** Short body clocks so a carry of a few seconds sees `zombie` and then `asleep` (real worlds keep BODY_KNOBS). */
const KNOBS = {sleepGraceMs: 1500, zombieWanderMs: 2500, zombieStepMinMs: 300, zombieStepMaxMs: 600, idleStartMs: 10 * MIN};

async function world(t, {presence = false} = {}) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, now = () => clock.now;
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry: true, now}), app = new Hono(); let current;
  const comms = registerEdgeComms(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current}, {fading: true, beam: true, now, sweepMs: 0});
  edge.attachComms(comms);
  // the fading holds the server registers with its event routes (edge/events/index.ts): a running act is not abandonment
  comms.fading.addHold((id) => edge.postureHold(id));
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  // the agent's listen presence: everyone listens until a test closes one (`listen(s, false)`)
  const pres = new Map(), listens = [];
  const rule = presence ? edge.attachPresence({soulPresence: (id) => pres.get(id) ?? {listening: true, at: clock.now}, onSoulListen: (l) => listens.push(l)}, KNOBS) : null;
  const listen = (s, open) => { pres.set(s.soulId, {listening: open, at: clock.now}); if (open) for (const l of listens) l(s.soulId); };
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { clock.now += STEP_MS; f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared disconnect test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, [ax, , az] = E[souls.Ada.entityId].pose.p;
  const at = async (s, x, z) => {
    await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = E[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z}`);
  };
  await at(souls.Bo, ax, az + 3); await at(souls.Cy, ax - 3, az - 5);
  // the §7 scene: Ada and Bo beside a loose shared-carry beam on open level-0 ground, the shed about 8 m away
  assert.notEqual(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
  ]}).accepted, false);
  await tick(60);
  if (rule) for (const s of Object.values(souls)) listen(s, true);
  return {f, edge, comms, god, rule, clock, tick, souls, listen, ax, az, idOf: (n) => god.model.get(n).id};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => { for (let n = 0; n < max && !done(); n++) await w.tick(1); };
const flat = (p) => Math.hypot(p[0], p[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const streamOf = (w, s) => w.comms.streams.read(s.soulId, 0).events;
const events = (w, kind) => w.f.db.db.prepare('SELECT seq, author, payload FROM events WHERE kind=? ORDER BY seq').all(kind).map((r) => ({seq: r.seq, author: r.author, ...JSON.parse(r.payload)}));
const receiptsOf = (w, s) => w.f.db.db.prepare('SELECT receipt_id FROM edge_receipts_v1 WHERE soul_id=?').all(s.soulId).length;
const walkOf = (w, s, to = null) => w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.available && (!to || c.id === `walk:${to}`))?.id ?? w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.available).id;
const bodyMoves = (w, s, since) => events(w, 'decision').filter((e) => e.seq > since && e.soulId === s.soulId && e.trigger === 'edge-body');
const bodyStops = (w, s, since) => events(w, 'edge-stop').filter((e) => e.seq > since && e.soulId === s.soulId && !e.programId);
const lastSeq = (w) => w.f.db.db.prepare('SELECT MAX(seq) AS s FROM events').get().s ?? 0;

/** Commit Ada and Bo's carry of the beam to the shed; sample every tick until the op ends. `during(ctx)` runs each tick.
 *  Asserts no teleport (no step over 0.1 m) and that the load is always carried or lying on the ground. */
async function carry(w, t, during, max = 6000) {
  const {Ada, Bo} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}, clientRef: 'bo-accept-1'}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const op0 = inviteOf(w, id).shared.op; assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p)));
  const crew = [[Ada, p], [Bo, a]], last = {}, seen = {phases: [], opPhases: new Set(), maxStep: 0, maxLoadStep: 0, unsupported: 0, states: {Ada: new Set(), Bo: new Set()}};
  const since = lastSeq(w);
  for (let n = 0; n < max && inviteOf(w, id).shared.op.phase !== 'ended'; n++) {
    await w.tick(1);
    const phase = eng.programAction?.(op0.programId)?.action.phase, op = inviteOf(w, id).shared.op;
    if (phase && seen.phases.at(-1) !== phase) seen.phases.push(phase); seen.opPhases.add(op.phase);
    for (const [s] of crew) { const q = E[s.entityId].pose.p; if (last[s.name]) seen.maxStep = Math.max(seen.maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; const v = w.rule?.view(s.soulId); if (v) seen.states[s.name].add(v.state); }
    const b = E[beam].pose.p; if (last.beam) seen.maxLoadStep = Math.max(seen.maxLoadStep, flat(sub(b, last.beam)), Math.abs(b[1] - last.beam[1])); last.beam = [...b];
    if (E[beam].phase !== 'carried' && E[beam].support?.kind !== 'ground') seen.unsupported++;
    await during?.({phase, op, p, a, id, beam, E, n, since});
  }
  const end = inviteOf(w, id).shared.op;
  t.diagnostic(`native phases ${seen.phases.join(',')}; op phases ${[...seen.opPhases].join(',')}; body states Ada ${[...seen.states.Ada].join('/') || '-'}, Bo ${[...seen.states.Bo].join('/') || '-'}; largest step ${seen.maxStep.toFixed(3)} m, load ${seen.maxLoadStep.toFixed(3)} m; op ${JSON.stringify({phase: end.phase, result: end.result, stop: end.stop, code: end.code})}`);
  assert.ok(seen.maxStep < 0.1, `no carrier teleports (${seen.maxStep.toFixed(3)} m)`); assert.ok(seen.maxLoadStep < 0.1, `the load never jumps or drops (${seen.maxLoadStep.toFixed(3)} m)`);
  assert.equal(seen.unsupported, 0, 'the load is always carried or lying on the ground');
  return {p, a, id, op: end, seen, crew, beam, since, programId: op0.programId};
}
const laidFree = (w, beam) => { const x = w.f.host.engine.world.entities[beam]; assert.equal(x.support?.kind, 'ground', 'the beam lies on the ground'); assert.equal(x.reservedBy ?? null, null, 'the load claim is gone'); };

for (const [who, when] of [['Bo', 'move'], ['Ada', 'gather'], ['Bo', 'lift']]) {
  test(`PC09 A1a/A2/A3: ${who} stops listening during ${when}; the body keeps the accepted carry to its end, then the same receipt says so on reconnect`, {timeout: 300000}, async (t) => {
    const w = await world(t, {presence: true}), {Ada, Bo, Cy} = w.souls, away = w.souls[who], other = who === 'Bo' ? Ada : Bo;
    const cyWalk = ok(await act(w, Cy, {capability: walkOf(w, Cy)}));
    let gone = null, during = null;
    const r = await carry(w, t, async (c) => {
      if (gone === null && c.phase === when) { gone = c.n; w.listen(away, false); }
      // away while the crew carries: the receipt still says started; a fresh accept from a stale context is refused
      // shared.busy naming the op, and makes no receipt for either member
      if (gone !== null && !during && c.op.phase === 'started' && c.n > gone + 200) {
        const counts = [receiptsOf(w, Ada), receiptsOf(w, Bo)];
        const fresh = await act(w, Bo, {capability: `accept:${c.id}`, params: {revision: 1}});
        during = {view: w.rule.view(away.soulId).state, receipt: read(w, away, away === Ada ? c.p : c.a), fresh, counts, after: [receiptsOf(w, Ada), receiptsOf(w, Bo)]};
      }
    });
    assert.ok(during, 'checked while the crew carried');
    assert.equal(during.fresh.accepted, false); assert.equal(during.fresh.code, 'shared.busy', JSON.stringify(during.fresh)); assert.equal(during.fresh.op, r.op.id);
    assert.deepEqual(during.after, during.counts, 'a refused accept makes no receipt');
    assert.ok(gone !== null, `${who} disconnected during ${when}`);
    // A1a: the body was left alone by the body rule (no reflex move or stop) and the accepted carry arrived
    assert.ok(r.seen.states[who].has('zombie') && r.seen.states[who].has('asleep'), `${who}'s body went zombie, then asleep, during the carry: ${[...r.seen.states[who]]}`);
    assert.deepEqual(bodyMoves(w, away, r.since), [], 'no body-rule move while the carry ran');
    assert.deepEqual(bodyStops(w, away, r.since), [], 'no body-rule stop while the carry ran');
    assert.equal(during.receipt.phase, 'started'); assert.equal(during.receipt.shared.phase, 'started');
    assert.equal(r.op.result, 'arrived');
    for (const [s, rc] of r.crew) { const x = read(w, s, rc); assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.result, 'arrived'); }
    laidFree(w, r.beam);
    // A2a: on reconnect the agent reads its own receipt: the same id, the true result, and the events it missed
    w.listen(away, true); await w.tick(25);
    assert.equal(w.rule.view(away.soulId).state, 'awake', 'a listen wakes the body');
    const mine = away === Ada ? r.p : r.a, back = read(w, away, mine);
    assert.equal(back.id, mine.receipt.id); assert.equal(back.phase, 'completed'); assert.equal(back.shared.op, r.op.id); assert.equal(back.shared.result, 'arrived');
    t.diagnostic(`${who}'s stream on reconnect: ${[...new Set(streamOf(w, away).map((e) => e.kind))].join(', ')}`);
    // A2b: retries from a stale context move nothing and make no receipt
    const before = {rc: [receiptsOf(w, Ada), receiptsOf(w, Bo)], seq: lastSeq(w)};
    const replay = ok(await act(w, Bo, {capability: `accept:${r.id}`, params: {revision: 1}, clientRef: 'bo-accept-1'}));
    assert.equal(replay.receipt.id, r.a.receipt.id, 'the original accept replayed by clientRef is the same receipt');
    assert.equal(replay.receipt.shared.result, 'arrived');
    const stale = await act(w, Bo, {capability: `accept:${r.id}`, params: {revision: 1}});
    assert.equal(stale.accepted, false, `a stale accept is refused: ${JSON.stringify(stale)}`); assert.equal(stale.code, 'invite.gone'); assert.match(stale.reason, /has ended \(arrived\); nothing was started/);
    t.diagnostic(`stale accept after the end: ${stale.code}: ${stale.reason}`);
    const stop = await act(w, away, {capability: `stop-carry:${r.op.id}`});
    assert.equal(stop.accepted, false); assert.equal(stop.code, 'shared.not-running');
    assert.deepEqual([receiptsOf(w, Ada), receiptsOf(w, Bo)], before.rc, 'no new receipt for either member');
    assert.deepEqual([...events(w, 'decision'), ...events(w, 'edge-stop')].filter((e) => e.seq > before.seq), [], 'no decision or stop was logged');
    assert.equal(events(w, 'decision').filter((e) => e.steps?.some((s) => s.verb === 'mars:carry')).length, 1, 'one carry decision for the op');
    // A3a: away again, the absent Soul is never enlisted: a new proposal waits for its own accept and commits nothing
    w.listen(away, false); await w.tick(60);
    const host = away === Ada ? Bo : Ada, asked = away;
    const again = ok(await act(w, host, {capability: `carry-with:${r.beam}`, params: {to: 'yard', with: asked.name}}));
    await w.tick(200);
    const inv = inviteOf(w, again.receipt.shared.invite);
    assert.equal(inv.state, 'pending'); assert.equal(inv.shared.op, null, 'nothing committed without their accept');
    assert.deepEqual(read(w, host, again).awaitingAnswer?.waitingFor?.map((g) => g.name), [asked.name], `the proposal says who has not answered: ${JSON.stringify(read(w, host, again))}`);
    assert.deepEqual(events(w, 'decision').filter((e) => e.seq > before.seq && e.soulId === asked.soulId && e.trigger !== 'edge-body'), [], `${asked.name}'s body joined nothing`);
    // it lapses: the host's receipt ends failed invite.expired, still with nothing committed
    await until(w, () => read(w, host, again).phase !== 'waiting', 2600);
    assert.deepEqual([read(w, host, again).phase, read(w, host, again).code], ['failed', 'invite.expired'], JSON.stringify(read(w, host, again)));
    assert.equal(inviteOf(w, again.receipt.shared.invite).shared.op, null);
    // A3b: the other member and the unrelated Soul were never held up
    const next = ok(await act(w, other, {capability: walkOf(w, other, 'yard')}));
    await until(w, () => read(w, other, next).phase !== 'started' && read(w, other, next).phase !== 'waiting', 1200);
    assert.equal(read(w, other, next).phase, 'completed', `${other.name} walks on afterwards: ${JSON.stringify(read(w, other, next))}`);
    await until(w, () => read(w, Cy, cyWalk).phase !== 'started' && read(w, Cy, cyWalk).phase !== 'waiting', 1200);
    assert.equal(read(w, Cy, cyWalk).phase, 'completed', 'Cy walked meanwhile');
    assert.deepEqual(w.f.host.engine.runtime.violations, []);
  });
}

// `via`: how the faded member comes back while the crew sets the load down: a body act (refused shared.busy), or an
// accepted act outside the ledger's act path (speech, conversation: Comms' touch and its 'reclaimed' event)
for (const [who, when, via] of [['Bo', 'move', 'act'], ['Ada', 'move', 'touch'], ['Bo', 'lift', 'act'], ['Ada', 'gather', 'act']]) {
  test(`PC09 A1b/A2c: ${who} fades during ${when}; the fade is ${who}'s stop with the supported cleanup, never a cut (back by ${via})`, {timeout: 300000}, async (t) => {
    const w = await world(t), {Ada, Bo, Cy} = w.souls, away = w.souls[who], other = who === 'Bo' ? Ada : Bo;
    let faded = null, reclaim = null, busy = null, stopping = null;
    const r = await carry(w, t, async (c) => {
      if (faded === null && c.phase === when && (when !== 'move' || flat(sub(c.E[c.beam].pose.p, [w.ax + 2, 0, w.az + 1.5])) > 2)) {
        // the agent is gone past the fading clock (and past the hold an accepted carry gives, 12 h), the other is not
        w.clock.now += 13 * HOUR; w.comms.fading.touch(other.soulId); w.comms.fading.touch(Cy.soulId); w.comms.sweep();
        faded = c.n; assert.ok(w.edge.faded.has(away.soulId), `${who} faded`); assert.ok(!w.edge.faded.has(other.soulId));
      }
      if (faded !== null && !stopping && c.op.stop) {
        stopping = {op: structuredClone(c.op), mine: read(w, away, away === Ada ? c.p : c.a), theirs: read(w, other, other === Ada ? c.p : c.a)};
        // A2c: the faded member comes back while the crew sets the beam down: not relocated, refused shared.busy
        if (c.op.phase !== 'ended') {
          const rel = events(w, 'edge-relocate').length;
          if (via === 'act') reclaim = await act(w, away, {capability: walkOf(w, away)});
          else { w.comms.fading.touch(away.soulId); await w.tick(2); reclaim = {touched: true}; }
          busy = {rel: events(w, 'edge-relocate').length - rel, faded: w.edge.faded.has(away.soulId)};
        }
      }
    });
    assert.ok(faded !== null, `${who} faded during ${when}`);
    // A1b: one logged stop naming the op programme; no stop of the host's body without it
    const stops = events(w, 'edge-stop');
    assert.deepEqual(stops.map((e) => [e.programId, e.why]), [[r.programId, 'shared.away']], `the fade's only stop is the op's: ${JSON.stringify(stops)}`);
    assert.equal(stopping.op.stop.by, away.soulId); assert.equal(stopping.op.stop.away, true);
    // a stop before anything was lifted ends in the tick it is asked (the walkers just stop); otherwise kept open
    if (stopping.op.phase !== 'ended') for (const x of [stopping.mine, stopping.theirs]) {
      assert.equal(x.phase, 'started', `kept open while it is set down: ${JSON.stringify(x)}`); assert.equal(x.code, 'shared.stopping');
      assert.match(x.reason, new RegExp(`^${who} went away \\(their mind left the world\\)`), x.reason);
    }
    for (const [s, rc] of r.crew) {
      const x = read(w, s, rc);
      assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.code, 'shared.stopped');
      assert.ok(['stopped', 'stopped-at-destination'].includes(x.shared.result), x.shared.result);
      assert.equal(x.shared.stop.by, away.soulId); assert.equal(x.shared.stop.away, true);
      assert.match(x.reason, new RegExp(`^Stopped because ${who} went away`), x.reason);
      assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.stopping' && e.away === true), `${s.name}'s stream says the crew is stopping`);
      assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.stopped'), `${s.name}'s stream says it is set down`);
    }
    laidFree(w, r.beam);
    if (reclaim) {
      t.diagnostic(`reclaim while stopping: ${JSON.stringify({accepted: reclaim.accepted, code: reclaim.code})}`);
      assert.equal(busy.rel, 0, 'a reclaimed member of a running carry is not relocated'); assert.equal(busy.faded, false, 'they are back');
      if (via === 'act') { assert.equal(reclaim.accepted, false); assert.equal(reclaim.code, 'shared.busy'); assert.match(reclaim.reason, new RegExp(`${who} went away`)); }
      else {
        const fades = streamOf(w, away).filter((e) => e.kind === 'fade').map((e) => e.text);
        t.diagnostic(`${who}'s fade lines: ${JSON.stringify(fades)}`);
        assert.match(fades.at(-2) ?? '', /your body stays in the shared carry \(op_/, 'the fade says the body stays at work');
        assert.match(fades.at(-1) ?? '', /^You are back, where your body is: it is still in the shared carry/, 'no starting-place promise');
      }
    } else {
      // the stop ended it in the same tick (nothing lifted): an act now reclaims them where they are, an ordinary act
      assert.ok(w.edge.faded.has(away.soulId));
    }
    // A3a: after release, a faded Soul cannot be named in a new carry; the other member and Cy are free
    if (w.edge.faded.has(away.soulId)) {
      const named = await act(w, other, {capability: `carry-with:${r.beam}`, params: {to: 'yard', with: who}});
      // a faded Soul is not perceived, so it is not near enough to ask (the `invite.absent` words are for a Soul still listed)
      assert.equal(named.accepted, false); assert.ok(['invite.not-near', 'invite.absent'].includes(named.code), JSON.stringify(named));
    }
    const next = ok(await act(w, other, {capability: walkOf(w, other, 'yard')}));
    await until(w, () => !['started', 'waiting'].includes(read(w, other, next).phase), 1200);
    assert.equal(read(w, other, next).phase, 'completed', `${other.name} walks on: ${JSON.stringify(read(w, other, next))}`);
    assert.deepEqual(w.f.host.engine.runtime.violations, []);
  });
}

test('PC09 A1c: an hour away mid-carry is not abandonment for either member (the guest is held as the host is)', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy} = w.souls;
  let swept = false, held = null;
  const r = await carry(w, t, async (c) => {
    if (!swept && c.phase === 'move') {
      w.clock.now += 61 * MIN; w.comms.fading.touch(Cy.soulId); w.comms.sweep(); swept = true;
      held = {Ada: w.comms.fading.status(Ada.soulId), Bo: w.comms.fading.status(Bo.soulId)};
    }
  });
  t.diagnostic(`fading after an hour: ${JSON.stringify(held)}`);
  assert.ok(swept);
  assert.ok(!w.edge.faded.has(Ada.soulId) && !w.edge.faded.has(Bo.soulId), 'neither faded');
  assert.match(held.Bo.held ?? '', /^shared accept:/, 'the guest is held by the shared carry'); assert.ok(held.Ada.held, 'the host is held');
  assert.equal(r.op.result, 'arrived'); assert.deepEqual(events(w, 'edge-stop'), []);
  for (const [s, rc] of r.crew) assert.equal(read(w, s, rc).phase, 'completed');
});
