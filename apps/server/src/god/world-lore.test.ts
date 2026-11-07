// F3 (rehearsal item 15): a god's new world serves no Eden lore. Arrival lore is the god's constitution (or a neutral
// line before there is one); reading reads the constitution or a god-built sign; Eden's commons lore and library
// ("A Field Guide to Eden's Gardens") never reach its Souls. Real host, sequencer, edge ledger and bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { NEW_WORLD_LORE } from './world-lore.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('a new world tells its Souls its constitution (or that it is new), never Eden\'s lore or books', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: (m) => { if (process.env.F3_DBG) console.log("BR", m); }, worldLore: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  assert.equal((god.act({ ops: [
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [8, 8] },
    { op: 'place', def: coreRef('sign'), name: 'welcome-sign', p: [2, 2], state: { text: 'Welcome to Test Hill' } },
  ] }, 'a fountain and a sign') as any).accepted, true);
  await settle(3);
  const souls: any[] = [];
  for (const name of ['ana', 'ben']) {
    await invite(f, name);
    const row: any = await accept(f.host, f.souls.create(`dev:${name}`, { name, description: 'a guest' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle(3);
  const [ana, ben] = souls;
  const run = async (s: any, id: string) => { for (let i = 0; i < 6000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const r: any = edge.receipt(s.soulId, id); if (r?.outcome) return r; } } return edge.receipt(s.soulId, id); };
  const act = async (s: any, capability: string, params?: any) => { const a: any = await accept(f.host, edge.act(s, { capability, ...(params ? { params } : {}) })); assert.equal(a.accepted, true, JSON.stringify(a)); return run(s, a.receipt?.id ?? a.receiptId ?? a.id); };
  const eden = /commons|Eden|Field Guide/;

  // before a constitution: the neutral line, once
  const w1: any = await act(ana, 'walk:fountain');
  assert.equal(w1.phase, 'completed', JSON.stringify(w1));
  assert.equal(w1.outcome.detail.firstVisit?.lore, NEW_WORLD_LORE, JSON.stringify(w1.outcome));
  assert.doesNotMatch(JSON.stringify(w1.outcome), eden);
  const w2: any = await act(ana, 'walk:welcome-sign');
  assert.equal(w2.outcome.detail.firstVisit, undefined, 'arrival lore is told once');

  // reading: the offer is not "the book you carry"; a sign reads its words; reading here reads about the world
  const caps = edge.capabilities(ana);
  assert.ok(!caps.some((c: any) => /book you carry/.test(c.label)), caps.filter((c: any) => c.verb === 'read').map((c: any) => c.label).join(' | '));
  const sign = [...god.model.entities.values()].find((e: any) => e.name === 'welcome-sign') as any;
  // a sign's words (the read:<sign> offer is F1's perceive.ts; the outcome is ours)
  const out: any = { detail: {}, learned: [], untrusted: false };
  (edge.outcomes as any).readPassage({ soulId: ana.soulId, capability: `read:${sign.id}`, params: {} }, out);
  assert.match(out.summary, /Welcome to Test Hill/);
  assert.equal(out.untrusted, true, "the god's words are untrusted");
  assert.doesNotMatch(JSON.stringify(out), eden);
  const readCap = caps.find((c: any) => c.verb === 'read' && c.id !== `read:${sign.id}`);
  if (readCap) {
    const rh: any = await act(ana, readCap.id, { seconds: 5 });
    assert.equal(rh.outcome.detail.passage, NEW_WORLD_LORE, JSON.stringify(rh.outcome));
    assert.doesNotMatch(JSON.stringify(rh.outcome), eden);
  }

  // the god writes a constitution: the next Soul to arrive is told it
  assert.equal((god.act({ ops: [{ op: 'world', state: { constitution: 'Be kind. Three prayers a day.' } }] }, 'constitution') as any).accepted, true);
  await settle(2);
  const b1: any = await act(ben, 'walk:fountain');
  assert.equal(b1.outcome.detail.firstVisit?.lore, 'Be kind. Three prayers a day.', JSON.stringify(b1.outcome));
  assert.equal(b1.outcome.detail.firstVisit?.source, 'world-constitution');
  assert.doesNotMatch(JSON.stringify(b1.outcome), eden);
});
