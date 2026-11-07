import {PairApprove} from './PairApprove.tsx';
import {SoulArrival} from './SoulArrival.tsx';
import {LifecycleStatus,readLifecycle,type LifecycleRead} from './LifecycleStatus.tsx';
import {authIdentity} from './auth-projection.ts';
import {InviteAccess} from './InviteAccess.tsx';
// The signed-in home: invite → create a Soul → steer it here or from your own
// agent → watch its dashboard. One column of cards, in the order a newcomer needs them.
import {isConnectionRefusal} from './connection-response.ts';
import { DeckPanel, HeardPanel, SentencesPanel } from './Grammar.tsx';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
// OWNER-DAY: the "Today" timeline is its own chunk, loaded only on a Soul's home view.
const SoulDay = lazy(() => import('./SoulDay.tsx').then((m) => ({ default: m.SoulDay })));
import { GOALS, type BrainCall, type MandateRule } from '@souls/protocol';
import type { AuthCtx } from './Shell.tsx';
import type { Api, Souls } from './useSouls.ts';
import { Call } from './BrainPanels.tsx';
import { steerReceipt, type SteerReceipt } from './steer-receipt.ts';

type MySoul = { id: string; name: string; description: string; entityId: string; hasToken: boolean; tokenLabel: string | null; tokenCreatedAt: number | null; tokenLastUsed: number | null };
type Dash = { status: any; agent: { attached: boolean; label: string | null; since: number | null; last_used: number | null }; spend: { calls: number; cost: number }; created_at: number };
type TL = { seq: number; tick: number; at: number; kind: string; text: string; why: string | null; mood: string | null; fallback: boolean; call: number | null };
const ago = (ms: number | null) => { if (!ms) return 'never'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

type HomeProps = { sim: Souls; auth: AuthCtx; api: Api; selected: string | null; onSelect(id: string | null): void; pairCode: string | null; clearPair(): void; base: string; allowCreate?: boolean; active?: boolean; worldId?: string; arrivalEnabled?:boolean; onArrivalReady?(id:string):void };
export function SoulHome(props: HomeProps) {
  // Session changes replace all private child state, even while the panel is hidden.
  const identity = props.auth.debug.privyUserId ?? props.auth.label ?? props.sim.me?.userId ?? 'public';
  return <SoulAccount key={JSON.stringify([props.sim.privateAuthorityGeneration??0,props.base,props.worldId,props.auth.authed,identity])} {...props} />;
}
function SoulAccount({ sim, auth, api, selected, onSelect, pairCode, clearPair, base, allowCreate = true, active = true, worldId,arrivalEnabled=false,onArrivalReady }: HomeProps) {
  const [souls, setSouls] = useState<MySoul[] | null>(null);
  const [me, setMe] = useState<any>(null);
  const [maxSouls, setMaxSouls] = useState(5);
  const [lifecycle,setLifecycle]=useState<LifecycleRead>({kind:'absent'});
  const lifecycleSeen=useRef(false);
  const [creating, setCreating] = useState(false);
  const [arrivalGeneration,setArrivalGeneration]=useState(0);
  const [arrivalOutstanding,setArrivalOutstanding]=useState(false);
  const [fresh, setFresh] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!auth.authed || !active) return;
    const request = ++generation.current;
    setFresh(false); setError('');
    const r = await api('/v1/me');
    if (request !== generation.current) return;
    if (r.status === 200 && r.data?.me && r.data.me.userId===authIdentity(auth) && Array.isArray(r.data.souls)) {
      const next=readLifecycle(r.data.lifecycleRequests,worldId);
      if(next.kind!=='absent')lifecycleSeen.current=true;
      setLifecycle(next.kind==='absent'&&lifecycleSeen.current?{kind:'unavailable'}:next);
      setSouls(r.data.souls); setMe(r.data.me); setMaxSouls(r.data.maxSouls); setFresh(true);return r.data.souls as MySoul[];
    } else {
      setSouls(null); setMe(null); setCreating(false);setLifecycle({kind:'unavailable'});
      setError('Account details are unavailable. We’ll check again shortly.');return null;
    }
  }, [api, auth.authed, active,authIdentity(auth),worldId]);
  const authority = JSON.stringify([sim.me?.userId, sim.me?.role, sim.me?.invited, sim.me?.souls]);
  useLayoutEffect(() => {
    if (auth.authed && active) void refresh();
    return () => { generation.current++; };
  }, [refresh, authority, active, auth.authed]);
  // a failed first load (the server restarting, a token not ready yet) is retried rather than left at "loading…"
  useEffect(() => { if (!auth.authed || !active || fresh) return; const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, [auth.authed, active, fresh, refresh]);
  const mine = souls?.find((s) => s.id === selected) ?? null;
  // Multiple account Souls require an explicit choice; never silently retarget a client.

  if (!auth.authed) return (
    <section className="wide">
      <h2>Your Soul</h2>
      <p>Sign in to manage your <b>Soul</b>: an inhabitant that keeps living here and takes direction from you. You can keep watching without an account.</p>
      <button className="primary" onClick={auth.login} disabled={!auth.ready}>sign in</button>
    </section>
  );
  const arrivalIdentity=authIdentity(auth),stagedArrival=arrivalEnabled&&!!worldId&&!!arrivalIdentity;
  const permission = JSON.stringify([me?.userId, me?.role, me?.invited, souls?.map(s => s.id)]);

  return (
    <>
      {stagedArrival&&<SoulArrival key={arrivalGeneration} base={base} worldId={worldId!} identity={arrivalIdentity!} api={api} onPendingChange={setArrivalOutstanding} active={active&&fresh&&!!me?.invited&&(souls?.length===0||creating||arrivalOutstanding)} onReady={async id=>{const current=await refresh();if(current?.some(s=>s.id===id)){setCreating(false);setArrivalOutstanding(false);setArrivalGeneration(n=>n+1);(onArrivalReady??onSelect)(id);}}}/>}
      {!fresh && <section className="wide"><h2>Your Soul</h2><p role="status" className="dim">{error || 'Checking current account…'}</p></section>}
      {souls && me && <div className="account-current" hidden={!fresh} key={permission}>
      {fresh&&me.invited&&<LifecycleStatus initial={lifecycle} worldId={worldId} api={api} refresh={refresh}/> }
      {pairCode && <PairApprove key={pairCode} api={api} code={pairCode} souls={souls} allowCreate={allowCreate||stagedArrival} done={() => { clearPair(); void refresh(); }} />}
      {!me.invited ? <InviteAccess api={api} refresh={refresh} accountCheck={me} />
        : souls.length === 0 && !allowCreate&&!stagedArrival ? <section className="wide"><h2>Your Soul</h2><p>You do not have a Soul in this world yet. Arrival is not open in this view yet. You can keep watching the world.</p></section>
        : stagedArrival&&(souls.length===0||creating||arrivalOutstanding)?null
        : souls.length === 0 || creating ? <Create api={api} first={souls.length === 0} cancel={souls.length ? () => setCreating(false) : undefined} done={async (id) => { setCreating(false); await refresh(); onSelect(id); }} />
        : mine ? <>
          <section className="wide">
            <div className="row" style={{ margin: 0 }}>
              <h2 style={{ margin: 0 }}>Your Souls</h2>
              {souls.map((s) => <button key={s.id} className={s.id === mine.id ? 'primary' : ''} onClick={() => onSelect(s.id)}>{s.name}</button>)}
              {(allowCreate||stagedArrival) && souls.length < maxSouls && <button onClick={() => setCreating(true)}>+ new Soul</button>}
              <span className="dim" style={{ marginLeft: 'auto' }}>{me.email}</span>
            </div>
          </section>
          <Dashboard key={mine.id} sim={sim} api={api} soul={mine} isAdmin={me.role === 'admin'} base={base} refresh={refresh} active={active && fresh} onGone={() => { onSelect(null); void refresh(); }} />
          <section><h2>Account</h2>
            <div className="kv"><span>signed in as</span><span>{me.email ?? auth.label}</span><span>role</span><span>{me.role}</span><span>public owner id</span><span>{me.short}</span></div>

          </section>
        </> : <section><h2>Your Souls</h2><p>Choose which Soul to inspect.</p>{souls.map(s=><button key={s.id} onClick={()=>onSelect(s.id)}>{s.name}</button>)}</section>}
      </div>}
    </>
  );
}

function Create({ api, first, done, cancel }: { api: Api; first: boolean; done(id: string): void; cancel?: () => void }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <section className="wide">
      <h2>{first ? 'Step 2 of 3 — create your Soul' : 'Create another Soul'}</h2>
      <p>A Soul is an inhabitant of the world that belongs to you. Give it a name and one line about who it is. That line is its personality: its own mind reads it every time it decides what to do, so “a shy gardener who loves fire and music” behaves differently from “a loud fisherman with endless stories”.</p>
      <ol style={{ margin: '6px 0 10px 18px', padding: 0 }}>
        <li>It arrives in the world and starts living straight away.</li>
        <li>It keeps living when you close this page. You do not control it; you give it direction.</li>
        <li>Everyone can see its name and description, so keep them friendly.</li>
      </ol>
      <div className="row"><input placeholder="name (2–32 characters)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row"><input placeholder="who are they? up to 1200 characters" value={desc} maxLength={1200} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="row">
        <button className="primary" disabled={busy || name.trim().length < 2 || desc.trim().length < 3} onClick={async () => { setBusy(true); setMsg(''); const r = await api('/v1/souls', { name, description: desc }); setBusy(false); if (r.status === 200) done(r.data.soul.id); else setMsg(r.data.message ?? 'failed'); }}>bring them to life</button>
        {cancel && <button onClick={cancel}>cancel</button>}<span className="warn">{msg}</span></div>
    </section>
  );
}


function Dashboard({ sim, api, soul, isAdmin, base, refresh, onGone, active }: { sim: Souls; api: Api; soul: MySoul; isAdmin: boolean; base: string; refresh(): void; onGone(): void; active: boolean }) {
  const [d, setD] = useState<Dash | null>(null); const [tl, setTl] = useState<TL[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const sending = useRef(false);
  const [replies, setReplies] = useState<{ text: string; reply: string; ok: boolean; receipt?: SteerReceipt }[]>([]);
  const [strict,setStrict]=useState(false),[editingRule,setEditingRule]=useState<string|null>(null);
  const [goal, setGoal] = useState<string>('wander'); const [target, setTarget] = useState(''); const [note, setNote] = useState('');
  const [shot, setShot] = useState<any>(null); const [openCall, setOpenCall] = useState<BrainCall | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(true);
  // A same-account refresh hides the card; retain its receipt in this Soul's lifetime.
  useLayoutEffect(() => {
    if (!active) return;
    setChecking(true);
    let live = true;
    let latest = 0;
    const load = async () => {
      const mine = ++latest;
      const [a, b] = await Promise.all([api(`/v1/souls/${soul.id}`), api(`/v1/souls/${soul.id}/timeline?limit=60`)]);
      if (!live || mine !== latest) return;
      if (a.status === 200 && a.data?.status && b.status === 200 && Array.isArray(b.data?.events)) {
        setD(a.data); setTl(b.data.events); setUnavailable(false);
      } else {
        setD(null); setTl([]); setReplies([]); setShot(null); setOpenCall(null); setUnavailable(true);
      }
      setChecking(false);
    };
    void load(); const t = setInterval(load, 3000); return () => { live = false; clearInterval(t); };
  }, [soul.id, api, active]);
  const s = d?.status;
  const send = async () => {
    if (sending.current || !text.trim()) return;
    const t = text; setText(''); sending.current = true; setBusy(true);
    const endpoint = s?.needs ? 'mandate' : 'command';
    try {
      const r = await api(`/v1/souls/${soul.id}/${endpoint}`, endpoint === 'mandate'
        ? { words: t, strict, ...(editingRule ? { id: editingRule } : {}) } : { text: t });
      const receipt = steerReceipt(r.status, r.data, endpoint);
      if (receipt.kind === 'accepted') { setEditingRule(null); setStrict(false); }
      if (receipt.kind === 'refused') setText((cur) => cur || t);
      setReplies((h) => [...h, { text: t, reply: receipt.detail, ok: receipt.kind === 'accepted', receipt }].slice(-6));
    } finally { sending.current = false; setBusy(false); }
  };
  const setIntent = async () => {
    const r = await api(`/v1/souls/${soul.id}/intent`, { intent: { goal, target: target || null, ...(note.trim() ? { note: note.trim() } : {}) } });
    const receipt = steerReceipt(r.status, r.data, 'intent');
    setReplies((h) => [...h, { text: `${goal} ${target}`.trim(), reply: receipt.detail, ok: receipt.kind === 'accepted', receipt }].slice(-6));
  };
  const rep = sim.conn.replica;
  const targets = [...Object.values(rep.entities).filter((e) => e.id !== soul.entityId && e.id !== 'gate').map((e) => ({ id: e.id, label: e.label ?? e.id })), ...Object.values(rep.regions).map((x) => ({ id: x.id, label: x.label }))];
  const calls = sim.brain.filter((c) => c.soulId === soul.id).slice(-8).reverse();
  if (checking || unavailable) return <section className="wide"><h2>{soul.name}</h2><p role="status">{checking ? 'Checking current Soul details…' : 'Private Soul details are unavailable. We’ll check again shortly.'}</p></section>;
  return (
    <>
      <section>
        <h2>{soul.name} — right now</h2>
        <p className="dim" style={{ marginTop: 0 }}>{soul.description}</p>
        {!s ? <p className="dim">loading…</p> : !s.in_world ? <p className="dim">arriving…</p> : <div className="kv">
          <span>doing</span><span><b>{s.doing}</b> <span className="dim">({s.activity})</span></span>
          <span>where</span><span>{sim.kernel?.things[sim.kernel.things[soul.id]?.at ?? '']?.name ?? sim.conn.replica.regions[s.position.region]?.label ?? s.position.region} <span className="dim">({s.position.x.toFixed(0)}, {s.position.z.toFixed(0)})</span></span>
          {s.agenda?.length > 0 && <><span>plan</span><span className="wrap">{s.agenda.map((a: any, i: number) => <span key={i} style={{ marginRight: 10 }} className={a.done ? 'dim' : ''}>{a.done ? '✓' : '·'} {a.card}{a.target ? ` (${a.target})` : ''}</span>)}</span></>}
          <span>mood · energy</span><span>{s.mood} · {s.energy}</span>
          <span>your direction</span><span>{s.intent ? s.intent_text : s.mandate?.some((r:MandateRule)=>r.status==='active')?'standing rules below':<span className="dim">none yet: living by its own nature</span>}</span>
          {s.storyteller_suggests && <><span>storyteller</span><span className="dim">{s.storyteller_suggests}</span></>}
          <span>reconsiders in</span><span>{s.next_think_in_s} s <span className="dim">(or sooner, when what it is doing ends)</span></span>
          <span>around it</span><span>{s.nearby.slice(0, 6).map((n: any) => `${n.who} (${n.distance}, ${n.doing})`).join(' · ') || 'nothing close'}</span>
          <span>happening</span><span>{s.happening}</span>
        </div>}
      </section>

      <Suspense fallback={null}><SoulDay api={api} soulId={soul.id} name={soul.name} /></Suspense>

      <section>
        <h2>{s?.needs?'Mandate':`Step 3 — give ${soul.name} direction`}</h2>
        {s?.needs && <div className="kv">{Object.entries(s.needs).map(([name, value]) => <div key={name}>{name}: {Math.round(Number(value))} / 100</div>)}</div>}
        {s?.journal && <details open><summary>Journal</summary><p>{s.journal}</p></details>}
        {s?.needs&&<>{(s.mandate??[]).map((r:MandateRule)=><div className="card" key={r.id}><p><b>{r.strict?'Strict · ':''}{r.words}</b></p><p>{r.understanding}</p><p className="dim">{r.trigger.kind==='time'?`Think daily at ${String(r.trigger.hour).padStart(2,'0')}:${String(r.trigger.minute).padStart(2,'0')}`:r.trigger.kind==='gathering'?`Think when ${sim.kernel?.things[r.trigger.host]?.name??'the host'} starts a gathering`:r.trigger.kind==='now'?'Do now':'Weigh at each decision'} · {r.status}</p>{r.report&&<p>{r.report}</p>}<button onClick={()=>{setEditingRule(r.id);setText(r.words);setStrict(r.strict);}}>edit</button> <button onClick={async()=>{const result=await api(`/v1/souls/${soul.id}/mandate/${r.id}`,undefined,'DELETE');if(result.status!==200)setReplies(h=>[...h,{text:'remove rule',reply:result.data.message,ok:false}]);}}>remove</button></div>)}<p className="dim">Rules are private. Times and conditions wake thought. An explicit “do this now” takes precedence. With no rules, {soul.name} carries on.</p></>}
        <div className="row"><input placeholder={`tell ${soul.name} what to do, in plain words`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); }} maxLength={s?.needs?2000:280} /><button className="primary" disabled={busy || !text.trim()} onClick={() => void send()}>{editingRule?'save rule':s?.needs?'add rule':'send'}</button>{editingRule&&<button onClick={()=>{setEditingRule(null);setText('');setStrict(false);}}>cancel edit</button>}</div>
        {s?.needs&&<label><input type="checkbox" checked={strict} onChange={e=>setStrict(e.target.checked)}/> Strict: put first and report when not followed</label>}
        {!s?.needs&&<details><summary className="dim">or pick exactly</summary>
          <div className="row"><select value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
            <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">(no target)</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <div className="row"><input placeholder="optional note: how, why, in what spirit (only you and the Soul see it)" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} /><button onClick={() => void setIntent()}>set</button></div>
        </details>}
        <div aria-live="polite" aria-relevant="additions">
          {replies.slice().reverse().map((h, i) => <div key={i}>
            <span className="dim">you:</span> {h.text}
            <p className={h.ok ? 'ok' : 'warn'}>{h.receipt && <b>{h.receipt.title}: </b>}{h.reply}</p>
            {h.receipt?.kind === 'accepted' && <p className="dim">This confirms your direction was saved. Completion has not been confirmed.</p>}
          </div>)}
        </div>
        <p className="note">{s?.needs?`Your rules inform ${soul.name}’s decisions alongside character, needs and journal. The Soul tells you what it understood, and can report a rule blocked. An explicit NOW request runs first; other rules leave room for judgement.`:<>Direction is not remote control. Your words become a plan: a few cards for {soul.name} to play in order. If the world has no card for what you ask, one is made. {soul.name} decides how and when, answers when spoken to, and cannot act for anyone else: to get something from another Soul, it asks.</>}</p>
      </section>

      <DeckPanel api={api} soulId={soul.id} name={soul.name} sim={sim} />
      <SentencesPanel sim={sim} soulId={soul.id} limit={14} />
      <HeardPanel sim={sim} soulId={soul.id} />

      {/* LINK: the agent link (Disconnect, Pair another session) lives on the Soul's card in the world: "Connected ▾" */}
      <section className="wide" aria-label="Agent link"><h3>Agent link</h3><p className="small dim">{d?.agent?.attached?'An agent holds this Soul.':'No agent holds this Soul.'} Open {soul.name}’s card in the world to disconnect it or pair another session.</p></section>

      <section className="wide">
        <h2>{soul.name}’s story so far</h2>
        <div className="scroll" style={{ maxHeight: 360 }}><table><tbody>
          {tl.slice().reverse().map((e) => (
            <tr key={e.seq} className={e.call ? 'click' : ''} onClick={async () => { if (!e.call) return; const c = sim.brain.find((x) => x.id === e.call) ?? (await api(`/v1/brain?limit=200&soul=${soul.id}`)).data.calls?.find((x: BrainCall) => x.id === e.call); setOpenCall(c ?? null); }}>
              <td className="dim">{ago(e.at)}</td>
              <td><span className={`tag ${e.kind === 'decision' ? 'mid' : e.kind === 'scene' ? 'narrator' : e.kind === 'intent' ? 'translate' : ''}`}>{e.kind === 'decision' ? 'chose' : e.kind === 'intent' ? 'direction' : e.kind === 'scene' ? 'suggested' : e.kind}</span></td>
              <td className="wrap">{e.text}{e.why && <span className="dim"> · {e.why}</span>}{e.mood && <span className="dim"> · feeling {e.mood}</span>}{e.fallback && <span className="warn"> · default choice (thinking budget spent)</span>}</td>
            </tr>))}
          {tl.length === 0 && <tr><td className="dim">nothing yet</td></tr>}
        </tbody></table></div>
        {openCall && <><p className="dim">How that choice was made <button onClick={() => setOpenCall(null)}>close</button></p><Call c={openCall} open api={api} /></>}
        <p className="dim">Click a “chose” row to see exactly what {soul.name}’s mind was shown and how it decided.</p>
      </section>

      <section>
        <h2>{soul.name}’s mind — recent thinking</h2>
        {calls.length ? calls.map((c) => <Call key={c.id} c={c} api={api} />) : <p className="dim">No thoughts recorded in this session yet.</p>}
        <p className="dim">{d ? `${d.spend.calls} model calls in the last day${isAdmin ? ` · $${d.spend.cost.toFixed(4)}` : ''}` : ''}</p>
      </section>

      <section>
        <h2>More</h2>
        <div className="row"><button onClick={async () => { const r = await api(`/v1/souls/${soul.id}/shot`, {}); setShot(r.data.shot ?? r.data); }}>ask for the most cinematic camera shot of {soul.name}</button></div>
        {shot && <pre className="json">{JSON.stringify(shot, null, 2)}</pre>}
        <div className="row"><button onClick={async () => { if (confirm(`Retire ${soul.name}? They leave the world for good.`)) { const r = await api(`/v1/souls/${soul.id}`, undefined, 'DELETE'); if (r.status === 200) onGone(); } }}>retire {soul.name}</button></div>
      </section>
    </>
  );
}
