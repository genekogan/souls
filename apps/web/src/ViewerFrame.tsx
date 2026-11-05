import {NavbarMenu} from './NavbarMenu.tsx';
import {FullscreenToggle} from './FullscreenToggle.tsx';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import {ImportCredits} from './ImportCredits.tsx';
import { createPortal } from 'react-dom';
import type { ViewportInsets, WorldViewerHandle, WorldViewerState } from './WorldViewer.ts';
import { arrivalMark } from './arrival-marks.ts';
import { earlyArrival } from './early-arrival.ts';
import { arrivalProgress, arrivalStage, assetDownloadProgress, heldLabel, initialPending } from './viewer-arrival.ts';
import type { InitialWorldProgress } from './InitialWorldReadiness.ts';
import { assetBytes, megabytes } from './asset-bytes.ts';
import { hourLabel, setVisitorPreviewHour, subscribeVisitorHour, visitorPreviewHour } from './visitor-hour.ts';
import { arrivalGate } from './gen-mesh/lazy-assets.ts';

/** Edge overlays are measured against World's actual viewport, never the window. */
export function useViewerInsets(root: RefObject<HTMLDivElement | null>, visible: boolean, layout: string): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>({});
  useLayoutEffect(() => {
    const frame = root.current, viewport = frame?.querySelector('.world-viewport');
    if (!frame || !viewport) return;
    const overlays = [...frame.querySelectorAll<HTMLElement>('.human-panel, .world-hud, .viewer-camera, .viewer-history, .dialogue-dock')];
    const measure = () => {
      const v = viewport.getBoundingClientRect();
      const origin = frame.getBoundingClientRect().top;
      const hud = frame.querySelector<HTMLElement>('.world-hud');
      if (hud) {
        const bottom = `${Math.ceil(hud.getBoundingClientRect().bottom - origin)}px`;
        if (frame.style.getPropertyValue('--app-hud-bottom') !== bottom) frame.style.setProperty('--app-hud-bottom', bottom);
      }
      const camera = frame.querySelector<HTMLElement>('.viewer-camera');
      if (camera) {
        const bottom = `${Math.ceil(camera.getBoundingClientRect().bottom - origin)}px`;
        if (frame.style.getPropertyValue('--app-camera-bottom') !== bottom) frame.style.setProperty('--app-camera-bottom', bottom);
      }
      const next: ViewportInsets = {};
      const phone = matchMedia('(max-width: 700px)').matches;
      if (!frame.classList.contains('has-advanced')) for (const el of overlays) {
        if (el.hidden || (el.matches('.human-panel') && !visible) || el.dataset.inset === 'none' || (el.matches('.viewer-history') && el.closest('.world-hud'))) continue;
        const p = el.getBoundingClientRect();
        if (!p.width || !p.height || p.right <= v.left || p.left >= v.right || p.bottom <= v.top || p.top >= v.bottom) continue;
        // DLG2: the dialogue dock is a left column (desktop) or bottom sheet (phone); keep Souls out from under it.
        const edge = el.matches('.human-panel, .dialogue-dock') ? phone ? 'bottom' : el.matches('.dialogue-dock') ? 'left' : 'right'
          : el.matches('.viewer-history') ? 'bottom'
          : 'top';
        const covered = edge === 'bottom' ? v.bottom - Math.max(v.top, p.top)
          : edge === 'right' ? v.right - Math.max(v.left, p.left)
          : edge === 'left' ? Math.min(v.right, p.right) - v.left
          : Math.min(v.bottom, p.bottom) - v.top;
        next[edge] = Math.max(next[edge] ?? 0, Math.ceil(covered));
      }
      setInsets(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); overlays.forEach(el => observer.observe(el));
    window.addEventListener('resize', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [root, visible, layout]);
  return insets;
}

/** VF2 (Gene): one "your camera" (drag orbits, right-drag pans, scroll zooms to the pointer, WASD/QE/RF keys;
 * WorldRtsCamera), and a split camera control beside Live: current state / one-click switching, modes and help. */
export function ViewerFrame({ handle, state, dt, navigationOpen, onNavigationChange, worldTime, connected = true, connecting = false, worldName, followName, slots, initial }: { handle: WorldViewerHandle | null; state: WorldViewerState | null; dt: number; navigationOpen: boolean; onNavigationChange: (open: boolean) => void; onNavigationOpen?: () => void; worldTime?: string; connected?: boolean; connecting?: boolean; worldName?: string; followName?: string | null; slots?: { status: HTMLElement | null; camera: HTMLElement | null }; initial?: InitialWorldProgress | null }) {
  const [cameraNote, setCameraNote] = useState('');
  const previewHour = useSyncExternalStore(subscribeVisitorHour, visitorPreviewHour, visitorPreviewHour);
  const [hourOpen, setHourOpen] = useState(false);
  const hourButton = useRef<HTMLButtonElement>(null);
  // DLG3 (Gene): the history scrub ("Back 1 min") is hidden for now; `?rewind` keeps it reachable for tests.
  const [rewind] = useState(() => { try { return new URLSearchParams(location.search).has('rewind'); } catch { return false; } });
  const help = useRef<HTMLDivElement>(null);
  const unavailable = !!state?.unavailableReason;
  const current = state?.shownTick != null && !state.loading && !unavailable;
  // VF1: arriving = no frame drawn yet. It gets one calm card (not warnings); a drawn view that stops being
  // current says why only once that lasts (transient gaps never flash), and the pill never says "Held".
  const reason = state?.unavailableReason ?? null;
  const blocked = !!reason && /graphics|3D/.test(reason);
  const drawnOnce = useRef(false);
  if (state?.shownTick != null && !state.loading) drawnOnce.current = true;
  const arriving = !blocked && (!state || state.shownTick == null || (state.loading && !drawnOnce.current));
  const [settledReason, setSettledReason] = useState<string | null>(null);
  useEffect(() => {
    if (!reason || arriving) { setSettledReason(null); return; }
    const id = setTimeout(() => setSettledReason(reason), blocked || /covered by controls/.test(reason) ? 0 : 4000);
    return () => clearTimeout(id);
  }, [reason, arriving, blocked]);
  // The card also carries the initial-assets progress (the world stays hidden until those assets are ready), so it
  // stays until they are, and steps aside when they fail: the viewer's own Retry is then the only thing to show.
  // Without such a gate (world-engine worlds) the bar follows the actual asset downloads while the card shows.
  const preparing = initialPending(initial);
  // lane PERF: a new world's card also waits for the GLBs nearest the arrival (gen-mesh/lazy-assets.ts, ≤ 30 s), so the
  // first view is the world, not bare ground filling in; old worlds never plan an eager set, so this is false there
  const assetsNear = useSyncExternalStore(arrivalGate.subscribe, arrivalGate.pending);
  // P7 lever D: a phone's new world drawn before the live data came: only the nearest assets still hold the card
  const early = useSyncExternalStore(earlyArrival.subscribe, earlyArrival.shown, earlyArrival.shown);
  if (early) drawnOnce.current = true;
  const card = ((!early && (arriving || preparing)) || assetsNear) && initial?.stage !== 'failed';
  const [arrivalShown, setArrivalShown] = useState(() => !earlyArrival.shown());   // P7d: a world already drawn before this page part came shows no card
  useEffect(() => { if (card) { setArrivalShown(true); return; } arrivalMark('card-done'); const id = setTimeout(() => setArrivalShown(false), 300); /* lane W1: the .25 s fade (world-chrome.css), then gone */ return () => clearTimeout(id); }, [card]);
  // The bar counts bytes (asset-bytes.ts: every asset fetch, total known up front), never files; it only moves forward
  // and is full once the world is ready. Without a byte total yet, the older measures stand in.
  const bytes = useSyncExternalStore(assetBytes.subscribe.bind(assetBytes), () => assetBytes.snapshot());
  // new worlds learn their total from the snapshot a moment after the first downloads start: no bar until then
  const inBytes = bytes.known && bytes.total > 0, byByte = card && inBytes;
  const measured = !card ? (arrivalShown ? 1 : null) : initial && (initial.stage === 'preparing' || initial.stage === 'first-frame') ? 1
    : byByte ? bytes.loaded / bytes.total : bytes.total > 0 && !bytes.known ? null : initial ? arrivalProgress(initial) : arriving ? assetDownloadProgress(state?.assetDownloads) : null;
  const peak = useRef(0);  // a file fetched again after an abort restarts its count: the bar (and its MB) hold, never step back
  if (!card) peak.current = 0;
  const progress = measured === null ? null : card ? (peak.current = Math.max(peak.current, Math.min(1, measured))) : measured;
  const lost = !connected && !arriving;
  const live = current && state?.presentation === 'live' && connected;
  const status = blocked && state?.shownTick == null ? 'View unavailable'
    : arriving || state!.loading ? 'Loading…'
    : lost ? 'Reconnecting…'
    : settledReason ? heldLabel(settledReason)
    : state!.presentation === 'history' ? 'Recorded' : 'Live';
  const statusClass = arriving || state?.loading ? 'loading' : !lost && !settledReason && current && connected ? 'ok' : 'warn';
  // #892: a glide to a Soul (flyToSoul) is Follow on its way, not your camera (no "Free" flash between two Souls)
  const kind = state?.cameraMode === 'follow' || state?.flyingTo ? 'follow' : state?.cameraMode === 'manual' ? 'yours' : 'broadcast';
  // Touch gestures on phones/tablets, read when the help is shown (the window may have been resized since).
  const touch = navigationOpen && (() => { try { return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 700px)').matches; } catch { return false; } })();
  const close = () => { onNavigationChange(false); setCameraNote(''); document.querySelector<HTMLElement>('.camera-menu .navbar-menu-trigger')?.focus(); };
  // VF6 (Gene: "if you touch WASD you break out of that mode so it's intuitive"): a short cue when Follow starts,
  // and a shorter one when a move key (or ×) hands the camera back to you.
  const [followCue, setFollowCue] = useState<'' | 'follow' | 'free'>('');
  const lastKind = useRef(kind);
  useEffect(() => {
    const was = lastKind.current; lastKind.current = kind;
    if (kind === was) return;
    const cue = kind === 'follow' ? 'follow' : was === 'follow' && kind === 'yours' ? 'free' : '';
    setFollowCue(cue); if (!cue) return;
    const id = setTimeout(() => setFollowCue(''), cue === 'follow' ? 5000 : 2500); return () => clearTimeout(id);
  }, [kind]);
  const coarse = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  useEffect(() => {
    if (!navigationOpen) return;
    handle?.releaseInput?.(); help.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [navigationOpen, handle, onNavigationChange]);
  const toBroadcast = () => { setCameraNote(''); handle?.setCameraMode('broadcast'); };
  const yourCamera = () => { setCameraNote(''); if (handle?.setManualNavigation) handle.setManualNavigation('orbit'); else handle?.setCameraMode('manual'); };
  // VF3 (Gene): the status ("● Live · time", and any reason it is not live) and the camera chip live in the top bar
  // (Shell's slots); nothing sits at the bottom of the screen.
  const statusBlock = <div className="viewer-history" data-viewer-navigation={state?.manualNavigation ?? ''} data-viewer-input={state?.inputOwned ?? false} data-viewer-mode={state?.cameraMode ?? ''} data-viewer-presentation={state?.presentation ?? ''} data-viewer-tick={state?.shownTick ?? ''} data-viewer-selection={state?.selection.soulId ?? state?.selection.entityId ?? ''} data-viewer-ready={!!handle}>
      <div className="row viewer-status">
        <span className={statusClass} data-viewer-status data-viewer-live={live} title={state?.shownTick == null ? undefined : `Recorded tick ${state.shownTick.toFixed(0)}`}>{status}</span>
        {state?.shownTick != null && !arriving && worldTime && <button ref={hourButton} type="button" className="world-time world-time-button" aria-expanded={hourOpen} title="Preview the time of day (only you see it)" onClick={() => setHourOpen(!hourOpen)}>{previewHour != null ? <>Preview {hourLabel(previewHour)}</> : worldTime.includes(' · ') ? <><span className="world-day">{worldTime.split(' · ')[0]} </span>{worldTime.split(' · ').slice(1).join(' · ')}</> : worldTime}</button>}
        {hourOpen && !arriving && createPortal(<div className="time-preview" role="group" aria-label="Preview the time of day" style={(() => { const r = hourButton.current?.getBoundingClientRect(); return { top: (r?.bottom ?? 48) + 8, left: Math.max(16, (r?.left ?? 16) - 12) }; })()}>
          <label>Time of day <b>{previewHour != null ? hourLabel(previewHour) : 'now'}</b>
            <input type="range" min={0} max={1425} step={15} value={previewHour ?? 720} aria-label="Preview hour" onChange={(e) => setVisitorPreviewHour(Number(e.target.value))} /></label>
          <button type="button" onClick={() => { setVisitorPreviewHour(null); setHourOpen(false); }}>Back to now</button>
          <span className="dim">Only you see this; the world's clock does not change.</span>
        </div>, document.body)}
        {!arriving&&!!state?.assetDownloads?.pending&&<span className="asset-download-note" role="status" title="Actual asset downloads; the world stays usable while art arrives.">Art loading · {state.assetDownloads.loaded}/{state.assetDownloads.total}</span>}
        {settledReason && !lost && <span role="status" className="warn viewer-reason" title={settledReason}>{settledReason}</span>}
        {rewind && <button disabled={!handle || state?.shownTick == null || state.loading} onClick={() => { if (state?.shownTick != null) void handle?.seek(Math.max(0, state.shownTick - 60 / dt)); }}>Back 1 min</button>}
        {state?.presentation === 'history' && <>
          <button onClick={() => handle?.setPlaying(state.playback !== 'playing')}>{state.playback === 'playing' ? 'Pause recording' : 'Play recording'}</button>
          <button onClick={() => handle?.live()}>Return to live</button>
        </>}
      </div>
    </div>;
  const cameraLabel=arriving?'Loading':state?.presentation==='history'?'Recorded':kind==='follow'?`Following ${followName??'a Soul'}`:kind==='yours'?'Free':'Broadcast';
  const cameraAction=kind==='broadcast'?'Switch to Free camera':'Return to Broadcast';
  const cameraBlock=<div className="viewer-camera-chip camera-split" data-camera={kind} data-follow-soul={kind==='follow'?state?.selection.soulId??'':undefined}>
    <button type="button" className="camera-main" disabled={!handle||arriving} aria-label={`${cameraLabel}: ${cameraAction}`} title={cameraAction} data-tooltip={cameraAction} onClick={()=>kind==='broadcast'?yourCamera():toBroadcast()}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.4-2h5.2l1.4 2h3v9.5H3z" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="11" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg><span className={kind==='follow'?'viewer-following-label':undefined}>{cameraLabel}</span>
    </button>
    <NavbarMenu label="Camera modes and help" className="camera-menu" trigger={<span aria-hidden="true">⌄</span>}>
      {dismiss=><><button type="button" aria-pressed={kind==='broadcast'} disabled={!handle||arriving} onClick={()=>{toBroadcast();dismiss();}}>Broadcast</button>
      <button type="button" aria-pressed={kind==='yours'} disabled={!handle||arriving} onClick={()=>{yourCamera();dismiss();}}>Free</button>
      {kind==='follow'&&<button type="button" onClick={()=>{yourCamera();dismiss();}}>Stop following</button>}
      <button type="button" onClick={()=>{dismiss();onNavigationChange(true);}}>Camera controls</button><FullscreenToggle/></>}
    </NavbarMenu>
  </div>;
  return <>
    {arrivalShown && !blocked && initial?.stage !== 'failed' && <div className="viewer-arrival" data-done={!card} role="status" aria-live="polite">
      <div className="viewer-arrival-card"><span className="viewer-arrival-spinner" aria-hidden="true" />
        <div><p className="viewer-arrival-title">Arriving in {worldName ?? 'the world'}</p>
          <p className="viewer-arrival-stage">{arriving ? byByte ? 'Downloading the world…' : state?.assetDownloads?.pending ? `Downloading world assets · ${state.assetDownloads.loaded} of ${state.assetDownloads.total} ready` : `${arrivalStage(reason, connecting)}…` : preparing ? byByte && progress !== null && progress < 1 ? 'Downloading the world…' : 'Preparing the world…' : assetsNear ? byByte && progress !== null && progress < 1 ? 'Downloading the world…' : 'Preparing the world…' : 'Ready'}</p>
          {progress !== null && <div className="viewer-arrival-progress"><progress aria-label="World loading progress" max={1000} value={Math.round(progress * 1000)} /><span>{inBytes ? megabytes({ loaded: Math.min(1, progress) * bytes.total, total: bytes.total }) : `${Math.round(progress * 100)}%`}</span></div>}</div></div>
    </div>}
    {followCue && !arriving && <div className="viewer-follow-hint" role="status" aria-live="polite" data-cue={followCue}>{followCue === 'follow'
      ? coarse ? <>Following <b>{followName ?? 'a Soul'}</b> · swipe for the next Soul · tap the ground to take over</> : <>Following <b>{followName ?? 'a Soul'}</b> · drag to look around, scroll to zoom · press <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to look around freely</>
      : <>Your camera · <b>Return to Broadcast</b> is top left</>}</div>}
    {navigationOpen && <div className="camera-help-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="camera-help" role="dialog" aria-modal="true" aria-labelledby="camera-help-title" tabIndex={-1} ref={help}>
        <button type="button" className="camera-help-close" aria-label="Close" title="Close (Esc)" onClick={close}><span aria-hidden="true">×</span></button>
        <h2 id="camera-help-title">Camera</h2>
        <p><b>Broadcast</b> directs itself, cutting between Souls and whatever is happening. Any drag, scroll or move key gives you the camera; <b>the camera button</b> (top left, beside Live) returns it.</p>
        {touch ? <><h3>Touch</h3>
          <ul className="camera-keys"><li><span>Thumb, lower left</span><span>walk (hold still first to keep walking)</span></li><li><span>One finger</span><span>look around in place</span></li><li><span>Pinch</span><span>glide toward or away</span></li><li><span>Two fingers up · down</span><span>rise · lower</span></li><li><span>Double-tap</span><span>fly there</span></li><li><span>Tap a Soul or its name plate</span><span>follow it</span></li><li><span>Swipe sideways while following</span><span>the next Soul</span></li><li><span>Tap the ground while following</span><span>your camera, there</span></li></ul></> : <><h3>Mouse</h3>
          <ul className="camera-keys"><li><span>Drag</span><span>orbit around the centre</span></li><li><span>Right-drag</span><span>look around in place</span></li><li><span>Scroll</span><span>zoom toward the pointer</span></li><li><span>Double-click</span><span>fly there</span></li><li><span>Click a name plate</span><span>meet that Soul</span></li></ul>
          <h3>Keyboard</h3>
          <ul className="camera-keys"><li><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>forward · back · sideways, staying level</span></li><li><span>← → · ↑ ↓</span><span>turn · look up and down</span></li><li><span><kbd>Q</kbd><kbd>E</kbd></span><span>lower · raise</span></li><li><span><kbd>R</kbd><kbd>F</kbd></span><span>raise · lower, too</span></li><li><span><kbd>Shift</kbd></span><span>faster</span></li><li><span><kbd>Alt</kbd></span><span>slow precision movement</span></li></ul></>}
        <p className="camera-help-follow"><b>Follow</b> a Soul from its card{touch ? ' (or tap it)' : ''}: the camera stays on it. Drag orbits around it, scroll zooms{touch ? ', pinch zooms' : ''}. {touch ? 'Tap the ground or choose Free to stop following' : 'Right-drag, a navigation key, or Free stops following'}, right where you are.</p>
        <div className="camera-help-actions">
          <button type="button" disabled={kind === 'broadcast' || !handle} onClick={() => { toBroadcast(); close(); }}>Back to broadcast</button>
          <button type="button" disabled={kind === 'broadcast' || !current || !handle?.resetView} onClick={() => setCameraNote(handle?.resetView?.() ? '' : 'The current view could not be reset.')}>Reset view</button>
        </div>
        {cameraNote && <p role="status">{cameraNote}</p>}
        <ImportCredits />
      </div>
    </div>}
    {slots ? <>{slots.status && createPortal(statusBlock, slots.status)}{slots.camera && createPortal(cameraBlock, slots.camera)}</>
      : <div className="viewer-bottom">{statusBlock}{cameraBlock}</div>}
  </>;
}
