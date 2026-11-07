// A fake world + fake seats for the swarm orchestrator: card messages make the fake agents walk to the room or speak
// after a latency, on a virtual clock. No world, browser or model.
import { fakeClock } from '../../fakes.mjs';
import { normalizeCast } from '../cast.mjs';

export { fakeClock };
export const WALL0 = Date.parse('2026-10-26T04:00:00Z');
export const HALL = ['hall', 'library', 'World'];
export const FIELD = ['commons', 'Green field', 'World'];

export function testCast(over = {}) {
  const ids = over.ids ?? ['ann', 'bob', 'cy'];
  return normalizeCast({
    kind: 'cast', name: 'test-trio', brief: 'Three friends give short talks in the hall.',
    world: { kind: 'dev', genesis: 'worlds/templates/eden-district.json' },
    room: { label: 'the library hall', match: ['hall'] },
    seats: ids.map((id) => ({ id, soulName: id[0].toUpperCase() + id.slice(1), character: `${id} is a test character.`, topic: `${id}'s favourite rock` })),
    timing: { truthPollSec: 5, nudgeAfterSec: 60, gatherMaxSec: 600, quietSec: 20, speakTimeoutSec: 120, maxSpeakNudges: 1, presentWaitSec: 60, ...(over.timing ?? {}) },
    durationSec: over.durationSec ?? 3600,
    observer: { sampleSec: 10 },
    ...(over.cast ?? {}),
  });
}

/**
 * The fake world: souls with a placePath and speech events; an owner inbox per soul; agents that react to cards.
 * behaviour per seat: {latencyMs=30000, ignoreFirstGather, silent, speakOnPrepare, lines=1, unpaired}
 */
export function fakeWorld({ clock, cast, behaviour = {} }) {
  const wall = () => WALL0 + clock.now();
  const souls = {}; const inbox = {}; const sent = []; let n = 0;
  const seats = {};
  for (const s of cast.seats) {
    const b = { latencyMs: 30000, lines: 1, ...(behaviour[s.id] ?? {}) };
    const soulId = `s_${s.id}`;
    souls[soulId] = { placePath: FIELD, speech: [], gathers: 0 };
    inbox[soulId] = [];
    const info = { id: s.id, soulName: s.soulName, soulId: b.unpaired ? null : soulId, ownerIdentity: `agent-${s.id}` };
    const chats = [];
    seats[s.id] = {
      info, rails: { maxTurnsPerRequest: 6, maxTurnWallSec: 240 }, chats, b, notes: 0,
      noteRequest() { this.notes += 1; }, save() {}, wakeLoop() { this.waking = true; return true; },
      async chat(text) { chats.push({ text, at: clock.now() }); await clock.sleep(b.latencyMs); if (b.pairAfterNudge) b.paired = true; return { turn: chats.length }; },
      async status() { return b.paired ? { ok: true, data: { paired: true, soul: { id: soulId, name: s.soulName } } } : { ok: true, data: { paired: false } }; },
    };
  }
  const say = (soulId, text) => souls[soulId].speech.push({ at: wall(), tick: clock.now() / 1000, kind: 'speech', channel: 'public', text });
  async function react(soulId, msg) {
    const id = soulId.slice(2); const b = seats[id].b; const sw = souls[soulId];
    await clock.sleep(b.latencyMs);
    msg.state = 'acknowledged'; msg.reply = 'on it'; msg.acknowledgedAt = wall();
    const t = msg.text;
    const isGather = /Walk \w+ to the library hall now and wait/.test(t);
    if (isGather || /Walk there now|Go back there now/.test(t)) {
      if (isGather) sw.gathers += 1;
      if (b.ignoreFirstGather && isGather && sw.gathers === 1) return;
      await clock.sleep(10000); sw.placePath = HALL;
    }
    if (b.leaveAfterGather && sw.placePath === HALL && !b.left) { b.left = true; await clock.sleep(5000); sw.placePath = FIELD; }
    const turn = /^Your turn|turn now: say the talk/.test(t);
    // speaksOnAny: an eager agent that talks on every card unless the card carries the hold guard (obeysGuard).
    const eager = b.speaksOnAny && !(b.obeysGuard && t.includes('Do not say it yet; wait until I write "your turn".'));
    if ((turn && !b.silent) || (b.speakOnPrepare && /is next/.test(t)) || (eager && !turn)) {
      const m = t.match(/in character: (.*?) Then stop/) ?? (eager && !turn ? t.match(/: (.*?)(?: Do not say it yet|$)/) : null);
      const body = m ? m[1] : `Hello everyone, I am ${id} and this is my talk about my favourite rock, which is grey.`;
      for (let i = 0; i < b.lines; i++) { say(soulId, i ? `And one more thing from ${id}: rocks are older than all of us here.` : body); await clock.sleep(4000); }
      msg.state = 'acknowledged'; msg.outcome = 'done'; msg.result = 'gave the talk'; msg.resultAt = wall();
    }
  }
  const owner = {
    sent,
    async sendCard({ soulId, text }) { const m = { id: `msg_${++n}`, text, state: 'delivered', sentAt: wall() }; inbox[soulId].push(m); sent.push({ soulId, ...m, mono: clock.now() }); react(soulId, m); return { messageId: m.id }; },
    async cardView({ soulId }) { const l = inbox[soulId].at(-1); return { latest: l ? { ...l } : null, presence: 'listening' }; },
  };
  const truth = {
    async soul(soulId) { const s = souls[soulId]; return { soulId, ok: true, placePath: s.placePath, posture: 'standing', speech: s.speech.map((e) => ({ atMs: e.at, tick: e.tick, text: e.text, channel: e.channel })) }; },
  };
  const observerTruth = { async snapshotSoul({ soulId }) { const l = inbox[soulId].at(-1); return { t: new Date(wall()).toISOString(), mono: clock.now(), place: souls[soulId].placePath[0], placePath: souls[soulId].placePath, inbox: { latest: l ? { ...l } : null }, receipts: [] }; } };
  return { souls, seats, owner, truth, observerTruth, wall };
}

/** Fake arena/observer modules recording what was created and stopped. onCard(n) runs on the n-th card sent. */
export function fakeDirectModules({ onCard = () => {} } = {}) {
  const made = [], stopped = [];
  let cards = 0, pid = 900000;
  const modules = {
    provision: {
      startWorld: async ({ onSpawn, port }) => { const child = { pid: ++pid }; made.push(`world:${child.pid}`); onSpawn?.(child); return { base: 'http://127.0.0.1:9', pid: child.pid, port }; },
      describeWorld: async () => { throw new Error('fake world'); }, healthz: async () => { throw new Error('fake world'); },
      stopWorld: async ({ pid: p }) => { stopped.push(`world:${p}`); return { stopped: true }; },
    },
    seat: { createSeat: ({ seat }) => { made.push(`seat:${seat.id}`); const info = { id: seat.id, soulName: seat.soulName, soulId: null, ownerIdentity: `o-${seat.id}` };
      return { info, dir: `seats/${seat.id}`, onboard: async () => { info.soulId = `s_${seat.id}`; return { ok: true, soulId: info.soulId, soulName: seat.soulName }; }, wakeLoop: () => true, save() {}, stop: async () => { stopped.push(`seat:${seat.id}`); } }; } },
    owner: { sendCard: async () => { cards += 1; onCard(cards); return { messageId: `m${cards}` }; }, cardView: async () => ({ latest: null, presence: 'listening' }) },
    truth: {}, evidence: { openPack() {}, closePack() {} },
    browser: { openBrowser: async () => { made.push('browser'); return { gpu: 'fake', openCamera: async () => null, close: async () => { stopped.push('browser'); } }; } },
    swarmTruth: () => ({ soul: async (soulId) => ({ soulId, ok: true, placePath: ['field'], posture: 'standing', speech: [] }) }),
  };
  return { modules, made, stopped };
}
