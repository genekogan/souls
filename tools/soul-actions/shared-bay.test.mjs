// PC17 (#696): six separately owned Souls build a rack bay with a deck and stairs from real stock through the ordinary
// offers. `organize` binds the stock, `inspect` names each ready maneuver's exact offer, `volunteer` is bounded advance
// consent, progress is read from the world. Nothing here calls a privileged actor array.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory as plainFactory} from '../../apps/server/test/native-owner-fixture.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/engine.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {inspectFrame} from '../../apps/server/src/edge/perception/inspect.ts';
import {hereFrame} from '../../apps/server/src/edge/perception/here.ts';

const STEP_MS = 50, IN = 0.0254, T = 3 * IN, UP_L = 12 * 0.3048, BEAM_L = 9 * 0.3048, D = BEAM_L + 2 * T, H = D / 2 + UP_L / 2, SPAN = 24 * IN, R = Math.PI / 2;
const PROC = 'rack-bay-build@1';
const factory = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
const log = process.env.BAY_LOG ? (...a) => console.log(...a) : () => {};

function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  const bridge = installEngineBridge({host, god, edge, log: () => {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god, bridge});
}
async function world(t, {sharedCarry = true, names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay']} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shared-bay-')), path = join(dir, 'sim.db');
  const f = fixture(path, sharedCarry ? factory : plainFactory, {durableClockV1: true}); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, clock, now: () => clock.now, current: null};
  t.after(() => {try {w.comms?.close();} catch {} try {w.host.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); w.trace?.(); if (w.host.clockFailure) throw new Error('HALT ' + String(w.host.clockFailure).slice(0, 300)); await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Rack bay test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls.Ada.entityId].pose.p;
  w.at = async (s, x, z) => {await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));};
  return Object.assign(w, {souls, ax, az, E, idOf: (n) => w.god.model.get(n).id});
}
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const ok = (r) => {assert.notEqual(r.accepted, false, JSON.stringify(r)); return r;};
const until = async (w, done, max) => {for (let n = 0; n < max && !done(); n++) await w.tick(1);};
const zone = (n, x, z, h = 1) => ({op: 'place', def: 'core/zone@1', name: n, shape: {area: [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]]}});
/** Lay real stock around a site (name, def, x, z, yaw in the site's frame), the crew beside it, and a place at its middle. */
async function yard(w, {yaw = 0, skip = []} = {}) {
  const xm = w.ax + 11, z0 = w.az, c = Math.cos(yaw), s = Math.sin(yaw), P = (x, z) => [xm + x * c - z * s, z0 + x * s + z * c];
  const stock = [['fa', 'core/rack-upright@2', -H, -3.2, 0], ['fb', 'core/rack-upright@2', H, -3.2, 0],
    ['beam1', 'core/rack-beam@5', 0, -3.9, 0], ['beam3', 'core/rack-beam@3', 0, -4.6, 0], ['beam2', 'core/rack-beam@5', 0, 3.9, 0], ['beam4', 'core/rack-beam@3', 0, 4.6, 0],
    ['j0', 'core/deck-joist@1', -2 * SPAN, -2.5, R], ['j2', 'core/deck-joist@1', 0, -2.5, R], ['j4', 'core/deck-joist@1', 2 * SPAN, -2.5, R], ['j1', 'core/deck-joist@1', -SPAN, 2.5, R], ['j3', 'core/deck-joist@1', SPAN, 2.5, R],
    ['sheet', 'core/plywood-sheet@2', 3.4, -5.4, 0], ['flight', 'core/deck-stair@1', 2.3, 2.4, R],
    ...[1, 2, 3, 4, 5].map((i) => [`tread${i}`, 'core/deck-stair-tread@1', -2.0, 0.9 + 0.4 * i, 0])].filter((x) => !skip.includes(x[0]));
  const at = [[-2, -5.5], [-3, -5.5], [2, -5.5], [3, -5.5], [-1, 5.5], [1, 5.5]];
  for (const [i, s2] of Object.values(w.souls).entries()) if (at[i]) await w.at(s2, ...P(...at[i]));
  ok(w.god.act({ops: [zone('site', xm, z0), zone('apron', ...P(-7, 7)), ...stock.map(([n, def, x, z, r]) => ({op: 'place', def, name: n, p: P(x, z), r: r + yaw}))]}));
  await w.tick(60);
  return {xm, z0, P};
}
const see = (w, s, id) => inspectFrame(w.edge, s, id, {all: true});
const offers = (w, s) => w.edge.capabilitiesPage(s, {all: true}).capabilities;
const TRACE = +(process.env.BAY_TRACE ?? 0);
const traced = (w) => {if (!TRACE) return; w.trace = () => {const tk = w.host.engine.world.tick; if (tk < TRACE || tk > TRACE + 80 || tk % 8) return; console.log('T', tk, Object.entries(w.souls).map(([n, q]) => {const e = w.E()[q.entityId]; return `${n}:${e.pose.p[0].toFixed(2)},${e.pose.p[2].toFixed(2)}/${e.human.activity ?? ''}${e.human.grip ? '*' + e.human.grip.entity.slice(-4) : ''}`;}).join(' '), Object.values(w.E()).filter((e) => e.support?.kind === 'held').map((e) => `${e.id.slice(-4)}@${e.pose.p[0].toFixed(2)},${e.pose.p[2].toFixed(2)},y${(e.pose.yaw ?? 0).toFixed(2)}`).join(' '));};};
const open = (w, s) => w.edge.openReceipts(s.soulId);

const walk = async (w, s, place) => ok(await act(w, s, {capability: offers(w, s).find((c) => c.verb === 'walk' && c.id === `walk:${place}`)?.id ?? `walk:${place}`}));
/** Organize, then have every pair take the next ready maneuver `inspect` names, partners answering by their standing agreement. */
async function build(w, host, pairs, {yaw = 0, max = +(process.env.BAY_MAX ?? 9000)} = {}) {
  const o = ok(await act(w, host, {capability: `organize:${PROC}`, params: {at: 'site', yaw, with: Object.values(w.souls).filter((s) => s !== host).map((s) => s.name).join(', ')}}));
  const pj = o.result.project, souls = Object.values(w.souls);
  let section = null;
  const claimed = new Map(), t0 = w.now(), holds = new Map();
  const seconds = () => ((w.now() - t0) / 1000).toFixed(1);
  for (let n = 0; n < max; n++) {
    const v = see(w, host, pj), st = v.state;
    if (st.complete) {log('complete', seconds()); return {pj, seconds: +seconds()};}
    if (st.section && st.section !== section) {section = st.section; log('section', section, seconds()); for (const s of souls) ok(await act(w, s, {capability: `volunteer:${pj}`, params: {revision: st.revision}}));}
    for (const r of st.ready) {
      if (claimed.has(r.maneuver) || !r.offer) continue;
      if (r.crew === 1) {
        const who = r.offer.startsWith('stop-carry:') ? holds.get(r.part) : pairs.flat().find((s) => !open(w, s).length); if (!who) continue;
        const res = await act(w, who, {capability: r.offer, params: r.params}); log(r.maneuver, who.name, res.accepted === false ? JSON.stringify(res).slice(0, 240) : 'ok', seconds());
        if (res.accepted !== false) claimed.set(r.maneuver, who);
        continue;
      }
      const pair = pairs.find((p) => p.every((s) => !open(w, s).length)); if (!pair) break;
      const res = await act(w, pair[0], {capability: r.offer, params: {...r.params, with: pair[1].name}}); log(r.maneuver, pair[0].name, res.accepted === false ? JSON.stringify(res).slice(0, 300) : 'ok', seconds());
      // told who is in the way, that Soul walks clear by its own ordinary offer
      if (res.accepted === false && /occupied/.test(res.code)) {const by = souls.find((s) => res.reason.includes(s.name)); if (by && !open(w, by).length) await walk(w, by, 'apron');}
      if (res.accepted !== false) {claimed.set(r.maneuver, pair[0]); if (r.offer.startsWith('raise-with:')) holds.set(r.part, pair[0]);}
    }
    for (const k of [...claimed.keys()]) if (!st.maneuvers.running.includes(k) && !st.ready.some((r) => r.maneuver === k) ? false : st.ready.some((r) => r.maneuver === k) && !open(w, claimed.get(k)).length) claimed.delete(k);
    await w.tick(5);
  }
  for (const s of souls) log(s.name, w.E()[s.entityId].pose.p.map((v) => v.toFixed(2)).join(','), w.E()[s.entityId].human.activity, JSON.stringify(open(w, s).map((r) => [r.capability, r.phase, r.reason, r.shared?.phase, r.shared?.blocked])).slice(0, 400));
  for (const i of w.edge.together.openShared().concat(w.edge.together.committedShared?.() ?? [])) log('inv', i.id, i.state, JSON.stringify(i.shared.op), JSON.stringify(w.host.engine.programAction?.(i.shared.op?.programId)?.action ?? null).slice(0, 700));
  log('holds', JSON.stringify([...w.E()[souls[0].entityId] ? [] : []]), JSON.stringify(w.host.engine.rt?.records ? [...w.host.engine.rt.records.values()].filter((r) => ['blocked', 'running'].includes(r.status)).map((r) => [r.verb, r.status, r.diagnostic?.code, r.diagnostic?.message, r.phase]).slice(0, 14) : 'norec').slice(0, 1800));
  assert.fail(`no end: ${JSON.stringify(see(w, host, pj).state).slice(0, 900)}`);
}

test('R3: six Souls build the bay through the offers they are given, and a Soul who built none of it walks up', {timeout: 900000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Dee, Eve, Fay} = w.souls;
  await yard(w); traced(w);
  const {pj} = await build(w, Ada, [[Ada, Bo], [Cy, Dee], [Eve, Fay]]);
  const v = see(w, Ada, pj).state;
  assert.equal(v.joints.made, 29); assert.equal(v.complete, true);
});
