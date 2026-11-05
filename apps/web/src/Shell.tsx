import {AudioMenu} from './AudioMenu.tsx';
import { HudMore } from './HudMore.tsx';
import {explorePresence} from './explore-data.ts';
import {bodiesFromEvents} from './soul-state.ts';
import {exploreAvailable} from './explore-control.ts';
import {arrivalOver} from './arrival-marks.ts';
import {MySouls,useMySouls} from './MySouls.tsx';
import {edenReleaseWorlds,edenExperienceEnabled} from './eden-release.ts';
import {EdenTour,type EdenTourPlace} from './EdenTour.tsx';
import {ClassroomPresentation} from './ClassroomPresentation.tsx';
import {classroomProjection,classroomScreenEntityId} from './classroom-projection.ts';
import {WorldSpeechOverlay} from './WorldSpeechOverlay.tsx';
import { apiPath, worldPath } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { LogEvent } from '@sim/protocol';
import { describeIntent } from '@sim/protocol';
import { makeApi, refreshMe, useSim, type Sim } from './useSim.ts';
import {WorldAccountControls} from './AccountMenu.tsx';
import {SoulAccount} from './SoulAccount.tsx';
import {useSignOutAtOnce} from './sign-out-now.ts';
import {EdenMark} from './EdenMark.tsx';
import {LocalIntegrationNotice,LocalConnectionHelp,DebugPanel} from './LocalIntegration.tsx';
import './world-chrome.css';
import {createApiRequest} from './api-request.ts';
import {VisitorWelcome} from './VisitorWelcome.tsx';
import { LiveWorld } from './LiveWorld.tsx';
import { SoulFocus } from './SoulFocus.tsx';
import {approvedMe,authIdentity} from './auth-projection.ts';
import { useViewerInsets, ViewerFrame } from './ViewerFrame.tsx';
import type { InitialWorldProgress } from './InitialWorldReadiness.ts';
import {connectionLost} from './viewer-arrival.ts';
import {BringAgent} from './BringAgent.tsx';
import {OldWorldApprovals} from './OldWorldApprovals.tsx';
import {answerApprovalTabs,approvalChannelName,approvalFromHash,askOpenTab} from './approval-link.ts';
import {useApprovalFollow} from './useApprovalFollow.ts';
import {FOLLOW_SOUL_WAIT_MS,onFollowSoulRequest,requestFollowSoul} from './follow-soul-request.ts';
import {onLookAtRequest} from './look-at-request.ts';
import {worldClockAt,worldTimeText} from './world-clock.ts';
import type { WorldViewerHandle, WorldViewerState } from './WorldViewer.ts';
import { worldKey } from './world-path.ts';
// A world made with "New world" (the world launcher): its god panel carries sign-in, claim, approvals and Join as a
// Soul, so the legacy Soul/account setup is hidden there. The old worlds (root build, these keys) keep main's (e8) Shell.
import { newWorld as launcherWorld } from './world-kind.ts';
import { joinLink } from './god-ui/join-api.ts';
import {soulFragment,soulFromFragment} from './soul-link.ts';
import {AUTH_UI,configuredSignIn} from './auth-ui.ts';
import {publishSession,type SessionMode} from './auth-session.ts';
import {getStatus as godStatus} from './god-ui/god-api.ts';
import {worldTitle} from './world-title.ts';
import { GodButton } from './god-ui/GodButton.tsx';
import {SoulChip} from './SoulChip.tsx';
import {doingText} from './place-names.ts';
// P1 phones: the advanced surface's panels are lazy chunks, fetched the first time the advanced surface shows them
// (never on a world's arrival)
const lazyNamed=<M,K extends keyof M>(load:()=>Promise<M>,name:K)=>lazy(()=>load().then(m=>({default:m[name] as ComponentType<any>})));
const grammar=()=>import('./Grammar.tsx'),brainPanels=()=>import('./BrainPanels.tsx');
const BrainPanel=lazyNamed(brainPanels,'BrainPanel'),BroadcastPanel=lazyNamed(brainPanels,'BroadcastPanel'),NarrativePanel=lazyNamed(brainPanels,'NarrativePanel');
const AdminPanel=lazyNamed(()=>import('./AdminPanel.tsx'),'AdminPanel'),SoulHome=lazyNamed(()=>import('./SoulHome.tsx'),'SoulHome');
const ArchPanel=lazyNamed(()=>import('./Arch.tsx'),'ArchPanel');
const SpendPanel=lazyNamed(()=>import('./Spend.tsx'),'SpendPanel');
const BacklogPanel=lazyNamed(grammar,'BacklogPanel'),HeardPanel=lazyNamed(grammar,'HeardPanel'),LibraryPanel=lazyNamed(grammar,'LibraryPanel'),NotebookPanel=lazyNamed(grammar,'NotebookPanel');
const SentencesPanel=lazyNamed(grammar,'SentencesPanel'),ThingsPanel=lazyNamed(grammar,'ThingsPanel'),VocabularyPanel=lazyNamed(grammar,'VocabularyPanel');

export type AuthCtx = {
  ready: boolean; authed: boolean; label: string | null; avatarUrl?:string|null; signInUrl?:string;
  /** Which sign-in this is (published to code outside these props: the god panel, Join). New worlds only. */
  mode?: SessionMode;
  login(): void; logout(returnUrl?:string): Promise<void> | void; getToken(): Promise<string | null>;
  debug: { privyUserId: string | null; accountIdentity?:string|null; wallet: unknown; linked: unknown[] };
};
type Cfg = { worldName?:string; authProvider?:'clerk'|'privy'|'none';clerkPublishableKey?:string;clerkIssuer?:string;privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean; accountAuthRequired?:boolean; inviteRequired?: boolean; build?: string; localIntegrationMetadataPath?:string };
const qualifiedEdenWorlds=edenReleaseWorlds(import.meta.env.VITE_EDEN_EXPERIENCE_WORLD_IDS);
const TABS = ['watch', 'my soul', 'grammar', 'notebook', 'world', 'debug', 'brain', 'story', 'sync', 'spend', 'admin', 'architecture', 'everything'] as const;
const ADMIN_TABS = new Set<string>(['spend', 'admin']);
const hashTab = (): { tab: Tab; pair: string | null; soul?:string|null } => { const soul=soulFromFragment(location.hash); if(soul)return {tab:'watch',pair:null,soul}; let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* a mangled link: fall back to the first tab */ } if (h.startsWith('pair/')) return /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(h.slice(5)) ? { tab: 'my soul', pair: h.slice(5) } : { tab: 'my soul', pair: null }; return { tab: (TABS as readonly string[]).includes(h) ? (h as Tab) : 'watch', pair: null, soul:null }; };
type Tab = (typeof TABS)[number];

// Gene's review #1 item 3 (lane PAIR-UI): an #approve link opened while a tab of this world is open hands the request to
// that tab (approval-link.ts askOpenTab) and shows only a short note here (ApproveOnly.tsx, its own small chunk): no second
// world, socket or score. With no open tab it boots the world with the card, as before.
const ApproveOnly=lazy(()=>import('./ApproveOnly.tsx').then(m=>({default:m.ApproveOnly})));
type ShellProps={ cfg: Cfg; auth: AuthCtx; arrivalEnabled?:boolean;humanPresetsEnabled?:boolean };
export function Shell(props:ShellProps){
  const [linkId]=useState(()=>approvalFromHash(location.hash));
  const [mode,setMode]=useState<'world'|'asking'|'handed'>(linkId?'asking':'world');
  useEffect(()=>{if(!linkId)return;let live=true;void askOpenTab(approvalChannelName(props.cfg.worldId),linkId).then(ok=>{if(live)setMode(m=>m==='asking'?(ok?'handed':'world'):m);});return()=>{live=false;};},[linkId,props.cfg.worldId]);
  if(mode==='world'||!linkId)return <ShellWorld {...props}/>;
  if(mode==='asking')return <main className="approve-only" aria-busy="true"/>;
  return <Suspense fallback={<main className="approve-only" aria-busy="true"/>}><ApproveOnly id={linkId} cfg={props.cfg} auth={props.auth} worldName={worldTitle(props.cfg.worldName,worldKey)}/></Suspense>;
}

function ShellWorld({ cfg, auth: providerAuth, arrivalEnabled=false,humanPresetsEnabled=true }: ShellProps) {
  const auth = useSignOutAtOnce(providerAuth);  // U3: signed-out everywhere the moment Sign out is pressed
  const tokenReader = useRef(auth.getToken);
  tokenReader.current = auth.getToken;
  // the god panel and the Join flow act as this same person (auth-session.ts)
  useEffect(()=>{publishSession({mode:auth.mode??(cfg.authProvider==='clerk'?'clerk':'none'),ready:auth.ready,authed:auth.authed,scope:authIdentity(auth),label:auth.label,signInUrl:auth.signInUrl,getToken:()=>tokenReader.current(),login:auth.login,logout:auth.logout});});
  const getToken = useCallback(() => tokenReader.current(), []);
  const sim = useSim(getToken, auth.authed,authIdentity(auth),cfg.worldId);
  const apiGeneration=useRef(0);
  const apiMe=approvedMe(auth,sim.me);
  const apiScope=JSON.stringify([sim.privateAuthorityGeneration??0,cfg.worldId,auth.ready,auth.authed,authIdentity(auth),apiMe?.userId,apiMe?.role,apiMe?.invited,apiMe?.souls.slice().sort()]);
  const lastApiScope=useRef(apiScope);
  if(lastApiScope.current!==apiScope){lastApiScope.current=apiScope;apiGeneration.current++;}
  // Me is mutated by the validated Connection before React's next render.
  // Recheck that current projection around queued credentials/responses too.
  const apiScopeReader=useRef(()=>apiScope);
  apiScopeReader.current=()=>{const me=approvedMe(auth,sim.me);return JSON.stringify([sim.privateAuthorityGeneration??0,cfg.worldId,auth.ready,auth.authed,authIdentity(auth),me?.userId,me?.role,me?.invited,me?.souls.slice().sort()]);};
  const readApiGeneration=useCallback(()=>{const current=apiScopeReader.current();if(lastApiScope.current!==current){lastApiScope.current=current;apiGeneration.current++;}return apiGeneration.current;},[]);
  const api = useMemo(() => makeApi(getToken,readApiGeneration), [getToken,readApiGeneration]);
  const siteApi = useMemo(() => createApiRequest(getToken,{path:path=>path,session:readApiGeneration}),[getToken,readApiGeneration]);
  const privatePanelKey=JSON.stringify([cfg.worldId,sim.privateAuthorityGeneration??0,auth.authed,authIdentity(auth)]);
  useEffect(()=>()=>{apiGeneration.current++;},[]);
  const [tab, setTab] = useState<Tab>(() => hashTab().tab);
  const [pairCode, setPairCode] = useState<string | null>(() => hashTab().pair);
  const [approvalId,setApprovalId]=useState(()=>approvalFromHash(location.hash));
  const approvalScope=JSON.stringify([cfg.worldId,authIdentity(auth)]);
  const [selected, setSelected] = useState<string | null>(()=>hashTab().soul??null); // public selection only
  // New worlds: the display name their server was given ("Little Martians (Arium)"), not the slug.
  const [newWorldName,setNewWorldName]=useState<string|null>(null);
  useEffect(()=>{if(launcherWorld)void godStatus().then(s=>{if(s?.name)setNewWorldName(s.name);});},[]);
  // The served title from the first frame (V1: never the slug); god status only refreshes it.
  const worldName=newWorldName??worldTitle(cfg.worldName,worldKey);
  useEffect(() => { if (!pairCode&&!approvalId){if(location.hash==='#join'||tab==='watch'&&!selected&&location.hash==='#advanced')return;const next=tab==='watch'&&selected?soulFragment(selected):tab;if(location.hash!=='#'+next){if(location.hash===''||location.hash==='#')history.replaceState(history.state,'',location.pathname+location.search+'#'+next);else location.hash=next;}} }, [tab, pairCode,selected,approvalId]);
  // lane QA: the landing's own '#watch' replaces the bare URL instead of pushing a second entry: one Back now leaves the
  // world (a stranger pressed Back and stayed on the same view).
  useEffect(()=>{const changed=()=>{setApprovalId(approvalFromHash(location.hash));};addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  // lane PAIR-UI: this open world tab answers an #approve link opened in another tab of the same world (Shell above): the
  // tab most recently in front shows the card. The hash says so too, so a sign-in round trip comes back to it.
  useEffect(()=>{let front=document.visibilityState==='visible'?Date.now():0;const mark=()=>{if(document.visibilityState==='visible')front=Date.now();};
    addEventListener('focus',mark);document.addEventListener('visibilitychange',mark);
    const stop=answerApprovalTabs(approvalChannelName(cfg.worldId),id=>{location.hash='approve/'+id;},()=>front);
    return()=>{stop();removeEventListener('focus',mark);document.removeEventListener('visibilitychange',mark);};},[cfg.worldId]);
  useEffect(() => { const f = () => { if(approvalFromHash(location.hash))return; if(location.hash==='#advanced'){setAdvanced(true);setPanelOpen(false);setTab('watch');return;} const h = hashTab(); setTab(h.tab); if (!['watch', 'my soul'].includes(h.tab)) setAdvanced(true); else if(h.soul&&h.soul!==chipRef.current){setAdvanced(false);setPanelOpen(true);setNavigationOpen(false);}  /* #892: the chip's own selection writes this hash; it keeps the card collapsed */ if(h.tab==='watch')setSelected(h.soul??null); if (h.pair) setPairCode(h.pair); else if(h.tab==='watch')setPairCode(null); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [lessonIndex,setLessonIndex]=useState(0);
  const [lessonOpen,setLessonOpen]=useState(false);
  // VF3 (Gene): Advanced is unlisted; reach it at #advanced (or any Advanced tab's hash).
  const [advanced, setAdvanced] = useState(() => !['watch', 'my soul'].includes(hashTab().tab) || location.hash === '#advanced');
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null), [cameraSlot, setCameraSlot] = useState<HTMLDivElement | null>(null);
  // UI2: the Soul panel opens only from a name plate, a name in a thread, or a shared Soul link.
  const [panelOpen, setPanelOpen] = useState(() => !!hashTab().soul);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const revealPanel = useCallback(() => {
    if (matchMedia('(max-width: 700px)').matches) setNavigationOpen(false);
    setPanelOpen(true);
  }, []);
  const frame = useRef<HTMLDivElement>(null);
  const [viewerHandle, setViewerHandle] = useState<WorldViewerHandle | null>(null);
  const [viewerState, setViewerState] = useState<WorldViewerState | null>(null);
  const receiveHandle = useCallback((handle: WorldViewerHandle | null) => setViewerHandle(handle), []);
  const receiveState = useCallback((state: WorldViewerState) => setViewerState(state), []);
  const [initialProgress, setInitialProgress] = useState<InitialWorldProgress | null>(null);
  // Gene 2026-10-20c: the god panel's approval card closed because the new Soul's body is ready: follow that Soul as
  // Explore -> a Soul does, as soon as it reaches this window's picture (up to a minute; a manual drag outranks it)
  const [cardFollow,setCardFollow]=useState<{soulId:string;scope:string}|null>(null);
  const meRef=useRef(sim.me);meRef.current=sim.me;
  // B3: chips, Explore Soul rows, the card's Follow button and the approval card all ask here (requestFollowSoul): fly the
  // camera to the Soul's Follow shot (flyToSoul); a Soul not in the picture yet is followed when it arrives (cardFollow).
  // Re-read Me when it is not ours yet (the owner box needs it for a just-approved Soul).
  const handleRef=useRef<WorldViewerHandle|null>(null);handleRef.current=viewerHandle;
  useEffect(()=>onFollowSoulRequest(soulId=>{if(!meRef.current?.souls.includes(soulId))refreshMe(sim);setCardFollow(null);if(!handleRef.current?.flyToSoul?.(soulId))setCardFollow({soulId,scope:'card'});}),[]);
  useEffect(()=>{if(!cardFollow)return;const t=setTimeout(()=>setCardFollow(null),FOLLOW_SOUL_WAIT_MS);return()=>clearTimeout(t);},[cardFollow]);
  useApprovalFollow(cardFollow,'card',true,viewerHandle,viewerState,()=>setCardFollow(null));
  // OWNER-DAY: a "Today" entry moves the camera to where it happened (your own camera, not follow/broadcast).
  useEffect(()=>onLookAtRequest(({x,z})=>{if(viewerHandle?.setManualNavigation)viewerHandle.setManualNavigation('orbit');else viewerHandle?.setCameraMode('manual');void import('./god-ui/camera.ts').then(m=>m.flyTo(x,0,z,{distance:28}));}),[viewerHandle]);
  const placePreview=useCallback((place:EdenTourPlace)=>viewerHandle?.locationPreview?.(place)??Promise.resolve(null),[viewerHandle]);
  const openNavigation = useCallback(() => setPanelOpen(false), []);
  const viewportInsets = useViewerInsets(frame, !advanced && panelOpen, `${advanced}:${navigationOpen}:${tab}:${selected}`);
  const currentMe=approvedMe(auth,sim.me);
  const isAdmin = currentMe?.role === 'admin';
  const restoreWorldFocus = useRef(false);
  useEffect(() => {
    if (ADMIN_TABS.has(tab) && !isAdmin) {
      restoreWorldFocus.current = true;
      setTab('watch'); setAdvanced(false); revealPanel();
    }
  }, [tab, isAdmin, revealPanel]);
  useEffect(() => {
    if (!advanced && tab === 'watch' && panelOpen && restoreWorldFocus.current) {
      restoreWorldFocus.current = false;
      frame.current?.querySelector<HTMLElement>('#soul-panel')?.focus();
    }
  }, [advanced, tab, panelOpen]);
  const show = (...t: Tab[]) => tab === 'everything' || t.includes(tab);
  const r = sim.conn.replica, st = sim.conn.stats;
  useMySouls(); // keeps reading #mine= share fragments; the card's Pin button is gone (CARD-TRIM)
  // Local favourites never establish ownership. Navbar comes only from server Me.
  const ownedIds=currentMe?.souls??[];
  const signinEnabled=AUTH_UI&&configuredSignIn(cfg,launcherWorld);  // new worlds: local dev sign-in too
  const newSoulAvailable=(!signinEnabled||auth.ready)&&(signinEnabled||cfg.accountAuthRequired!==true);
  const mine = new Set(currentMe?.souls ?? []);
  // #892: a touch that followed a Soul (a tap, a swipe, the Broadcast chip) collapses its card to the bottom chip.
  const [chip,setChip]=useState<string|null>(null),chipRef=useRef<string|null>(null),[chipNote,setChipNote]=useState<{text:string;at:number}|null>(null);
  const [coarse]=useState(()=>{try{return matchMedia('(pointer: coarse)').matches;}catch{return false;}});
  useEffect(()=>{if(!chipNote)return;const t=setTimeout(()=>setChipNote(null),2500);return()=>clearTimeout(t);},[chipNote]);
  const inspect = (id: string | null, how?: 'chip') => { setSelected(id); if(how==='chip'&&id){chipRef.current=id;setChip(id);setPanelOpen(false);return;} chipRef.current=null;setChip(null); if (id) revealPanel(); };
  const accountSouls=(entry:ReactNode)=><MySouls key={JSON.stringify([worldKey,currentMe?.userId])} recencyKey={JSON.stringify(['sim.soul-recency',worldKey,currentMe?.userId??'public'])} selectedId={selected} newSoul={entry} api={api} bodies={soulBodies} ids={ownedIds} souls={r.souls} present={new Set([...r.souls.values()].filter(s=>r.entities[s.entityId]).map(s=>s.id))} select={inspect} follow={requestFollowSoul}/>;
  const edenExpansion=edenExperienceEnabled(location.hostname,worldPath,cfg.worldId,sim.conn.welcome?.worldId,qualifiedEdenWorlds);
  // P1 phones (F12): the page that will show the old Eden town asks for its chunk before the welcome (it came ~1.3 s late)
  const edenExpected=edenExperienceEnabled(location.hostname,worldPath,cfg.worldId,cfg.worldId,qualifiedEdenWorlds);
  const tourHandle=viewerHandle;
  const exploreSeen=useRef(false),exploreOn=exploreAvailable(exploreSeen.current,viewerState);exploreSeen.current=exploreOn;  // V1: a viewer blip no longer unmounts Explore
  const explorePage=viewerHandle?.locationPage?.()??null;
  const exploreLocations=arrivalOver()?viewerHandle?.locations?.()??[]:[];  // P7b: the first scan of the world's views (~0.12 s on a 4x phone) waits for the card
  const exploreName=worldName;
  const soulBodies=bodiesFromEvents(sim.edge??[]);
  const localClassroomPresentation=classroomProjection(edenExpansion,sim.conn.welcome?.worldId,Object.hasOwn(r.entities,classroomScreenEntityId),viewerState?.presentation==='live'&&!viewerState.loading&&!viewerState.unavailableReason,lessonIndex,cfg.worldId);
  const openAccount = () => { setAdvanced(false); setPairCode(null); setTab('my soul'); revealPanel(); };
  return (
    <div ref={frame} className={`human-world ${advanced ? 'has-advanced' : ''}`}>
      {!launcherWorld&&<OldWorldApprovals linkId={approvalId} auth={auth} accountAuthRequired={cfg.accountAuthRequired===true} onLinkDone={()=>{setApprovalId(null);history.replaceState(null,'',location.pathname+location.search+'#watch');}}/>}
      <div className="world-scene"><LiveWorld sim={sim} selected={selected} onSelect={inspect} onChipNote={text=>setChipNote({text,at:Date.now()})} embedded bootWorldId={launcherWorld?cfg.worldId:undefined} {...{edenExpansion,edenExpected,localClassroomPresentation,publishSpeechAnchors:!advanced,humanPresets:humanPresetsEnabled&&edenExpansion}} hideControls={!advanced} hideSoulInfo={!advanced} viewportInsets={viewportInsets} onViewerHandle={receiveHandle} onViewerState={receiveState} onInitialProgress={advanced ? undefined : setInitialProgress} /></div>
      <VisitorWelcome key={privatePanelKey} api={api} siteApi={siteApi} worldPath={worldPath} ownerId={currentMe?.userId??null} worldId={cfg.worldId} worldName={worldName} build={cfg.build} handle={viewerHandle} state={viewerState}/>
      <WorldSpeechOverlay root={frame} sim={sim} state={viewerState} active={!advanced} handle={viewerHandle}/>
      {!advanced && <ViewerFrame handle={viewerHandle} state={viewerState} dt={sim.conn.welcome?.dt ?? 0.05} navigationOpen={navigationOpen} onNavigationChange={setNavigationOpen} onNavigationOpen={openNavigation} worldTime={worldTimeText(worldClockAt((sim as Sim&{takes?:{chunks?:unknown[]}|null}).takes?.chunks,viewerState?.shownTick))} connected={!connectionLost(sim.conn)} connecting={!sim.conn.welcome} worldName={worldName} followName={viewerState?.cameraMode === 'follow' || viewerState?.flyingTo ? r.souls.get(viewerState.flyingTo ?? viewerState.selection.soulId ?? '')?.name ?? null : null} selectedName={r.souls.get(viewerState?.selection.soulId ?? '')?.name ?? null} slots={{ status: statusSlot, camera: cameraSlot }} initial={initialProgress} />}
      <header className={`world-hud${advanced ? '' : ' slim'}`}>
        {advanced && <>
        <a href="/" className="world-home">SIM</a>
        <span className="world-name">{worldName}</span>
        <span className={st.state === 'open' ? 'ok' : 'dim'}>{st.state === 'open' ? '● Connected' : 'Connecting…'}</span>
        </>}
        {!advanced&&<div className="hud-left"><EdenMark/><div className="hud-status" ref={setStatusSlot}/><div className="hud-camera-row"><div className="hud-camera-slot" ref={setCameraSlot}/></div>
        <div className="hud-explore-group">{exploreOn&&tourHandle?.frameLocation&&<EdenTour bodies={soulBodies} worldName={exploreName} locations={exploreLocations} locationPage={explorePage??undefined} onSearch={explorePage?(query=>viewerHandle?.searchLocations?.(query)):undefined} onMore={explorePage?(()=>viewerHandle?.moreLocations?.()):undefined} onClose={()=>viewerHandle?.cancelLocationPictures?.()} presence={explorePresence(sim.edge??[],r.souls.keys())} room={viewerState?.room} souls={r.souls} present={new Set([...r.souls.values()].filter(s=>r.entities[s.entityId]).map(s=>s.id))} onOpen={()=>{if(!explorePage)viewerHandle?.refreshLocations?.();viewerHandle?.releaseInput?.();setNavigationOpen(false);}} onSoul={id=>requestFollowSoul(id)} preview={placePreview} onView={place=>{const viewed=tourHandle.frameLocation?.(place)??false;if(viewed){setPanelOpen(false);setNavigationOpen(false);}return viewed;}}/>}{launcherWorld&&<GodButton/>}{newSoulAvailable?<BringAgent key={JSON.stringify([cfg.worldId??location.pathname,authIdentity(auth)])} renderEntry={accountSouls} auth={auth} requireAuth={cfg.accountAuthRequired===true} worldName={launcherWorld?worldName:undefined}/>:accountSouls(null)}</div><AudioMenu/><HudMore/></div>}
        {!launcherWorld&&<LocalIntegrationNotice source={cfg.localIntegrationMetadataPath}/>}{AUTH_UI&&!launcherWorld&&<LocalConnectionHelp devAuth={cfg.devAuth}/>}
        <div className="hud-actions">
          {advanced&&<a className="world-back" href="#watch" onClick={e => { e.preventDefault(); setAdvanced(false); setPairCode(null); setTab('watch'); history.replaceState(null, '', '#watch'); }}>← Back to the world</a>}
          <WorldAccountControls signinEnabled={signinEnabled} accountAuthRequired={cfg.accountAuthRequired} auth={auth} inviteUrl={joinLink()} newSoul={advanced?<BringAgent showButton={false} key={cfg.worldId??location.pathname} auth={auth} requireAuth={cfg.accountAuthRequired===true} worldName={launcherWorld?worldName:undefined}/>:undefined}/>

        </div>
      </header>
      {!advanced&&!panelOpen&&(()=>{
        const following=chip&&selected===chip&&(viewerState?.cameraMode==='follow'||viewerState?.flyingTo===chip)?r.souls.get(chip):undefined;
        if(following)return <SoulChip kind="follow" name={following.name} status={doingText(following.doing,(r.entities[following.entityId] as {activity?:string}|undefined)?.activity,following.id)} note={chipNote?.text} openCard={()=>{chipRef.current=null;setChip(null);revealPanel();}}/>;
        const showing=coarse&&viewerState?.cameraMode==='broadcast'&&viewerState.shownTick!=null&&viewerState.broadcastSoulId?r.souls.get(viewerState.broadcastSoulId):undefined;
        return showing?<SoulChip kind="broadcast" name={showing.name} follow={()=>{viewerHandle?.flyToSoul?.(showing.id,{chip:true});}}/>:null;
      })()}
      <aside id="soul-panel" tabIndex={-1} className="human-panel" hidden={advanced || !panelOpen || tab === 'my soul'} aria-label="Selected Soul">
        <button className="panel-close" aria-label="Close panel" title="Close" onClick={() => setPanelOpen(false)}>×</button>
        {lessonOpen&&localClassroomPresentation&&<ClassroomPresentation worldId={localClassroomPresentation.worldId} screenEntityId={localClassroomPresentation.screenEntityId} index={lessonIndex} onSelect={setLessonIndex}/>}
        {pairCode&&<button onClick={()=>{setAdvanced(false);setTab('my soul');revealPanel();}}>Finish assistant approval</button>}
        <SoulFocus key={`${selected}:${sim.me?.userId ?? 'public'}`} sim={sim} api={api} auth={auth} selected={selected} select={inspect} camera={selected&&viewerHandle?{following:viewerState?.cameraMode==='follow'&&viewerState.selection.soulId===selected,follow:()=>{requestFollowSoul(selected);},stop:()=>{viewerHandle.setManualNavigation?.('orbit');viewerHandle.setCameraMode('manual');}}:undefined} manage={openAccount} active={!advanced&&panelOpen&&tab!=='my soul'} />
      </aside>
      <aside id="account-panel" className="human-panel account-panel" hidden={advanced||tab!=='my soul'||!panelOpen} aria-label="Soul and account tools">
        <button onClick={() => setTab('watch')}>← Back to the world</button><div className="grid"><SoulAccount sim={sim} auth={auth} api={api} select={id=>{inspect(id);setTab('watch');}} pairCode={pairCode} clearPair={()=>setPairCode(null)}/></div>
      </aside>
      {advanced && <div className="advanced-surface">
      <nav aria-label="Advanced tools">{TABS.filter((t) => isAdmin || !ADMIN_TABS.has(t)).map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => { setPairCode(null); setTab(t); }}>{t}</button>)}{singleLocalPreview(location.hostname)?<span className="dim">World Lab · not connected locally</span>:<a href={`/l/${worldKey}`}>World Lab</a>}</nav>
      <main>
        <Suspense fallback={null}><div className="grid">
          {tab === 'watch' && <Intro authed={auth.authed} login={auth.login} go={openAccount} souls={r.souls.size} />}
          {show('watch', 'world') && <WorldPanel sim={sim} mine={mine} selected={selected} onSelect={inspect} />}
          {show('watch', 'world', 'story') && <BroadcastPanel sim={sim} />}
          {tab === 'watch' && <HeardPanel sim={sim} />}
          {tab === 'watch' && <Happenings sim={sim} />}
          {show('grammar') && <SentencesPanel sim={sim} />}
          {show('grammar') && <VocabularyPanel sim={sim} />}
          {show('grammar') && <BacklogPanel sim={sim} />}
          {show('grammar') && <ThingsPanel sim={sim} />}
          {show('grammar') && <LibraryPanel sim={sim} />}
          {show('notebook') && <NotebookPanel sim={sim} />}
          {show('my soul') && <>{arrivalEnabled&&<section><h2>Soul arrivals</h2><p>Use the human view to request or check an arrival.</p><button onClick={openAccount}>Open Soul arrivals</button></section>}<SoulHome worldId={cfg.worldId} sim={sim} auth={auth} api={api} selected={selected} onSelect={setSelected} pairCode={pairCode} clearPair={() => setPairCode(null)} base={cfg.publicUrl} allowCreate={!arrivalEnabled} /></>}
          {show('spend') && isAdmin && <SpendPanel key={privatePanelKey} api={api} authed={auth.authed} isAdmin />}
          {show('brain') && <BrainPanel key={privatePanelKey} sim={sim} authed={auth.authed} selected={selected} api={api} isAdmin={isAdmin} />}
          {show('story') && <NarrativePanel sim={sim} />}
          {show('debug') && <DebugPanel key={privatePanelKey} api={api}/>}
          {show('sync') && <SyncPanel sim={sim} />}
          {show('world', 'sync') && <LogPanel log={sim.log} sim={sim} />}
          {show('admin') && isAdmin && <AdminPanel key={privatePanelKey} sim={sim} api={api} />}
          {tab === 'architecture' && <ArchPanel sim={sim} cfg={cfg} />}
        </div></Suspense>
      </main>
      </div>}
    </div>
  );
}

// ------------------------------------------------------------------ arrival
function Intro({ authed, login, go, souls }: { authed: boolean; login(): void; go(): void; souls: number }) {
  return (
    <section className="wide">
      <h2>You are watching Sim, live</h2>
      <p style={{ maxWidth: 820 }}>This world keeps living when you close the page. {souls} <b>Souls</b> live in it right now. Each has a name, a personality and a mind of its own; some belong to people, who give them direction now and then. Everyone who opens this page sees the same world at the same moment.</p>
      <div className="row">{authed ? <button className="primary" onClick={go}>go to my Soul</button> : <button className="primary" onClick={login}>sign in to meet your Soul</button>}<span className="dim">Watching is free and needs no account.</span></div>
    </section>
  );
}
function Happenings({ sim }: { sim: Sim }) {
  const rows = sim.log.filter((e) => e.kind !== 'rules' && e.kind !== 'admin' && e.kind !== 'decision' && e.kind !== 'deck').slice(-14).reverse();
  return (
    <section>
      <h2>Just now</h2>
      {rows.map((e) => <div key={e.seq}>{eventPlain(e, sim)}</div>)}
      {rows.length === 0 && <span className="dim">quiet</span>}
    </section>
  );
}
function eventPlain(e: LogEvent, sim: Sim): string {
  const p = e.payload ?? {}; const name = (id: string) => sim.conn.replica.souls.get(id)?.name ?? 'someone';
  if (e.kind === 'birth') return `${p.name} arrived.`;
  if (e.kind === 'play') return `${name(p.soulId)} ${p.card}${p.target ? ` → ${sim.kernel?.things[p.target]?.name ?? 'something'}` : ''}.`;
  if (e.kind === 'mint') return `A new card was made: “${p.card?.name}”.`;
  if (e.kind === 'deck') return `${name(p.soulId)}’s deck changed.`;
  if (e.kind === 'decision') return `${name(p.soulId)} decided to ${String(p.label).charAt(0).toLowerCase()}${String(p.label).slice(1)}.`;
  if (e.kind === 'intent') return `${name(p.soulId)} was given new direction by their owner.`;
  if (e.kind === 'scene') return `Storyteller, ${p.region}: ${p.beat.flavor}.`;
  if (e.kind === 'retire') return 'A Soul left the world.';
  return e.kind;
}

// ------------------------------------------------------------------ world
const COLS = 64, ROWS = 28;
function WorldPanel({ sim, mine, selected, onSelect }: { sim: Sim; mine: Set<string>; selected: string | null; onSelect(id: string | null): void }) {
  const r = sim.conn.replica, tick = sim.conn.displayTick();
  const souls = [...r.souls.values()].sort((a, b) => a.name.localeCompare(b.name));
  // fit the map to whatever this world contains (the toy plane is 100 m; a Mars scene is wherever its fixtures and people are)
  const pts = Object.values(r.entities).map((e) => [e.pose.p[0], e.pose.p[2]] as const);
  const toy = !!r.entities['gate'];
  const x0 = toy ? -50 : Math.min(...pts.map((p) => p[0]), 0) - 4, x1 = toy ? 50 : Math.max(...pts.map((p) => p[0]), 1) + 4, z0 = toy ? -50 : Math.min(...pts.map((p) => p[1]), 0) - 4, z1 = toy ? 50 : Math.max(...pts.map((p) => p[1]), 1) + 4;
  const cell = (x: number, z: number) => [Math.max(0, Math.min(COLS - 1, Math.round(((x - x0) / (x1 - x0)) * (COLS - 1)))), Math.max(0, Math.min(ROWS - 1, Math.round(((z - z0) / (z1 - z0)) * (ROWS - 1))))] as const;
  const grid: { ch: string; cls: string }[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ ch: '·', cls: 'dim' })));
  const glyph: Record<string, string> = { campfire: '*', bench: '=', 'bench-6ft': '=', 'camp-chair': 'h', 'table-6ft': 'T', kiosk: 'K', gate: 'G' };
  for (const e of Object.values(r.entities)) if (e.kind === 'fixture') { const [c, w] = cell(e.pose.p[0], e.pose.p[2]); grid[w][c] = { ch: glyph[e.def] ?? '?', cls: 'warn' }; }
  const pos = new Map<string, [number, number]>();
  for (const s of souls) {
    if (!r.entities[s.entityId]) continue;
    const p = r.poseAt(s.entityId, tick); const x = p[1] / 1000, z = p[3] / 1000; pos.set(s.id, [x, z]);
    const [c, w] = cell(x, z); grid[w][c] = { ch: s.name[0].toUpperCase(), cls: s.id === selected ? 'sel acc' : mine.has(s.id) ? 'acc' : '' };
  }
  const whereOf = (soulId: string) => { const k = sim.kernel; const at = k?.things[soulId]?.at; return at ? (k!.things[at]?.name ?? at) : ''; };
  return (
    <section className="wide">
      <h2>World — canonical state as this client sees it (positions computed locally from path decisions)</h2>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <pre className="map">{grid.map((row, i) => <div key={i}>{row.map((c, j) => <span key={j} className={c.cls}>{c.ch}</span>)}</div>)}</pre>
        <div className="scrollx" style={{ flex: 1, minWidth: 620 }}>
          <table>
            <thead><tr><th>soul</th><th>owner</th><th>activity</th><th>x, z</th><th>at</th><th>mood</th><th>energy</th><th>doing</th><th>intent</th></tr></thead>
            <tbody>
              {souls.map((s) => { const e = r.entities[s.entityId], p = pos.get(s.id); return (
                <tr key={s.id} className={`click ${s.id === selected ? 'sel' : ''}`} onClick={() => onSelect(s.id === selected ? null : s.id)} title={s.description}>
                  <td className={mine.has(s.id) ? 'acc' : ''}><b>{s.name}</b></td><td className="dim">{s.native ? 'world' : s.owner}</td>
                  <td>{e?.human?.activity ?? '—'}{e?.human?.on ? <span className="dim"> @{e.human.on}</span> : null}</td>
                  <td>{p ? `${p[0].toFixed(1)}, ${p[1].toFixed(1)}` : '—'}</td><td className="dim">{whereOf(s.id)}</td>
                  <td>{s.mood}</td><td>{s.energy}</td><td className="wrap">{s.doing}</td><td className="wrap dim">{s.intentText}</td>
                </tr>); })}
            </tbody>
          </table>
          <p className="dim">* campfire &nbsp; = bench &nbsp; K kiosk &nbsp; G gate &nbsp;·&nbsp; letters are souls (yours highlighted). Click a row to select a soul; the brain panel then filters to it.</p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ sync
function SyncPanel({ sim }: { sim: Sim }) {
  const c = sim.conn, st = c.stats, s = sim.stats, hb = c.heartbeat, r = c.replica;
  return (
    <section>
      <h2>Sync — this client vs the server</h2>
      <div className="kv">
        <span>socket</span><span className={st.state === 'open' ? 'ok' : 'bad'}>{st.state} · rtt {st.rttMs} ms · reconnects {st.reconnects}</span>
        <span>replica</span><span>batch seq {r.seq} · data through tick {r.tick} · display tick {c.displayTick().toFixed(0)}</span>
        <span>heartbeat</span><span>{hb ? `tick ${hb.tick} · seq ${hb.seq} · ${st.heartbeats} received` : '—'}</span>
        <span>server view hash</span><span>{st.lastHash || '—'}</span>
        <span>my view hash</span><span className={st.lastCheck === 'ok' ? 'ok' : st.lastCheck === 'mismatch' ? 'bad' : 'dim'}>{st.myHash || '—'} ({st.lastCheck})</span>
        <span>snapshots / resyncs</span><span>{st.snapshots} / {st.resyncs}</span>
        <span>inbound</span><span>{(sim.bytesPerSec / 1024).toFixed(2)} KB/s · {st.msgsIn} messages · {(st.bytesIn / 1024).toFixed(0)} KB total</span>
        <span>keyframes</span><span>{hb ? Object.keys(hb.keyframes).length : 0} authoritative poses in the last heartbeat{hb ? `, max drift ${maxDrift(sim)} mm` : ''}</span>
        <span>clock</span><span>rate ×{hb?.clockRate ?? c.welcome?.clockRate ?? 1}{hb?.paused ? ' · PAUSED' : ''} · dt {c.welcome?.dt}s · rules {c.welcome?.rulesVersion}</span>
      </div>
      {s && <>
        <h2 style={{ marginTop: 12 }}>Server</h2>
        <div className="kv">
          <span>tick</span><span>{s.tick} · step {s.tickMsAvg.toFixed(3)} ms avg, {s.tickMsMax.toFixed(2)} ms max (budget 50 ms)</span>
          <span>world</span><span>{s.entities} entities · {s.souls} souls · {s.liveActions} live actions</span>
          <span>clients</span><span>{s.clients}</span>
          <span>log</span><span>{s.seq} events · last snapshot at tick {s.lastSnapshotTick} ({Math.round((s.tick - s.lastSnapshotTick) / 20)} s ago) · capture {s.snapshotMs.capture.toFixed(1)} ms in-tick, write {s.snapshotMs.persist.toFixed(1)} ms deferred</span>
          <span>build</span><span>{s.build}</span>
          <span>database</span><span>{(s.dbBytes / 1024).toFixed(0)} KB</span>
          <span>uptime</span><span>{fmtDur(s.uptimeSec)}</span>
        </div>
      </>}
      <div className="row"><button onClick={() => c.resync('manual')}>force resync</button><button onClick={() => c.dropForTest()}>drop socket (test reconnect)</button></div>
    </section>
  );
}
function maxDrift(sim: Sim): number {
  const hb = sim.conn.heartbeat, r = sim.conn.replica; if (!hb) return 0;
  let m = 0;
  for (const [id, k] of Object.entries(hb.keyframes)) { if (!r.entities[id]) continue; const p = r.poseAt(id, k[0]); m = Math.max(m, Math.abs(p[1] - k[1]), Math.abs(p[3] - k[3])); }
  return m;
}
export const fmtDur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

// ------------------------------------------------------------------ log
export function eventText(e: LogEvent, sim: Sim): string {
  const p = e.payload ?? {}; const r = sim.conn.replica;
  const name = (soulId: string) => r.souls.get(soulId)?.name ?? soulId;
  const label = (id: string) => r.entities[id]?.label ?? r.regions[id]?.label ?? id;
  switch (e.kind) {
    case 'birth': return `${p.name} is born — "${p.description}"`;
    case 'intent': return `${name(p.soulId)} ← intent via ${p.source}: ${describeIntent(p.intent, label)}`; // the owner's note is never in the public log
    case 'decision': return `${name(p.soulId)} → ${p.label} [${p.option}] (${p.trigger}${p.fallback ? ', fallback' : ''}; mood ${p.mood}; rethink in ${Math.round(p.reevalTicks / 20)} s)`;
    case 'scene': return `narrator/${p.region}: ${p.beat.kind} ${p.beat.directive} ${p.beat.targets.join(', ')} — ${p.beat.flavor}`;
    case 'retire': return `${p.soulId} retired`;
    default: return JSON.stringify(p);
  }
}
function LogPanel({ log, sim }: { log: LogEvent[]; sim: Sim }) {
  const [kind, setKind] = useState('all');
  const rows = log.filter((e) => kind === 'all' || e.kind === kind).slice(-80).reverse();
  return (
    <section className="wide">
      <h2>Event log — the canonical record (append-only; the world is the fold of this)</h2>
      <div className="row">{['all', 'birth', 'intent', 'decision', 'scene', 'rules', 'admin', 'retire'].map((k) => <button key={k} className={k === kind ? 'primary' : ''} onClick={() => setKind(k)}>{k}</button>)}
        <a href={apiPath('/v1/log?limit=1000')} target="_blank" rel="noreferrer">raw json</a></div>
      <div className="scroll"><table><tbody>
        {rows.map((e) => <tr key={e.seq}><td className="dim">#{e.seq}</td><td className="dim">t{e.tick}</td><td><span className={`tag ${e.kind === 'decision' ? 'mid' : e.kind === 'scene' ? 'narrator' : e.kind === 'intent' ? 'translate' : ''}`}>{e.kind}</span></td><td className="dim">{e.author}</td><td className="wrap">{eventText(e, sim)}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}
