// #1015: one Soul repeating a refused solo carry at the act limit (60 tries in 60 s of world time). The native carry
// plan's refused formation search is kept (mars carry/validate.ts), so the act path does not search again each try.
// Counted in planner work (poses expanded, the engine spatial service's counters), not wall time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

test('#1015: 60 refused solo carries to a sealed vault in 60 s search once or twice in all, the same verdict every time', {timeout: 300000}, async (t) => {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick(); await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Refusal loop test'}));
  soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], ax = b.pose.p[0], az = b.pose.p[2];
  const placed = god.act({ops: [
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    // a walled garden with no way in at all
    {op: 'place', def: 'core/garden-wall@1', name: 'vault-wall', shape: {path: [[ax + 5, az - 6], [ax + 5, az - 11], [ax + 11, az - 11], [ax + 11, az - 6], [ax + 5, az - 6]]}},
    {op: 'place', def: 'core/zone@1', name: 'vault', shape: {area: [[ax + 5.6, az - 10.4], [ax + 10.4, az - 10.4], [ax + 10.4, az - 6.6], [ax + 5.6, az - 6.6]]}},
  ]});
  assert.notEqual(placed.accepted, false, JSON.stringify(placed));
  await tick(60);
  const beam = god.model.get('beam').id, sp = f.host.engine.rt.services.spatial;
  const before = {searches: sp.stats.carrySearches, expanded: sp.stats.carryExpanded, kept: sp.stats.carryRefusalsKept}, tick0 = f.host.engine.world.tick;
  const answers = [];
  for (let i = 0; i < 60; i++) {
    const r = await accept(f.host, edge.act(soul, {capability: `carry:${beam}`, params: {to: 'vault'}}));
    answers.push({accepted: r.accepted, code: r.error?.code ?? r.code, reason: r.error?.message ?? r.reason});
    await tick(20);   // one try per world second: the act limit
  }
  const searches = sp.stats.carrySearches - before.searches, expanded = sp.stats.carryExpanded - before.expanded, kept = sp.stats.carryRefusalsKept - before.kept;
  console.log(`  60 tries over ${f.host.engine.world.tick - tick0} ticks: ${searches} searches, ${expanded} poses expanded, ${kept} answered from the kept verdict; code ${answers[0].code}`);
  assert.ok(answers.every((a) => a.accepted === false), 'every try refused');
  assert.equal(answers[0].code, 'carry.no-route', JSON.stringify(answers[0]));
  assert.ok(answers.every((a) => a.code === answers[0].code && a.reason === answers[0].reason), 'the same verdict and wording every time');
  assert.ok(searches >= 1 && searches <= 2, `searched ${searches} times`);
  assert.ok(kept >= 58, `${kept} kept answers`);
  assert.ok(expanded > 0);
  assert.equal(f.host.engine.world.tick - tick0, 60 * 20, 'the world kept its ticks');
});
