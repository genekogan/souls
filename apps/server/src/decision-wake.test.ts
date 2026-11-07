// A wake that lands while a Soul's decision is queued is kept when the decision applies.
// The DJ story (sync.test.ts) failed this way: Wren decided "wait" just before Rob said yes; the yes woke her, but her
// "wait" applied a tick later and overwrote the wake with its own 200-tick re-think, so Rob ended the gathering first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

function world() {
  const db = new Db(':memory:');
  const host = new WorldHost(db, toyFactory, 'wake', 1e9); host.boot();
  void host.enqueue('birth', 'test', { soulId: 's_W', entityId: 'h_W', name: 'Wren', description: 'x', owner: 'system' });
  host.drainInputs();
  const m = host.minds.get('s_W')!;
  return { db, host, m };
}
const wait = { soulId: 's_W', entityId: 'h_W', option: 'continue', label: 'waiting', steps: [], continue: true, reevalTicks: 200, fallback: false, trigger: 'plan-advanced' };

test('a decision applied after a wake keeps the sooner wake (and its reason)', () => {
  const { db, host, m } = world();
  const t0 = host.engine.world.tick;
  m.nextEvalTick = t0 + 600; host.provisionalEval.set('s_W', m.nextEvalTick);   // the brain queued "wait", provisional
  m.nextEvalTick = Math.min(m.nextEvalTick, t0 + 12); m.evalTrigger = 'spoken-to'; // then Rob's yes woke her
  void host.enqueue('decision', 'brain:reflex', wait); host.drainInputs();
  assert.equal(m.nextEvalTick, t0 + 12, 'the wake is not overwritten by the decision\'s own re-think');
  assert.equal(m.evalTrigger, 'spoken-to');
  assert.equal(host.provisionalEval.has('s_W'), false);
  db.close();
});

test('without a wake (or with no provisional) the decision sets the re-think as before', () => {
  const { db, host, m } = world();
  const t0 = host.engine.world.tick;
  m.nextEvalTick = t0 + 600; host.provisionalEval.set('s_W', m.nextEvalTick);
  void host.enqueue('decision', 'brain:reflex', wait); host.drainInputs();
  const t1 = host.engine.world.tick;
  assert.equal(m.nextEvalTick, t1 + 200); assert.equal(m.evalTrigger, 'timer');
  m.nextEvalTick = t1 + 5; // replay or another author: no provisional, the decision's timing stands
  void host.enqueue('decision', 'edge:s_W', wait); host.drainInputs();
  assert.equal(m.nextEvalTick, host.engine.world.tick + 200);
  db.close();
});
