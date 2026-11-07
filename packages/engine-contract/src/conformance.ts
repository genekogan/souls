// Conformance suite: every EngineFactory (the toy engine, the Mars adapter) must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EngineFactory } from './engine.ts';

export function conformance(name: string, factory: EngineFactory, drive: (e: ReturnType<EngineFactory['create']>, i: number) => void) {
  test(`${name}: determinism (same seed + same submits → same hash)`, () => {
    const run = () => { const e = factory.create(factory.genesis('seed-1')); for (let i = 0; i < 400; i++) { drive(e, i); e.step(); } return e.stateHash(); };
    assert.equal(run(), run());
  });
  test(`${name}: different seeds diverge`, () => {
    const a = factory.create(factory.genesis('seed-1')); const b = factory.create(factory.genesis('seed-2'));
    for (let i = 0; i < 100; i++) { drive(a, i); drive(b, i); a.step(); b.step(); }
    assert.notEqual(a.stateHash(), b.stateHash());
  });
  test(`${name}: snapshot/restore mid-action continues identically`, () => {
    const a = factory.create(factory.genesis('seed-3'));
    for (let i = 0; i < 150; i++) { drive(a, i); a.step(); }
    const snap = a.snapshot();
    const b = factory.restore(structuredClone(snap));
    assert.equal(b.stateHash(), a.stateHash());
    for (let i = 150; i < 400; i++) { drive(a, i); drive(b, i); a.step(); b.step(); }
    assert.equal(a.stateHash(), b.stateHash());
  });
  test(`${name}: physicalHash ignores labels and env`, () => {
    const e = factory.create(factory.genesis('seed-4'));
    const h = e.physicalHash();
    const id = Object.keys(e.world.entities)[0];
    e.world.entities[id].label = 'renamed';
    e.world.env.weather.clouds = 0.9;
    assert.equal(e.physicalHash(), h);
    assert.notEqual(e.stateHash(), h);
  });
  test(`${name}: verbs describe with JSON schema`, () => {
    const e = factory.create(factory.genesis('seed-5'));
    const verbs = e.describeVerbs();
    assert.ok(verbs.length > 0);
    for (const v of verbs) assert.equal(typeof v.inputSchema, 'object');
  });
  test(`${name}: unknown verb fails cleanly`, () => {
    const e = factory.create(factory.genesis('seed-6'));
    const r = e.submit('no_such_verb', {});
    assert.equal(r.status, 'failed');
    assert.equal(r.diagnostic?.code, 'action.unknown-verb');
  });
}

/** For an engine that declares rules (#1150). `force` arranges for the next step's move to break one, by the engine's own
 *  means. The step refuses it: no violation is left, the refusal is reported, and a second run makes the same one. */
export function refusalConformance(name: string, factory: EngineFactory, force: (e: ReturnType<EngineFactory['create']>) => void) {
  test(`${name}: a refusable move is refused inside the step`, () => {
    const run = () => { const e = factory.create(factory.genesis('seed-7')); force(e); const seen = e.runtime.violations.length, out = e.step(); return { e, out, seen }; };
    const a = run(), b = run();
    assert.equal(a.e.runtime.violations.length, a.seen);
    assert.ok(a.out.refusals?.length);
    assert.deepEqual(a.out.refusals, b.out.refusals);
    assert.equal(a.e.stateHash(), b.e.stateHash());
  });
}
