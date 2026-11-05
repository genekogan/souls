import test from 'node:test';
import assert from 'node:assert/strict';
import { godAgentState } from '../src/god-ui/god-agent-state.ts';

// #662: only a paired agent the inbox reports connected is green; nothing else ever looks connected.
test('God button: green only when paired and connected', () => {
  assert.deepEqual(godAgentState(false, null), { live: 'off', words: 'agent not connected' });
  assert.deepEqual(godAgentState(true, null), { live: 'unknown', words: 'agent status loading' });
  assert.deepEqual(godAgentState(true, null, true), { live: 'unknown', words: 'agent status unavailable' });
  assert.deepEqual(godAgentState(true, { connected: false }), { live: 'off', words: 'agent not connected' });
  assert.deepEqual(godAgentState(true, { connected: true }), { live: 'on', words: 'agent connected' });
  assert.deepEqual(godAgentState(false, { connected: true }), { live: 'off', words: 'agent not connected' }, 'not paired: a stale inbox is not trusted');
  assert.equal(godAgentState(true, { connected: true }, false, 2).words, 'agent connected, 2 pairing requests');
});
