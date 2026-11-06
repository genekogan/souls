import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStart, runFixtureSetup } from './fixture-setup.mjs';
test('setup bounds use physical position and wrap headings; missing evidence fails', () => {
  assert.deepEqual(checkStart({ pos: [1, 0], heading: 359, posture: 'standing' }, { pos: [0, 0], radiusM: 2, heading: 0, posture: ['standing'] }), []);
  assert.equal(checkStart({}, { pos: [0, 0], heading: 0, posture: ['standing'] }).length, 3);
});
test('setup cannot pass refused/incomplete acts and does not send owner requests', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'sim-setup-'));
  for (const data of [{ accepted: false }, { accepted: true, receipt: { phase: 'running' } }]) {
    const r = await runFixtureSetup({ runDir, requestKey: 'a', setup: { steps: ['walk:plaza'] }, seat: { chain: Promise.resolve(), cliJson: async args => { assert.ok(args.includes('none')); return { ok: true, data }; } } });
    assert.equal(r.ok, false);
  }
  const calls = [];
  const r = await runFixtureSetup({ runDir, requestKey: 'b', setup: { steps: ['stand:here'], expect: { heading: 90 } }, seat: { chain: Promise.resolve(), cliJson: async args => { calls.push(args); return { ok: true, data: args[0] === 'act' ? { accepted: true, receipt: { phase: 'completed' } } : { me: { heading: 90 } } }; } } });
  assert.equal(r.ok, true); assert.equal(calls.length, 2);
});

test('stable-path binding ignores prose aliases and fails for missing fixture targets', async () => {
  const { bindJourneyFixtures } = await import('./fixture-bindings.mjs');
  const s = { director: { script: [{ id: 'podium', expect: { journey: { phases: [{ receipt: { targetRefs: ['hall/chair'] } }] } } }] } };
  const snapshot = { entities: [{ id: 'building', name: 'hall', in: { parent: 'world' } }, { id: 'true-chair', name: 'chair', in: { parent: 'building' } }, { id: 'fake-chair', name: 'other', about: { aliases: ['hall/chair'] }, in: { parent: 'world' } }] };
  const bound = bindJourneyFixtures(s, snapshot);
  assert.equal(bound.bindings[0].id, 'true-chair');
  assert.deepEqual(s.director.script[0].expect.journey.phases[0].receipt.targetIds, ['true-chair']);
  assert.throws(() => bindJourneyFixtures(s, { entities: [] }), /required entity/);
});

test('alternative fixture receipt targets bind independently', async () => {
  const {bindJourneyFixtures}=await import('./fixture-bindings.mjs');
  const phases=[{anyOf:[{receipt:{targetRefs:['chair-a']}},{receipt:{targetRefs:['chair-b']}}]}];
  bindJourneyFixtures({director:{script:[{id:'seats',expect:{journey:{phases}}}]}},{entities:[{id:'a',name:'chair-a'},{id:'b',name:'chair-b'}]});
  assert.deepEqual(phases[0].anyOf.map(p=>p.receipt.targetIds),[['a'],['b']]);
});

test('setup refuses malformed or nonfinite position and heading',()=>{
 for(const pos of [[],[1],[NaN,NaN],[0,Infinity],[0,0,0,0],{x:0,z:NaN}]) assert.equal(checkStart({pos},{pos:[0,0]}).length,1);
 for(const heading of [NaN,Infinity,undefined,'0']) assert.equal(checkStart({heading},{heading:0}).length,1);
});

test('measurement setup uses frozen transport, leaving the model served CLI unchanged', async()=>{
 const runDir=mkdtempSync(join(tmpdir(),'sim-setup-')); let calls=0;
 const r=await runFixtureSetup({runDir,requestKey:'frozen',setup:{steps:[{verb:'turn',heading:90}],expect:{heading:90}},seat:{chain:Promise.resolve(),cliJson:async()=>{throw Error('baseline model CLI must not run setup');},fixtureCliJson:async args=>{calls++;return {ok:true,data:args[0]==='act'?{accepted:true,receipt:{phase:'completed'}}:{me:{heading:90}}};}}});
 assert.equal(r.ok,true);assert.equal(calls,3,'resolve, act, here');
});
