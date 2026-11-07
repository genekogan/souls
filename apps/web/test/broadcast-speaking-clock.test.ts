// DIRECTOR2: the dialogue dock stamps speakingNow on the performance.now() clock; the broadcast directs on wall seconds.
// A conversation that is speaking now must reach the director as recent (it was decades old before the conversion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldBroadcast } from '../src/WorldBroadcast.ts';
import { speakingNow } from '../src/dialogue-speaking.ts';

test('DIRECTOR2: a Soul speaking now is a conversation for the broadcast, whatever the clocks', () => {
  const g = globalThis as unknown as { __soulsBroadcastCuts?: { key: string }[] };
  g.__soulsBroadcastCuts = [];
  const b = new WorldBroadcast();
  b.hints = () => ({ soulEntity: (s: string) => ({ s_a: 'h_a', s_b: 'h_b' } as Record<string, string>)[s] ?? null, eden: false, daylight: 1, views: [] });
  const now = performance.now();
  speakingNow.set('s_a', { colour: '#fff', since: now - 2000, thread: 'c1', text: 'hello' });
  speakingNow.set('s_b', { colour: '#fff', since: now - 500, thread: 'c1', text: 'hi' });
  const frame = { h_a: { p: [0, 1, 0], activity: 'idle' }, h_b: { p: [1.5, 1, 0], activity: 'idle' } };
  const records = { h_a: { kind: 'human' }, h_b: { kind: 'human' } };
  try { b.sample(frame as never, records as never, {} as never, 10, 0.1, 16 / 9, Date.now() / 1000, 0.016); } catch { /* framing needs a real scene; the choice is made first */ }
  speakingNow.clear();
  assert.match(g.__soulsBroadcastCuts.at(-1)?.key ?? '', /^conversation:c1$/);
});
