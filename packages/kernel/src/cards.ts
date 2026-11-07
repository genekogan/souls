// Cards: resolving references, testing conditions, finding what a Soul can play
// now, and turning a play into concrete changes.
import { hashOf } from '@souls/engine-contract';
import { SPEECH_LINKS, controllers, linked, linksTo, preview, samePlace } from './kernel.ts';
import { cardSchema, type Card, type Change, type Cond, type Json, type KState, type MintedCard } from './types.ts';

export type Bindings = Record<string, string>; // slot name → thing id ('actor', 'target', derived slots, 'new')

export const cardHash = (c: Card): string => hashOf(c).slice(0, 16);

function resolve(s: KState, r: string, b: Bindings): string | null {
  if (!r.startsWith('$')) return r;
  const [slot, suffix] = r.slice(1).split('.');
  const id = b[slot];
  if (!id) return null;
  if (suffix === 'at') return s.things[id]?.at ?? null;
  return id;
}

export function holds(s: KState, c: Cond, b: Bindings): boolean {
  const r = (x: string) => resolve(s, x, b);
  if ('is' in c) { const id = r(c.is[0]); return !!id && s.things[id]?.kind === c.is[1]; }
  if ('at' in c) { const a = r(c.at[0]), x = r(c.at[1]); return !!a && !!x && samePlace(s, a, x); }
  if ('notAt' in c) { const a = r(c.notAt[0]), x = r(c.notAt[1]); return !a || !x || !samePlace(s, a, x); }
  if ('linked' in c) { const a = r(c.linked[1]), x = r(c.linked[2]); return !!a && !!x && !!linked(s, c.linked[0], a, x); }
  if ('notLinked' in c) { const a = r(c.notLinked[1]), x = r(c.notLinked[2]); return !a || !x || !linked(s, c.notLinked[0], a, x); }
  if ('noneLinkedTo' in c) { const x = r(c.noneLinkedTo[1]); return !!x && linksTo(s, x, c.noneLinkedTo[0]).length === 0; }
  if ('state' in c) { const id = r(c.state[0]); return !!id && JSON.stringify(s.things[id]?.states[c.state[1]] ?? null) === JSON.stringify(c.state[2] ?? null); }
  if ('notState' in c) { const id = r(c.notState[0]); return !id || JSON.stringify(s.things[id]?.states[c.notState[1]] ?? null) !== JSON.stringify(c.notState[2] ?? null); }
  if ('said' in c) { const a = r(c.said[0]), x = r(c.said[1]); const l = a && x ? linked(s, 'said', a, x) : undefined; return !!l && (l.data as { act?: string } | undefined)?.act === c.said[2]; }
  if ('distinct' in c) return r(c.distinct[0]) !== r(c.distinct[1]);
  return false;
}

/** Fill derived slots (e.g. host = whoever hosts the target). Returns null if one cannot be filled. */
export function bind(s: KState, card: Card, actor: string, target: string | null): Bindings | null {
  const b: Bindings = { actor };
  // every play knows the region its actor is in (walk up the `at` chain)
  for (let x: string | null = s.things[actor]?.at ?? null, n = 0; x && n < 6; x = s.things[x]?.at ?? null, n++) if (s.things[x]?.kind === 'region') { b.region = x; break; }
  if (card.target) { if (!target) return null; b.target = target; }
  for (const [slot, d] of Object.entries(card.derive ?? {})) {
    const to = resolve(s, d.to, b); if (!to) return null;
    const l = linksTo(s, to, d.link)[0]; if (!l) return null;
    b[slot] = l.from;
  }
  return b;
}

/** Why a card cannot be played on a target right now, or null if it can. */
export function whyNot(s: KState, card: Card, actor: string, target: string | null): string | null {
  if (card.target) {
    const t = target ? s.things[target] : undefined;
    if (!t) return 'no such target';
    if (card.target.kind !== 'any' && t.kind !== card.target.kind) return `needs a ${card.target.kind}`;
    if (t.id === actor) return 'cannot target oneself';
    if (card.target.same_place && !samePlace(s, actor, t.id)) return `${t.name} is not here`;
  }
  const b = bind(s, card, actor, target);
  if (!b) return 'nobody fills a needed role (for example, there is no host)';
  for (const c of card.when) if (!holds(s, c, b)) return `condition not met: ${JSON.stringify(c)}`;
  return null;
}

/** The conditions that do not hold for a play, or null if the target or a needed role is missing entirely. */
export function unmet(s: KState, card: Card, actor: string, target: string | null): Cond[] | null {
  if (card.target) { const t = target ? s.things[target] : undefined; if (!t || (card.target.kind !== 'any' && t.kind !== card.target.kind) || t.id === actor) return null; }
  const b = bind(s, card, actor, target); if (!b) return null;
  const out: Cond[] = card.when.filter((c) => !holds(s, c, b));
  if (card.target?.same_place && target && !samePlace(s, actor, target)) out.push({ at: ['$actor', '$target'] });
  return out;
}
/** How far a step is from playable: the fewest unmet conditions over its possible targets (Infinity if no target could ever do). 0 = playable now. */
export function gap(s: KState, card: Card, actor: string, targets: (string | null)[]): number {
  let best = Infinity;
  for (const t of targets) { const u = unmet(s, card, actor, t); if (u && u.length < best) best = u.length; }
  return best;
}
/**
 * One step of looking ahead: which of the plays open to a Soul now would bring a blocked step closer to playable?
 * Each play is tried on a copy of the state. This is how travel, leaving what you are in, or fetching what you
 * need serve a plan without anyone having to write those steps down.
 */
export function enablers(s: KState, actor: string, step: { card: Card; targets: (s: KState) => (string | null)[] }, plays: Playable[], manner?: string): Set<string> {
  const out = new Set<string>(); const before = gap(s, step.card, actor, step.targets(s));
  if (before === 0) return out;
  for (const p of plays) {
    const b = bind(s, p.card, actor, p.target); if (!b) continue;
    let r; try { r = preview(s, changesOf(s, p.card, b, manner).changes, actor); } catch { continue; }
    if (r.ok && gap(r.state, step.card, actor, step.targets(r.state)) < before) out.add(p.id);
  }
  return out;
}

export type Playable = { card: MintedCard; target: string | null; id: string };
/** Every (card, target) a Soul could play now, given the things it can reach or knows of. */
export function playable(s: KState, actor: string, candidates: string[]): Playable[] {
  const deck = s.decks[actor]; if (!deck) return [];
  const out: Playable[] = [];
  for (const name of deck.cards) {
    const card = s.vocab.cards[name]; if (!card) continue;
    if (!card.target) { if (!whyNot(s, card, actor, null)) out.push({ card, target: null, id: name }); continue; }
    for (const t of candidates) if (!whyNot(s, card, actor, t)) out.push({ card, target: t, id: `${name}@${t}` });
  }
  return out;
}

/** Turn a play into concrete changes. `manner` colours anything said. Deterministic: new ids come from s.nextId. */
export function changesOf(s: KState, card: Card, b: Bindings, manner: string | undefined, ticksPerSecond = 20): { changes: Change[]; bindings: Bindings; nextId: number } {
  const bb = { ...b }; let nextId = s.nextId; const out: Change[] = [];
  const r = (x: string) => { const id = resolve({ ...s, things: { ...s.things } }, x, bb); if (!id) throw new Error(`unresolved reference ${x}`); return id; };
  const text = (v: Json | undefined): Json | undefined => (typeof v === 'string' ? v.replace(/\$(\w+)\.name/g, (_m, slot) => s.things[bb[slot]]?.name ?? slot) : v);
  for (const st of card.then) {
    if ('move' in st) out.push({ op: 'move', id: r(st.move[0]), to: st.move[1] === '$target.at' && bb.target && !s.things[bb.target]?.at ? bb.target : r(st.move[1]) });
    else if ('set' in st) out.push({ op: 'set', id: r(st.set[0]), key: st.set[1], value: text(st.set[2]) as Json });
    else if ('link' in st) out.push({ op: 'link', kind: st.link[0], from: r(st.link[1]), to: r(st.link[2]), ...(st.value !== undefined ? { value: st.value } : {}), ...(st.data !== undefined ? { data: st.data } : {}), ...(st.forSeconds ? { until: s.tick + st.forSeconds * ticksPerSecond } : {}) });
    else if ('unlink' in st) out.push({ op: 'unlink', kind: st.unlink[0], from: r(st.unlink[1]), to: r(st.unlink[2]) });
    else if ('say' in st) out.push({ op: 'say', from: r(st.say[0]), to: r(st.say[1]), act: st.say[2], ...(st.about !== undefined ? { about: text(st.about) as Json } : {}), ...(manner ? { manner } : {}) });
    else if ('appear' in st) {
      const id = `t_${nextId++}`; bb.new = id;
      const at = st.appear.at === '$target' ? bb.target : r(st.appear.at);
      const tied = st.appear.with ? r(st.appear.with) : undefined;
      out.push({ op: 'appear', id, kind: st.appear.kind, name: String(text(st.appear.name)), at, ...(tied ? { traits: { with: tied } } : {}), ...(st.appear.states ? { states: st.appear.states as Record<string, Json> } : {}) });
      if (st.linkFromActor) out.push({ op: 'link', kind: st.linkFromActor, from: bb.actor, to: id });
    } else if ('vanish' in st) out.push({ op: 'vanish', id: r(st.vanish) });
  }
  return { changes: out, bindings: bb, nextId };
}

export const MAX_CARD_BYTES = 4000;
export const MAX_CARDS = 5000;
/** Static validation of a proposed card against the grammar and the coherence rule. Returns problems in plain words. */
export function validateCard(input: unknown, s: KState, engineVerbs: Set<string>): { ok: true; card: Card } | { ok: false; problems: string[] } {
  // Bounded before anything else looks at it: a card is a few lines, never a document.
  let size = 0; try { size = JSON.stringify(input)?.length ?? 0; } catch { return { ok: false, problems: ['the card is not plain JSON'] }; }
  if (size > MAX_CARD_BYTES) return { ok: false, problems: [`the card is too large (${size} characters; the limit is ${MAX_CARD_BYTES})`] };
  const p = cardSchema.safeParse(input);
  if (!p.success) return { ok: false, problems: p.error.issues.map((i) => `${i.path.join('.') || 'card'}: ${i.message}`) };
  if (!s.vocab.cards[p.data.name] && Object.keys(s.vocab.cards).length >= MAX_CARDS) return { ok: false, problems: ['the library is full'] };
  const card = p.data, problems: string[] = [];
  for(const st of card.then){
    if('set' in st&&st.set[1]==='privateMandate')problems.push('owner mandate rules are changed through steering, never by a card');
    if('appear' in st&&st.appear.states?.privateMandate!==undefined)problems.push('a card cannot create owner mandate state');
  }
  const slots = new Set(['actor', 'region', ...(card.target ? ['target'] : []), ...Object.keys(card.derive ?? {}), 'new']);
  const okRef = (x: string) => !x.startsWith('$') || slots.has(x.slice(1).split('.')[0]);
  const refsOf = (o: unknown): string[] => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(refsOf) : []);
  for (const c of card.when) for (const x of refsOf(Object.values(c)[0])) if (!okRef(x)) problems.push(`a condition refers to an unknown slot ${x}`);
  for (const st of card.then) {
    if ('move' in st && st.move[0] !== '$actor') problems.push('a card may move only its actor');
    if ('link' in st && st.link[1] !== '$actor') problems.push(`link "${st.link[0]}" must start from the actor: an actor asserts only its own links`);
    if ('unlink' in st && st.unlink[1] !== '$actor' && st.unlink[2] !== '$actor') problems.push('a card may cut only links the actor is part of');
    if ('say' in st && st.say[0] !== '$actor') problems.push('a card speaks only for its actor');
    if ('set' in st && st.set[0] !== '$actor' && st.set[0] !== '$target' && st.set[0] !== '$new') problems.push('a card may set states only on the actor, its target, or a thing it just made');
    const made = 'link' in st ? st.link[0] : 'appear' in st ? st.linkFromActor : undefined;
    if (made && SPEECH_LINKS.has(made)) problems.push(`"${made}" comes only from saying it: use a say step (saying "ask" opens a question, saying "agree" makes an agreement)`);
    if ('unlink' in st && SPEECH_LINKS.has(st.unlink[0])) problems.push(`"${st.unlink[0]}" cannot be unsaid`);
    if ('appear' in st && st.appear.kind === 'soul') problems.push('a card cannot make a Soul');
    if ('appear' in st) for (const x of [st.appear.at, ...(st.appear.with ? [st.appear.with] : [])]) if (!okRef(x)) problems.push(`a step refers to an unknown slot ${x}`);
    for (const x of refsOf(Object.values(st)[0])) if (!okRef(x)) problems.push(`a step refers to an unknown slot ${x}`);
  }
  // Every link kind a card uses must be declared, so that everyone knows what it means and whether it gives control.
  const kinds = new Set<string>();
  for (const c of card.when) { if ('linked' in c) kinds.add(c.linked[0]); if ('notLinked' in c) kinds.add(c.notLinked[0]); if ('noneLinkedTo' in c) kinds.add(c.noneLinkedTo[0]); }
  for (const st of card.then) { if ('link' in st) kinds.add(st.link[0]); if ('unlink' in st) kinds.add(st.unlink[0]); if ('appear' in st && st.linkFromActor) kinds.add(st.linkFromActor); }
  for (const d of Object.values(card.derive ?? {})) kinds.add(d.link);
  for (const kind of kinds) if (!s.vocab.links[kind]) problems.push(`link kind "${kind}" is not declared: declare it (a one-line meaning, and control: true if holding it should give power over its target)`);
  // A card that changes or removes its target must say where the right to do so comes from: a control link the actor
  // already holds (in "when"), or one the card takes first (a "link" step, which the world allows only on the actor's
  // own things or when someone who controls the target agreed). Otherwise it would be refused every time it is played.
  const control = (kind: string) => s.vocab.links[kind]?.control === true;
  let holds = card.when.some((c) => 'linked' in c && control(c.linked[0]) && c.linked[1] === '$actor' && c.linked[2] === '$target');
  for (const st of card.then) {
    if ('link' in st && control(st.link[0]) && st.link[1] === '$actor' && st.link[2] === '$target') holds = true;
    const touches = ('set' in st && st.set[0] === '$target') || ('vanish' in st && st.vanish === '$target');
    if (touches && !holds) { problems.push('the card changes its target, but nothing gives the actor the right to: require a control link in "when" (for example ["linked", "hosts", "$actor", "$target"] or ["linked", "made", "$actor", "$target"]), or take one in an earlier "link" step (possible when someone who controls the target has agreed)'); break; }
  }
  for (const d of [...card.approach, ...card.during]) if (!engineVerbs.has(d.verb)) problems.push(`the engine has no verb "${d.verb}" (list what you wanted under "wants" and use an existing verb)`);
  if (s.vocab.cards[card.name] && cardHash(card) !== s.vocab.cards[card.name].hash) problems.push(`a different card named "${card.name}" already exists; choose another name`);
  return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true, card };
}
export { controllers };
