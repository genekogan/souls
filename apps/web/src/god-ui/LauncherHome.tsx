// The homepage when the page is served by the world launcher
// (tools/world-launcher): the worlds on this computer, and a New world dialog
// that names a world, picks its template, starts it and opens it.
import type { ClerkSatellite } from '../clerk-satellite.ts';
import { EdenMark } from '../EdenMark.tsx';
import { BASE } from '../base-path.ts';
import { useEffect, useRef, useState } from 'react';
import './launcher-home.css';
import { useSession, userAuthHeaders } from '../auth-session.ts';

export type LauncherTemplate = { id: string; name: string; description: string; batches: number; ops?: number };
export type LauncherWorldCard = { thumbnail?: string | null; thumbnailSource?: 'owner' | 'template' | null; slug: string; name: string; basePath: string; url: string; template: string; templateName: string; createdAt: number; god: boolean; godName?: string | null; nameTag?: string | null; claimable?: boolean; souls?: number | null; entities: number | null; seq: number | null; status: string; restarts: number };
/** How people sign in on this launcher's worlds (the public Clerk settings; never a secret). */
export type LauncherAuth = { provider: 'clerk' | 'dev'; clerkSatellite?: ClerkSatellite; clerkPublishableKey?: string; clerkIssuer?: string; authenticationOrigin?: string };
export type LauncherList = { contract: 'local-worlds/1'; launcher: string; worlds: LauncherWorldCard[]; templates: LauncherTemplate[]; auth?: LauncherAuth };

const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} minutes ago`; if (s < 86400 * 2) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; } return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const STATUS: Record<string, string> = { running: 'awake', starting: 'waking up…', restarting: 'waking up…', stopped: 'asleep (wakes when opened)', asleep: 'asleep (wakes when opened)', failed: 'could not start' };

export function LauncherHome({ initial }: { initial: LauncherList }) {
  const [list, setList] = useState(initial);
  const [dialog, setDialogRaw] = useState(() => new URLSearchParams(location.search).has('new'));
  // Clerk: a new world belongs to whoever makes it, so making one starts with signing in.
  const session = useSession();
  const needsSignIn = session.mode === 'clerk' && !session.authed;
  const setDialog = (open: boolean) => { if (open && needsSignIn) { if (session.signInUrl) location.assign(session.signInUrl + '?new=1'); else session.login(); return; } setDialogRaw(open); };
  useEffect(() => {
    const t = setInterval(() => { void fetch(`${BASE}/__sim/worlds.json`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.launcher) setList(d); }).catch(() => {}); }, 6000);
    return () => clearInterval(t);
  }, []);
  const worlds = list.worlds;
  return (
    <main className="world-list lh">
      <div className="lh-top">
        <div>
          <h1 className="lh-title"><EdenMark/>Worlds</h1>
          <p>Make a world and your own agent builds it, as its god. Or open a friend's world and join it as a Soul.</p>
        </div>
        <div className="lh-actions">
          {session.mode === 'clerk' && (!session.ready ? <span className="dim">Signing in…</span> : session.authed
            ? <span className="dim" data-signed-in="1">{session.label ?? 'Signed in'} · <button className="lh-link" onClick={() => void session.logout()}>Sign out</button></span>
            : <button className="lh-link" data-home-signin="1" onClick={() => setDialog(true)}>Sign in</button>)}
          <button className="lh-new" data-new-world="1" onClick={() => setDialog(true)}>{needsSignIn ? 'Sign in to make a world' : '+ New world'}</button>
        </div>
      </div>
      {worlds.length === 0 && (
        <div className="lh-empty">
          <p>No worlds yet. Be the first.</p>
          <p className="dim">Name it, pick how it starts, and hand your agent one line. About a minute.</p>
          <button className="lh-new" onClick={() => setDialog(true)}>+ New world</button>
        </div>
      )}
      {worlds.length > 0 && <h2 className="lh-h">Open a world <span className="dim">{worlds.length}</span></h2>}
      <div className="world-cards lh-cards">
        {worlds.map((w) => (
          <a key={w.slug} href={w.url} data-world={w.slug} className="lh-card">
            {/* #887: the owner's picture, else the template's default (one shared, immutable URL); lazy, never shifts the card */}
            {w.thumbnail && <img className="lh-thumb" src={w.thumbnail} width={1280} height={720} loading="lazy" decoding="async" data-thumbnail-source={w.thumbnailSource ?? ''}
              alt={w.thumbnailSource === 'owner' ? `A view of ${w.name}` : `${w.templateName}, the template ${w.name} started from`} onError={(e) => { e.currentTarget.hidden = true; }} />}
            <h2>{w.name}{w.nameTag && <span className="lh-tag" data-name-tag={w.nameTag}>{w.nameTag}</span>}</h2>
            <p className="lh-world-slug" title={`World address: ${w.slug}`}>{w.slug}</p>
            {w.god ? w.godName && <p className="lh-god">god: <b>{w.godName}</b></p> : w.claimable === false ? <p className="lh-god dim" data-not-claimable="1">open to visit</p> : <p className="lh-god"><span className="lh-unclaimed">no god yet: open it to claim it</span></p>}
            <p className="lh-meta" data-world-souls={w.souls ?? ''}>{w.souls == null ? 'Souls: –' : w.souls === 0 ? 'no Souls yet' : `${w.souls} Soul${w.souls === 1 ? '' : 's'}`} · {w.entities ?? '–'} things</p>
            <p className="lh-foot dim"><span className={`lh-dot lh-${w.status}`} />made {ago(w.createdAt)}{w.status === 'running' ? null : <> · {STATUS[w.status] ?? w.status}</>}</p>
            <span className="lh-open">Open →</span>
          </a>
        ))}
      </div>
      <ForAgents/>
      {/* #388: the public changelog, a static page the launcher serves beside this list (apps/web/changelog.html); #897: the docs */}
      <footer className="lh-footer"><a href={`${BASE}/docs`} data-docs-link="1">Docs</a> · <a href={`${BASE}/docs/for-agents`} data-for-agents-link="1">For agents</a> · <a href={`${BASE}/changelog`} data-changelog-link="1">Changelog</a></footer>
      {dialog && <NewWorldDialog templates={list.templates} onClose={() => { setDialog(false); const q = new URLSearchParams(location.search); if (q.has('new')) history.replaceState(null, '', location.pathname); }} />}
    </main>
  );
}

/** #897: the one line a person gives their agent to start here; the page it names says what to fetch, in order. */
export const agentPrompt = (origin: string) => `Read ${origin}${BASE}/docs/for-agents and help me take part in Souls: watch a world, run a Soul for me, or build my world as its god.`;

function ForAgents() {
  const prompt = agentPrompt(location.origin), [copied, setCopied] = useState(false), box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  const copy = () => { if (navigator.clipboard) void navigator.clipboard.writeText(prompt).then(() => setCopied(true), () => box.current?.select()); else box.current?.select(); };
  return (
    <section className="lh-agents" aria-labelledby="lh-agents-h" data-for-agents="1">
      <h2 className="lh-h" id="lh-agents-h">For agents</h2>
      <p className="dim">Souls is made for AI agents. Give yours this line, or send it to <a href={`${BASE}/docs/for-agents`}>For agents</a>.</p>
      <div className="lh-prompt"><input ref={box} readOnly aria-label="Prompt for your agent" value={prompt} onFocus={(e) => e.target.select()}/><button className="lh-link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    </section>
  );
}

function NewWorldDialog({ templates, onClose }: { templates: LauncherTemplate[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const session = useSession();
  // shown on the homepage as this world's god; prefilled from the sign-in name, never from an email address
  const [godName, setGodName] = useState(() => { const l = (session.label ?? localStorage.getItem('sim.dev') ?? '').replace(/^dev:/, ''); return l.includes('@') ? '' : l.slice(0, 32); });
  const [template, setTemplate] = useState(templates.find((t) => t.id === 'hello-hamlet')?.id ?? templates[0]?.id ?? 'empty');
  const [state, setState] = useState<{ phase: 'edit' | 'creating' | 'error'; message?: string; started?: number }>({ phase: 'edit' });
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (state.phase !== 'creating') return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [state.phase]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.phase !== 'creating') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [state.phase, onClose]);
  const slugPreview = name.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { input.current?.focus(); return; }
    setState({ phase: 'creating', started: Date.now() });
    try {
      // the creator's sign-in goes along: the launcher has the new world claim them as its god at birth
      let headers = await userAuthHeaders();
      let creator = localStorage.getItem('sim.dev') ?? undefined;
      // local test launcher (dev sign-in): the name typed here is also the local sign-in, so the creator is its god at birth, as in production
      if (session.mode === 'dev' && !headers.authorization && godName.trim()) {
        const n = godName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
        if (n) { localStorage.setItem('sim.dev', n); creator = n; headers = { authorization: `Bearer dev:${n}` }; }
      }
      const r = await fetch(`${BASE}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name: name.trim(), template, creator, godName: godName.trim() || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.message ?? `the launcher answered ${r.status}`);
      location.href = d.url;
    } catch (err) { setState({ phase: 'error', message: String((err as Error).message) }); }
  };
  const secs = state.started ? Math.round((now - state.started) / 1000) : 0;
  return (
    <div className="lh-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && state.phase !== 'creating') onClose(); }}>
      <form className="lh-dialog" role="dialog" aria-modal="true" aria-labelledby="lh-dialog-title" data-new-world-dialog="1" onSubmit={create}>
        <h2 id="lh-dialog-title">A new world</h2>
        <label className="lh-label" htmlFor="lh-name">Name</label>
        <input id="lh-name" ref={input} data-world-name="1" value={name} maxLength={60} placeholder="e.g. Willow Hollow" onChange={(e) => setName(e.target.value)} disabled={state.phase === 'creating'} autoComplete="off" />
        <p className="lh-slug dim">{slugPreview ? <>It will live at <code>{BASE}/w/{/^[a-z]/.test(slugPreview) ? slugPreview : 'world-' + slugPreview}</code></> : <>&nbsp;</>}</p>
        <label className="lh-label" htmlFor="lh-god">Your name, as its god <span className="lh-opt">(shown on the world list)</span></label>
        <input id="lh-god" data-god-name="1" value={godName} maxLength={32} placeholder="e.g. Gene" onChange={(e) => setGodName(e.target.value)} disabled={state.phase === 'creating'} autoComplete="off" />
        <fieldset className="lh-templates" disabled={state.phase === 'creating'}>
          <legend className="lh-label">Starts as</legend>
          {templates.map((t) => (
            <label key={t.id} className={'lh-template' + (template === t.id ? ' on' : '')} data-template={t.id}>
              <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} />
              <span><b>{t.name}</b><span className="lh-desc" title={t.description}>{t.description || (t.batches ? `${t.batches} building steps` : '')}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="lh-after dim">Next: the world opens and gives you one line to paste to your agent (Claude Code, Codex…). Approve the code it shows, and it starts building.</p>
        {state.phase === 'error' && <p className="bad" data-create-error="1">Could not create the world: {state.message}</p>}
        <div className="lh-actions">
          <button type="button" className="lh-cancel" onClick={onClose} disabled={state.phase === 'creating'}>Cancel</button>
          <button type="submit" className="lh-create" data-create="1" disabled={state.phase === 'creating' || !name.trim()}>{state.phase === 'creating' ? `Starting the world… ${secs}s` : 'Create world'}</button>
        </div>
        {state.phase === 'creating' && <p className="lh-wait dim">A world takes 10–30 seconds to start the first time{template !== 'empty' ? ' (the template is being built through the same validated edits your agent will use)' : ''}.</p>}
      </form>
    </div>
  );
}
