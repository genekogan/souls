// The god panel on an entity world (spec <eden4>/29 WP6): sign in, claim, pairing approvals, undo/redo, weather,
// prayers, and (switched off) flags and the god's previews drawn as ghosts.
// G4 (Gene 2026-10-20): for the world's god all of it lives in the one God modal (GodModal.tsx) under the God button.
// G5 (Gene 2026-10-20b): one view, no tabs: connect the agent (until it is connected), the command box with undo/redo
// and weather, prayers waiting (only if any), the log, and Forsake world (hand on or archive). Start, Edits, Souls (in
// Explore) are gone; flags, previews and the Constitution are switched off (god-ui/features.ts) but their code stays.
// Everyone else has no God Mode (U3: the God button is the god's only): the claim card of a godless world and the offer
// links keep their small floating card. The approval link (#approve/<id>) is a modal on top for everyone (lane HF).
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPath, worldKey } from './world-path.ts';
import * as G from './god-ui/god-api.ts';
import { flyTo } from './god-ui/camera.ts';
import { SMALL_SCREEN } from './HudMore.tsx';
import { previewGhost, takePreviewKey, type GhostSummary } from './WorldPreviewGhost.ts';
import { useSession } from './auth-session.ts';
import { ApprovalDialog } from './god-ui/ApprovalDialog.tsx';
import { offerApproval, useCardIsOpen } from './pairing-slot.ts';
import { OwnerGod, ago as since } from './god-ui/GodModal.tsx';
import { closeGod, openGod, useGod, watchInbox } from './god-ui/god-store.ts';
import { ConstitutionBody } from './god-ui/Constitution.tsx';
import { ForsakeWorld } from './god-ui/WorldOwnerOps.tsx';
import { PrayersWaiting } from './god-ui/Prayers.tsx';
import { godFeature } from './god-ui/features.ts';
import { approvalFromHash, landingHash } from './god-ui/join-api.ts';
import { closeApproval, closedApprovals, pickWindowApproval, useWindowApprovals } from './god-ui/window-approvals.ts';
import { OfferCard, offerFromHash } from './god-ui/OfferCard.tsx';
import { countEvent } from './visitor-counts.ts';
import './god-ui/god-panel.css';

const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const shotMode = query.get('shot') === '1';
// Read at module load: Shell rewrites the landing fragment to its tab (#watch) before the scene is ready.
// Taking it also strips it from the URL, so the view key does not stay in browser history.
const landingPreviewKey = typeof location === 'undefined' ? null : takePreviewKey({ location, history });
const PAIRED_KEY = `sim.godPaired:${worldKey}`;
const PHONE = () => typeof matchMedia === 'function' && matchMedia(SMALL_SCREEN).matches;  // P6: landscape phones (coarse pointer) too
// Phones keep their own remembered choice and start compact: the open panel covers most of a small screen.
const openKey = () => 'sim.godPanel.open' + (PHONE() ? '.phone' : '');
const INTRO_KEY = `sim.godIntro:${worldKey}`;
/** Lane HF: the approval link's dialog was closed on this page (the panel can remount; it must not come back). */
let approvalClosed = false;   // G4: God opens by itself once, for a new owner whose agent is not connected
type Souls = { controls?: { target: { x: number; z: number } } };
/** Where the camera looks (the orbit target), for a strike near the view's centre. */
const viewCentre = (): [number, number] | null => { const t = (window as unknown as { __soulsEntity?: Souls }).__soulsEntity?.controls?.target; return t ? [Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10] : null; };
const UNDO = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const REDO = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3M13.2 6.5H6.5a3.5 3.5 0 0 0 0 7H9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export function GodPanel({ flagMode, onFlagMode, entitiesAt }: { flagMode: boolean; onFlagMode: (v: boolean) => void; entitiesAt?: (seq: number) => Iterable<G.FlagSource> | null }) {
  const [status, setStatus] = useState<G.Status | null>(null);
  // #join (the link a god shares): open the panel on the Join section / the Souls tab
  const joinHash = landingHash === '#join';
  // #approve/<id> (the link the Soul CLI prints for its human): the approval card, a modal on top of everything (lane HF)
  const [approvalId, setApprovalId] = useState(() => (approvalClosed ? null : approvalFromHash(landingHash)));
  // lane PAIR-UI (Gene's review #1 item 3; PAIR-INWINDOW's draft): an #approve link opened in another tab of this world
  // hands its request here (Shell.tsx sets #approve/<id>); the card opens over this world, no second world starts
  useEffect(() => { const changed = () => { const id = approvalFromHash(location.hash); if (id) { approvalClosed = false; setApprovalId(id); } }; addEventListener('hashchange', changed); return () => removeEventListener('hashchange', changed); }, []);
  // #worldoffer/<code>, #cobuildpair/<code> (the launcher's co-builder and handoff links): that card first
  const [offerLink, setOfferLink] = useState(() => offerFromHash(landingHash));
  const [open, setOpen] = useState<boolean>(() => joinHash || !!approvalId || (PHONE() ? localStorage.getItem(openKey()) === '1' : localStorage.getItem(openKey()) !== '0'));
  const god = useGod();
  const hashCode = landingHash.startsWith('#godpair/') ? decodeURIComponent(landingHash.slice('#godpair/'.length)) : null;
  const [edits, setEdits] = useState<G.EditRow[] | null>(null);
  const [flags, setFlags] = useState<G.FlagRef[]>([]);
  const [previews, setPreviews] = useState<G.PreviewRow[]>([]);
  const [launcher, setLauncher] = useState<Awaited<ReturnType<typeof G.launcherWorld>>>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ghost, setGhost] = useState<GhostSummary | null>(null);
  const owner = status?.you === 'owner' || status?.you === 'god';
  const seq = status?.seq;
  // who is signed in on this page (Clerk in production, a local name in dev): auth-session.ts
  const session = useSession();
  const [naming, setNaming] = useState(false);
  const [devName, setDevName] = useState('');
  const wasAuthed = useRef(false);
  useEffect(() => { if (wasAuthed.current && !session.authed) G.forgetToken(); wasAuthed.current = session.authed; }, [session.authed]);

  const refresh = useCallback(async () => { const s = await G.getStatus(); if (s) setStatus(s); }, []);
  useEffect(() => G.watchStatus(setStatus), []);
  useEffect(() => { void refresh(); }, [refresh, session.authed, session.label]);
  useEffect(() => { localStorage.setItem(openKey(), open ? '1' : '0'); }, [open]);
  // journal, flags: whenever the world's edit counter moves
  useEffect(() => {
    if (seq === undefined) return;
    if (owner) void G.edits(30).then(setEdits).catch(() => setEdits(null));
    if (!godFeature('flags')) return;   // G5: flags are switched off
    // lane L3h: the entity layer already holds the public snapshot plus its diffs; read the flags there once it has reached
    // this edit (a diff can land just after the status), and download the whole snapshot only when it never does
    let live = true, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      if (!live) return;
      const here = entitiesAt?.(seq);
      if (here) { setFlags(G.flagRefsOf(here)); return; }
      if (entitiesAt && ++tries < 40) { timer = setTimeout(read, 250); return; }
      void G.flags().then((f) => { if (live) setFlags(f); }).catch(() => {});
    };
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [seq, owner, entitiesAt]);
  // what the launcher saw (looks, an agent's calls) and the god's previews: a slower poll
  useEffect(() => {
    const go = () => { void G.launcherWorld().then(setLauncher); if (owner && godFeature('previews')) void G.previews().then(setPreviews); };
    go(); const t = setInterval(go, 8000); return () => clearInterval(t);
  }, [owner]);

  // ?preview=<id>: draw it as soon as the world's scene exists, then fly there
  const showPreview = useCallback(async (id: string, fly = true) => {
    let g = previewGhost(apiPath);
    for (let i = 0; !g && i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); g = previewGhost(apiPath); }
    if (!g) { setNote({ text: 'The world view is not ready for a preview.', bad: true }); return; }
    const viewKey = query.get('preview') === id ? landingPreviewKey : null;
    // Never mint here: minting claims an unowned world, and a visitor opening a link must not do that.
    const token = G.storedToken();
    const s = await g.show(id, { token, viewKey }); previewGhost(apiPath); setGhost(s);
    if (fly && s.ok && s.bounds) { const [x0, z0, x1, z1] = s.bounds; const span = Math.max(20, x1 - x0, z1 - z0); flyTo((x0 + x1) / 2, 0, (z0 + z1) / 2, { distance: span * 1.6, aside: 0.3 }); }
  }, []);
  const hideGhost = () => { previewGhost(apiPath)?.clear(); setGhost(null); const q = new URLSearchParams(location.search); if (q.has('preview')) { q.delete('preview'); history.replaceState(null, '', `${location.pathname}${q.size ? '?' + q : ''}${location.hash}`); } };
  useEffect(() => { const id = query.get('preview'); if (id && godFeature('previews')) void showPreview(id); }, [showPreview]);   // G5: switched off by default

  const run = async (key: string, fn: () => Promise<unknown>, ok?: (r: unknown) => string | null) => {
    setBusy(key); setNote(null);
    try { const r = await fn(); const t = ok?.(r); if (t) setNote({ text: t }); await refresh(); }
    catch (e) { setNote({ text: String((e as Error).message), bad: true }); }
    finally { setBusy(null); }
  };
  // Sign in as the page does: Clerk's own sign-in in production; locally, a name typed here (no window.prompt:
  // embedded browsers drop it).
  const signIn = () => {
    if (session.signInUrl) { location.assign(session.signInUrl); return; }
    if (session.mode === 'dev') { setDevName(localStorage.getItem('sim.dev') ?? ''); setNaming(true); return; }
    if (session.mode === 'none') { setNote({ text: 'Sign-in is not configured on this server.', bad: true }); return; }
    session.login();
  };
  const devSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    const n = devName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
    if (!n) return; localStorage.setItem('sim.dev', n); G.forgetToken(); location.reload();
  };
  const signInForm = naming && (
    <form className="gp-row" data-signin-form="1" onSubmit={devSignIn}>
      <input data-signin-name="1" autoFocus value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="a local name, e.g. gene" maxLength={36} aria-label="local name" />
      <button className="gp-btn gp-primary" data-signin-go="1" type="submit">Sign in</button>
    </form>
  );
  const signInButton = session.mode === 'clerk' && !session.ready ? <p className="gp-dim">Signing in…</p>
    : session.mode === 'clerk' && session.label && !session.authed ? <p className="gp-dim">Signed in as <b>{session.label}</b>; connecting your account to this world…</p>
    : !naming && <button className="gp-btn gp-primary" data-signin="1" onClick={signIn}>Sign in</button>;
  const who = (session.label ?? 'you').replace(/^dev:/, '');
  const claim = () => run('claim', G.claim, () => 'This world is yours.');
  const undoRedo = (which: 'undo' | 'redo') => run(which, () => (which === 'undo' ? G.undo() : G.redo()), (r) => { const x = r as G.UndoResult; return x.accepted ? `${which === 'undo' ? 'Undid' : 'Redid'} edit ${x.reverted}.` : (x.failures?.[0]?.detail ?? `nothing to ${which}`); });

  const signedIn = session.authed && !!status && status.you !== 'anonymous';
  // Lane HF (Gene 2026-10-20): the approval stays on screen and on top for everyone, the god included, whatever loads or
  // settles later (Clerk, the god's status, God Mode, the arrival), until approved, refused or closed. Closing drops the link.
  // Lane PUX: a request the person's agent addressed to this window (its window code) shows here too, with no navigation.
  const waiting = useWindowApprovals(signedIn && session.mode !== 'dev');
  const [windowId, setWindowId] = useState<string | null>(null);
  useEffect(() => { if (!windowId) setWindowId(pickWindowApproval(waiting, closedApprovals())); }, [waiting, windowId]);
  const shownId = approvalId ?? windowId;
  const approvalDone = () => {
    if (shownId) closeApproval(shownId);
    if (approvalId) { approvalClosed = true; setApprovalId(null); if (approvalFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search); }
    else setWindowId(null);
  };
  // LINK Pairing: while a Soul card is open the card turns into this request (pairing-slot.ts); the forced-up dialog is drawn
  // only when no card is open, so a second dialog never covers an open Soul card. Signed out, the dialog carries sign-in.
  const cardIsOpen = useCardIsOpen(), inCard = !!shownId && cardIsOpen && signedIn;
  const doneRef = useRef(approvalDone); doneRef.current = approvalDone;
  useEffect(() => { offerApproval(shownId && signedIn ? { id: shownId, done: () => doneRef.current() } : null); }, [shownId, signedIn]);
  useEffect(() => () => offerApproval(null), []);
  const approvalModal = shownId && !inCard && <ApprovalDialog id={shownId} signedIn={signedIn} onDone={approvalDone} signIn={!signedIn && <>{signInButton}{signInForm}</>} />;
  const canUndo = (edits ?? []).some((e) => !e.undone && e.kind !== 'undo' && e.ops.length > 0);
  // a new owner whose agent is not connected yet: God opens by itself once (it shows the line to give the agent)
  useEffect(() => {
    if (!owner || !status || shotMode || joinHash) return;
    if ((status.agents ?? 0) > 0) return;
    try { if (localStorage.getItem(INTRO_KEY) === '1') return; localStorage.setItem(INTRO_KEY, '1'); } catch { return; }
    openGod('agent');
  }, [owner, status?.agents, joinHash]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the owner's agent inbox: the God button watches it; the modal keeps it fresh while open
  useEffect(() => { if (owner && god.open) return watchInbox(); }, [owner, god.open]);

  if (shotMode) return null;
  const ghostBar = ghost && (
    <div className="gp-ghostbar" data-preview-banner={ghost.id} data-preview-ok={ghost.ok ? '1' : '0'}>
      <b>Preview</b> <code>{ghost.id}</code>
      {ghost.ok
        ? <><span className="gp-add">+{ghost.added} new</span><span className="gp-chg">{ghost.changed} changed</span><span className="gp-rem">{ghost.removed ? '−' : ''}{ghost.removed} removed</span>{ghost.tiles ? <span>{ghost.tiles} ground tile{ghost.tiles === 1 ? '' : 's'}</span> : null}<i>not built yet</i></>
        : <span className="gp-ghostmsg">{ghost.message}{ghost.failures?.[0] ? <> <code>{ghost.failures[0].code}</code> {ghost.failures[0].detail}</> : null}</span>}
      {ghost.ok && ghost.bounds && <button className="gp-btn" onClick={() => { const [x0, z0, x1, z1] = ghost.bounds!; flyTo((x0 + x1) / 2, 0, (z0 + z1) / 2, { distance: Math.max(20, x1 - x0, z1 - z0) * 1.6, aside: open ? 0.3 : 0 }); }}>fly there</button>}
      <button className="gp-btn" onClick={hideGhost}>hide</button>
    </div>
  );
  if (offerLink) return <>{approvalModal}{ghostBar}<div data-god-panel="1" className="gp-card">
    <OfferCard link={offerLink} signedIn={signedIn} onDone={() => { setOfferLink(null); history.replaceState(null, '', location.pathname + location.search); void refresh(); }} />
    {!signedIn && <div className="gp-block">{signInButton}{signInForm}</div>}
  </div></>;
  if (!status) return <>{approvalModal}{ghostBar}</>;
  const name = launcher?.world.name ?? status.name;
  const isNew = query.has('new');

  // The claim card of a godless world (anyone not its owner): a small floating card, as before.
  const claimCard = !status.hasOwner && !owner && launcher?.world.claimable !== false && (open
    ? <div data-god-panel="1" className="gp-card">
      <div className="gp-head">
        <b className="gp-title" title={status.worldId}>✦ {name}</b>
        <span className="gp-dim">{status.entities} things</span>
        <button className="gp-icon" onClick={() => setOpen(false)} title="Collapse the panel" aria-label="collapse">–</button>
      </div>
      {launcher?.world.templateName && <div className="gp-dim gp-sub">from <i>{launcher.world.templateName}</i>{launcher.world.createdAt ? <> · made {ago(launcher.world.createdAt)}</> : null}</div>}
      <div className="gp-block gp-next">
        {isNew && status.you !== 'claimant' && <p className="gp-hello">Your new world is ready. Whoever claims it first becomes its god, so sign in and claim it now.</p>}
        {status.you === 'claimant'
          ? <><p>Signed in as <b>{who}</b>. Nobody owns this world yet: claim it, and your agent builds it.</p>
            <button className="gp-btn gp-primary" data-claim="1" disabled={busy === 'claim'} onClick={claim}>{busy === 'claim' ? 'Claiming…' : 'Become its god'}</button></>
          : <>{!isNew && <p>This world has no god yet. Sign in to claim it; your agent will build it.</p>}{signInButton}{signInForm}</>}
      </div>
      {note && <p className={note.bad ? 'gp-bad' : 'gp-ok'}>{note.text}</p>}
    </div>
    : <button data-god-panel-toggle="1" className="gp-card gp-collapsed" onClick={() => setOpen(true)}>✦ Claim this world</button>);

  if (!owner) {
    // Everyone not this world's god (U3: no God button, no Cmd+G): the claim card of a godless world, and the approval
    // link their agent printed (#approve/<id>, its own dialog).
    return <>{approvalModal}{ghostBar}
      {claimCard}
    </>;
  }

  // ---- the world's god: everything in the one God Mode view ----
  const env = (body: unknown) => G.god('/v1/god/env', { method: 'POST', body: JSON.stringify(body) });
  const weather = (kind: 'rain' | 'lightning' | 'haze') => run(kind, async () => {
    if (kind === 'rain') return env({ weather: { kind: 'rain', intensity: 0.8 }, note: 'weather' });
    if (kind === 'haze') return env({ weather: { kind: 'fog', intensity: 0.6 }, note: 'weather' });
    await env({ weather: { kind: 'storm', intensity: 0.8 }, note: 'weather' });
    const at = viewCentre(); await G.god('/v1/god/strike', { method: 'POST', body: JSON.stringify(at ? { at } : {}) });
  }, () => (kind === 'rain' ? 'Rain.' : kind === 'haze' ? 'Haze.' : 'Lightning.'));
  const approve = (code: string) => run(code, async () => {
    await G.approve(code); countEvent('god connected'); try { localStorage.setItem(PAIRED_KEY, '1'); } catch { /* storage disabled */ }
    if (hashCode === code) history.replaceState(null, '', location.pathname + location.search);
  }, () => `Approved. Your agent is now this world's god.`);
  const agentsPaired = (status.agents ?? 0) > 0;
  const fly = (x: number, y: number, z: number, distance: number) => { closeGod(); flyTo(x, y, z, { distance }); };
  const banner = <>
    {hashCode && !status.pending.some((p) => p.code === hashCode) && <p className="gm-banner gp-bad">Pairing request <code>{hashCode}</code> is not pending (expired, or already approved).</p>}
    {status.pending.length > 0 && (
      <div className="gm-banner gp-pairs" data-pairing="1">
        <b>Your agent asks to be this world's god</b><span className="gp-dim">Check the code matches what your agent shows, then approve.</span>
        {status.pending.map((p) => (
          <div key={p.code} className="gp-row">
            <span><code className="gp-code-big">{p.code}</code> {p.agent} <span className="gp-dim">({Math.max(1, Math.round(p.expiresIn / 60))} min)</span></span>
            <button data-approve={p.code} className="gp-btn gp-primary" disabled={busy === p.code} onClick={() => approve(p.code)}>Approve</button>
          </div>
        ))}
      </div>
    )}
    {note && <p className={'gm-banner gm-note ' + (note.bad ? 'gp-bad' : 'gp-ok')} role="status">{note.text}</p>}
  </>;
  // until the agent is connected (never paired, or paired and away): the one line to give it, naming this world's skill
  const connected = !!god.inbox?.connected;
  const connectUrl = !agentsPaired || (god.inbox && !connected) ? `${status.base || location.origin + apiPath('')}/SKILL.md` : null;
  const tools = <>
    <div className="gm-tool-group" role="group" aria-label="Undo and redo">
      <button type="button" className="gm-tool" data-undo="1" disabled={!canUndo || !!busy} onClick={() => undoRedo('undo')} title="Undo the newest edit">{UNDO}Undo</button>
      <button type="button" className="gm-tool" data-redo="1" disabled={!!busy} onClick={() => undoRedo('redo')} title="Redo the newest undone edit">{REDO}Redo</button>
    </div>
    <div className="gm-tool-group" role="group" aria-label="Weather" data-weather="1" title="The same as your agent's weather and strike: each press is one edit">
      <button type="button" className="gm-tool" data-weather-kind="rain" disabled={!!busy} onClick={() => weather('rain')}>Rain</button>
      <button type="button" className="gm-tool" data-weather-kind="lightning" disabled={!!busy} onClick={() => weather('lightning')}>Lightning</button>
      <button type="button" className="gm-tool" data-weather-kind="haze" disabled={!!busy} onClick={() => weather('haze')}>Haze</button>
    </div>
  </>;
  // switched off by default (god-ui/features.ts); shown under the log when turned back on
  const more = <>
    {godFeature('flags') && <section className="gm-more" data-flags="1">
      <h3 className="gm-h">Flags</h3>
      <div className="gp-tools"><button className={'gp-btn' + (flagMode ? ' gp-armed' : '')} data-flag-button="1" aria-pressed={flagMode} onClick={() => { onFlagMode(!flagMode); if (!flagMode) closeGod(); }} title="Drop a labelled flag: a reference point your agent can build around (or Alt+click the ground)">⚑ {flagMode ? 'click the ground…' : 'Drop a flag'}</button></div>
      <ul className="gp-list">
        {flags.map((f) => (
          <li key={f.id}>
            <button className="gp-link" data-fly={f.name} onClick={() => fly(f.p[0], f.p[1], f.p[2], 35)} title="Fly the camera here">⚑ {f.label}</button>
            <code className="gp-dim">flag:{f.name}</code>
          </li>
        ))}
      </ul>
    </section>}
    {godFeature('previews') && previews.length > 0 && <section className="gm-more" data-previews="1">
      <h3 className="gm-h">Previews</h3>
      <ul className="gp-list">
        {previews.map((p) => (
          <li key={p.id}>
            <code>{p.id}</code>
            <span className="gp-what">{p.accepted ? summaryText(p.summary) : <span className="gp-bad">would be refused</span>}</span>
            <span className="gp-dim gp-when">{since(p.at)}</span>
            {p.accepted && <button className="gp-btn gp-small" data-show-preview={p.id} onClick={() => { closeGod(); void showPreview(p.id); }}>{ghost?.id === p.id ? 'shown' : 'show'}</button>}
          </li>
        ))}
      </ul>
    </section>}
    {godFeature('constitution') && <section className="gm-more"><ConstitutionBody /></section>}
  </>;
  // the owner here is 'owner' (signed in) or 'god' (the owner's own god token in this browser): both may forsake
  return <>
    {approvalModal}
    {ghostBar}
    {god.open && <OwnerGod banner={banner} connectUrl={connectUrl} paired={agentsPaired} tools={tools} prayers={<PrayersWaiting />} more={more}
      forsake={<ForsakeWorld name={name} />} />}
  </>;
}

function summaryText(s: Record<string, unknown> | null) {
  if (!s) return '';
  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : 0);
  const parts = [n('upserts') && `${n('upserts')} things`, n('removes') && `−${n('removes')}`, n('tiles') && `${n('tiles')} tiles`].filter(Boolean);
  return parts.join(' · ') || 'no change';
}
