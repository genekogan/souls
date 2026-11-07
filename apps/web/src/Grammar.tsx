// The meaning layer, made visible: what exists (things, links), what happened
// (plays as sentences, with the changes each one made), the words the world has
// (kinds, links, manners, cards), what was said, and what the engine could not show.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { KernelView, PlayView } from '@souls/protocol';
import type { Api, Souls } from './useSouls.ts';

type Change = PlayView['changes'][number];
const nameIn = (k: KernelView | null) => (id: string | null | undefined) => (id ? (k?.things[id]?.name ?? id) : 'nowhere');
const val = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
const ago = (tick: number, now: number) => { const s = Math.max(0, Math.round((now - tick) / 20)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };

/** One change in plain words. There are only five kinds of change; everything a card does is made of these. */
function changeText(c: Change, name: (id: string | null | undefined) => string, names: Map<string, string>): string {
  const n = (id: string | null | undefined) => (id && names.get(id)) || name(id);
  switch (c.op) {
    case 'appear': return `made ${c.name} (a ${c.kind}) at ${n(c.at)}`;
    case 'vanish': return `${n(c.id)} is gone`;
    case 'set': return c.value === null ? `${n(c.id)}: ${c.key} cleared` : `${n(c.id)}: ${c.key} = ${val(c.value)}`;
    case 'move': return `${n(c.id)} is now at ${n(c.to)}`;
    case 'link': return `${n(c.from)} —${c.kind}→ ${n(c.to)}${c.until !== undefined ? ' (for a while)' : ''}`;
    case 'unlink': return `${n(c.from)} no longer ${c.kind} ${n(c.to)}`;
    case 'say': return `${n(c.from)} said “${c.act}” to ${n(c.to)}${c.about ? `, about ${val(c.about)}` : ''}`;
  }
}
const OPS: Record<Change['op'], string> = { appear: 'appear', vanish: 'vanish', set: 'set', move: 'move', link: 'link', unlink: 'unlink', say: 'say' };

export function SentencesPanel({ sim, soulId, limit = 40 }: { sim: Souls; soulId?: string; limit?: number }) {
  const name = nameIn(sim.kernel), now = sim.conn.displayTick();
  const rows = sim.plays.filter((p) => !soulId || p.soulId === soulId).slice(-limit).reverse();
  // things that have since vanished are still named in the record of what happened to them
  const past = new Map<string, string>();
  for (const p of sim.plays) { if (p.target && p.targetName) past.set(p.target, p.targetName); for (const c of p.changes) if (c.op === 'appear') past.set(c.id, c.name); }
  return (
    <section className={soulId ? '' : 'wide'}>
      <h2>{soulId ? 'What it did — plays and what each one changed' : 'What happened — every action is a sentence: who, in what manner, which card, on what'}</h2>
      <div className="scroll">
        {rows.map((p) => {
          const names = past;
          return (
            <div key={p.seq} style={{ marginBottom: 6 }}>
              <span className="dim">{ago(p.tick, now)} </span><b>{p.soul}</b>{p.manner && <span className="dim"> {p.manner}</span>} <span className="acc">{p.card}</span>{p.targetName && <> → {p.targetName}</>}
              {!p.ok && <span className="bad"> · did not happen: {p.reason}</span>}
              {p.ok && p.changes.filter((c) => !(c.op === 'set' && c.key === 'doing')).map((c, i) => <div key={i} className="dim" style={{ paddingLeft: 18 }}><span className="tag">{OPS[c.op]}</span> {changeText(c, name, names)}</div>)}
            </div>
          );
        })}
        {rows.length === 0 && <span className="dim">nothing yet</span>}
      </div>
    </section>
  );
}

export function HeardPanel({ sim, soulId }: { sim: Souls; soulId?: string }) {
  const now = sim.conn.displayTick();
  const rows = sim.talk.filter((l) => !soulId || l.from === soulId || l.to === soulId).slice(-30).reverse();
  return (
    <section>
      <h2>{soulId ? 'What was said' : 'Overheard'}</h2>
      <div className="scroll">
        {rows.map((l) => <div key={l.id} style={{ marginBottom: 3 }}><span className="dim">{ago(l.tick, now)} </span><b>{l.fromName}</b><span className="dim"> to {l.toName}{l.act !== 'chat' ? ` (${l.act})` : ''}: </span>{l.text}</div>)}
        {rows.length === 0 && <span className="dim">nobody has spoken yet</span>}
      </div>
      {!soulId && <p className="dim">What a Soul means when it speaks (asks, agrees, declines) is part of the world’s state. The words are written afterwards to fit, and change nothing.</p>}
    </section>
  );
}

type KLink = KernelView['links'][string];
/** Links by their ends, built once per kernel message (the page re-renders five times a second). "knows" is left out: it is shown as a count. */
const indexCache = new WeakMap<object, { from: Map<string, KLink[]>; to: Map<string, KLink[]> }>();
function linkIndex(k: KernelView) {
  let ix = indexCache.get(k.links);
  if (!ix) {
    ix = { from: new Map(), to: new Map() };
    for (const l of Object.values(k.links)) { if (l.kind === 'knows') continue; (ix.from.get(l.from) ?? ix.from.set(l.from, []).get(l.from)!).push(l); (ix.to.get(l.to) ?? ix.to.set(l.to, []).get(l.to)!).push(l); }
    indexCache.set(k.links, ix);
  }
  return ix;
}

export function ThingsPanel({ sim }: { sim: Souls }) {
  const k = sim.kernel; if (!k) return <section><h2>Things</h2><span className="dim">loading…</span></section>;
  const name = nameIn(k);
  const things = Object.values(k.things).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const links = Object.values(k.links);
  const { from, to } = linkIndex(k);
  return (
    <section className="wide">
      <h2>Things — everything that exists ({things.length}), where it is, and how it is connected</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>kind</th><th>name</th><th>at</th><th>states</th><th>links from it</th><th>links to it</th></tr></thead>
          <tbody>
            {things.map((t) => (
              <tr key={t.id}>
                <td className="dim">{t.kind}</td><td><b>{t.name}</b></td><td>{t.at ? name(t.at) : <span className="dim">—</span>}</td>
                <td className="wrap">{Object.entries(t.states).map(([key, v]) => <span key={key} style={{ marginRight: 10 }}><span className="dim">{key}</span> {val(v)}</span>)}</td>
                <td className="wrap">{(from.get(t.id) ?? []).map((l, i) => <span key={i} style={{ marginRight: 10 }}><span className={k.vocab.links[l.kind]?.control ? 'acc' : 'dim'}>{l.kind}</span> {name(l.to)}</span>)}</td>
                <td className="wrap">{(to.get(t.id) ?? []).map((l, i) => <span key={i} style={{ marginRight: 10 }}>{name(l.from)} <span className={k.vocab.links[l.kind]?.control ? 'acc' : 'dim'}>{l.kind}</span></span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim">A thing has a kind, a name, a place and a few states. A link is a named connection from one thing to another; <span className="acc">highlighted</span> links give control over their target. “knows” links are hidden here ({links.filter((l) => l.kind === 'knows').length}). State hash {k.hash}.</p>
    </section>
  );
}

export function VocabularyPanel({ sim }: { sim: Souls }) {
  const k = sim.kernel; if (!k) return null;
  const used = new Map<string, number>(); for (const l of Object.values(k.links)) used.set(l.kind, (used.get(l.kind) ?? 0) + 1);
  const kindsInUse = new Map<string, number>(); for (const t of Object.values(k.things)) kindsInUse.set(t.kind, (kindsInUse.get(t.kind) ?? 0) + 1);
  const allKinds = [...new Set([...Object.keys(k.vocab.kinds), ...kindsInUse.keys()])].sort();
  return (
    <section>
      <h2>Vocabulary — the words this world has so far</h2>
      <div className="kv">
        <span>the grammar (fixed)</span><span>things · links · time · five changes: <b>appear/vanish</b>, <b>set</b>, <b>move</b>, <b>link/unlink</b>, <b>say</b></span>
        <span>kinds of thing ({allKinds.length})</span><span className="wrap">{allKinds.map((n) => <span key={n} style={{ marginRight: 10 }} title={k.vocab.kinds[n]?.summary ?? 'made by a card'}>{n}<span className="dim"> {kindsInUse.get(n) ?? 0}</span></span>)}</span>
        <span>kinds of link ({Object.keys(k.vocab.links).length})</span><span className="wrap">{Object.entries(k.vocab.links).map(([n, d]) => <span key={n} style={{ marginRight: 10 }} className={d.control ? 'acc' : ''} title={d.summary}>{n}<span className="dim"> {used.get(n) ?? 0}</span></span>)}</span>
        <span>manners ({Object.keys(k.vocab.manners).length})</span><span className="wrap">{Object.entries(k.vocab.manners).map(([n, d]) => <span key={n} style={{ marginRight: 10 }} title={d.summary}>{n}</span>)}</span>
        <span>cards ({Object.keys(k.vocab.cards).length})</span><span>{Object.values(k.vocab.cards).filter((c) => c.origin === 'base').length} the world began with · {Object.values(k.vocab.cards).filter((c) => c.origin === 'compiled').length} compiled from owners’ wishes · {Object.values(k.vocab.cards).filter((c) => c.origin === 'agent').length} proposed by owners’ agents</span>
      </div>
      <p className="dim">Everything except the first line is content that was added, and more can be. Numbers are how many exist right now. Hover for meanings.</p>
    </section>
  );
}

export function LibraryPanel({ sim }: { sim: Souls }) {
  const k = sim.kernel; const [open, setOpen] = useState<string | null>(null);
  if (!k) return null;
  const name = nameIn(k);
  const inDecks = new Map<string, number>(); for (const d of Object.values(k.decks)) for (const c of d.cards) inDecks.set(c, (inDecks.get(c) ?? 0) + 1);
  const cards = Object.values(k.vocab.cards).sort((a, b) => Number(a.origin === 'base') - Number(b.origin === 'base') || b.mintedAt - a.mintedAt || a.name.localeCompare(b.name));
  return (
    <section className="wide">
      <h2>The card library — every action that exists; new ones are minted when a wish needs them</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>card</th><th>on a</th><th>from</th><th>by</th><th>played</th><th>in decks</th><th>what it does</th></tr></thead>
          <tbody>
            {cards.map((c) => (
              <Fragment key={c.name}>
                <tr className="click" onClick={() => setOpen(open === c.name ? null : c.name)}>
                  <td><b className={c.origin === 'base' ? '' : 'acc'}>{c.name}</b></td><td className="dim">{c.target?.kind ?? '—'}</td>
                  <td className={c.origin === 'base' ? 'dim' : 'warn'}>{c.origin === 'base' ? 'the world' : c.origin === 'compiled' ? 'a wish' : 'an agent'}</td>
                  <td className="dim">{c.by === 'world' ? '' : name(c.by)}</td><td>{k.plays[c.name] ?? 0}</td><td className="dim">{inDecks.get(c.name) ?? 0}</td>
                  <td className="wrap">{c.summary}{c.wants?.length ? <span className="dim"> · wants: {c.wants.join(', ')}</span> : null}</td>
                </tr>
                {open === c.name && <tr><td colSpan={7}><pre className="json">{JSON.stringify({ when: c.when, then: c.then, derive: c.derive, approach: c.approach, during: c.during, wants: c.wants, hash: c.hash }, null, 1)}</pre></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim">Click a card to see its conditions (<i>when</i>), its changes (<i>then</i>) and how the body shows it (<i>approach</i>, <i>during</i>). A minted card is checked against the world’s rules first: an actor changes only itself, what it controls, and what it made.</p>
    </section>
  );
}

/** Motions cards asked for that the engine cannot show yet, ranked by how often those cards are played. */
export function BacklogPanel({ sim }: { sim: Souls }) {
  const k = sim.kernel; if (!k) return null;
  const want = new Map<string, { plays: number; cards: Set<string> }>();
  for (const c of Object.values(k.vocab.cards)) for (const w of c.wants ?? []) { const x = want.get(w) ?? { plays: 0, cards: new Set<string>() }; x.plays += k.plays[c.name] ?? 0; x.cards.add(c.name); want.set(w, x); }
  const rows = [...want.entries()].sort((a, b) => b[1].plays - a[1].plays || a[0].localeCompare(b[0]));
  const total = Object.values(k.plays).reduce((a, b) => a + b, 0), wanting = Object.values(k.vocab.cards).filter((c) => c.wants?.length).reduce((a, c) => a + (k.plays[c.name] ?? 0), 0);
  return (
    <section>
      <h2>Animation to-do — what the world meant and the engine could not show</h2>
      <table>
        <thead><tr><th>motion wanted</th><th>times needed</th><th>by cards</th></tr></thead>
        <tbody>{rows.map(([w, x]) => <tr key={w}><td>{w}</td><td>{x.plays}</td><td className="dim wrap">{[...x.cards].join(', ')}</td></tr>)}</tbody>
      </table>
      {rows.length === 0 && <span className="dim">nothing yet</span>}
      <p className="dim">The world can mean more than the engine can draw. {total ? `${Math.round((100 * wanting) / total)}% of plays so far` : 'No plays yet'} used a card that wanted a motion it did not get; the meaning still happened.</p>
    </section>
  );
}

type DeckView = {
  cards: { name: string; summary: string; origin: string; by: string; target: string | null; plays: number; wants: string[]; playableOn: string[]; playable: boolean; whyNot: string | null }[];
  manners: { name: string; summary: string }[]; agenda: { card: string; targetName: string | null; done: boolean }[]; agendaPos: number;
};
/** One Soul's deck, for its owner: its plan, its manners, and each card with whether it can be played now. */
export function DeckPanel({ api, soulId, name, sim }: { api: Api; soulId: string; name: string; sim: Souls }) {
  const [d, setD] = useState<DeckView | null>(null);
  const beat = Math.floor(sim.conn.displayTick() / 100);
  useEffect(() => { let live = true; void api<DeckView>(`/v1/souls/${soulId}/deck`).then((r) => { if (live && r.status === 200) setD(r.data); }); return () => { live = false; }; }, [soulId, beat]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section><h2>{name}’s deck</h2><span className="dim">loading…</span></section>;
  return (
    <section className="wide">
      <h2>{name}’s deck — the actions it can take, and its plan</h2>
      <div className="kv" style={{ marginBottom: 8 }}>
        <span>plan</span><span className="wrap">{d.agenda.length === 0 ? <span className="dim">none: it does as it pleases</span> : d.agenda.map((a, i) => <span key={i} style={{ marginRight: 12 }} className={a.done ? 'dim' : i === d.agendaPos ? 'acc' : ''}>{a.done ? '✓' : i === d.agendaPos ? '▸' : '·'} {a.card}{a.targetName ? ` (${a.targetName})` : ''}</span>)}</span>
        <span>manners</span><span className="wrap">{d.manners.map((m) => <span key={m.name} style={{ marginRight: 12 }} title={m.summary}>{m.name}</span>)}<span className="dim"> how it tends to do things; chosen to suit its description</span></span>
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th>card</th><th>now?</th><th>played</th><th>what it does</th></tr></thead>
          <tbody>
            {d.cards.map((c) => (
              <tr key={c.name}>
                <td><b className={c.origin === 'base' ? '' : 'acc'}>{c.name}</b>{c.origin !== 'base' && <span className="dim"> · {c.origin === 'compiled' ? 'made for a wish' : 'from an agent'}{c.by !== name ? ` (${c.by})` : ''}</span>}</td>
                <td className="wrap">{c.playable ? <span className="ok">yes{c.playableOn.length ? `: ${c.playableOn.join(', ')}` : ''}</span> : <span className="dim">no: {plainWhy(c.whyNot)}</span>}</td>
                <td>{c.plays}</td><td className="wrap">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
/** A failed condition, in words. */
function plainWhy(w: string | null): string {
  if (!w) return '';
  const m = /condition not met: (.*)$/.exec(w); if (!m) return w;
  try {
    const c = JSON.parse(m[1]) as Record<string, unknown[]>; const [k, v] = Object.entries(c)[0]; const who = (x: unknown) => String(x).replace('$actor', 'it').replace('$target', 'the target').replace(/^\$/, 'the ');
    if (k === 'at') return `${who(v[0])} is not where ${who(v[1])} is`;
    if (k === 'notAt') return 'already there';
    if (k === 'linked') return `needs “${v[0]}” from ${who(v[1])} to ${who(v[2])}`;
    if (k === 'notLinked') return `already “${v[0]}” (${who(v[1])} → ${who(v[2])})`;
    if (k === 'noneLinkedTo') return `someone is already “${v[0]}” there`;
    if (k === 'state') return `${who(v[0])} is not ${v[1]}: ${val(v[2])}`;
    if (k === 'notState') return `${who(v[0])} is ${v[1]}: ${val(v[2])}`;
    if (k === 'said') return `${who(v[0])} has not said “${v[2]}”`;
  } catch { /* fall through */ }
  return w;
}

/** The open design questions, each beside what the running world shows about it. */
export function NotebookPanel({ sim }: { sim: Souls }) {
  const k = sim.kernel; if (!k) return <section className="wide"><h2>Notebook</h2><span className="dim">loading…</span></section>;
  const plays = sim.plays, ok = plays.filter((p) => p.ok), refused = plays.filter((p) => !p.ok);
  const ops = new Map<string, number>(); for (const p of ok) for (const c of p.changes) ops.set(c.op, (ops.get(c.op) ?? 0) + 1);
  const reasons = new Map<string, number>(); for (const p of refused) { const r = (p.reason ?? '').replace(/condition not met.*/, 'a condition no longer held').replace(/“.*?”|".*?"/g, '…'); reasons.set(r, (reasons.get(r) ?? 0) + 1); }
  const cards = Object.values(k.vocab.cards), minted = cards.filter((c) => c.origin !== 'base');
  const inDecks = new Map<string, number>(); for (const d of Object.values(k.decks)) for (const c of d.cards) inDecks.set(c, (inDecks.get(c) ?? 0) + 1);
  const shared = minted.filter((c) => (inDecks.get(c.name) ?? 0) > 1).length;
  const says = ok.flatMap((p) => p.changes).filter((c) => c.op === 'say').length;
  const things = Object.values(k.things), made = things.filter((t) => t.by && t.by !== 'world' && t.kind !== 'soul');
  const Q = ({ q, children }: { q: string; children: ReactNode }) => <div style={{ marginBottom: 12 }}><div><b>{q}</b></div><div className="dim" style={{ paddingLeft: 14 }}>{children}</div></div>;
  return (
    <section className="wide">
      <h2>Notebook — open design questions, beside what this running world shows (last {plays.length} plays)</h2>
      <Q q="1. Is the grammar small enough, and enough? (things, links, time, five changes)">
        Changes made: {[...ops.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(' · ') || 'none yet'}. {Object.keys(k.vocab.kinds).length} kinds of thing, {Object.keys(k.vocab.links).length} kinds of link, {cards.length} cards, all of it content. Nothing so far has needed a sixth kind of change.
      </Q>
      <Q q="2. Can a coherent shared state come out of actions nobody coordinated?">
        {refused.length} of {plays.length} plays were refused{refused.length ? `: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`).join('; ')}` : ''}. A refusal is the world declining a change that was not the actor’s to make, or that stopped being possible on the way there. Every joint outcome (a host and a DJ, a question and its answer) came from separate plays that fit.
      </Q>
      <Q q="3. Does an open vocabulary grow into a shared language, or into clutter?">
        {minted.length} cards have been minted ({minted.filter((c) => c.origin === 'compiled').length} from wishes, {minted.filter((c) => c.origin === 'agent').length} by agents); {shared} of them are in more than one Soul’s deck. {made.length} things exist that a card made. Open: who may retire a card, and whether a card can be improved without breaking its past.
      </Q>
      <Q q="4. How far is what the world means from what the engine can show?">
        See “Animation to-do”. Meaning never waits for depiction: a Soul became a DJ before any engine could draw a turntable.
      </Q>
      <Q q="5. Dialogue: acts are state, words are decoration. Is that the right cut?">
        {says} things were said in these plays; {sim.talk.length} lines of words were written for them. Asking, agreeing and declining change what can happen next; the wording changes nothing. Open: whether a Soul should be able to say something new (a promise, a rumour) that becomes state.
      </Q>
      <Q q="6. How do bodies with several people in one motion fit a world where each acts only for itself?">
        On the Mars engine a conversation borrows the other body only while it is free, and that Soul’s own decision takes it back. Open (doc 19): scenes, where one kernel thing (a class, a meal, a crew) is staged by one engine coordinator and re-staged from the kernel after a restart.
      </Q>
      <p className="dim">Design notes: <code>docs/eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md</code> (the kernel and cards) and <code>docs/eden4/19-MARS-BRIDGE.md</code> (how this compiles down to the Mars engine) in the repository.</p>
    </section>
  );
}
