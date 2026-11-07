// Applying changes. Deterministic and total: a change either applies or is
// refused with a reason; nothing else can alter the state.
// Coherence rule: an actor changes only itself, what it controls, and what it
// made. Anything shared happens when independent actions fit together.
import { hashOf } from '@souls/engine-contract';
import type { Change, Json, KState, Link, Thing } from './types.ts';

export const linkKey = (kind: string, from: string, to: string) => `${kind}|${from}|${to}`;
export const SAID_TICKS = 20 * 120; // something said stays "just said" for two minutes
export const AGREED_TICKS = 20 * 1800; // an agreement stands for thirty minutes
/** Links that exist only because something was said. No card or actor can make them directly. */
export const SPEECH_LINKS: ReadonlySet<string> = new Set(['said', 'asked', 'agreed']);
export const MAX_MADE = 24;   // things one Soul may have brought into being at a time
export const MAX_LINKS = 400; // links one Soul may hold at a time

export function emptyKernel(): KState {
  return { tick: 0, things: {}, links: {}, vocab: { kinds: {}, links: {}, cards: {}, manners: {} }, decks: {}, nextId: 1 };
}

export class Refused extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

// ---------------------------------------------------------------- queries
export const linked = (s: KState, kind: string, from: string, to: string): Link | undefined => {
  const l = s.links[linkKey(kind, from, to)];
  return l && (l.until === undefined || l.until >= s.tick) ? l : undefined;
};
export const linksFrom = (s: KState, from: string, kind?: string): Link[] => Object.values(s.links).filter((l) => l.from === from && (!kind || l.kind === kind) && (l.until === undefined || l.until >= s.tick));
export const linksTo = (s: KState, to: string, kind?: string): Link[] => Object.values(s.links).filter((l) => l.to === to && (!kind || l.kind === kind) && (l.until === undefined || l.until >= s.tick));
/** Where a thing is: the thing it is `at`, or null. */
export const placeOf = (s: KState, id: string): string | null => s.things[id]?.at ?? null;
export const samePlace = (s: KState, a: string, b: string): boolean => {
  if (a === b) return true;
  const pa = placeOf(s, a), pb = placeOf(s, b);
  return pa === b || pb === a || (pa !== null && pa === pb);
};
/** Who controls a thing: Souls with a control-flagged link to it (hosts, holds, made, dj of…). */
export const controllers = (s: KState, id: string): string[] => linksTo(s, id).filter((l) => s.vocab.links[l.kind]?.control).map((l) => l.from);

// ---------------------------------------------------------------- apply
/** Check a change against the coherence rule; throws Refused. `by` is the acting Soul id or 'world'. */
export function check(s: KState, c: Change, by: string): void {
  const world = by === 'world';
  const exists = (id: string) => { if (!s.things[id]) throw new Refused('thing.unknown', `no such thing: ${id}`); return s.things[id]; };
  // A thing that is not a Soul may be changed by whoever controls it. If nobody controls it, only by its maker,
  // or by anyone when it is marked loose. Things the world made (places, regions) are therefore nobody's to change.
  const mayAlter = (t: Thing) => {
    if (world || t.id === by) return;
    if (t.kind === 'soul') throw new Refused('coherence.other-soul', `${by} cannot change another Soul (${t.name}); ask them instead`);
    const ctl = controllers(s, t.id);
    if (ctl.includes(by)) return;
    if (ctl.length) throw new Refused('coherence.controlled', `${t.name} is controlled by someone else`);
    if (t.by !== by && t.traits.loose !== true) throw new Refused('coherence.not-yours', `${t.name} is not yours to change`);
  };
  switch (c.op) {
    case 'appear':
      if (s.things[c.id]) throw new Refused('thing.exists', `${c.id} already exists`); if (c.at !== null) exists(c.at);
      if (c.kind === 'soul' && !world) throw new Refused('coherence.soul', 'only the world brings Souls into being');
      if (!world && Object.values(s.things).filter((t) => t.by === by).length >= MAX_MADE) throw new Refused('limit.things', `a Soul may have at most ${MAX_MADE} things of its making at a time`);
      break;
    case 'vanish': mayAlter(exists(c.id)); if (s.things[c.id].kind === 'soul' && !world) throw new Refused('coherence.soul', 'a Soul cannot be removed by an action'); break;
    case 'set': if(c.key==='privateMandate'&&!world)throw new Refused('coherence.mandate','owner mandate rules are changed through steering');mayAlter(exists(c.id)); break;
    case 'move': { const t = exists(c.id); if (c.to !== null) exists(c.to); if (!world && c.id !== by) { if (t.kind === 'soul') throw new Refused('coherence.other-soul', 'a Soul moves only itself'); mayAlter(t); } break; }
    case 'link': {
      exists(c.from); const target = exists(c.to);
      if (!world && c.from !== by) throw new Refused('coherence.link', 'an actor asserts only its own links');
      // What was said and what was agreed come only from saying it.
      if (!world && SPEECH_LINKS.has(c.kind)) throw new Refused('coherence.speech', `"${c.kind}" comes only from saying it`);
      if (!world && !s.links[linkKey(c.kind, c.from, c.to)] && linksFrom(s, by).length >= MAX_LINKS) throw new Refused('limit.links', `a Soul may hold at most ${MAX_LINKS} links at a time`);
      // Control is taken only over what you made, over a loose thing nobody controls, or when someone who has it agreed.
      if (!world && s.vocab.links[c.kind]?.control) {
        const ctl = controllers(s, target.id);
        const mine = target.by === by, loose = target.traits.loose === true && ctl.length === 0, granted = ctl.some((x) => !!linked(s, 'agreed', x, by));
        if (!mine && !loose && !granted) throw new Refused('coherence.control', `${by} cannot take control of ${target.name}: it was not made by them and nobody who controls it agreed`);
      }
      break;
    }
    case 'unlink': if (!world && SPEECH_LINKS.has(c.kind)) throw new Refused('coherence.speech', `"${c.kind}" cannot be unsaid`); if (!world && c.from !== by && c.to !== by) throw new Refused('coherence.link', 'an actor cuts only links it is part of'); break;
    case 'say': exists(c.from); exists(c.to); if (!world && c.from !== by) throw new Refused('coherence.say', 'an actor speaks only for itself'); break;
  }
}

/** Apply a change (already checked). Mutates `s`. */
export function apply(s: KState, c: Change): void {
  switch (c.op) {
    case 'appear': s.things[c.id] = { id: c.id, kind: c.kind, name: c.name, traits: structuredClone(c.traits ?? {}), states: structuredClone(c.states ?? {}), at: c.at, born: s.tick, by: '' }; break;
    case 'vanish': {
      // A thing takes with it whatever was made to exist only alongside it (traits.with), and so on down.
      const gone = [c.id];
      for (let i = 0; i < gone.length; i++) for (const t of Object.values(s.things)) if (t.traits.with === gone[i] && !gone.includes(t.id)) gone.push(t.id);
      for (const id of gone) delete s.things[id];
      for (const k of Object.keys(s.links)) { const l = s.links[k]; if (gone.includes(l.from) || gone.includes(l.to)) delete s.links[k]; }
      for (const t of Object.values(s.things)) if (t.at !== null && gone.includes(t.at)) t.at = null;
      break;
    }
    case 'set': if (c.value === null) delete s.things[c.id].states[c.key]; else s.things[c.id].states[c.key] = structuredClone(c.value); break;
    case 'move': s.things[c.id].at = c.to; break;
    case 'link': s.links[linkKey(c.kind, c.from, c.to)] = { kind: c.kind, from: c.from, to: c.to, since: s.tick, ...(c.value !== undefined ? { value: c.value } : {}), ...(c.data !== undefined ? { data: c.data } : {}), ...(c.until !== undefined ? { until: c.until } : {}) }; break;
    case 'unlink': delete s.links[linkKey(c.kind, c.from, c.to)]; break;
    case 'say':
      s.links[linkKey('said', c.from, c.to)] = { kind: 'said', from: c.from, to: c.to, since: s.tick, until: s.tick + SAID_TICKS, data: { act: c.act, ...(c.about !== undefined ? { about: c.about } : {}), ...(c.manner ? { manner: c.manner } : {}) } as Json };
      // A question stays open (whatever else is said meanwhile) until it is answered or two minutes pass.
      if (c.act === 'ask') s.links[linkKey('asked', c.from, c.to)] = { kind: 'asked', from: c.from, to: c.to, since: s.tick, until: s.tick + SAID_TICKS, ...(c.about !== undefined ? { data: { about: c.about } as Json } : {}) };
      // An answer closes the question. Saying yes is what makes an agreement: there is no other way to hold one.
      if (c.act === 'agree' || c.act === 'decline') delete s.links[linkKey('asked', c.to, c.from)];
      if (c.act === 'agree') s.links[linkKey('agreed', c.from, c.to)] = { kind: 'agreed', from: c.from, to: c.to, since: s.tick, until: s.tick + AGREED_TICKS };
      break;
  }
}

/** What the state would be after these changes, or the refusal. Never touches `s`. (Vocabulary and decks are shared, not copied: changes cannot alter them.) */
export function preview(s: KState, changes: Change[], by: string): { ok: true; state: KState } | { ok: false; code: string; message: string } {
  const draft: KState = { ...s, things: structuredClone(s.things), links: structuredClone(s.links) };
  try { for (const c of changes) { check(draft, c, by); apply(draft, c); if (c.op === 'appear') draft.things[c.id].by = by; } }
  catch (e) { if (e instanceof Refused) return { ok: false, code: e.code, message: e.message }; throw e; }
  return { ok: true, state: draft };
}

/** Apply a batch atomically: all changes pass the check in order, or none apply. */
export function applyAll(s: KState, changes: Change[], by: string): { ok: true } | { ok: false; code: string; message: string } {
  const r = preview(s, changes, by); if (!r.ok) return r;
  s.things = r.state.things; s.links = r.state.links;
  return { ok: true };
}

/** Drop links whose time has passed. Call occasionally; lapsed links are already invisible to queries. */
export function sweep(s: KState): number { let n = 0; for (const k of Object.keys(s.links)) { const l = s.links[k]; if (l.until !== undefined && l.until < s.tick) { delete s.links[k]; n++; } } return n; }

export const kernelHash = (s: KState): string => hashOf({
  things: s.things, links: Object.fromEntries(Object.entries(s.links).filter(([, l]) => l.until === undefined || l.until >= s.tick)), decks: s.decks, nextId: s.nextId,
  cards: Object.fromEntries(Object.entries(s.vocab.cards).map(([n, c]) => [n, c.hash])), linkKinds: s.vocab.links, kinds: s.vocab.kinds, manners: s.vocab.manners,
});
