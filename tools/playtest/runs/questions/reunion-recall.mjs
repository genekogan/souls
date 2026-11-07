// Question (#1138, the Reunion scenario): after both clients restarted in new chats, did each Soul walk to the place the two
// named on day one, and use the other's name? Deterministic over each seat's own CLI calls. The walk id carries the measure:
// a near Soul's name is in `here` for anyone, and flags are not places there, so what counts is the id each Soul said after
// "Tomorrow at" and the walk the world finished. Warmth is not scored.
import { actOutcome } from '../evaluate.mjs';

const PLAN = /\btomorrow at\s+[`'"<]?((?:walk|go):<?[a-z0-9_/-]+)/i, WALK = /^(?:walk|go):/, RETOLD = /\btomorrow at\b/i;
/** Ways to get somewhere that aren't a finished walk: ids differ (`run:g-knoll`, `walk:knoll`), so where they end can't be compared. */
const OTHER_MOVE = /^(?:run|jog|stroll|hang-out|approach|follow|go-near|fly|ride|climb)\b/;
/** The reads that can carry words from day one. `here` and `caps` list every place as an offer, so a place's id there tells nothing. */
const READS_SPEECH = new Set(['events', 'pending', 'wait', 'listen', 'converse', 'batch', 'receipt']);
const said = (s) => !s.isError && s.out?.accepted !== false;
const spoken = (s) => said(s) && (s.verb === 'say' || (s.verb === 'converse' && ['start', 'say'].includes(s.args[0])));
const words = (s) => s.args.filter((a) => !(s.verb === 'converse' && ['start', 'say'].includes(a)) && !a.startsWith('--') && !/^s_[a-z0-9]+$/i.test(a)).join(' ');
const holds = (text, name) => new RegExp(`\\b${String(name).replace(/[^\p{L}\p{N} ]/gu, '.')}\\b`, 'iu').test(text);
const dayOf = (s) => { const m = s.verb === 'here' ? /\bworld day (\d+)\b/i.exec(String(s.out?.now ?? '')) : null; return m ? Number(m[1]) : null; };
const shown = ({ out }) => JSON.stringify(out && typeof out === 'object' ? { ...out, brief: undefined } : out ?? '');
const idOf = (cap) => String(cap).toLowerCase().replace(/^(?:walk|go):/, '').replace(/[<>]/g, '');
/** Every receipt a step shows, its own or those a serve finished (a `plan`'s steps end in `pending`). */
const receiptsIn = (s) => [...(s.out?.receipt ? [{ step: s, receipt: s.out.receipt, outcome: actOutcome(s).outcome }] : []), ...(Array.isArray(s.out?.endedReceipts) ? s.out.endedReceipts : []).map((r) => ({ step: s, receipt: r, outcome: r?.phase === 'completed' ? 'completed' : ['failed', 'replaced', 'refused', 'cancelled', 'interrupted'].includes(r?.phase) ? 'failed' : 'started' }))];
const walked = (steps) => steps.flatMap(receiptsIn).filter((r) => WALK.test(r.receipt?.capability ?? '') && r.outcome === 'completed').map((r) => idOf(r.receipt.capability));
/** One record per receipt, its end if any step saw it: `act` prints it started and a later `wait` prints it done. */
const lastOf = (steps) => { const seen = new Map(), loose = []; for (const r of steps.flatMap(receiptsIn)) { const id = r.receipt?.id; if (!id) loose.push(r); else if (!['completed', 'failed'].includes(seen.get(id)?.outcome)) seen.set(id, r); } return [...seen.values(), ...loose]; };
/** Some move this question can't place: a walk with no observed end, any other move, or a plan with steps still unseen. */
const unplaced = (steps) => steps.some((s) => (s.verb === 'plan' && s.out?.accepted === true)) || lastOf(steps).some((r) => { const cap = r.receipt?.capability ?? ''; return r.outcome !== 'failed' && (OTHER_MOVE.test(cap) || (WALK.test(cap) && r.outcome !== 'completed')); });
/** Anything but the Soul's own memory that showed it day one's words before it set off. */
function toldBefore(steps, id) {
  const leaf = id.split(/[-/]/).at(-1), set = steps.findIndex((s) => receiptsIn(s).some((r) => idOf(r.receipt?.capability ?? '') === id) || (s.verb === 'plan' && s.args.join(' ').includes(id)));
  return (set < 0 ? steps : steps.slice(0, set)).some((s) => {
    if (spoken(s) || s.verb === 'memory') return false;
    const text = shown(s);
    if (s.verb === 'converse' && s.args[0] === 'turns') return said(s) && text.length > 2;
    return RETOLD.test(text) || (READS_SPEECH.has(s.verb) && (text.includes(id) || holds(text, leaf)));
  });
}

export default {
  id: 'reunion-recall',
  version: 5,
  question: 'On the second day, in a new chat, did both Souls finish a walk to the place they named on the first day, each using the other\'s name in what it said?',
  assumptions: [
    'Each seat\'s last two cards are the two days; the second names neither the other Soul nor a place.',
    'The agreed place is the walk id each Soul said after "Tomorrow at" on the first day; a plan not stated by both, or not the same, is unknown, not a failure of memory.',
    'A Soul that never finished a walk away from that place on the first day proves nothing by being there: unknown.',
    'Keeping the plan is a walk to that id the world finished that day, in a receipt the seat read. Leaving afterwards changes nothing.',
    'A Soul with no such walk, but with a move this question can\'t place (a walk with no observed end, another way of moving, a plan), is unknown.',
    'If anything but the Soul\'s own memory showed it day one\'s words before it set off, the world told it: unknown. Reading conversation turns counts whatever they say.',
    'A name counts as a whole word in a say or converse call the world took that day. Whether it came before the world showed it, and whether the wake carried a brief, are reported and decide nothing.',
    'The world day turns between the two cards: `here` frames that say otherwise make the run unknown.',
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
      const before = ctx.steps(seat).filter((s) => s.atMs < from), after = ctx.steps(seat).filter((s) => s.atMs >= from), talk = after.filter(spoken), days = before.map(dayOf).filter((d) => d !== null);
      const firstName = after.findIndex((s) => spoken(s) && holds(words(s), other));
      const plan = before.filter(spoken).map((s) => PLAN.exec(words(s))?.[1]).filter(Boolean).at(-1) ?? null, id = plan ? idOf(plan.toLowerCase()) : null;
      return {
        seat, secondDay: true, plan: id, after, spoke: talk.length, greeted: firstName >= 0, namedBeforeSeen: firstName >= 0 && !after.slice(0, firstName).some((s) => holds(shown(s), other)),
        parted: !!walked(before).at(-1) && walked(before).at(-1) !== id, retold: !!id && toldBefore(after, id),
        kept: !!id && walked(after).includes(id), open: unplaced(after),
        briefAtWake: (ctx.listens?.(seat) ?? []).some((l) => Date.parse(l.t) >= from && /"brief"/.test(l.stdout ?? '')),
        days: { first: days[0] ?? null, last: days.at(-1) ?? null, next: after.map(dayOf).find((d) => d !== null) ?? null },
        refs: talk.slice(0, 2).map((s) => ctx.stepRef(s)),
      };
    });
    const evidence = rows.flatMap((r) => r.refs ?? []), detail = rows.map(({ after, refs, ...rest }) => rest), unknown = (uncertainty) => ({ verdict: 'unknown', evidence, detail, uncertainty });
    if (rows.some((r) => !r.secondDay)) return unknown('a seat never reached the second day');
    if (rows.some(({ days: d }) => (d.first !== null && d.last !== null && d.first !== d.last) || (d.last !== null && d.next !== null && d.next <= d.last))) return unknown('the world day did not turn between the two cards');
    const [a, b] = rows;
    if (!a.plan || a.plan !== b.plan) return unknown('the two Souls stated no shared plan on the first day');
    if (rows.some((r) => !r.parted)) return unknown('a Soul never walked away from the agreed place on the first day');
    if (rows.some((r) => r.retold)) return unknown('the world showed a Soul the plan before it set off');
    const kept = rows.every((r) => r.kept), greeted = rows.every((r) => r.greeted);
    if (!kept && rows.every((r) => r.kept || r.open)) return unknown('a Soul\'s move has no end this question can read');
    return { verdict: kept && greeted ? 'pass' : 'fail', evidence, detail: { kept, greeted, plan: a.plan, rows: detail } };
  },
};
