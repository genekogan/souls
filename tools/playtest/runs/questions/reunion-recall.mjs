// Question (#1138, the Reunion scenario): after both clients restarted in new chats, did each Soul walk to the place the two
// named on day one, and use the other's name? Deterministic over each seat's own CLI calls. The walk id carries the measure:
// a near Soul's name is in `here` for anyone, and flags are not places there, so what counts is the id each Soul said after
// "Tomorrow at" and the walk the world finished. Warmth is not scored.
import { actOutcome } from '../evaluate.mjs';

const PLAN = /\btomorrow at\s+[`'"]?((?:walk|go):[a-z0-9_-]+)/i, MOVE = /^(?:walk|go):/, RETOLD = /\btomorrow at\b/i;
const spoken = (s) => ['say', 'converse'].includes(s.verb);
const words = (s) => s.args.filter((a) => a !== 'start' && !a.startsWith('--') && !/^s_[a-z0-9]+$/i.test(a)).join(' ');
const holds = (text, name) => new RegExp(`\\b${String(name).replace(/[^\p{L}\p{N} ]/gu, '.')}\\b`, 'iu').test(text);
const dayOf = (s) => { const m = s.verb === 'here' ? /\bworld day (\d+)\b/i.exec(String(s.out?.now ?? '')) : null; return m ? Number(m[1]) : null; };
const shown = ({ out }) => JSON.stringify(out && typeof out === 'object' ? { ...out, brief: undefined } : out ?? '');
const idOf = (cap) => String(cap).replace(MOVE, '');
const moves = (steps) => steps.filter((s) => MOVE.test(s.out?.receipt?.capability ?? '')).map((s) => ({ step: s, id: idOf(s.out.receipt.capability), outcome: actOutcome(s).outcome })).filter((m) => m.outcome !== 'failed');
const finished = (steps) => moves(steps).filter((m) => m.outcome === 'completed').at(-1)?.id ?? null;

export default {
  id: 'reunion-recall',
  version: 3,
  question: 'On the second day, in a new chat, did both Souls finish a walk to the place they named on the first day, each using the other\'s name in what it said?',
  assumptions: [
    'Each seat\'s last two cards are the two days; the second names neither the other Soul nor a place.',
    'The agreed place is the walk id each Soul said after "Tomorrow at" on the first day; a plan not stated by both, or not the same, is unknown, not a failure of memory.',
    'A Soul that never finished a walk away from that place on the first day proves nothing by being there: unknown.',
    'Where a Soul ended is the last walk the world completed that day; a later walk with no observed end is unknown.',
    'If anything but the Soul\'s own memory showed "Tomorrow at" before it set off, the world told it: unknown.',
    'A name counts as a whole word in a say or converse call that day. Whether it came before the world showed it, and whether the wake carried a brief, are reported and decide nothing.',
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
      const set = moves(after).find((m) => m.id === id)?.step, ahead = set ? after.slice(0, after.indexOf(set)) : after, last = moves(after).at(-1);
      return {
        seat, secondDay: true, plan: id, after, spoke: talk.length, greeted: firstName >= 0, namedBeforeSeen: firstName >= 0 && !after.slice(0, firstName).some((s) => holds(shown(s), other)),
        parted: !!finished(before) && finished(before) !== id, retold: ahead.some((s) => !spoken(s) && s.verb !== 'memory' && RETOLD.test(shown(s))),
        ended: finished(after), walking: last && last.outcome !== 'completed' ? last.id : null,
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
    if (rows.some((r) => r.walking)) return unknown('a Soul\'s last walk has no observed end');
    const kept = rows.every((r) => r.ended === a.plan), greeted = rows.every((r) => r.greeted);
    return { verdict: kept && greeted ? 'pass' : 'fail', evidence, detail: { kept, greeted, plan: a.plan, rows: detail } };
  },
};
