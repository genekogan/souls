// GOVERN (lane C17): residents govern through the edge contract. Real host, sequencer, edge ledger, bridge and world
// lore: a Soul proposes an amendment and another supports it (capabilities, completed receipts), the god decides, an
// arriving Soul is told the constitution changed since it last saw it (once), and the read offer names the version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { installGovernance } from './governance-edge.ts';
process.env.SIM_GOD_FEATURES = 'constitution';   // G5: switched off by default (tools/god-skill/lib/features.mjs); this file tests it

/* eslint-disable @typescript-eslint/no-explicit-any */
test('residents propose and support amendments on the edge; the god decides; arrivals hear the constitution changed', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: true });
  const gov = installGovernance(god, { host: f.host, edge, edgeHooks: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  assert.equal((god.act({ ops: [
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [8, 8] },
    { op: 'place', def: coreRef('bench'), name: 'bench', p: [-8, 4] },
    { op: 'world', state: { constitution: '# Test Hill\n\nBe kind.' } },
  ] }, 'a fountain, a bench, a constitution') as any).accepted, true);
  await settle(3);
  const souls: any[] = [];
  for (const name of ['ana', 'ben', 'cy']) {
    await invite(f, name);
    const row: any = await accept(f.host, f.souls.create(`dev:${name}`, { name, description: 'a resident' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle(3);
  const [ana, ben] = souls;
  assert.equal(gov.residents().length, 3, 'the Souls living here are the active residents');
  const run = async (s: any, id: string) => { for (let i = 0; i < 6000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const r: any = edge.receipt(s.soulId, id); if (r?.outcome) return r; } } return edge.receipt(s.soulId, id); };
  const act = async (s: any, capability: string, params?: any) => { const a: any = await accept(f.host, edge.act(s, { capability, ...(params ? { params } : {}) })); assert.equal(a.accepted, true, JSON.stringify(a)); return a; };
  const walk = async (s: any, to: string) => { const a = await act(s, `walk:${to}`); return run(s, a.receipt?.id ?? a.receiptId ?? a.id); };

  // arrival tells the constitution once (world lore) and that counts as seen
  const w1: any = await walk(ana, 'fountain');
  assert.equal(w1.outcome.detail.firstVisit?.source, 'world-constitution', JSON.stringify(w1.outcome));
  assert.equal(w1.outcome.detail.constitutionChanged, undefined);
  assert.equal(gov.seenBy(ana.soulId, false).lastSeen, 1);

  // propose: a capability for everyone; a completed receipt at once
  const caps = edge.capabilities(ana);
  const propose = caps.find((c: any) => c.id === 'propose-amendment');
  assert.ok(propose?.available, caps.map((c: any) => c.id).join(' '));
  // CTRL-1 (#1093): its id has no target, and the strict gate takes it by exact id; `text` is required, as its schema says
  assert.equal(edge.offerGate(ana, { capability: 'propose-amendment', params: { text: 'x' } }), null);
  assert.equal((propose as any).params.text.required, true);
  const p: any = await act(ana, 'propose-amendment', { text: 'Anyone may rest on the bench as long as they like.', title: 'Bench rest' });
  assert.equal(p.receipt.phase, 'completed', JSON.stringify(p));
  const id = p.result.amendment.id;
  // another resident sees an offer to support it; the proposer sees one to withdraw it
  await settle(1);
  const benCaps = edge.capabilities(ben);
  const sup = benCaps.find((c: any) => c.id === `support:${id}`);
  assert.ok(sup, benCaps.map((c: any) => c.id).join(' '));
  assert.match(sup!.label, /Bench rest.*proposed by ana.*1 support/);
  assert.ok(edge.capabilities(ana).some((c: any) => c.id === `withdraw-amendment:${id}`));
  assert.ok(!edge.capabilities(ana).some((c: any) => c.id === `support:${id}`), 'no offer to support your own');
  const s: any = await act(ben, `support:${id}`);
  assert.equal(s.result.amendment.support, 2);
  await settle(1);
  assert.ok(edge.capabilities(ben).some((c: any) => c.id === `unsupport:${id}`));
  const bad: any = await accept(f.host, edge.act(ben, { capability: 'support:am_nope' }));
  assert.equal(bad.accepted, false);
  assert.equal(bad.code, 'not-found');

  // the god accepts: a new version; Ana, arriving again, is told it changed (once)
  assert.equal(gov.decide(id, { decision: 'accept' }).version, 2);
  await settle(2);
  const w2: any = await walk(ana, 'bench');
  const changed = w2.outcome.detail.constitutionChanged;
  assert.equal(changed?.from, 1, JSON.stringify(w2.outcome));
  assert.equal(changed?.to, 2);
  assert.match(changed.text, /Amendment 1: Bench rest/);
  assert.match(changed.why, /accepted amendment/);
  const w3: any = await walk(ana, 'fountain');
  assert.equal(w3.outcome.detail.constitutionChanged, undefined, 'told once');
  // the read offer names the version
  const read = edge.capabilities(ben).find((c: any) => c.verb === 'read' && /constitution/.test(c.label));
  if (read) assert.match(read.label, /version 2/);
});
