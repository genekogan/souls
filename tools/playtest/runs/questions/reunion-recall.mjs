// Question (#1138, the Reunion scenario): after both clients restarted in new chats, did each Soul go where the two agreed on
// day one and use the other's name? Deterministic over each seat's own CLI calls. The place carries the measure: `here` shows
// a near Soul's name to anyone, but nothing in the world repeats a plan, so a name alone never passes. Warmth is not scored.
import { actOutcome } from '../evaluate.mjs';

const PLAN = /\btomorrow at ([^.!?;,\n]+)/i;
const plain = (v) => ` ${String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const placeOf = (text) => { const m = PLAN.exec(text); return m ? plain(m[1]).replace(/^ (?:the )?/, ' ') : null; };
const spoken = (s) => ['say', 'converse'].includes(s.verb);
const words = (s) => s.args.filter((a) => a !== 'start' && !a.startsWith('--') && !/^s_[a-z0-9]+$/i.test(a)).join(' ');
const holds = (text, name) => new RegExp(`\\b${String(name).replace(/[^\p{L}\p{N} ]/gu, '.')}\\b`, 'iu').test(text);
const dayOf = (s) => { const m = s.verb === 'here' ? /\bworld day (\d+)\b/i.exec(String(s.out?.now ?? '')) : null; return m ? Number(m[1]) : null; };
const shown = ({ out }) => JSON.stringify(out && typeof out === 'object' ? { ...out, brief: undefined } : out ?? '');

/** Where the seat's own calls last put it: a `here`, or a walk the world finished; a walk still going leaves it open. */
function lastSeen(steps, place) {
  let seen = { known: false, at: null, id: null };
  for (const s of steps) {
    const cap = s.out?.receipt?.capability;
    if (s.verb === 'here' && s.out?.me) { const id = s.out.me.place ?? null; seen = { known: true, id, at: [id, ...(s.out.me.placePath ?? [])].some((p) => plain(p).includes(place)) }; }
    else if (/^walk:/.test(cap ?? '')) {
      const outcome = actOutcome(s).outcome, id = cap.slice('walk:'.length);
      if (outcome === 'completed') seen = { known: true, id, at: plain(id).includes(place) };
      else if (outcome !== 'failed') seen = { known: false, at: null, id, walking: true };
    }
  }
  return seen;
}

export default {
  id: 'reunion-recall',
  version: 2,
  question: 'On the second day, in a new chat, did both Souls end at the place they agreed on the first day, each using the other\'s name in what it said?',
  assumptions: [
    'Each seat\'s last two cards are the two days; the second names neither the other Soul nor a place.',
    'The agreed place is what each Soul said after "Tomorrow at" on the first day; a plan not stated by both, or not the same, is unknown, not a failure of memory.',
    'Where a Soul ended is its last `here` that day or the last walk the world completed, so one already waiting there counts; a walk with no observed end is unknown.',
    'A name counts as a whole word in a say or converse call that day. Whether it came before the world showed it is reported, and decides nothing.',
    'Midnight falls between the two cards: `here` frames that say otherwise make the run unknown.',
  ],
  score(ctx) {
    const seats = ctx.seats ?? [];
    if (seats.length !== 2) return { verdict: 'unknown', uncertainty: 'Reunion has two seats', evidence: [] };
    const blind = seats.filter((s) => !ctx.hasTranscript(s));
    if (blind.length) return { verdict: 'unknown', uncertainty: `no transcript for ${blind.join(', ')}`, evidence: [] };
    const names = Object.fromEntries((ctx.scenario?.seats ?? []).map((s) => [s.id, s.soulName]));
    const rows = seats.map((seat) => {
      const other = names[seats.find((s) => s !== seat)], cards = ctx.requests.filter((r) => r.seat === seat && r.channel === 'card'), from = Date.parse(cards.at(-1)?.sentAt ?? '');
      if (cards.length < 2 || !Number.isFinite(from)) return { seat, secondDay: false };
      const before = ctx.steps(seat).filter((s) => s.atMs < from), after = ctx.steps(seat).filter((s) => s.atMs >= from), talk = after.filter(spoken);
      const firstName = after.findIndex((s) => spoken(s) && holds(words(s), other)), days = [...before.map(dayOf), ...after.map(dayOf)].filter((d) => d !== null);
      return {
        seat, secondDay: true, plan: before.filter(spoken).map((s) => placeOf(words(s))).filter(Boolean).at(-1) ?? null, after, spoke: talk.length, greeted: firstName >= 0,
        namedBeforeSeen: firstName >= 0 && !after.slice(0, firstName).some((s) => holds(shown(s), other)),
        days: { first: before.map(dayOf).find((d) => d !== null) ?? null, last: before.map(dayOf).filter((d) => d !== null).at(-1) ?? null, next: after.map(dayOf).find((d) => d !== null) ?? null, seen: days.length },
        refs: talk.slice(0, 2).map((s) => ctx.stepRef(s)),
      };
    });
    const evidence = rows.flatMap((r) => r.refs ?? []), view = (r) => { const { after, refs, ...rest } = r; return rest; };
    if (rows.some((r) => !r.secondDay)) return { verdict: 'unknown', evidence, detail: rows.map(view), uncertainty: 'a seat never reached the second day' };
    const crossed = rows.some(({ days: d }) => (d.first !== null && d.last !== null && d.first !== d.last) || (d.last !== null && d.next !== null && d.next <= d.last));
    if (crossed) return { verdict: 'unknown', evidence, detail: rows.map(view), uncertainty: 'midnight did not fall between the two cards' };
    const [a, b] = rows;
    if (!a.plan || a.plan !== b.plan) return { verdict: 'unknown', evidence, detail: rows.map(view), uncertainty: 'the two Souls stated no shared plan on the first day' };
    const ends = rows.map((r) => ({ ...lastSeen(r.after, a.plan), seat: r.seat })), greeted = rows.every((r) => r.greeted), detail = { greeted, plan: a.plan.trim(), ends, rows: rows.map(view) };
    const missed = ends.some((e) => e.known && !e.at);
    if (missed || !greeted) return { verdict: 'fail', evidence, detail: { ...detail, kept: missed ? false : null } };
    if (ends.some((e) => !e.known)) return { verdict: 'unknown', evidence, detail: { ...detail, kept: null }, uncertainty: 'a Soul\'s last walk has no observed end' };
    return { verdict: 'pass', evidence, detail: { ...detail, kept: true } };
  },
};
