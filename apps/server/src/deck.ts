// From a Soul's deck to the options its mind chooses among, and from a card's
// depiction program to concrete engine steps. This is the boundary where
// meaning (kernel things) meets the engine (bodies, fixtures, points).
import {menuWorldOf,withRead} from './split/menu-world.ts';
import type { ActivityOption } from '@souls/engine-contract';
import { SPEECH_LINKS, bind, enablers, linked, linksFrom, linksTo, playable, samePlace, whyNot, type KState, type MintedCard, type Thing } from '@souls/kernel';
import type { Mind, WorldHost } from './world.ts';

export type CardOption = ActivityOption & { card: string; hash: string; cardTarget: string | null; approachLen: number; available?:boolean; blockedCode?:string };

/** What the engine needs in order to find a kernel thing: a body, a fixture entity, or a point. */
export function engineRef(host: WorldHost, id: string): string | [number, number] | null {
  const k = host.kernel;
  for (let t: Thing | undefined = k.things[id], n = 0; t && n < 6; t = t.at ? k.things[t.at] : undefined, n++) {
    if (typeof t.traits.body === 'string') return t.traits.body;
    if (typeof t.traits.entity === 'string') return t.traits.entity;
    if(menuWorldOf(host).world.regions[t.id])return t.id;
    if (Array.isArray(t.traits.point)) return t.traits.point as [number, number];
  }
  return null;
}
/** Where a thing physically is, in metres. */
export function positionOf(host: WorldHost, id: string): [number, number] | null {
  const r = engineRef(host, id); if (r === null) return null;
  if (Array.isArray(r)) return r;
  const e = menuWorldOf(host).world.entities[r]; if (e) return [e.pose.p[0], e.pose.p[2]];
  // Keep the region ID for native traversal, but use the adapter's current
  // physical anchor for distance and coordinate bindings. A symbolic `at`
  // relationship does not establish arrival at this point.
  if (!menuWorldOf(host).world.regions[r]) return null;
  const p = menuWorldOf(host).anchors().find((a) => a.id === r)?.point;
  return p?.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null;
}
export function distance(host: WorldHost, a: string, b: string): number {
  const pa = positionOf(host, a), pb = positionOf(host, b);
  return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : 1e6;
}
export const distanceWord = (m: number) => (m < 2.5 ? 'here' : m < 9 ? 'close' : m < 28 ? 'near' : 'far');

/** Replace `$slot` references in depiction params with engine references. */
export function resolveParams(host: WorldHost, v: unknown, b: Record<string, string>): unknown {
  if (typeof v === 'string' && v.startsWith('$')) {
    const [slot, suffix] = v.slice(1).split('.');
    const id = b[slot]; if (!id) return v;
    if (suffix === 'name') return host.kernel.things[id]?.name ?? id;
    if (suffix === 'x' || suffix === 'z') { const p = positionOf(host, id); return p ? p[suffix === 'x' ? 0 : 1] : 0; }
    return engineRef(host, id) ?? id;
  }
  if (Array.isArray(v)) return v.map((x) => resolveParams(host, x, b));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.startsWith('$') ? String(resolveParams(host, k, b)) : k, resolveParams(host, x, b)]));
  return v;
}

function describeTarget(host: WorldHost, me: string, t: Thing): string {
  const k = host.kernel, d = distanceWord(distance(host, me, t.id));
  if (t.kind === 'soul') return `${t.name} (${d}, ${String(t.states.doing ?? host.minds.get(t.id)?.doing ?? 'around')})`;
  if (t.kind === 'gathering') { const n = linksTo(k, t.id, 'attends').length; return `${t.name} (${d}, ${n} taking part${t.states.music === 'playing' ? ', music playing' : ''})`; }
  const here = Object.values(k.things).filter((x) => x.kind === 'soul' && x.at === t.id).length;
  return `${t.name} (${d}${here ? `, ${here} here` : ''})`;
}

/** Things a Soul could act on: for now everything that exists except regions and itself (the world is small). */
export function candidatesFor(host: WorldHost, soulId: string): string[] {
  return Object.values(host.kernel.things).filter((t) => t.id !== soulId && t.kind !== 'region').map((t) => t.id);
}

/** Does a target belong to `of`: is it that thing, or something it hosts, made, holds or otherwise links to? */
type AgendaStep = { card: string; target?: string | null; of?: string | null };
function belongsToIn(k: KState, target: string | null, of: string): boolean {
  if (!target) return false;
  if (target === of) return true;
  if (k.things[target]?.by === of) return true;
  // "Rob's party" is the one he hosts, made or holds: a link that gives control. Merely attending it does not make it his.
  return Object.values(k.links).some((l) => l.from === of && l.to === target && k.vocab.links[l.kind]?.control === true && (l.until === undefined || l.until >= k.tick));
}
export const belongsTo = (host: WorldHost, target: string | null, of: string): boolean => belongsToIn(host.kernel, target, of);
/** Does playing this card on this target match a step of the owner's agenda? */
export const matchesStep = (host: WorldHost, s: { card: string; target?: string | null; of?: string | null } | undefined, card: string, target: string | null) =>
  !!s && s.card === card && (!s.target || s.target === target) && (!s.of || belongsTo(host, target, s.of));
/** The index of the first remaining agenda step this play matches, or -1. A plan is a set of things to get done in order, but a step that is redundant or already true must not block the ones after it. */
export function stepIndex(host: WorldHost, m: Mind, card: string, target: string | null): number {
  for (let i = m.agendaPos; i < m.agenda.length; i++) if (matchesStep(host, m.agenda[i], card, target)) return i;
  return -1;
}
/** The targets an agenda step could be played on, in a given state (which may be a looked-ahead copy). */
const stepTargets = (host: WorldHost, me: string, s: AgendaStep, needsTarget: boolean, cands: string[]) => (k: KState): (string | null)[] =>
  !needsTarget ? [null] : (s.target ? [s.target] : [...cands, ...Object.keys(k.things).filter((id) => !cands.includes(id) && !host.kernel.things[id])]).filter((t) => !s.of || belongsToIn(k, t, s.of));
/** Which remaining step is the plan's current frontier: the first one that could be played on some target now (or, failing that, simply the next). */
export function frontier(host: WorldHost, m: Mind): number {
  const k = host.kernel, me = m.soulId; const cands = candidatesFor(host, me);
  for (let i = m.agendaPos; i < m.agenda.length; i++) {
    const s = m.agenda[i], card = k.vocab.cards[s.card]; if (!card) continue;
    if (stepTargets(host, me, s, !!card.target, cands)(k).some((t) => !whyNot(k, card, me, t))) return i;
  }
  return m.agendaPos;
}
/** Does this option serve the owner's plan right now? */
export const serves = (host: WorldHost, m: Mind, card: string, target: string | null) => m.agendaPos < m.agenda.length && matchesStep(host, m.agenda[frontier(host, m)], card, target);

/** The options the mind chooses among: playable cards, physically feasible, ranked and capped. */
export function optionsFor(host: WorldHost, m: Mind, cap = 12,ordinaryRetainedCards=new Set<string>()): CardOption[] {
  const read=()=>readOptionsFor(host,m,cap,ordinaryRetainedCards);return withRead(menuWorldOf(host),read);
}
/** Registry read keeps supported blocked offers; minds still receive only feasible choices. */
export function registeredOptionsFor(host:WorldHost,m:Mind,cap=128):CardOption[]{
 const read=()=>readOptionsFor(host,m,cap,new Set(),true);
 return withRead(menuWorldOf(host),read);
}
function readOptionsFor(host: WorldHost, m: Mind, cap = 12,ordinaryRetainedCards=new Set<string>(),includeBlocked=false): CardOption[] {
  if (m.life && cap === 12) cap = 24;
  const k = host.kernel, me = m.soulId; k.tick = menuWorldOf(host).world.tick;
  const fr = m.agendaPos < m.agenda.length ? m.agenda[frontier(host, m)] : undefined;
  const servesNow = (card: string, target: string | null) => matchesStep(host, fr, card, target);
  const faults = (host.extra.cardFaults ?? {}) as Record<string,number>;
  const cooldown = (host.extra.cardCooldown ?? {}) as Record<string,number>;
  // Apply runtime failure cooldown before deciding what serves the plan. If
  // its only serving option is removed later by Brain, waiting loses its
  // signal and an unrelated target can win as a spontaneous random choice.
  const registeredGoals=new Set(m.agenda.slice(m.agendaPos).map(s=>s.card));
  for(const card of ordinaryRetainedCards)registeredGoals.add(card);
  const all = playable(k, me, candidatesFor(host, me)).filter(p => (!p.card.name.startsWith('human goal ')||registeredGoals.has(p.card.name)||m.pending?.card===p.card.name)&& (faults[p.card.name] ?? 0) < 3 && (cooldown[p.card.name] ?? 0) <= k.tick
    && !(m.avoid && m.avoid.untilTick > k.tick && m.avoid.id === p.id));
  // Looking one step ahead: if the plan's step cannot be played yet, any play that brings it closer serves the plan
  // (going where it happens, leaving what stands in the way). Nobody has to write those steps down.
  let travel = new Set<string>();
  if (fr && !all.some((p) => servesNow(p.card.name, p.target))) {
    const card = k.vocab.cards[fr.card];
    if (card) travel = enablers(k, me, { card, targets: stepTargets(host, me, fr, !!card.target, candidatesFor(host, me)) }, all.filter((p) => p.card.name !== fr.card));
  }
  const scored: { o: CardOption; score: number }[] = [];
  const perCard = new Map<string, number>();
  const plays = all.map((p) => {
    const t = p.target ? k.things[p.target] : null;
    const d = t ? distance(host, me, t.id) : 0;
    let score = 0;
    if (servesNow(p.card.name, p.target) || travel.has(p.id)) score += 1000;
    if (p.card.name === 'say yes' || p.card.name === 'say no') score += 300;                  // someone is waiting
    if (t && samePlace(k, me, t.id)) score += 40;
    if (t?.kind === 'gathering') score += 25;
    if (!t) score += 10;
    if (p.card.name === 'wait') score += m.life ? 5 : 200;                                                 // always on offer
    if (m.life) {
      const text = `${p.card.name} ${p.card.summary} ${p.card.good_when ?? ''}`.toLowerCase(), n = m.life.needs;
      if (p.card.by === 'world' && p.card.origin !== 'base') score += 45;
      if (/sleep/.test(text)) score += (100-n.energy)/2 - (n.energy > 60 ? 80 : 0);
      if (/eat a bowl|share a meal|finish the bowl|join .*supper/.test(text)) score += n.hunger/2;
      if (/rest|sit/.test(text)) score += (100-n.energy)/5;
      if (/talk|fire|music|class/.test(text)) score += n.company/10;
      if (/garden|work|read|draw|walk|wander/.test(text)) score += n.restlessness/10;
      if (m.recent.some(a => a.startsWith(p.card.name))) score -= 40;
    }
    score -= Math.min(30, d / 3);
    return { p, t, score };
  }).sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1));
  for (const { p, t, score } of plays) {
    if(scored.length>=cap&&!ordinaryRetainedCards.has(p.card.name))continue;
    const n = perCard.get(p.card.name) ?? 0;
    if (n >= 3 && score < 1000) continue;                                                     // at most three targets per card
    const b = bind(k, p.card, me, p.target); if (!b) continue;
    const steps = [...p.card.approach, ...p.card.during].map((s) => ({ verb: s.verb, params: resolveParams(host, s.params, b) as Record<string, unknown> }));
    // physical feasibility of the first step, asked of the engine (Mars: verb.plan)
    const issue=steps.length?menuWorldOf(host).feasibility.canPerform({actor:m.entityId,label:p.card.name,steps}):null;
    if(issue&&!includeBlocked)continue;
    perCard.set(p.card.name, n + 1);
    const label = `${p.card.name}${t ? `: ${describeTarget(host, me, t)}` : ''}`;
    scored.push({ score, o: {
      id: p.id, template: p.card.name, label, goodWhen: p.card.good_when ?? p.card.summary, notFor: p.card.not_for, target: p.target ?? undefined,
      servesIntent: servesNow(p.card.name, p.target) || travel.has(p.id), steps, durationHint: p.card.takes,
      card: p.card.name, hash: p.card.hash, cardTarget: p.target, approachLen: p.card.approach.length,
      ...(includeBlocked?{available:!issue,...(issue?{blockedCode:issue.code}:{})}:{}),
    } });
    if (scored.length >= cap+ordinaryRetainedCards.size) break;
  }
  // If the plan's current step cannot be played yet, waiting is what serves the plan.
  if (m.agenda[m.agendaPos] && !scored.some((x) => x.o.servesIntent)) { const w = scored.find((x) => x.o.card === 'wait'); if (w) { w.o.servesIntent = true; w.o.goodWhen = 'the plan’s next step is not possible yet: stay and wait for it'; } }
  return scored.map((s) => s.o);
}

/** Who this Soul has asked something and not yet heard back from (they are here, and the question still hangs in the air). */
export function awaiting(host: WorldHost, me: string): string[] {
  const k = host.kernel; k.tick = menuWorldOf(host).world.tick;
  return linksFrom(k, me, 'asked').map((l) => l.to).filter((to) => samePlace(k, me, to));
}

/** The Soul's social situation in words, for its mind (and for agents through `perceive`). */
export function situationOf(host: WorldHost, m: Mind): { situation: string[]; heard: { who: string; act: string; about?: string; from: string }[] } {
  const k = host.kernel, me = m.soulId; k.tick = menuWorldOf(host).world.tick;
  const self = k.things[me]; if (!self) return { situation: [], heard: [] };
  const out: string[] = [];
  const name = (id: string) => k.things[id]?.name ?? id;
  for (const g of Object.values(k.things).filter((t) => t.kind === 'gathering')) {
    const mine = linked(k, 'attends', me, g.id), hosting = linked(k, 'hosts', me, g.id), here = samePlace(k, me, g.id);
    if (!mine && !hosting && !here && distance(host, me, g.id) > 40) continue;
    const host_ = linksTo(k, g.id, 'hosts')[0], n = linksTo(k, g.id, 'attends').length;
    const roles = linksTo(k, g.id).filter((l) => !['attends', 'hosts', 'dancing at'].includes(l.kind) && !SPEECH_LINKS.has(l.kind)).map((l) => `${name(l.from)} ${l.kind}`);
    out.push(`${g.name} is ${here ? 'here' : `at ${g.at ? name(g.at) : 'somewhere'}`}: hosted by ${host_ ? (host_.from === me ? 'you' : name(host_.from)) : 'nobody'}, ${n} taking part${g.states.music === 'playing' ? ', music is playing' : ''}${roles.length ? `, ${roles.join(', ')}` : ''}${mine ? ' (you are part of it)' : ''}`);
  }
  const waitingOn = awaiting(host, me);
  for (const l of linksFrom(k, me, 'asked')) { const d = (l.data ?? {}) as { about?: string }; if (waitingOn.includes(l.to)) out.push(`you asked ${name(l.to)}${d.about ? ` about ${d.about}` : ''} and are waiting for an answer`); }
  for (const l of linksTo(k, me, 'agreed')) out.push(`${name(l.from)} agreed to your request`);
  const heard = linksTo(k, me, 'said').map((l) => { const d = l.data as { act?: string; about?: string }; return { who: name(l.from), from: l.from, act: d?.act ?? 'spoke', ...(d?.about ? { about: String(d.about) } : {}) }; });
  const step = m.agendaPos < m.agenda.length ? m.agenda[frontier(host, m)] : undefined;
  if (step) {
    const card = k.vocab.cards[step.card];
    const targets = (step.target ? [step.target] : candidatesFor(host, me)).filter((t) => !step.of || belongsTo(host, t, step.of));
    const possible = card && (card.target ? targets.some((t) => !whyNot(k, card, me, t)) : !whyNot(k, card, me, null));
    out.push(`your owner's plan, step ${m.agenda.indexOf(step) + 1} of ${m.agenda.length}: ${step.card}${step.target ? ` (${name(step.target)})` : step.of ? ` (${name(step.of)}’s)` : ''}${possible ? '' : ': not possible yet'}`);
  } else if (m.agenda.length) out.push("your owner's plan is complete");
  return { situation: out, heard };
}

/** For the owner's dashboard: every card in the deck, and whether it can be played now (and on what, or why not). */
export function deckView(host: WorldHost, m: Mind) {
  const k = host.kernel, me = m.soulId; k.tick = menuWorldOf(host).world.tick;
  const deck = k.decks[me] ?? { cards: [], manners: [] };
  const cands = candidatesFor(host, me);
  const cards = deck.cards.map((n) => k.vocab.cards[n]).filter((c): c is MintedCard => !!c).map((c) => {
    const ok = c.target ? cands.filter((t) => !whyNot(k, c, me, t)) : (whyNot(k, c, me, null) ? [] : ['']);
    const nearest = c.target ? cands.filter((t) => k.things[t].kind === c.target!.kind || c.target!.kind === 'any').sort((a, b) => distance(host, me, a) - distance(host, me, b))[0] : null;
    return {
      name: c.name, summary: c.summary, origin: c.origin, by: c.by === 'world' ? 'world' : (k.things[c.by]?.name ?? c.by), target: c.target?.kind ?? null, plays: host.counts[c.name] ?? 0, wants: c.wants ?? [],
      playableOn: ok.filter(Boolean).slice(0, 6).map((t) => k.things[t]?.name ?? t), playable: ok.length > 0,
      whyNot: ok.length ? null : c.target ? (nearest ? whyNot(k, c, me, nearest) : `there is no ${c.target.kind}`) : whyNot(k, c, me, null),
    };
  });
  return { cards, manners: deck.manners.map((n) => ({ name: n, summary: k.vocab.manners[n]?.summary ?? '' })), agenda: m.agenda.map((s, i) => ({ ...s, targetName: s.target ? (k.things[s.target]?.name ?? s.target) : s.of ? `${k.things[s.of]?.name ?? s.of}’s` : null, done: i < m.agendaPos })), agendaPos: m.agendaPos };
}
