// A model-free stand-in for the Codex app server (#487). It speaks just enough of the protocol for the real CodexHost, and
// answers each turn with a decision: a `say` carrying a fresh nonce, then a short `wait`. The nonce is what makes a duplicate
// countable: two world rows with one nonce are one logical write sent twice. It thinks about nothing, so it proves the
// runtime's recovery path and says nothing about how an agent behaves.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const send = (v) => process.stdout.write(JSON.stringify(v) + '\n');
const decision = (n) => JSON.stringify(n % 2
  ? { plan: 'Say one beat, then wait', call: { type: 'write', command: 'say', arguments: JSON.stringify({ text: `beat ${randomUUID()}` }) }, wakeAt: null }
  : { plan: 'Wait a moment', call: { type: 'wait', command: 'wait', arguments: JSON.stringify({ seconds: 2 }) }, wakeAt: null });
let thread = null, turns = 0;
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line), p = m.params ?? {};
  if (m.id === undefined) continue;
  if (m.method === 'thread/start' || m.method === 'thread/resume') {
    // A resume keeps the id it was given, and a start makes a new one, so an unchanged id means the thread really resumed.
    thread = p.threadId ?? `thread-${randomUUID()}`; send({ id: m.id, result: { thread: { id: thread } } });
  } else if (m.method === 'turn/start') {
    const id = `turn-${++turns}`, item = `item-${turns}`, text = decision(turns);
    send({ id: m.id, result: { turn: { id, status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: thread, turn: { id, status: 'inProgress' } } });
    send({ method: 'item/started', params: { threadId: thread, turnId: id, item: { id: item, type: 'agentMessage' } } });
    send({ method: 'item/completed', params: { threadId: thread, turnId: id, item: { id: item, type: 'agentMessage', text } } });
    send({ method: 'turn/completed', params: { threadId: thread, turn: { id, status: 'completed' } } });
  } else send({ id: m.id, result: {} });
}
