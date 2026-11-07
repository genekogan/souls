import { useState } from 'react';
import type { BrainCall } from '@souls/protocol';
import type { Api, Souls } from './useSouls.ts';

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`);
const J = ({ v }: { v: unknown }) => <pre className="json">{JSON.stringify(v, null, 2)}</pre>;

function Probs({ p, chosen }: { p: Record<string, number>; chosen?: string }) {
  const rows = Object.entries(p).sort((a, b) => b[1] - a[1]);
  return <table><tbody>{rows.map(([k, v]) => <tr key={k}><td className={k === chosen ? 'acc' : ''}>{k === chosen ? '▶ ' : '  '}{k}</td><td><span className="bar" style={{ width: Math.round(v * 160) }} />{(v * 100).toFixed(0)}%</td></tr>)}</tbody></table>;
}

function appliedSummary(c: BrainCall): string {
  const a = c.applied as any;
  if (c.error && !a) return `error: ${c.error}`;
  if (!a) return '';
  if (c.tier === 'mid') return a.dropped ? a.dropped : a.option === 'continue' ? `continue (rethink in ${a.reevalSeconds}s)` : `${a.label} [${a.option}]`;
  if (c.tier === 'translate') return a.ok ? `intent: ${a.intent.goal}${a.intent.target ? ' → ' + a.intent.target : ''} (${(a.confidence * 100).toFixed(0)}%)` : `not understood: ${a.reason}`;
  if (c.tier === 'director') return `shot: ${a.shot}${a.ticker?.length ? ` · ticker +${a.ticker.length}` : ''}`;
  if (c.tier === 'narrator') return `${a.plan?.beats?.length ?? 0} beats — ${a.plan?.summary ?? ''}`;
  if (c.tier === 'shot') return `shot: ${a.shot}`;
  return '';
}

function Prompt({ v, api }: { v: any; api?: Api }) {
  const [text, setText] = useState<string | null>(typeof v === 'string' ? v : null);
  if (text !== null) return <pre className="json">{text}</pre>;
  return <p className="dim">stored once as {v?.$prompt} ({v?.chars} characters) {api && <button onClick={async () => setText(String((await api(`/v1/prompt/${v.$prompt}`)).data))}>show</button>}</p>;
}

export function Call({ c, open, api }: { c: BrainCall; open?: boolean; api?: Api }) {
  const req = c.request as any, res = c.response as any, a = c.applied as any;
  const [shown, setShown] = useState(!!open);   // the body is built only once opened: it serialises whole requests
  const jev = c.tier === 'mid' && !!req?.questions?.next;
  return (
    <details className="call" open={open} onToggle={(e) => setShown((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className={`tag ${c.tier}`}>{c.tier}</span><b>{c.subject}</b> <span className="dim">t{c.tick} · {c.model} · {c.ms.toFixed(0)} ms · {c.inputTokens} in{c.outputTokens ? ` / ${c.outputTokens} out` : ''}{c.cachedTokens ? ` (${c.cachedTokens} cached)` : ''} · {usd(c.costUsd)}{a?.trigger ? ` · trigger: ${a.trigger}` : ''}</span>
        {c.error && <span className="bad"> · {c.error}</span>}
        <div style={{ paddingLeft: 12 }}>→ {appliedSummary(c)}</div>
      </summary>
      {shown && <div style={{ padding: '6px 0 6px 12px' }}>
        {c.tier === 'mid' && !jev && <>
          <p className="dim">{a?.how === 'reflex' ? `Decided by reflex, with no model call: ${a?.why ?? ''}.` : 'Decided without a model call.'}</p><J v={req} />
          <p className="dim">APPLIED: becomes a logged decision event</p><J v={a} />
        </>}
        {jev && <>
          <p className="dim">1. CONTEXT we gave Jev (the state: word-bucketed, no numbers, at most 8 nearby things; user-written text sits in named fields)</p><J v={req.state} />
          <p className="dim">2. OPTIONS the engine enumerated as feasible now, each with when it is right and when it is not. Jev may only pick one of these; the verb params were bound by code.</p><J v={req.questions.next} />
          {res?.answers?.next && <><p className="dim">3. ANSWER: a calibrated probability per option (confidence {(res.answers.next.confidence * 100).toFixed(0)}%). Policy: {a?.how === 'continue' ? `keep going (keep_going ${(a.keepGoing * 100).toFixed(0)}% ≥ 70%)` : a?.how === 'argmax' ? `take the top option (top ${(a.topP * 100).toFixed(0)}% ≥ threshold)` : a?.how === 'sampled' ? `near-tie: sample among ${a.pool?.length} plausible options (never ones Jev rated near zero)` : a?.how}</p>
            <Probs p={res.answers.next.probabilities} chosen={Object.entries(a?.optionKeys ?? {}).find(([, id]) => id === a?.option)?.[0]} />
            <p className="dim">riding along in the same request (separate, narrow judgments):</p>
            <div className="kv"><span>pace (Score)</span><span>{res.answers.pace?.score?.toFixed(2)} → rethink in {a?.reevalSeconds}s</span>
              <span>sociable (Noul)</span><span>{res.answers.sociable ? `${(res.answers.sociable.noul * 100).toFixed(0)}%` : '—'}</span>
              {res.answers.keep_going && <><span>keep_going (Noul)</span><span>{(res.answers.keep_going.noul * 100).toFixed(0)}%</span></>}
              <span>mood (derived in code)</span><span>{a?.mood}</span></div></>}
          <p className="dim">4. APPLIED: becomes a logged decision event; the engine runs these verb steps</p><J v={a} />
        </>}
        {c.tier === 'narrator' && req && <>
          <p className="dim">SYSTEM prompt (the cached block)</p><Prompt v={req.system?.[0]?.text} api={api} />
          <p className="dim">DIGEST for this region (the only uncached input)</p><pre className="json">{req.messages?.[0]?.content}</pre>
          <p className="dim">PLAN returned (beats fire later as scene events and become nudges in Jev’s context)</p><J v={a?.plan} />
          <p className="dim">usage</p><J v={res?.usage} />
        </>}
        {c.tier !== 'mid' && c.tier !== 'narrator' && <>
          <p className="dim">REQUEST</p><J v={req} />
          <p className="dim">RESPONSE</p><J v={res?.answers ?? res} />
          <p className="dim">APPLIED</p><J v={a} />
        </>}
      </div>}
    </details>
  );
}

export function BrainPanel({ sim, authed, selected, api, isAdmin }: { sim: Souls; authed: boolean; selected: string | null; api: Api; isAdmin: boolean }) {
  const [tier, setTier] = useState('all');
  const b = sim.stats?.brain;
  const selName = selected ? sim.conn.replica.souls.get(selected)?.name : null;
  const calls = sim.brain.filter((c) => (tier === 'all' || c.tier === tier) && (!selName || c.subject === selName || c.tier === 'narrator' || c.tier === 'director')).slice(-60).reverse();
  const recent = sim.brain.filter((c) => c.tier === 'mid' && Date.now() - c.at < 300_000);
  return (
    <section className="wide">
      <h2>Brain — every model call: what it was given, what it answered, what we did with it</h2>
      {b && <div className="kv" style={{ marginBottom: 8 }}>
        <span>mode</span><span>{b.mode} · {b.inflight} in flight</span>
        <span>last 24 h</span><span>{b.callsToday} calls{b.costToday !== undefined && b.budget !== undefined ? <> · {usd(b.costToday)} of ${b.budget.toFixed(2)} budget{b.costToday >= b.budget ? <b className="bad"> · OVER BUDGET: deterministic fallback</b> : ''}</> : null}</span>
        <span>Jev latency</span><span>{b.jevMsAvg.toFixed(0)} ms average</span>
        <span>mid-brain cadence</span><span>{recent.length} calls in the last 5 min{sim.stats?.souls ? ` ≈ one per soul every ${recent.length ? Math.round((300 * sim.stats.souls) / recent.length) : '∞'} s` : ''}</span>
      </div>}
      <p className="note">Three tiers. <b>mid</b>: Jev picks a Soul’s next activity from engine-enumerated options, on new intent, when an activity ends, on a narrator beat, or on a timer Jev sets itself. <b>narrator</b>: a small LLM plans beats for one region every ~5 minutes. <b>director</b>: Jev picks the broadcast shot and ticker lines. <b>translate</b>: your typed command → closed intent.</p>
      {!authed ? <p className="dim">Sign in to see model calls.</p> : <>
        <div className="row">{['all', 'mid', 'translate', 'narrator', 'director', 'shot'].map((k) => <button key={k} className={k === tier ? 'primary' : ''} onClick={() => setTier(k)}>{k}</button>)}{selName && <span className="dim">filtered to {selName} (click the row again to clear)</span>}</div>
        <div className="scroll" style={{ maxHeight: 640 }}>{calls.length ? calls.map((c) => <Call key={c.id} c={c} api={api} />) : <p className="dim">no calls yet</p>}
        {!isAdmin && <p className="dim">You see the thinking of your own Souls. World-level calls (storyteller, camera) are visible to the operator only.</p>}</div>
      </>}
    </section>
  );
}

export function NarrativePanel({ sim }: { sim: Souls }) {
  const tick = sim.stats?.tick ?? sim.conn.replica.tick;
  const views = Object.values(sim.narratives).sort((a, b) => a.region.localeCompare(b.region));
  return (
    <section className="wide">
      <h2>Narrator — per-region plans (regions are planned at different times, on purpose)</h2>
      {views.length === 0 && <p className="dim">No plan yet. Each region gets its first plan within a few minutes of boot; empty regions are skipped.</p>}
      <div className="grid" style={{ marginTop: 0 }}>
        {views.map((v) => (
          <div key={v.region}>
            <b>{v.region}</b> <span className="dim">planned at t{v.tick} ({Math.round((tick - v.tick) / 20)} s ago) · next plan in {Math.max(0, Math.round((v.nextRunTick - tick) / 20))} s</span>
            <p>{v.summary}</p>
            <table><tbody>{v.beats.map((b, i) => <tr key={i}><td className={b.fired ? 'ok' : 'dim'}>{b.fired ? 'fired' : `in ${Math.max(0, Math.round((b.fireTick - tick) / 20))} s`}</td><td>{b.kind}</td><td className="acc">{b.directive}</td><td>{b.targets.join(', ')}</td><td className="wrap dim">{b.flavor}</td></tr>)}{v.beats.length === 0 && <tr><td className="dim">no beats (quiet)</td></tr>}</tbody></table>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BroadcastPanel({ sim }: { sim: Souls }) {
  const c = sim.camera;
  return (
    <section>
      <h2>Broadcast — what an anonymous viewer would be shown</h2>
      {c ? <><div><b>CAMERA</b> {c.text} <span className="dim">(held {c.heldSec}s, chosen at t{c.tick})</span></div><pre className="json" style={{ maxHeight: 110 }}>{JSON.stringify(c.shot)}</pre></> : <p className="dim">The director runs while at least one client is connected; first shot arrives within a few seconds.</p>}
      <div style={{ marginTop: 8 }}><b>TICKER</b></div>
      <div className="scroll" style={{ maxHeight: 180 }}>{sim.ticker.length ? sim.ticker.slice().reverse().map((l, i) => <div key={i}><span className="dim">t{l.tick}</span> {l.text}</div>) : <span className="dim">nothing announced yet</span>}</div>
      <p className="note">The shot is a Mars-engine ShotSpec chosen by Jev among code-enumerated candidates. The suggested shot is shown here as data; use the follow control to follow a Soul in the scene.</p>
    </section>
  );
}
