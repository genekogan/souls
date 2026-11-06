import {WorldMotionHistory} from './WorldMotionHistory.ts';
import { setPosterDay } from '../../../mars/viewer/app/engine-view/poster-sheet.ts';
import {WorldContextViews} from './WorldContextViews.ts';
import { whenAssetsSettled } from './gen-mesh/gltf-assets.ts';
import {ALL_OPTIONAL_APPEARANCE_PROFILES,type OptionalAppearanceProfiles} from './optional-appearance-profiles-all.ts';
import {historyTakePath,historyTakePage} from './WorldTakeTransport.ts';
import {WorldAuthoredBoundaries} from './WorldAuthoredBoundaries.ts';
import {WorldTouchFree} from './touch/WorldTouchFree.ts';
import {SoulSwipe,swipeStep,soulRing,interestScores} from './touch/soul-swipe.ts';
import {hapticTick} from './touch/haptics.ts';
import {exploreRoom} from './explore-data.ts';
import {RendererDiagnostics} from './RendererDiagnostics.ts';
import {EngineFixtureInstances} from './EngineFixtureInstances.ts';
import {StaticBatchOwner} from './rendering/StaticBatchOwner.ts';
import {glowSourceMaterial,mergedGlowMaterial} from './gen-mesh/motion.ts';
import {mergedRealismAttributes,mergedRealismMaterial} from './WorldEdenRealism.ts';
import {AssetDownloads,trackAssetDownloads,type AssetDownloadProgress} from './AssetDownloads.ts';
import {PLACE_SHOT_MINUTES,WorldPlacePreviews} from './WorldPlacePreviews.ts';
import {constrainOfficeGuardCamera,officeGuardsFromPublication} from './WorldOfficeGuards.ts';
import {recordedBody,admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {WorldBodyModels} from './WorldBodyModels.ts';
import {conversationFrame} from './WorldConversationFrame.ts';
import {WorldEyes} from './WorldEyes.ts';
import {WorldHover,type HoverTarget} from './WorldHover.ts';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {WorldSoulAvatars} from './SoulAvatars.ts';
import {edenExpansionCapture} from './WorldEdenActivation.ts';
import {worldPlaceView,CURATED_WORLD_LOCATIONS,type WorldPlaceId} from './WorldPlaces.ts';
import type {createWorldEdenExpansion} from './WorldEdenExpansion.ts';
import type {LocalClassroomPresentation} from './WorldClassroomPresentation.ts';
import {WorldFollow} from './WorldFollow.ts';
import {worldCameraRenderRoots} from './WorldCameraRenderRoots.ts';
import {SoulFlight} from './WorldSoulFlight.ts';import {WorldRtsCamera,EDEN_TERRAIN_EXTENT,forwardWheel} from './WorldRtsCamera.ts';import {FramePacer} from './frame-pacing.ts';
import {createWorldAtmosphere} from './WorldAtmosphere.ts';
import {SpectatorSpeechLayer,speechFromTalk,speechFromEdge,channelChip,type SpectatorSpeech,type EdgeSpectatorMessage} from './WorldSpectatorSpeech.ts';
import {WorldFadingLayer,parseFadeOverride,fadingFromEdge,beamedOut,type FadingState} from './WorldFading.ts';
import {renderEyes,renderOverhead,renderMap} from './WorldSnapshots.ts';
import {conversationAttention,WorldIdleLife,type IdleSoul} from './WorldIdleLife.ts';
import {WorldBodyPoses,bodyLabel} from './WorldBodyState.ts';
import {WorldBalloonRide,parseRideOverride,previewState} from './WorldBalloonRide.ts';
import {WorldRideCars} from './WorldRideCars.ts';
import {recordedCarriers,carrierPoses} from './ride-carriers.ts';
import {WorldShadowDetail} from './WorldShadowDetail.ts';
import {WorldPlaceActivity} from './WorldPlaceActivity.ts';
import {installLookToneCurve,installMaterialDetail,setMaterialDetail,lookSettings,lookExposure,WorldPost} from './rendering/WorldLook.ts';
import {installNightLighting,setNightLightStrength,nightLightStrength} from './WorldNightLights.ts';
import type {createEdenHouseWindows} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-house-windows.ts';
// P1 phones: the old Eden expansion is its own chunk (old-eden.ts), fetched only by a world that shows it
let oldEden:typeof import('./old-eden.ts')|null=null,oldEdenLoad:Promise<typeof import('./old-eden.ts')>|null=null;
const loadOldEden=()=>oldEdenLoad??=import('./old-eden.ts').then(m=>{setTimeout(()=>{try{m.prebuildEdenLandscape();}catch{}},0);return oldEden=m;},e=>{oldEdenLoad=null;throw e;});
// Patch shared lit-shader chunks before any program compiles (strength stays 0 outside Eden).
installNightLighting();
installLookToneCurve();installMaterialDetail();  // look pass (rendering/WorldLook.ts): tone curve + material detail chunks, before any program compiles
import {arrivalMark,arrivalOver,whenArrivalCardGone,whenMarked} from './arrival-marks.ts';import {earlyArrival,earlyArrivalWanted} from './early-arrival.ts';import {connectionLost} from './viewer-arrival.ts';import {activityWords,doingText} from './place-names.ts';
import {worldDepictionBeat,type WorldBeatSampler} from './WorldDepiction.ts';
import {RecordedGaitContinuity} from '../../../mars/viewer/app/engine-view/recorded-gait-continuity.ts';
import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import type { loadTemplates } from '../../../mars/viewer/app/engine-view/people.ts';
import {PEOPLE,templateNameFor} from '../../../mars/viewer/app/engine-view/people-light.ts';
import {WorldLightPeople} from './WorldLightPeople.ts';
import {WorldBodyStandIns} from './WorldBodyStandIns.ts';
// P1 phones: the people renderer is a lazy chunk (people-kit.ts). Old worlds and desktops fetch it at once and wait for it
// before their first frame; a phone's new world draws its first frames with WorldLightPeople and fetches it after arrival.
/** F12: whether this page's arrival card has gone (speech anchors wait for it). */
let arrivalCardDone=false;void whenMarked('card-done').then(()=>{arrivalCardDone=true;});
let peopleKit:typeof import('./people-kit.ts')|null=null,peopleKitLoad:Promise<typeof import('./people-kit.ts')>|null=null;
const loadPeopleKit=()=>peopleKitLoad??=import('./people-kit.ts').then(m=>peopleKit=m,e=>{peopleKitLoad=null;throw e;});
if(!newWorld)void loadPeopleKit().catch(()=>{});
import {depictedWorldLocations,type WorldLocation} from './WorldLocations.ts';
import {InitialWorldReadiness,successfulInitialLookup,type InitialWorldProgress} from './InitialWorldReadiness.ts';
import { FloaterView, KinScenery } from '../../../mars/viewer/app/engine-view/floaters.ts';
import { floaterBody } from '../../../mars/viewer/engine/bodies/body.ts';
import { ThreeResources } from '../../../mars/viewer/lib/three-resources.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { PlayView, PublicSoul } from '@sim/protocol';
import type { Sim } from './useSim.ts';
import { decodeSceneCapturePublication } from '@sim/protocol/scene-capture';
import { WorldSceneHistory } from './WorldSceneHistory.ts';
import { apiPath, worldKey } from './world-path.ts';
import { BASE } from './base-path.ts';
import { newWorld } from './world-kind.ts';
import { sceneOwner, type SceneOwnerMemory } from './scene-owner.ts';
import { marsFork } from './mars-fork.ts';
import type { ForkLand } from './WorldMarsForkLand.ts';
import { WorldEntityLayer } from './WorldEntityLayer.ts';
import { earlyPosterShown, removeEarlyPoster, takeEarlyLayer, takeEarlyRender } from './early-layer.ts';
import { WorldWaterDetail, markHeight } from './WorldWaterDetail.ts';
import { findSeats, surveySeats } from './WorldSeatSurvey.ts';
import { visitorPreviewHour } from './visitor-hour.ts';
import { SunShadowCache } from './rendering/SunShadowCache.ts';
import { GodWorldLiving, calendarClock, entityWorldState, godTourViews, parseShotHour, shotClockAt, whenShotClock } from './world-env.ts';
import { setFleeSources, AFLOAT } from './gen-mesh/motion.ts';
import { WorldLightning } from './WorldLightning.ts';
import { worldArrivalPose } from './arrival-shot.ts';
import { anyPersonInView } from './people-in-view.ts';
import { setAssetLoader } from './gen-mesh/gltf-assets.ts';import { worldResolution } from './adaptive-resolution.ts';import { browserQuality } from './quality-tier.ts';import { WorldDistanceDetail } from './WorldDistanceDetail.ts';import { WorldMeshLod, PHONE_MESH_LOD, DESKTOP_MESH_LOD, workerSimplifier, type Simplifier } from './WorldMeshLod.ts';import { WorldFarStandIns, PHONE_STAND_INS, rendererSnapshotter } from './WorldFarStandIns.ts';import { captureTexturePreparation, fitTextures, compileSceneAsync, setTextureRenderer, warmReadyProgramMetadata } from './gen-mesh/texture-budget.ts';
// P1 phones: the god panel and the constitution card are lazy chunks, mounted once the arrival card has gone (20 s cap), or
// at once when the landing URL carries something for the panel (#join, #approve/…, an offer or pairing link, a preview)
const GodPanel=lazy(()=>import('./GodPanel.tsx').then(m=>({default:m.GodPanel})));
const godUiAtOnce=typeof location!=='undefined'&&(!['','#','#watch'].includes(location.hash)||new URLSearchParams(location.search).has('preview'));
import { ensureToken as ensureGodToken } from './god-ui/god-api.ts';
import { WorldPreviewGhost } from './WorldPreviewGhost.ts';
import {WorldEdgeItems} from './WorldEdgeItems.ts';
import { WorldNavigation, createWorldOrbitControls, type ManualNavigation, type CameraMove } from './WorldNavigation.ts';
import {WorldPlaceCamera} from './WorldPlaceCamera.ts';
import { composeVisibleViewport, visibleViewport, type ViewportInsets } from './WorldViewport.ts';
import { nameTag, placeWorldLabels, plateAnchor, type LabelBox, type LabelOffset } from './WorldLabels.ts';
import {projectSpeechAnchors,type SpeechAnchorPoint} from './WorldSpeechAnchors.ts';
import {paintSpeakingDot,speakingNow} from './dialogue-speaking.ts';
import {WorldGames} from './WorldGames.ts';
import {parsePlatformFloors,platformFloorOffset,type PlatformFloor} from '../../../mars/viewer/lib/platform-floor.ts';
import {WorldPlatforms} from './WorldPlatforms.ts';
import {cameraGround,cameraGroundSampler,clearShotEye} from './WorldCameraGround.ts';
import {WorldRenderedVisibility} from './WorldRenderedVisibility.ts';
import {WorldFollowMotion} from './WorldFollowMotion.ts';
import { godFeature } from './god-ui/features.ts';
import { WorldBroadcast, type WorldCameraMode, type CarrierPose } from './WorldBroadcast.ts';
// P1 phones: old worlds' captured-scene content is a lazy chunk (old-scene-kit.ts); an old world's page fetches it at once
type OldSceneKit=typeof import('./old-scene-kit.ts');
let oldKit:OldSceneKit|null=null,oldKitLoad:Promise<OldSceneKit>|null=null;
const NO_OLD_PROFILES:OptionalAppearanceProfiles=Object.freeze({understory:false,nativeSocial:false});
const loadOldKit=()=>oldKitLoad??=import('./old-scene-kit.ts').then(m=>oldKit=m,e=>{oldKitLoad=null;throw e;});
if(!newWorld)void loadOldKit().catch(()=>{});
import { cameraModeAfterGesture, createWorldViewerHandle, viewerPresentation, type WorldViewerHandle, type WorldViewerState } from './WorldViewer.ts';
import {
  agoText, chunkAt, clockText, Daylight, mergeWindow, MAX_PAST_CHUNKS, parseSceneInfo, placeOf, plainWords, rewindWindow, recordingTick, shiftIso, validChunks, WorldGeometry,
  type Chunk, type LiveTakes,
} from './WorldGeometry.ts';

// The shared live view: the world's recorded motion, streamed over the socket as short chunks and
// replayed a moment behind the server, over the camp's real ground, walls and doors. No engine runs here.

/** useSim's `takes` (the socket stream of recorded chunks); read loosely until every world sends it. */
const takesOf = (sim: Sim) => (sim as Sim & { takes?: LiveTakes | null }).takes ?? null;
const dtOf = (sim: Sim) => sim.conn.welcome?.dt ?? 0.05;
/** Server ticks per real second right now (0 while the world is paused). */
const tpsOf = (sim: Sim) => (sim.conn.heartbeat?.paused ? 0 : (sim.conn.heartbeat?.clockRate ?? sim.conn.welcome?.clockRate ?? 1)) / dtOf(sim);
/** Best estimate of the server's tick now, from the last chunk message. */
function serverNow(sim: Sim): number | null {
  const t = takesOf(sim);
  if (!t || typeof t.serverTick !== 'number') return null;
  return t.serverTick + Math.min(2, Math.max(0, (performance.now() - t.receivedAt) / 1000)) * tpsOf(sim);
}
/** Live playback sits this many ticks behind the server, so the next chunk has arrived before it is needed. */
const LIVE_DELAY = 30;
const HOUR_SECONDS = 3600;

type Past = { tick: number; playing: boolean; chunks: Chunk[]; extending: boolean; retryAt: number; ended: boolean };
/** What is on screen, for the panels (written by the frame loop, read on React renders). */
type Shown = { tick: number; datetime: string | null; take: Take | null; entities: Record<string, SampledEntity> };
type Label = { obj: CSS2DObject; head: THREE.Vector3; name: HTMLElement; line: HTMLElement; card: HTMLElement; offset: LabelOffset; text: string };  // obj sits under the body (C2); head is where speech anchors

async function fetchChunks(from: number, to: number, limit: number, signal: AbortSignal): Promise<Chunk[]> {
  let out: Chunk[] = [], cursor = from;
  for (let page = 0; page < 4 && out.length < limit; page++) {
    const res = await fetch(apiPath(historyTakePath(cursor,to,limit-out.length)), { signal });
    if (!res.ok) throw Error(`the server answered ${res.status}`);
    const body = historyTakePage(await res.json());
    out = validChunks([...out, ...body.chunks]).slice(0, limit);
    const next = typeof body.next === 'number' ? body.next : null;
    if (next === null || next <= cursor || (out.at(-1)?.toTick ?? -Infinity) >= to) break;
    cursor = next;
  }
  return out;
}

/** The latest card each Soul played at or before `tick`. */
function cardsAt(plays: readonly PlayView[], tick: number): Map<string, PlayView> {
  const out = new Map<string, PlayView>();
  for (const p of plays) if (p.ok && p.tick <= tick && (out.get(p.soulId)?.tick ?? -1) <= p.tick) out.set(p.soulId, p);
  return out;
}
const cardText = (p: PlayView | undefined) => (p ? `“${p.card}”${p.targetName ? ` → ${p.targetName}` : ''}` : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** lookrace: the camera a `god look` pinned on this ?shot=1 page (eye already lifted clear of the ground). */
type ShotPin = { eye: number[]; at: number[]; lifted: number; closer: number; raised: number };
const shotPin = (): ShotPin | null => { const p = (window as unknown as { __shotCamera?: ShotPin }).__shotCamera; return p && p.eye?.length === 3 && p.at?.length === 3 && [...p.eye, ...p.at].every(Number.isFinite) ? p : null; };

export function LiveWorld({ sim, selected, onSelect, onChipNote, onViewerHandle, onViewerState, onInitialProgress, hideControls = false, embedded = false, hideSoulInfo = false, publishSpeechAnchors = false, humanPresets = false, viewportInsets, depictionBeatAt, edenExpansion = false, edenExpected = false, localClassroomPresentation, bootWorldId }: {
  sim: Sim; selected: string | null;
  /** #892: 'chip' when a touch followed this Soul: the App shows its bottom chip, not the full card. */
  onSelect(id: string | null, how?: 'chip'): void;
  /** #892: a short word for the follow chip (a swipe with no other Soul here). */
  onChipNote?(note: string): void;
  onViewerHandle?(handle: WorldViewerHandle | null): void;
  onViewerState?(state: WorldViewerState): void;
  /** App shows the initial-assets progress in its own arrival card; this overlay then keeps only its backdrop and a failure's Retry. */
  onInitialProgress?(progress: InitialWorldProgress): void;
  hideControls?: boolean;
  /** App sizes the stable world-viewer/world-viewport elements. */
  embedded?: boolean;
  /** Hide only the duplicate Soul card, retaining object inspection and notes. */
  hideSoulInfo?: boolean;
  /** App requests public speech anchors; default off avoids extra visibility queries. */
  publishSpeechAnchors?: boolean;
  /** Optional verified palettes; preserves each existing model and Soul key. */
  humanPresets?:boolean;
  viewportInsets?: ViewportInsets;
  /** Opt-in Core-derived phase at this exact body take/tick; App owns live/history sourcing. */
  depictionBeatAt?: WorldBeatSampler;
  /** Optional current-world composition; new scenery has no native authority. */
  edenExpansion?:boolean;
  /** The configured world will show the old Eden town once its welcome confirms it: fetch that chunk now. */
  edenExpected?:boolean;
  localClassroomPresentation?:LocalClassroomPresentation;
  /** Lane W1: a new world's page world id; the scene then starts before the socket's welcome (scene-owner.ts). */
  bootWorldId?:string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const ownerMemory = useRef<SceneOwnerMemory>({}), owner = sceneOwner(sim.conn.welcome, bootWorldId, ownerMemory.current);
  const [cameraMode, setCameraMode] = useState<WorldCameraMode>('broadcast');
  const [manualNavigation,setManualNavigation] = useState<ManualNavigation>('orbit');
  const follow = cameraMode === 'follow';
  const [thing, setThing] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'past'>('live');
  const [, refreshPlayback] = useState(0);
  const [draft, setDraft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const earlyShown=useSyncExternalStore(earlyArrival.subscribe,earlyArrival.revealed,earlyArrival.revealed);
  const [initialProgress,setInitialProgress]=useState<InitialWorldProgress>({generation:0,stage:'waiting',required:0,completed:0,failed:[],bytesLoaded:0,bytesTotal:null});
  const retryInitial=useRef<(()=>void)|null>(null);
  useEffect(()=>{onInitialProgress?.(initialProgress);},[initialProgress,onInitialProgress]);
  const progressInCard=!!onInitialProgress&&initialProgress.stage!=='failed';
  const [assetProgress,setAssetProgress]=useState<AssetDownloadProgress>({loaded:0,total:0,failed:0,pending:0});
  const [placeCard,setPlaceCard]=useState<HoverTarget|null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [graphicsUnavailable, setGraphicsUnavailable] = useState<string | null>(null);
  const [sceneryNotice,setSceneryNotice]=useState<string|null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [flagMode, setFlagMode] = useState(false); const flagModeRef = useRef(false); flagModeRef.current = flagMode;
  const [entityWorld, setEntityWorld] = useState(false);
  const [godUi, setGodUi] = useState(godUiAtOnce);
  useEffect(() => { if (godUi) return; const abort = new AbortController(); void whenArrivalCardGone({ timeoutMs: 20_000, fadeMs: 0, signal: abort.signal }).then(() => { if (!abort.signal.aborted) setGodUi(true); }); return () => abort.abort(); }, [godUi]);
  // lane L3h: GodPanel reads its flags from this page's entity layer (no second snapshot download per edit)
  const entityLayerRef = useRef<WorldEntityLayer | null>(null);
  const entitiesAt = useCallback((seq: number) => entityLayerRef.current?.entitiesAt(seq) ?? null, []);
  /** Entity worlds: the person's camera across scene re-mounts of this page (framed once, on first arrival). */
  const entityView = useRef<{eye:[number,number,number];target:[number,number,number];pending?:boolean;broadcast?:boolean}|null>(null);
  const context = useRef({ placeCard, sim, selected, onSelect, onChipNote, follow, cameraMode, setCameraMode, thing, setThing, onViewerState, loading, graphicsUnavailable, viewportInsets, manualNavigation, setManualNavigation, depictionBeatAt, publishSpeechAnchors, edenExpansion, localClassroomPresentation });
  context.current = { placeCard, sim, selected, onSelect, onChipNote, follow, cameraMode, setCameraMode, thing, setThing, onViewerState, loading, graphicsUnavailable, viewportInsets, manualNavigation, setManualNavigation, depictionBeatAt, publishSpeechAnchors, edenExpansion, localClassroomPresentation };
  const past = useRef<Past | null>(null);
  const shown = useRef<Shown>({ tick: 0, datetime: null, take: null, entities: {} });
  const drawnTick = useRef<number | null>(null);
  const stateSignature = useRef('');
  const latestViewerState=useRef<WorldViewerState|null>(null);
  const emitState = (state: WorldViewerState) => {
    latestViewerState.current=state;
    const signature = JSON.stringify(state);
    if (signature === stateSignature.current || !context.current.onViewerState) return;
    stateSignature.current = signature; context.current.onViewerState(state);
  };
  const seeking = useRef<AbortController | null>(null);
  const controlsApi = useRef<{ feedbackContext(): import('./WorldViewer.ts').WorldViewContext; overview(): void; frameSouls(ids:readonly string[]):boolean; framePoint(point:THREE.Vector3,radius:number):void; locations():readonly WorldLocation[];refreshLocations():void;locationPage():import('./WorldLocations.ts').WorldLocationPage|null;searchLocations(query:string):void;moreLocations():void;cancelLocationPictures():void;frameLocation(id:string):boolean;locationPreview(id:string):Promise<string|null>;framePlace(place:WorldPlaceId): boolean; placePreview(place:WorldPlaceId):Promise<string|null>; focusSelected(): boolean; reset(): boolean; releaseInput(): void; flyToSoul(soulId:string,opts?:{chip?:boolean}):boolean; move(delta: CameraMove): boolean; inputOwned(): boolean } | null>(null);
  const playbackCommands = useRef<{ seek(tick: number): Promise<void>; live(): void; setPlaying(playing: boolean): boolean } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a Soul picked elsewhere (the table, my Soul) replaces a picked thing
  useEffect(() => { if (selected) setThing(null); }, [selected]);
  useEffect(() => { if (edenExpected) void loadOldEden().catch(() => {}); }, [edenExpected]);

  useEffect(() => {
    // The first welcome supplies the world/epoch that owns this scene; a new world's page starts it from its own world
    // id and adopts that welcome (scene-owner.ts), so the welcome does not tear it down and download its people twice.
    if (!mount.current || !owner) return;
    const ownerKey=[owner.worldId,owner.epoch];
    // Recorded ticks and scene assets belong to one world/epoch. A restarted
    // connection must not keep a paused take or let its pending seek refill it.
    seeking.current?.abort(); seeking.current = null;
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    past.current = null;
    shown.current = { tick: 0, datetime: null, take: null, entities: {} };
    drawnTick.current = null;
    latestViewerState.current = null; stateSignature.current = '';
    setMode('live'); setDraft(null); setNote(null); setLoading(false);
    setThing(null); setProblems([]); setGraphicsUnavailable(null);setSceneryNotice(null);
    const host = mount.current, abort = new AbortController(), resources = new ThreeResources();
    const problem = (text: string) => setProblems((p) => (p.includes(text) ? p : [...p, text]));
    let navigation: WorldNavigation | null=null;
    let renderer: THREE.WebGLRenderer;
    // P7d: a phone's new world may have been drawn by the page's first phase (early-render.ts): adopt its renderer, scene,
    // camera, daylight and atmosphere (no second GL context; its programs are linked); its poster stays until this draws
    const adopted=newWorld?takeEarlyRender():null;
    try { renderer = adopted ? adopted.renderer as THREE.WebGLRenderer : new THREE.WebGLRenderer({ antialias: true }); } catch {
      setGraphicsUnavailable('This browser could not start 3D graphics.');
      problem('This browser could not start 3D graphics, so the world view is unavailable here.');
      return () => abort.abort();
    }
    // Lane phones (V4): a phone draws fewer pixels, a smaller shadow map and less far detail (quality-tier.ts).
    const quality=browserQuality(),phoneOff=new Set((new URLSearchParams(location.search).get('phoneOff')??'').split(',')),distanceDetail=quality.detail&&!phoneOff.has('detail')?new WorldDistanceDetail(phoneOff.has('bodies')?{...quality.detail,standInDistance:Infinity}:quality.detail):null;  // ?phoneOff=detail,lod,cards,bodies,worker isolates one phone-tier part
    const bodyViewer={eye:new THREE.Vector3(),frustum:new THREE.Frustum(),nearM:quality.bodies.nearM,farM:quality.bodies.farM},bodyViewerM=new THREE.Matrix4();let viewerLive=false;  // PERF-EDEN: bodies' pose rate by distance and view; PERF-PASSES: the layer's motion things and idle life read the same view
    const meshLod=quality.detail&&!phoneOff.has('lod')?new WorldMeshLod(quality.tier==='phone'?PHONE_MESH_LOD:DESKTOP_MESH_LOD,async()=>{
      if(abort.signal.aborted)return null;
      const worker=!phoneOff.has('worker')&&await workerSimplifier(()=>new Worker(new URL('./mesh-lod.worker.ts',import.meta.url),{type:'module'}),15000,abort.signal);
      if(abort.signal.aborted)return null;
      return worker||import('meshoptimizer/simplifier').then(async m=>{await m.MeshoptSimplifier.ready;return !abort.signal.aborted&&m.MeshoptSimplifier.supported?m.MeshoptSimplifier as unknown as Simplifier:null;});
    }):null;  // levels built in a worker (?phoneOff=worker: in-thread)
    (window as unknown as {__simQuality?:unknown}).__simQuality={tier:quality.tier,reason:quality.reason,maxPixelRatio:quality.maxPixelRatio,detail:()=>distanceDetail?{...distanceDetail.stats}:null,lod:()=>meshLod?{...meshLod.stats}:null,standIns:()=>farStandIns?{...farStandIns.stats}:null};
    const shotMode=new URLSearchParams(location.search).has('shot');
    // P1 phones: a new world's people (character models, clip libraries and composed Soul bodies: ~1.6 MB on Eden 2026,
    // ~8 s of a 1.6 Mbps link) wait until the arrival is over. Before, they shared the link with the world's own build (its
    // building worker's code waited behind them) and held the card ~12 s; until they land, a simple figure stands in.
    // Desktop, old worlds and pictures load them at once and wait for them as before. `?people=wait|later` overrides.
    const earlyWanted=earlyArrivalWanted(quality.tier,newWorld,location.search,shotMode);
    // Old worlds on phones (F12): undecided until the first snapshot, held meanwhile; the people wait for the arrival
    // only when none of them stands in the arrival camera's view (otherwise the card waits for them as before).
    const peopleAsk=new URLSearchParams(location.search).get('people'),peopleRule=((q:string|null)=>q==='wait'?false:q==='later'?true:quality.tier==='phone'&&!shotMode)(peopleAsk);
    let peopleLater=peopleRule&&(newWorld||peopleAsk!=='wait');const peopleByView=peopleLater&&!newWorld&&peopleAsk!=='later';
    const adaptive=worldResolution(renderer,Math.min(devicePixelRatio,quality.maxPixelRatio),newWorld,shotMode);if(adaptive)(window as unknown as {__simAdaptive?:unknown}).__simAdaptive=adaptive;  // W2b: shot mode stays at pixel ratio 1; phones cap the ratio (quality tier); ordinary worlds retain adaptive resolution
    renderer.shadowMap.enabled = true;
    // look pass for entity worlds: occlusion, highlight roll-off + night exposure, material detail (rendering/WorldLook.ts)
    const look=lookSettings(location.search,quality.tier,newWorld),post=look.ao?new WorldPost():null;if(look.enabled)renderer.toneMapping=THREE.CustomToneMapping;setMaterialDetail(look.detail);(window as unknown as {__simLook?:unknown}).__simLook={settings:look,post:post?.params??null,get failed(){return post?.failed??null;}};
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Live 3D view of the world');
    renderer.domElement.style.display = 'block';
    // The canvas fills its host. setSize(w, h, false) below sizes only the drawing buffer (w·dpr × h·dpr); without this the
    // canvas is laid out at buffer size, so on a 2× (Retina) screen it is twice the window and only its top-left quarter
    // shows: the view looks shifted/warped and the orbit centre sits at the bottom-right edge (Gene, 2026-10-11).
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);
    const onContextLost = (e: Event) => { e.preventDefault(); setGraphicsUnavailable('The 3D graphics context was lost.'); navigation?.release(); problem('The 3D view lost its graphics context; it will come back when the browser restores it.'); };
    const onContextRestored = () => setGraphicsUnavailable(null);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
    const speechVisibility=new WorldRenderedVisibility();
    const labels2d = new CSS2DRenderer();
    // P1: name tags live in their own scene, so drawing them no longer re-walks (and re-multiplies) every one of the world's
    // ~9,000 objects each frame: CSS2DRenderer.render was ~20% of an Eden 2026 frame. Tags are placed in world coordinates.
    const labelScene = new THREE.Scene();
    // zIndex 1 contains CSS2DRenderer's per-label depth z-indices, so speech bubbles (z 3) read above name tags.
    Object.assign(labels2d.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', zIndex: '1' });labels2d.domElement.classList.add('world-labels');  // QA2 F13: hidden while the arrival card shows (world-chrome.css)
    host.appendChild(labels2d.domElement);forwardWheel(labels2d.domElement,renderer.domElement);  // C1: the wheel zooms over a name tag too

    const scene = (adopted?.scene as THREE.Scene|undefined) ?? new THREE.Scene();
    const farStandIns=quality.tier==='phone'&&quality.detail&&!phoneOff.has('cards')?new WorldFarStandIns(PHONE_STAND_INS,rendererSnapshotter(renderer)):null;if(farStandIns)scene.add(farStandIns.group);  // lane phones: flat cards for far scattered things
    const staticBatches=new StaticBatchOwner(scene),batchEnabled=new URLSearchParams(location.search).get('staticBatches')!=='0';
    let batchGeometry:WorldGeometry|null=null,batchRevision=-1,batchGeneration=0;
    // PERF-BATCH: the entity world's frozen things (WorldEntityLayer.staticBatchRoots) merge per cell and plain material
    // into derived meshes (Eden 2026: ~6,000 meshes, 983 materials → a few hundred draws). Sources are trusted between
    // changes of the layer's staticRevision; a changed revision re-prepares (incrementally) once things have been still
    // for a moment. `?entityBatches=0` turns it off, `?entityCell=<m>` sets the cell size (default 48 m).
    const entityBatchQuery=new URLSearchParams(location.search),entityBatchEnabled=entityBatchQuery.get('entityBatches')!=='0',entityCell=Number(entityBatchQuery.get('entityCell'))||96;
    const entityBatches=new StaticBatchOwner(scene,{cellSize:entityCell,maxMeshes:32768,maxNodes:262144,maxRootInputs:32768,maxMergedBytes:160*1024*1024,maxWorkingBytes:320*1024*1024,maxMeshesPerBatch:1024});
    let entityBatchRevision=-1,entityBatchChangedAt=0,entityBatchStillAt=0,entityBatchSeenRevision=-1,entityBatchGeneration=0,entityBatchDraw=true;  // entityBatchDraw: a proof's A/B switch (window.__simEntity.batching)
    const prepareEntityBatches=()=>{const revision=entityLayer.staticRevision;entityBatchRevision=revision;entityBatchSeenRevision=revision;void entityBatches.prepare(entityLayer.staticBatchRoots(32768),{sourcePolicy:'complete-roots/1',generation:++entityBatchGeneration,signal:abort.signal,budgetPolicy:'partial-cells/1',sharePlainMaterials:true,incremental:true,hideWholeRoots:true,sliceMs:24  /* PERF-LOAD: cell by cell, not one ~0.45 s task */,shaderMerge:{material:(m)=>mergedGlowMaterial(m,mergedRealismMaterial)??mergedRealismMaterial(m),attributes:(copy,mesh,toBatch,derived)=>{if(derived.userData.mergedRealism)mergedRealismAttributes(copy,mesh,toBatch,glowSourceMaterial(mesh)??mesh.material as THREE.Material);},source:glowSourceMaterial}}).catch(()=>{});};
    // Far plane covers the whole ±900 m terrain from anywhere in Eden: a nearer far plane slices the distant
    // ranges and the slice moves with the camera (ridges seemed to rise and recede). Depth precision is set by near.
    const camera = (adopted?.camera as THREE.PerspectiveCamera|undefined) ?? new THREE.PerspectiveCamera(45, 1, 0.1, 2400);
    const followView=new WorldFollow();
    let down: { x: number; y: number } | null = null;
    const newControls = (target?: THREE.Vector3) => createWorldOrbitControls(camera,renderer.domElement,target,{
      mode:context.current.cameraMode,navigation:context.current.manualNavigation,lifecycle:'',
    },(before,after)=>followView.userInput(before,after));
    let controls=newControls();
    navigation=new WorldNavigation(renderer.domElement,camera,()=>controls.target,()=>({
      mode:context.current.cameraMode,navigation:context.current.manualNavigation,
      lifecycle:JSON.stringify([...ownerKey,context.current.selected,context.current.thing,!!past.current,(() => {const c=context.current,id=c.selected?c.sim.conn.replica.souls.get(c.selected)?.entityId:c.thing;return id?id.startsWith('kin:')?!!kin.view.object(id):!!shown.current.entities[id]:null;})()]),
    }),()=>{
      down=null;if(abort.signal.aborted)return;
      const target=controls.target.clone();controls.dispose();controls=newControls(target);
    },owned=>{if(latestViewerState.current)emitState({...latestViewerState.current,inputOwned:owned});});
    // B3: a flight to a Soul's Follow shot (flyToSoul); any pointer or key input stops it where it is (manual camera).
    let soulFlight:SoulFlight|null=null,soulFlightClock=0,soulFlightChip=false;const stopSoulFlight=(e:Event)=>{if(soulFlight&&soulFlightChip&&(e as PointerEvent).pointerType==='touch'&&e.target===renderer.domElement)return;soulFlight=null;};  // #892: a touch's glide is already Follow on the way: a touch on the view (a flick, a ground tap) decides what it does; any control stops it
    const chipFlight=()=>!!soulFlight&&soulFlightChip;
    for(const type of ['pointerdown','keydown','wheel'] as const)window.addEventListener(type,stopSoulFlight,{capture:true,passive:true});
    const rts=new WorldRtsCamera(renderer.domElement,camera,{arrived:()=>hapticTick(),controls:()=>controls,mode:()=>context.current.cameraMode,takeOver:()=>{context.current.manualNavigation='orbit';context.current.cameraMode='manual';context.current.follow=false;if(!navigation?.sync(true))navigation?.release(false);context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');},scene:()=>scene,pickRoots:()=>[floaters.root,kin.view.root,standIns,...(people?.pickingRoots()??[]),...visualObstructionRoots()],focusAt:(x,y)=>{const target=hover.pick(x,y);if(target){inspectHover(target);return {center:target.point,radius:target.radius};}return null;},enabled:()=>!(context.current.cameraMode==='manual'&&context.current.manualNavigation==='free'),
      extent:()=>(entityLayer.active?entityLayer.groundExtent():null)??(expansion?EDEN_TERRAIN_EXTENT:geometry.bounds),home:()=>{context.current.setCameraMode('manual');controlsApi.current?.overview();}});scene.add(rts.marker);  // VF2: your camera (keys, pivot, double-click)
    // #891: on a touch screen in Free, the floating stick walks, one finger looks, pinch glides, two fingers rise, double-tap flies (all through rts)
    const touchFree=new WorldTouchFree(renderer.domElement,host,{camera:rts,free:()=>context.current.cameraMode==='manual'&&context.current.manualNavigation==='orbit'&&!chipFlight(),soulAt:(x,y)=>hover.pick(x,y)?.kind==='soul'});
    const speechLayer=new SpectatorSpeechLayer();scene.add(speechLayer.group);let speeches:SpectatorSpeech[]=[];const speechHead=new THREE.Vector3();
    // W3 fading visuals: Core C9 state when it ships; meanwhile a ?fade= preview override.
    // W2/W5 preview: ?snapshots=1 exposes on-demand low-res JPEG eyes/overhead/map frames (steward queue C10 will call these).
    if(new URLSearchParams(location.search).has('snapshots')){const soulAt=(name:string)=>{const c=context.current,soul=[...c.sim.conn.replica.souls.values()].find(x=>x.name.toLowerCase()===name.toLowerCase()),p=soul?shown.current.entities[soul.entityId]:null;return soul&&p?{soul,p:p.p,yaw:p.yaw??0}:null;};
      (window as unknown as Record<string,unknown>).edenSnapshots={
        map:()=>renderMap(renderer,scene,{souls:[...context.current.sim.conn.replica.souls.values()].flatMap(soul=>{const p=shown.current.entities[soul.entityId]?.p;return p?[{name:soul.name,x:p[0],z:p[2]}]:[];})}),
        eyes:(name:string)=>{const a=soulAt(name);return a?renderEyes(renderer,scene,{position:[a.p[0],a.p[1]+1.6,a.p[2]],yaw:a.yaw}):null;},
        overhead:(name:string)=>{const a=soulAt(name);return a?renderOverhead(renderer,scene,[a.p[0],a.p[1],a.p[2]]):null;}};}
    const portraits=new WorldSoulAvatars(renderer);
    const seatSurvey=new URLSearchParams(location.search).get('survey')==='seats'?{done:false,since:null as number|null}:null;
    const waterDetail=new WorldWaterDetail(()=>!!reducedMotionQuery?.matches,()=>quality.tier==='phone'),waterDetailOff=new URLSearchParams(location.search).get('water')==='0';  // ?water=0: before/after comparisons
    waterDetail.boats=AFLOAT;(window as unknown as {__simWater?:unknown}).__simWater=waterDetail.stats;    const idleLife=new WorldIdleLife();const bodyPoses=new WorldBodyPoses();const idleSouls:IdleSoul[]=[];const idleSphere=new THREE.Sphere();let attentionTargets=new Map<string,readonly string[]>();
    const contextViews=new WorldContextViews(apiPath,abort.signal,()=>{const state=latestViewerState.current;if(state&&!abort.signal.aborted)context.current.onViewerState?.({...state});},newWorld);
    const edgeItems=new WorldEdgeItems(apiPath('/v1/edge/items'));scene.add(edgeItems.group);edgeItems.start(abort.signal);  // things lying around (together/1)
    const early=newWorld?takeEarlyLayer():null;if(early)abort.signal.addEventListener('abort',()=>early.abort.abort());const entityLayer=early?.layer??new WorldEntityLayer(apiPath);entityLayerRef.current=entityLayer;{const q=new URLSearchParams(location.search);entityLayer.scatterPooling=q.get('scatterPools')!=='0';entityLayer.motionInstancing=q.get('motionPools')!=='0';entityLayer.scatterPools.cellSize=Number(q.get('scatterCell'))||(quality.tier==='phone'?192:Infinity);}  // P7b: a phone's layer may have started before this page's code was in (early-layer.ts)
    scene.add(entityLayer.group);entityLayer.cover.bindScene(scene);let entityWorldFramed=false,rideNames:string[]|null=null,rideNamesAt=0,rideCarriers:CarrierPose[]=[],rideCars:string[]=[],carrierIds:string[]=[];
    // E2 #3: shy animals in a god world run from where the Souls' figures are now; ANI: every animal (god worlds and old Eden) gives way to them
    setFleeSources(()=>{const out:[number,number][]=[];for(const soul of context.current.sim.conn.replica.souls.values()){const e=shown.current.entities[soul.entityId];if(e?.p)out.push([e.p[0],e.p[2]]);}return out;});
    const godLiving=newWorld?new GodWorldLiving(entityLayer,renderer,{radius:look.enabled?1.45:1,gain:look.poolGain}):null;if(godLiving){scene.add(godLiving.group);(window as unknown as {__simLiving?:unknown}).__simLiving={get lights(){return godLiving.lights;},lightFrame:()=>godLiving.lightFrame(),atmosphere:()=>atmosphere.inspect(),broadcastViews:()=>godTourViews(entityLayer,entityLayer.groundAt).length,lightning:()=>godLightning?.inspect()??null,holdLightning:(ms:number)=>{if(godLightning)godLightning.holdUntil=performance.now()+ms;}};}  // R4-LIVE: lamps at dusk, the god's weather, rain kept out of rooms
    const godLightning=newWorld?new WorldLightning(entityLayer):null;if(godLightning)scene.add(godLightning.group);for(const o of adopted?.standIns??[])o.removeFromParent();  // GOD-ENV: bolts, flash, thunder (new worlds only)
    // Entity worlds have no Souls to broadcast at first: frame what the god built (or ?eye=x,y,z&at=x,y,z for stable shots),
    // once, on first arrival (after the snapshot loads; never from the render loop), at a human distance (entity-arrival.ts).
    const frameEntityWorld=()=>{if(!entityLayer.active||entityWorldFramed)return;entityWorldFramed=true;const q=new URLSearchParams(location.search),pin=shotMode?shotPin():null,eye=pin?.eye??q.get('eye')?.split(',').map(Number),at=pin?.at??q.get('at')?.split(',').map(Number);  // lookrace: a re-mounted shot page keeps the look's pinned camera
      if(eye?.length===3&&at?.length===3&&eye.every(Number.isFinite)&&at.every(Number.isFinite)){controls.target.set(at[0],at[1],at[2]);camera.position.set(eye[0],eye[1],eye[2]);}
      else if(entityView.current){controls.target.fromArray(entityView.current.target);camera.position.fromArray(entityView.current.eye);if(entityView.current.pending){camera.lookAt(controls.target);arrivalPending={eye:entityView.current.eye,target:entityView.current.target};return;}if(entityView.current.broadcast&&context.current.cameraMode==='broadcast'){camera.lookAt(controls.target);return;}}  // DIRECTOR2: a re-mount (a new Soul, a reconnect) left a broadcast viewer on 'your camera' with no input  // a re-mount (welcome, reconnect) keeps the person's camera (and an undecided arrival stays undecided)
      else{  // the orbit target is the centre of the screen and of what was built: no panel-dependent shift (Gene: off-centre pivot on small screens)
        const pose=adopted?.target&&adopted.eye?{target:adopted.target,eye:adopted.eye,opening:adopted.opening??null}:worldArrivalPose(entityLayer,camera.aspect);controls.target.fromArray(pose.target);camera.position.fromArray(pose.eye);broadcast.opening=pose.opening;  // P7f: one arrival camera (arrival-shot.ts): the poster's, and with Souls the broadcast's first shot starts from it
        camera.lookAt(controls.target);arrivalPending={eye:camera.position.toArray(),target:controls.target.toArray()};return;}  // R4-LIVE: broadcast if Souls live here (decided once the welcome lists them), as on /w/eden
      camera.lookAt(controls.target);context.current.cameraMode='manual';context.current.setCameraMode('manual');};  // lane W1: at once, not at React's next render: the socket's takes now arrive during the build, and a broadcast frame in between moved a ?shot's eye/at camera
    let arrivalPending:{eye:[number,number,number];target:[number,number,number]}|null=null,arrivalWelcome:number|null=null;
    // QA2 F10: the arrival framing of a world with no Souls takes the camera off Broadcast by itself; until the visitor moves
    // it (or picks a mode) that is not "your camera", so the chip offers no "Back to broadcast". The pose is read one frame
    // after the framing (controls settle it) and any later move beyond a few cm counts as the visitor's.
    let autoFrame:{eye:THREE.Vector3;target:THREE.Vector3}|null|'pending'=null;
    // ?shot=1: a clean picture for `god look` (canvas over every overlay, camera from eye/at, title 'ready' once drawn).
    const shotHour=parseShotHour(location.search);
    if(shotMode){const c=renderer.domElement;Object.assign(c.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'2147483000'});document.title='loading';}
    // W1: readiness follows startup and two drawn frames, with no 2.5 s floor or timer polling.
    void (newWorld ? early?.started ?? entityLayer.start(abort.signal) : Promise.resolve()).then(async()=>{
      layerStarted=true;arrivalMark('entity-built');if(entityLayer.active){entityLayer.onContextChanged=()=>void contextViews.refresh();void contextViews.refresh();}
      if(abort.signal.aborted)return;frameEntityWorld();setEntityWorld(entityLayer.active);
      // lane W1: link the built world's shaders in parallel (KHR_parallel_shader_compile) before its first frame, instead
      // of the first frame stalling the page on each program (~0.2-0.35 s); frames wait for it, at most 3 s
      if(entityLayer.active){programsPending=true;warmLayer=1;}  // PERF-LOAD: linked after the layer's first update (warmLayer, in the frame loop), which adds its pools
      // r2.1: and after the first world clock reaches the lights (all views/frames of `look --hour` honour the hour)
      if(shotMode){await whenAssetsSettled();await whenShotClock(()=>light.daylight!==null,{timeoutMs:shotHour!==null?15_000:4_000,signal:abort.signal});await whenArrivalCardGone({signal:abort.signal});await new Promise<void>(r=>{afterNextDraw=r;});requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(abort.signal.aborted)return;document.title=entityLayer.active?'ready':'no-entity-world';
        (window as unknown as {__shotReady?:boolean}).__shotReady=true;window.dispatchEvent(new Event('sim-shot-ready'));
      }));}
    });
    const gw=window as unknown as {__simGhost?:WorldPreviewGhost};const ghost=gw.__simGhost??(gw.__simGhost=new WorldPreviewGhost(apiPath));if(newWorld)scene.add(ghost.group);  // ?preview=<id> ghosts (GodPanel drives it; one ghost per page, whoever makes it first)
    // Alt+click on the ground drops a labelled flag (a core/flag entity) the god can refer to as flag:<label>.
    // Owner authority: this world's god token, minted with the page's signed-in person (Clerk in production, a local name in dev).
    const godMint=()=>ensureGodToken().catch(()=>null);
    const flagRay=new THREE.Raycaster(),flagNdc=new THREE.Vector2();
    const onFlagClick=async(ev:MouseEvent)=>{
      if(!godFeature('flags')||!(ev.altKey||flagModeRef.current)||!entityLayer.active)return;  // G5: flags are switched off (god-ui/features.ts)
      setFlagMode(false);
      const rect=renderer.domElement.getBoundingClientRect();flagNdc.set(((ev.clientX-rect.left)/rect.width)*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
      flagRay.setFromCamera(flagNdc,camera);const hit=flagRay.intersectObjects(entityLayer.terrainMeshes(),false)[0];if(!hit)return;
      const label=window.prompt(`Flag at (${hit.point.x.toFixed(0)}, ${hit.point.z.toFixed(0)}) — label:`);if(!label)return;
      const token=await godMint();if(!token){problem('Only the world owner can drop flags: sign in and claim the world first.');return;}
      const name=label.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'flag';
      const r=await fetch(apiPath('/v1/god/act'),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({ops:[{op:'place',def:'core/flag@1',name,p:[Math.round(hit.point.x*10)/10,Math.round(hit.point.z*10)/10],state:{label}}],note:'flag from the website'})});
      const d=await r.json().catch(()=>null);if(!d?.accepted)problem(`Flag refused: ${d?.failures?.[0]?.code??r.status} ${d?.failures?.[0]?.detail??''}`);
    };
    // lookrace: `god look` pins its camera here once (?shot=1 pages only), then the render loop holds it exactly, so nothing
    // (orbit distance limits, the ground clamp, a camera mode, a re-mount) moves it between the request and the capture.
    // An eye under the ground moves toward its target, or rises on its side, until the view clears the terrain
    // (clearShotEye; else the live view's clamp lifts it); `closer`/`raised`/`lifted` say how. Returns the camera used.
    const shotCamera=(eye:readonly number[],at:readonly number[])=>{
      if(!shotMode)throw Error('shotCamera: only on a ?shot=1 page');
      refreshCameraGround();const ground=(x:number,z:number)=>cameraGround.heightAt(scene,x,z),fixed=clearShotEye(eye,at,ground),start=fixed?.eye??eye;
      controls.target.set(at[0],at[1],at[2]);camera.position.set(start[0],start[1],start[2]);camera.up.set(0,1,0);camera.lookAt(controls.target);
      let lifted=0;for(let i=0;i<4;i++){const l=cameraGround.apply(camera,scene);if(!(l>0))break;lifted+=l;camera.lookAt(controls.target);}
      const round=(v:number)=>Math.round(v*100)/100;
      const pin:ShotPin={eye:camera.position.toArray(),at:controls.target.toArray(),lifted:round(lifted),closer:round(fixed?.closer??0),raised:fixed?.raised??0};(window as unknown as {__shotCamera?:ShotPin}).__shotCamera=pin;return pin;};
    renderer.domElement.addEventListener('click',onFlagClick);if(newWorld)(window as unknown as {__simEntity?:unknown}).__simEntity={layer:entityLayer,get depictedTick(){return shown.current.tick;},get worldSeconds(){const dt=shown.current.take?.dt;return dt?shown.current.tick*dt:null;},transportFrame:()=>({tick:shown.current.tick,dt:shown.current.take?.dt,entities:shown.current.entities,bones:people&&!(people instanceof WorldLightPeople)?people.bones():null}),gameFrame:()=>({tick:shown.current.tick,dt:shown.current.take?.dt??.05,entities:shown.current.entities,bones:(people as TakePeople|null)?.bones?.()??{},souls:[...context.current.sim.conn.replica.souls.values()].map(s=>({id:s.id,entityId:s.entityId,name:s.name})),props:games.group.children.map(o=>({key:o.name,p:o.position.toArray(),kind:o.userData.gameKind}))}),contactFrame:()=>({tick:shown.current.tick,dt:shown.current.take?.dt,takeStart:shown.current.take?.startTick,entities:shown.current.entities,bones:people&&!(people instanceof WorldLightPeople)?people.contactDiagnostics():null}),shotCamera,labelScene,applyEdge:(msg:Parameters<WorldEntityLayer['applyEdge']>[0][number]|Parameters<WorldEntityLayer['applyEdge']>[0])=>entityLayer.applyEdge(Array.isArray(msg)?msg:[msg]),siteStyle:(style:string)=>entityLayer.sites.siteStyle(style),siteStats:()=>entityLayer.sites.inspect(),camera,get controls(){return controls;},residents:()=>{const out:{id:string;p:readonly[number,number,number];speaking?:boolean;body?:string;activity?:string;instrument?:string;activityAge?:number;activityLeft?:number}[]=[],now=Date.now();for(const s of context.current.sim.conn.replica.souls.values()){const e=shown.current.entities[s.entityId];if(e)out.push({id:s.id,p:e.p as readonly[number,number,number],speaking:speeches.some(sp=>sp.speaker===s.id&&now-sp.at<Math.min(9000,1500+sp.text.length*55)),body:s.entityId,activity:(e as {activity?:string}).activity,instrument:people&&!(people instanceof WorldLightPeople)?people.instrumentOf(s.entityId):undefined,activityAge:people&&!(people instanceof WorldLightPeople)?people.activityAgeOf(s.entityId):undefined,activityLeft:people&&!(people instanceof WorldLightPeople)?people.activityLeftOf(s.entityId):undefined});}return out;},scene,renderer,stats:()=>({draws:renderer.info.render.calls,tris:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,instances:entityLayer.instancer.instances,instanceDraws:entityLayer.instancer.draws,scatterDraws:entityLayer.scatterPools.draws,motionDraws:entityLayer.motionInstancer.draws,motionInstances:entityLayer.motionInstancer.instances,scatterInstances:entityLayer.scatterPools.instances,entities:entityLayer.entityCount,batches:entityBatches.inspection(),staticRevision:entityLayer.staticRevision,sunShadow:sunCache?{...sunCache.stats}:null}),batching:(on:boolean)=>{entityBatchDraw=on;}};  // the entity world (god mode), when this world has one
    const games=new WorldGames();scene.add(games.group);
    const platformDraw=new WorldPlatforms();scene.add(platformDraw.group);
    const placeActivity=new WorldPlaceActivity();scene.add(placeActivity.group);
    const fading=new WorldFadingLayer();scene.add(fading.group);let fadedOut=new Set<string>();const fadeOverride=parseFadeOverride(location.search),fadeSince=new Map<string,number>();
    // Balloon ride: Core's ride state (edge frames) or a native carrier; ?ride=Alice,Bob previews a flight locally.
    const balloonRide=new WorldBalloonRide();scene.add(balloonRide.group);const rideCarsDrawn=new WorldRideCars();scene.add(rideCarsDrawn.group);const rideOverride=parseRideOverride(location.search),rideStart=performance.now();
    const atmosphere=(adopted?.atmosphere as ReturnType<typeof createWorldAtmosphere>|undefined)??createWorldAtmosphere(scene);
    // MARSLAND-FORK: the Mars fork (/worlds/w/mars) draws the mars-two template's drone surroundings and its desert sky (lazy: only the fork loads the kit)
    let forkLand:ForkLand|null=null,forkLandLoad:Promise<void>|null=null;
    const dressForkLand=(camp:THREE.Object3D)=>{if(!marsFork)return;forkLandLoad??=import('./WorldMarsForkLand.ts').then(m=>{if(abort.signal.aborted)return;forkLand=m.createForkLand(0);scene.add(forkLand.group);(window as unknown as {__simForkLand?:unknown}).__simForkLand=forkLand.stats;},e=>console.warn('mars fork land could not be drawn',e));void forkLandLoad.then(()=>forkLand?.dress(camp));};let atmosphereSeconds=0;const reducedMotionQuery=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    const light = (adopted?.light as Daylight|undefined) ?? new Daylight(scene,{bakedShadow:quality.bakedShadows});if(quality.shadowMapSize!==light.sun.shadow.mapSize.x)light.sun.shadow.mapSize.set(quality.shadowMapSize,quality.shadowMapSize);
    // PERF-BAKED-SHADOWS: still things cast into the sun's cached map (redrawn when the sun turns, the view steps or a still thing changes); the per-frame map draws what moves
    const sunCache=light.baked?new SunShadowCache(renderer,scene,light.sun,light.baked,{enabled:()=>look.enabled&&look.follow&&entityLayer.active&&!expansion&&!eyes&&entityLayer.freezeSettled,statics:()=>{const out=entityLayer.shadowStatics([]);out.push(entityBatches.group,staticBatches.group);return out;},revision:()=>entityLayer.shadowRevision}):null;
    const broadcast = new WorldBroadcast();
    broadcast.hints=()=>({soulEntity:id=>context.current.sim.conn.replica.souls.get(id)?.entityId??null,eden:!!expansion&&!past.current,daylight:light.daylight,carriers:rideCarriers,...(entityLayer.active&&!expansion?{views:godTourViews(entityLayer,entityLayer.groundAt)}:{})});  // R4-LIVE: a god world's own landmarks  // VF1/VF5: who speaks; Eden town views; time of day
    const followMotion=new WorldFollowMotion();
    let followTick:number|null=null,followEpoch:string|null=null;
    let previousCameraMode: WorldCameraMode = 'broadcast';
    let logicalFov = 45;
    let expansion:ReturnType<typeof createWorldEdenExpansion>|null=null,expansionFailed=false,expansionWantedNow:boolean|null=null;
    if(context.current.edenExpansion)void loadOldEden().catch(()=>{});  // P1: start fetching the old Eden chunk with the scene
    let expansionSceneInfo:ReturnType<typeof parseSceneInfo>|null=null;
    let cameraGroundInfo:ReturnType<typeof parseSceneInfo>|null|undefined,cameraGroundOwner:ReturnType<typeof createWorldEdenExpansion>|null|undefined;
    const refreshCameraGround=()=>{if(entityLayer.active){cameraGround.bindGround(entityLayer.groundAt,entityLayer);return;}const owner=expansion?.group.visible?expansion:null;if(cameraGroundInfo===expansionSceneInfo&&cameraGroundOwner===owner)return;cameraGroundInfo=expansionSceneInfo;cameraGroundOwner=owner;cameraGround.bindGround(cameraGroundSampler(expansionSceneInfo??undefined,owner?.sampleVisualGround),expansionSceneInfo);};
    let houseWindows:ReturnType<typeof createEdenHouseWindows>=null;
    let shadowDetail:WorldShadowDetail|null=null;
    const clearExpansion=()=>{shadowDetail?.dispose();shadowDetail=null;houseWindows?.dispose();houseWindows=null;expansion?.dispose();expansion=null;refreshCameraGround();};
    let geometry = new WorldGeometry(null);
    // Called by the finite initial gate after required attachments and appearances.
    const prepareStaticRendering=async()=>{
      if(!batchEnabled)return;
      const revision=geometry.staticRenderRevision;
      if(batchGeometry===geometry&&batchRevision===revision)return;
      batchGeometry=geometry;batchRevision=revision;
      await staticBatches.prepare(geometry.staticRenderRoots(),{generation:++batchGeneration,signal:abort.signal,budgetPolicy:'partial-cells/1'}).catch(()=>{});
    };
    scene.add(geometry.group);
    const groupSelection=new Set<string>();
    const framing=new WorldPlaceCamera();let followed: string | null = null;
    const overview = (b: readonly [number, number, number, number]) => {
      if(entityWorldFramed)return;  // the entity world framed itself; a later scene install must not yank the camera back
      const [x0, z0, x1, z1] = b, span = Math.max(10, x1 - x0, z1 - z0);
      controls.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      camera.position.set(controls.target.x + span * 0.1, span * 0.6, controls.target.z + span * 0.75);
      controls.update();
      framing.framed = true;
    };
    overview(geometry.bounds);
    framing.framed = false; // the placeholder ground does not count: frame again once the real layout (or the people) arrive
    controlsApi.current = {
      feedbackContext: () => ({camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov},placeId:context.current.placeCard?.id??latestViewerState.current?.room?.id??null}),
      overview: () => { navigation?.release(); overview(expansion&&!past.current?[-100,-65,105,85]:geometry.bounds); },
      framePoint:(point,radius)=>{context.current.setCameraMode('manual');context.current.setManualNavigation('orbit');rts.frameSubject(point,radius);},
      frameSouls: ids => {
        const members=[...new Set(ids)].slice(0,12).flatMap(id=>{const soul=context.current.sim.conn.replica.souls.get(id),p=soul?shown.current.entities[soul.entityId]:null;return soul&&p?[{id,p:p.p,yaw:p.yaw??0}]:[];});
        if(!members.length)return false;
        navigation?.release();context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');
        const shot=conversationFrame(members,camera,visualObstructionRoots(),(x,z)=>cameraGround.heightAt(scene,x,z)??0);
        if(!shot)return false;groupSelection.clear();members.forEach(m=>groupSelection.add(m.id));context.current.onSelect(members[0].id);controls.target.copy(shot.target);camera.position.copy(shot.position);camera.lookAt(shot.target);controls.update();return true;
      },
      refreshLocations:()=>void contextViews.refresh(),
      locationPage:()=>!expansion&&entityLayer.active&&!past.current?contextViews.page():null,
      searchLocations:query=>void contextViews.search(query),
      moreLocations:()=>void contextViews.more(),
      cancelLocationPictures:()=>contextViews.cancelPictures(),
      locations:()=>expansion&&!past.current?CURATED_WORLD_LOCATIONS:entityLayer.active&&!past.current?contextViews.locations:depictedLocations,
      frameLocation:id=>{if(initialGate?.snapshot().stage!=='ready')return false;const view=controlsApi.current?.locations().find(p=>p.id===id);if(!view)return false;framing.place(camera,()=>controls,view,()=>{context.current.manualNavigation='orbit';context.current.cameraMode='manual';context.current.follow=false;context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');},()=>{rts.release();navigation?.release();});return true;},
      locationPreview:id=>{if(id.startsWith('context:'))return contextViews.picture(id);if(initialGate?.snapshot().stage!=='ready')return Promise.resolve(null);const location=controlsApi.current?.locations().find(p=>p.id===id);if(!location)return Promise.resolve(null);return location.regionId?placePreviews.captureLocation(location,sceneKey??''):placePreviews.capture(id as WorldPlaceId);},
      framePlace: place => {const view=worldPlaceView(place);if(!view||!expansion||past.current)return false;framing.place(camera,()=>controls,view,()=>{context.current.manualNavigation='orbit';context.current.cameraMode='manual';context.current.follow=false;context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');},()=>{rts.release();navigation?.release();});return true;},
      releaseInput: () => {rts.release();navigation?.release();},
      flyToSoul: (soulId,opts) => {
        const c=context.current,soul=c.sim.conn.replica.souls.get(soulId),p=soul?shown.current.entities[soul.entityId]?.p:null;
        if(!soul||!p||past.current||c.loading||c.graphicsUnavailable||!shown.current.take||(initialGate&&initialGate.snapshot().stage!=='ready'))return false;
        soulFlightChip=!!opts?.chip;  // #892: a touch's follow shows the bottom chip, not the card (same flight)
        navigation?.release();rts.release();groupSelection.clear();c.onSelect(soulId,soulFlightChip?'chip':undefined);c.setThing(null);
        const target=new THREE.Vector3(p[0],p[1]+1,p[2]);
        if(reducedMotionQuery?.matches){soulFlight=null;c.cameraMode='follow';c.follow=true;c.setCameraMode('follow');hapticTick();return true;}
        c.manualNavigation='orbit';c.cameraMode='manual';c.follow=false;c.setManualNavigation('orbit');c.setCameraMode('manual');
        camera.updateMatrixWorld();soulFlightClock=performance.now();soulFlight=new SoulFlight(soulId,camera.position,camera.getWorldDirection(new THREE.Vector3()),camera.position.distanceTo(controls.target),target);
        return true;
      },
      move: delta => navigation?.move(delta) ?? false,
      inputOwned: () => navigation?.inputOwned ?? false,
      reset: () => {
        navigation?.release(); broadcast.reset();followView.reset();followMotion.reset();followed=null;
        if(context.current.cameraMode==='broadcast')return true;
        if(context.current.cameraMode==='follow'){
          const c=context.current,id=c.selected?c.sim.conn.replica.souls.get(c.selected)?.entityId:c.thing;
          const p=id?.startsWith('kin:')?kin.view.object(id)?.position.toArray():id?shown.current.entities[id]?.p:null;
          if(!p)return false;controls.target.set(p[0],p[1]+1,p[2]);camera.position.copy(controls.target).add(new THREE.Vector3(6,4,8));camera.lookAt(controls.target);return true;
        }
        overview(geometry.bounds);return true;
      },
      placePreview: place => context.current.edenExpansion&&!past.current ? placePreviews.capture(place) : Promise.resolve(null),
      focusSelected: () => {
        navigation?.release();
        const c = context.current;
        const entity = c.selected ? c.sim.conn.replica.souls.get(c.selected)?.entityId : c.thing;
        const position = entity ? shown.current.entities[entity]?.p : null;
        if (!position) return false;
        const offset = camera.position.clone().sub(controls.target);
        if (offset.length() > 12) offset.setLength(12);
        controls.target.set(position[0], position[1] + 1, position[2]);
        camera.position.copy(controls.target).add(offset); controls.update();
        return true;
      },
    };
    const resize = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false); labels2d.setSize(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    });
    resize.observe(host);

    // models: one loader (Draco for the character scans) shared by buildings, floaters and kin
    const diagnostics=new RendererDiagnostics(host);
    const downloads=new AssetDownloads(()=>{if(!abort.signal.aborted)setAssetProgress(downloads.snapshot());}),manager=new THREE.LoadingManager();
    const releaseDownloads = trackAssetDownloads(manager, downloads);
    const draco = new DRACOLoader(manager).setDecoderPath(BASE+'/mars-assets/draco/');
    const placePreviews=new WorldPlacePreviews(renderer,()=>[geometry.group,...(expansion?[expansion.group]:[]),...(entityLayer.active?[entityLayer.group]:[])],()=>scene,()=>{  // Gene #13: every place shot in the same late-morning, clear, dry light, whatever the live clock and weather
      const at=shotClockAt(light.clock??'2026-06-21T12:00:00',PLACE_SHOT_MINUTES)!,undoLight=light.photo(at),undoAtmosphere=atmosphere.photo(at,light.daylight),night=nightLightStrength();setNightLightStrength(1);houseWindows?.setNight(0);
      return ()=>{undoLight();undoAtmosphere();setNightLightStrength(0,night);houseWindows?.setNight(night);};});  // E2 #7: a god world's landmarks are drawn by its entity layer
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    const releaseAssetLoader = setAssetLoader(loader);
    const releaseTexturePreparation = newWorld ? setTextureRenderer(renderer,scene,camera) : () => {};
    if(newWorld){MeshoptDecoder.useWorkers?.(2);renderer.debug.checkShaderErrors=false;}  // lane PERF: paced GLB texture uploads, meshopt decoding in 2 workers, no sync link-status reads (new worlds only)
    else if(quality.tier==='phone'&&!import.meta.env.DEV)renderer.debug.checkShaderErrors=false;  // F12: an old world on a phone skips the sync link-status/info-log reads too (~0.2 s of /w/eden's first compile at 4x)
    const floaters = new FloaterView(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader, prepareModel: fitTextures });
    const bodyModels=new WorldBodyModels(loader,problem);bodyModels.held=peopleLater;
    let capturedPlatforms:readonly PlatformFloor[]|null=null;
    let currentPlatforms:{worldId:string;platforms:PlatformFloor[]}|null=null;
    void fetch(apiPath('/v1/edge/platforms'),{signal:abort.signal}).then(r=>r.ok?r.json():null).then(meta=>{
      if(!abort.signal.aborted&&meta?.contract==='eden-edge/1'&&meta.active===true&&meta.provenance?.contract==='render-platforms/1'&&typeof meta.worldId==='string')currentPlatforms={worldId:meta.worldId,platforms:parsePlatformFloors(meta.platforms)};
    }).catch(()=>{});
    const kin = new KinScenery(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader, prepareModel: fitTextures });
    let templates: Awaited<ReturnType<typeof loadTemplates>> = Object.assign([],{stableOrder:PEOPLE});
    type TemplateLoad={promise:Promise<void>;resolve:()=>void;reject:(error:Error)=>void;failed:boolean};
    const templateLoads=new Map<string,TemplateLoad>();
    const beginTemplate=(name:string)=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});templateLoads.set(name,{promise,resolve,reject,failed:false});};
    PEOPLE.forEach(beginTemplate);
    const templateOptions={appearances:humanPresets,onTemplate:(template:typeof templates[number])=>{const i=templates.findIndex(t=>t.name===template.name);if(i>=0)templates[i]=template;else templates.push(template);people?.setTemplates(templates);},onAsset:(name:string,phase:'start'|'loaded'|'failed')=>{if(phase==='start')downloads.start('person:'+name);else{downloads.finish('person:'+name,phase==='failed');const entry=templateLoads.get(name)!;if(phase==='loaded')entry.resolve();else{entry.failed=true;entry.reject(Error('Required person model '+name+' could not be loaded.'));}}}};
    // lane W1: a new world loads (and parses, ~0.1 s of main thread) its character templates once it has arrived, or as
    // soon as an initial body needs one; old worlds load them at once, as before
    let templatesStarted=false;const startTemplates=()=>{if(templatesStarted)return;templatesStarted=true;void loadPeopleKit().then(kit=>kit.loadTemplates(abort.signal,resources,templateOptions)).catch(()=>{});};
    if((!newWorld&&!peopleLater)||shotMode)startTemplates();
    const requireTemplate=async(name:string)=>{startTemplates();if(templates.some(t=>t.name===name))return;if(templateLoads.get(name)?.failed){beginTemplate(name);void loadPeopleKit().then(kit=>kit.loadTemplates(abort.signal,resources,{...templateOptions,names:[name]})).catch(()=>{});}await templateLoads.get(name)!.promise;};

    // Current unbound live viewers retain their observed layout. Historical
    // bound segments load their verified base; old unbound history uses neutral ground.
    let dayTicks: number | null = null, dayOrigin: number | null = null;
    let base: ReturnType<typeof parseSceneInfo>['scene'] = null, sceneSettled = false, people: TakePeople | WorldLightPeople | null = null;
    let peopleKitRetryAt=0;
    let appearanceProfiles=ALL_OPTIONAL_APPEARANCE_PROFILES;
    let publication:unknown=null,restMarkers:ReturnType<OldSceneKit['createPublishedRestMarkers']>=null;
    let newcomerMarkers:ReturnType<OldSceneKit['createPublishedNewcomerMarkers']>=null,newcomerMarkersFailed=false;
    const clearNewcomerMarkers=()=>{const owner=newcomerMarkers;newcomerMarkers=null;newcomerMarkersFailed=false;try{owner?.dispose();}catch{if(!abort.signal.aborted)problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}};
    // made with the first verified capture (old worlds); without one, the original fixtures draw (what its update does then)
    let nativeSocialDraw:InstanceType<OldSceneKit['WorldNativeSocialDraw']>|null=null;
    const resetSocialDraw=()=>{if(nativeSocialDraw)nativeSocialDraw.reset(people);else people?.setFixtureDrawReplacement(null);};
    let socialPaths:ReturnType<OldSceneKit['createNativeSocialPaths']>=null;
    const clearSocialPaths=()=>{const previous=socialPaths;socialPaths=null;try{previous?.dispose();}catch{problem('Some path scenery could not be shown; keeping the original ground.');}};
    let planting:ReturnType<OldSceneKit['createCurrentProvisionsUnderstory']>=null,plantingFailed=false;
    let connectedDressing:ReturnType<OldSceneKit['createCurrentSocialDressingOwner']>=null,connectedDressingFailed=false;
    const clearConnectedDressing=()=>{const owner=connectedDressing;connectedDressing=null;connectedDressingFailed=false;try{owner?.dispose();}catch{problem('Some greenery could not be shown; keeping the original scenery.');}};
    const visualObstructionRoots=()=>worldCameraRenderRoots(geometry.group,people?.obstructionRoots()??[],[planting?.group,connectedDressing?.group,expansion?.group,entityLayer.active?entityLayer.group:null]);  // new worlds: god-built terrain/things are what double-click and the camera hit (else the y=0 plane, inside hills)
    let nativeBoat:NonNullable<ConstructorParameters<typeof TakePeople>[1]>['nativeBoat'];
    let locationRegions:unknown=null,depictedLocations:readonly WorldLocation[]=[];
    let sceneKey:string|null=null,sceneRequest=0,sceneRetryAt=0,sceneReason:string|null=null;
    let initialGeneration=0,initialGate:InitialWorldReadiness|null=null,initialSnapshot=false,preparingGeneration=0,initialBodyIds:readonly string[]=[];
    const newInitialGate=()=>{initialGate?.cancel();const generation=++initialGeneration;initialSnapshot=false;preparingGeneration=0;initialBodyIds=[];const gate=new InitialWorldReadiness(generation,progress=>{if(!abort.signal.aborted&&initialGate===gate){arrivalMark('initial-'+progress.stage);setInitialProgress(progress);}});initialGate=gate;setInitialProgress(gate.snapshot());retryInitial.current=()=>{if(initialGate===gate){preparingGeneration=0;gate.retry();}};return gate;};

    const sceneryStatus=(reason:string|null)=>{sceneReason=reason;setSceneryNotice(reason);};
    const sceneHistory=new WorldSceneHistory(owner.worldId,async(hash,signal)=>{
      const response=await fetch(apiPath('/v1/scenes/'+hash)+'?world='+encodeURIComponent(owner.worldId),{signal});  // lane W1: browser-cached per world (http.ts)
      if(!response.ok)throw Error('Recorded scenery unavailable');return response.json();
    },decodeSceneCapturePublication);
    const installScene=(info:ReturnType<typeof parseSceneInfo>,verifiedPublication?:unknown,profiles:OptionalAppearanceProfiles=ALL_OPTIONAL_APPEARANCE_PROFILES)=>{
      staticBatches.reset();batchGeometry=null;batchRevision=-1;entityBatches.reset();entityBatchRevision=-1;
      speechVisibility.reset();
      const gate=newInitialGate();locationRegions=null;depictedLocations=[];placePreviews.invalidate();
      appearanceProfiles=profiles;
      resetSocialDraw();
      clearExpansion();expansionFailed=false;
      clearConnectedDressing();
      planting?.dispose();planting=null;plantingFailed=false;
      clearSocialPaths();
      clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=verifiedPublication??null;expansionSceneInfo=info;
      refreshCameraGround();
      people?.dispose();people=null;applied=null;
      base=info.scene;nativeBoat=info.shore?.metadata.boat&&info.shore.appearance?{layout:info.shore.metadata.boat.layout,proposal:info.shore.appearance.boat}:undefined;dayTicks=info.clock?.dayTicks??null;dayOrigin=info.clock?.origin??null;broadcast.reset();followView.reset();followed=null;
      capturedPlatforms=info.platforms??null;
      geometry.dispose();geometry=new WorldGeometry(base,info.ground,info.commons,info.shore,info.assetRoot);scene.add(geometry.group);light.fit(geometry.bounds);light.setCommonsReadability(geometry.hasAuthoredCommons);dressForkLand(geometry.group);  // MARSLAND-FORK: layer 3 around the Mars fork
      // Cosmetic paths require the verified full public capture and exact Core
      // social layout. Unknown/legacy scenes retain their original appearance.
      if((verifiedPublication as {body?:{scene?:{social?:{version?:unknown}}}}|undefined)?.body?.scene?.social?.version==='social-eden/1'&&oldKit)try{socialPaths=oldKit.createNativeSocialPaths(verifiedPublication,true);if(socialPaths)scene.add(socialPaths.group);}catch{}
      if(base)framing.initial(()=>overview(geometry.bounds));
      kin.place(info.kin);sceneSettled=true;
      const owner=geometry,assetBytes=(url:string,event:ProgressEvent)=>gate.download(url,event.loaded,event.lengthComputable?event.total:null);
      if(info.backdrop)gate.require('Campus',async()=>{if(!await owner.addBackdrop(info.backdrop!,loader,assetBytes))throw Error('The campus model could not be loaded.');});
      if(info.kin.length)gate.require('Local characters',()=>kin.readyInitial());
      if(info.buildings.length){const buildingRoot=successfulInitialLookup(()=>Promise.resolve(info.assetRoot));  // the scene names its asset root; no server has a /v1/worldmeta (a 404 there meant the default root)
      for(const [index,building] of info.buildings.entries())gate.require('Building '+(index+1)+': '+building.file,async()=>{const assetRoot=await buildingRoot();if(assetRoot)owner.setAssetRoot(assetRoot);const failed=await owner.addBuildings([building],loader,assetBytes);if(failed.length)throw Error('Required building could not be loaded.');});}
    };
    let currentScene:Promise<ReturnType<typeof parseSceneInfo>>|null=null;
    const currentLayout=()=>currentScene??=(async()=>{const response=await fetch(apiPath('/v1/scene'),{signal:abort.signal});if(!response.ok)throw Error('Layout unavailable');return parseSceneInfo(await response.json());})();
    const failLayout=(reason:string)=>{initialGate?.cancel();sceneSettled=false;sceneRetryAt=Infinity;renderer.domElement.dataset.sceneBinding='unavailable';sceneryStatus(reason);setInitialProgress({generation:initialGeneration,stage:'failed',required:1,completed:0,failed:['World layout'],bytesLoaded:0,bytesTotal:null});retryInitial.current=()=>{sceneRequest++;sceneKey=null;currentScene=null;sceneRetryAt=0;setInitialProgress({generation:initialGeneration,stage:'waiting',required:0,completed:0,failed:[],bytesLoaded:0,bytesTotal:null});};};
    const ensureScene=(chunk:Chunk,history:boolean,now:number)=>{
      const reference=(chunk.take as Take&{renderSceneRef?:unknown}).renderSceneRef;
      const ref=reference as {contract?:unknown;hash?:unknown;rulesVersion?:unknown}|undefined;
      const mismatch=reference!==undefined&&ref?.rulesVersion!==chunk.take.rulesVersion;
      const key=reference===undefined?(history?'history-unbound':'current-unbound'):JSON.stringify([ref?.contract,ref?.hash,ref?.rulesVersion,mismatch]);
      if(key===sceneKey&&(sceneSettled||now<sceneRetryAt))return sceneSettled;
      const request=++sceneRequest;sceneKey=key;sceneRetryAt=Infinity;sceneSettled=false;initialGate?.cancel();setInitialProgress({generation:initialGeneration,stage:'waiting',required:0,completed:0,failed:[],bytesLoaded:0,bytesTotal:null});
      staticBatches.reset();batchGeometry=null;batchRevision=-1;entityBatches.reset();entityBatchRevision=-1;
      speechVisibility.reset();
      resetSocialDraw();
      clearSocialPaths();
      clearConnectedDressing();
      sceneHistory.cancel();planting?.dispose();planting=null;plantingFailed=false;clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=null;expansionSceneInfo=null;people?.dispose();people=null;applied=null;floaters.sync(new Map());kin.place([]);standIns.clear();
      for(const label of labels.values()){labelScene.remove(label.obj);label.obj.element.remove();}labels.clear();
      clearExpansion();geometry.dispose();geometry=new WorldGeometry(null);scene.add(geometry.group);base=null;nativeBoat=undefined;light.setCommonsReadability(false);
      capturedPlatforms=null;
      platformDraw.set([],0,false);
      shown.current={tick:0,datetime:null,take:null,entities:{}};drawnTick.current=null;
      renderer.domElement.dataset.sceneHash='';renderer.domElement.dataset.sceneBinding='loading';sceneryStatus('Loading the scenery for this recording.');
      const active=()=>!abort.signal.aborted&&request===sceneRequest;
      if(reference===undefined){
        const pending=history?Promise.resolve(parseSceneInfo(null)):currentLayout();
        void pending.then(info=>{if(!active())return;installScene(info);sceneryStatus(history?'This recording does not identify its scenery; showing people on plain ground.':null);renderer.domElement.dataset.sceneBinding=history?'unbound-history':'current-unbound';}).catch(()=>{if(active())failLayout('The world layout could not be loaded. Retry to try again.');});
      }else if(mismatch){failLayout('The scenery reference does not match this recording.');}
      else void sceneHistory.resolve(reference).then(result=>{
        if(!active())return;
        if(result.status==='bound'){
          const bind=(kit:OldSceneKit|null)=>{if(!active())return;installScene(result.info,result.publication,kit?kit.optionalAppearanceProfilesForVerifiedCapture(result.publication,context.current.sim.conn.welcome?.worldId??'',result.ref):NO_OLD_PROFILES);sceneryStatus(null);renderer.domElement.dataset.sceneHash=result.ref.hash;renderer.domElement.dataset.sceneBinding='bound';};
          // a new world's capture is never one of the old pinned captures the kit dresses: it binds at once, without the kit
          if(newWorld)bind(null);else void loadOldKit().then(bind,()=>{if(active())failLayout('The scenery for this recording could not be loaded. Retry to try again.');});
        }
        else if(result.status!=='stale'){failLayout(result.reason);}
      });
      return false;
    };

    // selection marker and stand-in figures (used only if the people models fail)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    // C2: name plates hang just outside this ring's drawn outer edge (read from the ring itself, never a separate constant)
    const plateRadius = () => ring.geometry.parameters.outerRadius * ring.scale.x;
    const screenDown = new THREE.Vector3();
    const standInGeometry = new THREE.CapsuleGeometry(0.22, 1.2, 4, 12), standInMaterial = new THREE.MeshStandardMaterial({ color: 0x5d7f9e, roughness: 0.7 });
    const standIns = new THREE.Group(); scene.add(standIns);
    const bodyStandIns = new WorldBodyStandIns(standIns,standInGeometry,standInMaterial);
    const labels = new Map<string, Label>();
    const labelFor = (soul: PublicSoul): Label => {
      let l = labels.get(soul.id);
      if (l) return l;
      const {el, name, line, card} = nameTag(document);
      el.dataset.soulId = soul.id;
      let touched=false;el.addEventListener('pointerdown',e=>{touched=e.pointerType==='touch';},{passive:true});
      el.addEventListener('click', e => { e.stopPropagation(); setPlaceCard(null); context.current.setThing(null); const byTouch=touched;touched=false;if(byTouch&&controlsApi.current?.flyToSoul(soul.id,{chip:true}))return; context.current.onSelect(soul.id); });  // #892: a touch on a name plate follows at once
      el.addEventListener('dblclick', e => {
        e.preventDefault();e.stopPropagation();setPlaceCard(null);context.current.setThing(null);context.current.onSelect(soul.id);
        const point=shown.current.entities[soul.entityId]?.p;
        if(point){navigation?.release();context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');rts.frameSubject(new THREE.Vector3(point[0],point[1]+1,point[2]),1);}
      });
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 0);  // C2: the plate hangs below its anchor under the body
      labelScene.add(obj);
      l = { obj, head: new THREE.Vector3(), name, line, card, offset: {dx:0,dy:0}, text: '' };
      labels.set(soul.id, l);
      return l;
    };

    const initialMotionHistory=new WorldMotionHistory(fetchChunks,abort.signal);
    const motionOwner=()=>JSON.stringify([context.current.sim.conn.welcome?.worldId,context.current.sim.conn.welcome?.epoch]);
    let liveArr: unknown = null, liveKey = '', live: Chunk[] = [], liveTick: number | null = null;
    const spot = new THREE.Vector3();
    const gaitContinuity=new RecordedGaitContinuity();
    let applied: Chunk | null = null, records: Record<string, Entity> = {}, frame = 0, last = performance.now(), labelAt = 0, brokenTake: string | null = null, frameGap = false;
    const liveChunks = () => {
      const t = takesOf(context.current.sim);
      const arr = t?.chunks ?? null, key = `${arr?.length ?? 0}:${(arr?.at(-1) as { toTick?: number } | undefined)?.toTick ?? ''}`;
      if (arr !== liveArr || key !== liveKey) { liveArr = arr; liveKey = key; live = validChunks(arr).filter((c) => c.fromTick <= (t?.serverTick ?? Infinity)); } // a restarted server starts its ticks again
      return live;
    };
    const goLive = () => { past.current = null; liveTick = null; setMode('live'); setNote(null); };

    const pacer = new FramePacer();
    const eyes=WorldEyes.fromSearch(location.search,{renderer,camera,scene,body:id=>people?.bodyObject(id)??floaters.object(id)??standIns.getObjectByName(id)??null,souls:()=>[...context.current.sim.conn.replica.souls.values()].map(x=>x.entityId),overlays:()=>[speechLayer.group,ring,fading.group,hover.marker],tick:()=>shown.current.tick,ready:()=>sceneSettled&&drawnTick.current!==null});
    const officeGuardFrom=new THREE.Vector3(),authoredBoundaries=new WorldAuthoredBoundaries();
    let shadowFrame=0;  // P1 phones
    const fixtureInstances=new EngineFixtureInstances(entityLayer.motionInstancer);
    let posterFrames=0,programsPending=false,warmLayer=0,arrivedOnce=false,earlyPending=0,buildingFrameAt=-Infinity,layerStarted=false,afterNextDraw:(()=>void)|null=null;  // afterNextDraw: ?shot waits for a frame drawn after the build  // lane W1: the built world's shaders are still linking in parallel: no frame yet
    const compileInitialPrograms=async()=>{
      const owner=newWorld?captureTexturePreparation():null;
      const active=()=>!abort.signal.aborted&&(!newWorld||(owner?.renderer===renderer&&captureTexturePreparation()===owner));
      await new Promise<void>(r=>setTimeout(r,0));  // traversal gets its own task, separate from the warm frame
      if(!active())return;
      await compileSceneAsync(renderer,scene,camera,3000,owner?.abort.signal??abort.signal);
      if(owner&&active())await warmReadyProgramMetadata(renderer,active,owner.abort.signal);
    };
    const animate = () => {
      officeGuardFrom.copy(camera.position);
      if (abort.signal.aborted) return;
      frame = eyes && !entityLayer.building ? eyes.schedule(animate, cb => pacer.next(cb)) : pacer.next(animate);  // eyes: render on demand (builds keep their pace)
      // lane W1: while a new world's first build runs in slices nothing is drawn: look at the takes 4 times a second, no more
      if(entityLayer.building){const t=performance.now();if(t-buildingFrameAt<250)return;buildingFrameAt=t;}
      if(eyes&&!eyes.wake(performance.now()))return;  // VF1b: a slow frame leaves room for socket messages
      const now = performance.now(), step = Math.min(0.1, (now - last) / 1000);
      last = now;
      const rigBudget={remaining:1};  // one shared cap for this animate, including any repeated people updates
      const s = context.current.sim, dt = dtOf(s), liveList = liveChunks();
      let chunks: Chunk[], tick: number;
      const p = past.current;
      if (p) {
        const end = p.chunks.at(-1)!;
        if (p.playing) p.tick = Math.min(end.toTick, p.tick + step / dt); // replays run at the world's normal speed
        // A paused recent seek remains history. Playing history catches the actual
        // delayed live moment, not merely the oldest buffered chunk boundary.
        const liveHead = serverNow(s);
        if (p.playing && liveList.length && liveHead !== null &&
          p.tick >= Math.max(liveList[0].fromTick, liveHead - LIVE_DELAY)) { goLive(); return; }
        if (p.playing && !p.extending && !p.ended && now > p.retryAt && p.tick > end.toTick - 20 / dt) {
          p.extending = true;
          void fetchChunks(end.toTick, end.toTick + 60 / dt, 60, abort.signal).then((got) => {
            if (past.current !== p) return;
            const before = p.chunks.at(-1)!.toTick;
            p.chunks = mergeWindow(p.chunks, got, p.tick);
            if (p.chunks.at(-1)!.toTick <= before) p.ended = true;
          }).catch(() => { p.retryAt = performance.now() + 5000; }).finally(() => { p.extending = false; });
        }
        if (p.ended && p.tick >= end.toTick && p.playing) {
          const at = serverNow(s);
          if (at !== null && at - end.toTick < 120 / dt) { goLive(); return; } // only the last moments are missing: they are live
          p.playing = false;
          setNote('This is the end of what was recorded here. Go back to live to continue.');
        }
        chunks = p.chunks; tick = p.tick;
      } else {
        chunks = liveList;
        const target = (serverNow(s) ?? chunks.at(-1)?.toTick ?? 0) - LIVE_DELAY;
        if (liveTick === null || Math.abs(target - liveTick) > 80) liveTick = target;
        else liveTick += step * tpsOf(s) + (target - liveTick) * Math.min(1, step * 1.5); // run at the clock rate, drift gently toward the server
        if (chunks.length) liveTick = Math.max(chunks[0].fromTick, Math.min(chunks.at(-1)!.toTick, liveTick));
        tick = liveTick;
      }

      if(initialMotionHistory&&!past.current&&initialMotionHistory.loading)void initialMotionHistory.start(liveList,serverNow(s)??liveList.at(-1)?.toTick??0,LIVE_DELAY,motionOwner(),motionOwner);
      const candidate = initialMotionHistory?.loading&&!past.current ? null : chunkAt(chunks, tick);
      // the people renderer: at once on desktops and old worlds (no frame until it is here), after the arrival on a phone's
      // new world (WorldLightPeople until then); a failed fetch is retried every 5 s
      if(!peopleKit&&(!peopleLater||arrivalOver())&&now>=peopleKitRetryAt){peopleKitRetryAt=now+5000;void loadPeopleKit().catch(()=>{});}
      const pick = candidate && ensureScene(candidate.chunk,!!past.current,now) && (peopleKit!==null||peopleLater) ? candidate : null;
      frameGap = !!pick && !pick.exact;
      if(!pick||past.current||!pick.exact||!entityLayer.active||people instanceof WorldLightPeople){
        entityLayer.clearSupplementalStairs();
        if(people&&!(people instanceof WorldLightPeople))people.setSupplementalStairs([]);
      }
      if (pick) {
        const chunk = pick.chunk, take = chunk.take;
        const depictedTick = recordingTick(chunk, tick);
        const motionHistory=!past.current&&initialMotionHistory?initialMotionHistory.history(chunks,chunk,depictedTick):chunks;
        try {
          if(people instanceof WorldLightPeople&&peopleKit){scene.remove(people.group);people.dispose();people=null;applied=null;}  // the renderer has loaded: the same take, drawn
          if (!people) {
            people = peopleKit ? new peopleKit.TakePeople(take, { scene: base ?? undefined,nativeBoat,commonsContrast:geometry.hasAuthoredCommons,humanPresets:humanPresets&&geometry.hasAuthoredCommons }) : new WorldLightPeople(take);
            people.setTemplates(templates);
            people.setBodyTemplates(bodyModels.templates);
            scene.add(people.group);
          }
          if (chunk !== applied) {
            const kit=publication?oldKit:null;
            if(!restMarkers&&kit){const choice=kit.publishedRestSelection(context.current.sim.conn.welcome?.worldId??'',(take as Take&{renderSceneRef?:unknown}).renderSceneRef);if(choice){restMarkers=kit.createPublishedRestMarkers(publication,take,choice,{enabled:true});if(restMarkers)scene.add(restMarkers.group);}}
            restMarkers?.setTake(take);
            if(!newcomerMarkers&&!newcomerMarkersFailed&&kit){const choice=kit.publishedNewcomerSelection(context.current.sim.conn.welcome?.worldId??'',(take as Take&{renderSceneRef?:unknown}).renderSceneRef);if(choice)try{newcomerMarkers=kit.createPublishedNewcomerMarkers(publication,take,choice,{enabled:true});if(newcomerMarkers)scene.add(newcomerMarkers.group);}catch{newcomerMarkersFailed=true;problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}}
            if(newcomerMarkers)try{newcomerMarkers.setTake(take);}catch{clearNewcomerMarkers();newcomerMarkersFailed=true;problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}
            if(!planting&&!plantingFailed&&kit&&appearanceProfiles.understory){
              let createPlanting:OldSceneKit['createCurrentProvisionsUnderstory']|undefined;
              try{if(kit.inspectCurrentProvisionsUnderstory(publication,take,{enabled:true}))createPlanting=kit.createCurrentProvisionsUnderstory;else if(kit.inspectLiveKitchenUnderstory(publication,take,{enabled:true}))createPlanting=kit.createLiveKitchenUnderstory;else if(kit.inspectLiveFoodShoreUnderstory(publication,take,{enabled:true}))createPlanting=kit.createLiveFoodShoreUnderstory;else if(kit.inspectLiveSocialUnderstory(publication,take,{enabled:true}))createPlanting=kit.createLiveSocialUnderstory;else if(kit.inspectLiveFoodBUnderstory(publication,take,{enabled:true}))createPlanting=kit.createLiveFoodBUnderstory;}catch{}
              if(createPlanting)try{planting=createPlanting(publication,take,{enabled:true});if(planting)scene.add(planting.group);}catch{plantingFailed=true;problem('Some planting could not be shown; keeping the original scenery.');}
            }
            if(planting)try{planting.setTake(take);}catch{const failed=planting;planting=null;plantingFailed=true;try{failed.dispose();}catch{}problem('Some planting could not be shown; keeping the original scenery.');}
            // Eligibility reserves the whole recorded chunk; never rehash it per display frame.
            if(kit&&!connectedDressingFailed&&appearanceProfiles.understory){
              if(!connectedDressing)try{connectedDressing=kit.createCurrentSocialDressingOwner(publication,take,true);if(connectedDressing)scene.add(connectedDressing.group);}catch{connectedDressingFailed=true;}
              else try{connectedDressing.setTake(take);}catch{clearConnectedDressing();connectedDressingFailed=true;}
            }
            people.setTake(take,gaitContinuity.offsets(chunks,chunk));
            records = { ...(take.entities0 as Record<string, Entity> | undefined), ...take.finalState.entities };
            applied = chunk;
            geometry.markRegions(take.finalState.regions);
            if (!framing.framed) { // no layout: frame whatever the world has in it
              const box = new THREE.Box3();
              for (const e of Object.values(take.finalState.entities)) box.expandByPoint(new THREE.Vector3(...e.pose.p));
              if (!box.isEmpty()) overview([box.min.x - 4, box.min.z - 4, box.max.x + 4, box.max.z + 4]);
            }
          }
          const local = Math.max(0, Math.min(take.ticks, depictedTick - take.startTick));
          // A historical/nearest frame never borrows the current God layer's stair metadata.
          // TakePeople additionally verifies each selected native fixture's exact identity and pose.
          if(!(people instanceof WorldLightPeople)){
            if(!past.current&&pick.exact&&entityLayer.active){
              // serverNow is absolute native ticks: serverTick + seconds * ticks/second.
              // Its first observation cannot certify an already-started take.
              people.setSupplementalStairs(entityLayer.supplementalStairs(s.edge??[],serverNow(s)),{liveTakeId:take.id});
            }else{entityLayer.clearSupplementalStairs();people.setSupplementalStairs([]);}
          }
          people.setWaterHistory(motionHistory.map(c=>c.take));
          const floors=capturedPlatforms??(!past.current&&currentPlatforms&&currentPlatforms.worldId===s.conn.welcome?.worldId?currentPlatforms.platforms:[]);
          platformDraw.set(floors,base?.levels.find(l=>l.id===0)?.y??0,!!expansion&&!past.current);
          people.setPlatformFloors(floors,base?.levels.find(l=>l.id===0)?.y??0);
          if(locationRegions!==take.finalState.regions){locationRegions=take.finalState.regions;depictedLocations=depictedWorldLocations(take.finalState.regions,base?.levels??[],(x,z,y)=>platformFloorOffset(floors,x,z,y,base?.levels.find(l=>l.id===0)?.y??0));}
          const beat=worldDepictionBeat(context.current.depictionBeatAt,s.conn.welcome?.worldId,take,depictedTick,past.current?'history':'live',pick.exact);
          if(!eyes&&!shotMode){camera.updateMatrixWorld();bodyViewer.frustum.setFromProjectionMatrix(bodyViewerM.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));bodyViewer.eye.copy(camera.position);people.setViewer(bodyViewer);entityLayer.viewer=bodyViewer;viewerLive=true;}else{people.setViewer(null);entityLayer.viewer=null;viewerLive=false;}  // PERF-EDEN: far / off-screen bodies are posed at a lower rate
          const sampled = people.show(local * take.dt, depictedTick * dt,beat,(depictedTick - take.startTick) * take.dt,!eyes&&!shotMode?rigBudget:undefined);
          games.update(sampled.entities,depictedTick);entityLayer.setJuggled(games.juggledSets);
          bodyModels.sync(records,sampled.entities);
          const sampledFloaters=new Map(Object.entries(sampled.entities).flatMap(([id,e])=>{const body=recordedBody(records[id]?.body,e.state);if(body?.family!=='floater')return [];const url=admittedBodyUrl(body.modelUrl,apiPath('').replace(/\/$/,''));return [[id,{...body,...(url?{modelUrl:url}:{})} as NonNullable<Entity['body']>]] as [string,NonNullable<Entity['body']>][];}));
          floaters.sync(sampledFloaters);
          if(initialGate&&!initialSnapshot){const gate=initialGate;initialSnapshot=true;const initialRecords=structuredClone(records),initialEntities=structuredClone(sampled.entities),floaterIds=[...sampledFloaters.keys()];initialBodyIds=Object.keys(initialEntities).filter(id=>initialRecords[id]?.kind==='human');if(peopleByView){peopleLater=!anyPersonInView(camera,initialBodyIds.map(id=>initialEntities[id]!.p));arrivalMark(peopleLater?'people-later':'people-wait');if(!peopleLater){bodyModels.held=false;startTemplates();}}const names=new Set<string>();for(const [id,e]of Object.entries(initialEntities)){if(initialRecords[id]?.kind!=='human')continue;const body=recordedBody(initialRecords[id]?.body,e.state);if(body?.family==='floater'||body?.modelUrl)continue;names.add(templateNameFor(id,PEOPLE));}if(!peopleLater){for(const name of names)gate.require('Person '+name,()=>requireTemplate(name));gate.require('Initial Soul bodies',()=>bodyModels.readyInitial(initialRecords,initialEntities));}if(floaterIds.length)gate.require('Initial ceramic bodies',async()=>{floaters.retryInitial(floaterIds);await floaters.readyInitial(floaterIds);});gate.seal();}

          if(publication&&oldKit)nativeSocialDraw??=new oldKit.WorldNativeSocialDraw();
          if(nativeSocialDraw)nativeSocialDraw.update(people,publication,take,records,sampled,appearanceProfiles.nativeSocial);else people.setFixtureDrawReplacement(null);
          geometry?.setRecordedFixtures(sampled.entities,records);
          geometry?.setViewTime(depictedTick*take.dt);
          const expansionWanted=edenExpansionCapture(!!context.current.edenExpansion,s.conn.welcome?.worldId,expansionSceneInfo,publication,!!past.current);expansionWantedNow=expansionWanted;
          if(!expansionWanted&&expansion)clearExpansion();
          if(expansionWanted&&!expansion&&!expansionFailed&&!oldEden)void loadOldEden().catch(()=>{expansionFailed=true;problem('Some new Eden scenery could not be shown.');});
          if(expansionWanted&&!expansion&&!expansionFailed&&oldEden)try{expansion=oldEden.createWorldEdenExpansion(officeGuardsFromPublication(publication,depictedTick),expansionSceneInfo??undefined);scene.add(expansion.group);try{houseWindows=oldEden.createEdenHouseWindows();if(houseWindows)expansion.group.add(houseWindows.group);}catch{houseWindows=null;}expansion.replaceCosmeticBackdrop(geometry.group);light.fit([-100,-65,105,85]);expansion.warmUp(renderer,camera,scene);}catch{expansionFailed=true;problem('Some new Eden scenery could not be shown.');}
          expansion?.sync(sampled.entities,!!past.current,depictedTick*take.dt);
          expansion?.setLocalPresentation(context.current.localClassroomPresentation,s.conn.welcome?.worldId??'',Object.hasOwn(sampled.entities,'eden-classroom-screen-1')&&records['eden-classroom-screen-1']?.kind==='fixture'&&records['eden-classroom-screen-1']?.def==='standing-display',!!past.current);
          floaters.update(sampled.entities, take.startTick + sampled.tick, take.dt); // absolute tick: the bob is replay-stable
          kin.update(depictedTick, dt);
          // stand-ins if the people models never arrived
          {
            const seen = new Set<string>();
            for (const [id, e] of Object.entries(sampled.entities)) {
              const rec = records[id];
              const body=recordedBody(rec?.body,e.state);
              if(rec?.kind!=='human'||body?.family==='floater')continue;
              seen.add(id);
              bodyStandIns.sync(id,e.p,people.bodyObject(id),{
                unresolved:bodyModels.unresolved.has(id),
                customReady:!!body?.model&&bodyModels.templates.has(body.model),
                uploaded:!!body?.modelUrl,
                legacyReady:templates.some(t=>t.name===templateNameFor(id,PEOPLE)),
              });
            }
            bodyStandIns.finish(seen);
          }
          // world clock at the moment shown (the sim's clock, moved back by how far behind it we are)
          // a world's `time.calendar` (MM-DD) dates its sky: the sun's path and the dusk follow that season, the hour stays the clock's
          const clock = calendarClock(take.finalState.env?.datetime ?? null, entityWorldState(entityLayer));
          const ref = take.startTick + take.ticks;
          const clockOffset=(depictedTick-ref)*(dayTicks?86400/dayTicks:dt);
          const datetime = clock ? shiftIso(clock, clockOffset) : null;
          light.update(shotClockAt(clock?shiftIso(clock,clockOffset,true):null,shotHour??visitorPreviewHour()));
          entityLayer.sites.setWorldClock(datetime,dayTicks?86400/(dayTicks*dt):1);
          // Soul Actions entry 38: posters age by the world day shown (redrawn only when that day changes); #430 chalk fades by it too
          if(dayTicks&&dayOrigin!==null&&setPosterDay(Math.floor(Math.max(0,depictedTick-dayOrigin)/dayTicks))){entityLayer.redrawTagged('posters');entityLayer.redrawTagged('fades');}
          const godLit=!!godLiving&&entityLayer.active;light.setNightLighting(!!expansion||godLit);if(!godLit)setNightLightStrength(expansion?light.daylight:1);houseWindows?.setNight(nightLightStrength());
          shown.current = { tick: depictedTick, datetime, take, entities: sampled.entities };
          brokenTake = null;
        } catch (e) {
          entityLayer.clearSupplementalStairs();
          if(people&&!(people instanceof WorldLightPeople))people.setSupplementalStairs([]);
          if (brokenTake !== take.id) { brokenTake = take.id; console.warn('live view: a recorded moment could not be drawn', e); }
        }
      }

      // names over Souls, the selection ring, follow
      const { selected: soulId, thing: thingId, follow: following, cameraMode: viewing } = context.current;
      if(following||soulId&&!groupSelection.has(soulId))groupSelection.clear();
      if (viewing !== previousCameraMode) { broadcast.reset(); previousCameraMode = viewing; renderer.domElement.dataset.cameraShot=''; }
      renderer.domElement.dataset.cameraMode = viewing;
      const souls = [...s.conn.replica.souls.values()];
      const refresh = now - labelAt > 250;
      if (refresh) labelAt = now;
      if(refresh)balloonRide.ingest(((context.current.sim as unknown as {edge?:readonly EdgeSpectatorMessage[]}).edge??[]));
      const ridePreview=rideOverride&&!past.current?(()=>{const st=previewState((performance.now()-rideStart)/1000,rideOverride.speed),ids=rideOverride.names.flatMap(n=>{const soul=souls.find(x=>x.name.toLowerCase()===n);return soul?[soul.id]:[];});return {riders:ids.slice(0,st.aboard),phase:st.phase,flight:st.flight};})():null;
      // Riders stand in the basket for labels, speech, camera and drawing (presentation only; the recording is untouched).
      const at = balloonRide.update(shown.current,{dt,seconds:atmosphereSeconds,eden:!!expansion,history:!!past.current,soulEntity:id=>s.conn.replica.souls.get(id)?.entityId??null,preview:ridePreview});
      if (entityLayer.active && !expansion) entityLayer.transportPoses(at.entities, souls.map(soul => soul.entityId));
      // E-life B7: a god's balloon flies with its native ride (the recorded carrier entity of the same name)
      rideCarriers=expansion?[{p:balloonRide.basket.p,yaw:balloonRide.basket.yaw}]:[];  // V1: Broadcast frames a rider with its carrier
      if(entityLayer.active&&!expansion){if(refresh||!rideNames||(!rideNames.length&&performance.now()-rideNamesAt>2000)){rideNames=entityLayer.rideNames();rideNamesAt=performance.now();}/* BALLOON-BODY: an empty list (asked before the world's things arrived) is asked again */for(const n of rideNames){const e=at.entities[n] as {p?:readonly[number,number,number];yaw?:number}|undefined;entityLayer.poseOverride(n,e?.p??null,e?.yaw);if(e?.p)rideCarriers.push({p:e.p,yaw:e.yaw??0});}}
      // D1: every native carrier is a ride (a god's ferris wheel or carousel, Eden's punt), not only balloons: framed with its
      // rider, and a god attraction's carrier gets a car drawn at its twin (the wheel itself and its gondola clock stay as built)
      if(refresh){carrierIds=recordedCarriers(records);rideCars=entityLayer.active&&!expansion?entityLayer.rideCars():[];}
      {const framed=new Set<string>([...(expansion?['eden-balloon']:[]),...(entityLayer.active&&!expansion?rideNames??[]:[])]),more=carrierPoses([...new Set([...carrierIds,...rideCars])],at.entities as Record<string,{p?:readonly number[];yaw?:number}|undefined>,framed);
       rideCarriers.push(...more);const cars=new Set(rideCars);rideCarsDrawn.update(more.filter(c=>cars.has(c.id)));}
      const cards = refresh ? cardsAt(s.plays, at.tick) : null;
      const alive = new Set<string>();
      let focus: THREE.Vector3 | null = null;
      screenDown.setFromMatrixColumn(camera.matrixWorld, 1).negate();
      const ringR = plateRadius(), eye = camera.position, down = {x: screenDown.x, z: screenDown.z};
      for (const soul of souls) {
        const pos = at.entities[soul.entityId]?.p, rec = records[soul.entityId];
        if (!pos || fadedOut.has(soul.id)) continue;   // DLG1: a faded (absent) Soul has no name tag or speech anchor
        alive.add(soul.id);
        const drawnBody=recordedBody(rec?.body,at.entities[soul.entityId]?.state??{});
        const lift = drawnBody?.family === 'floater' ? (() => { const b = floaterBody(drawnBody); return b.hoverHeight + b.radius + 0.15; })() : 2.05;
        if(refresh&&!eyes&&!soul.profilePhoto)portraits.capture(soul.id,JSON.stringify([drawnBody,soul.entityId]),people?.bodyObject(soul.entityId)??floaters.object(soul.entityId)??standIns.getObjectByName(soul.entityId)??null,drawnBody?.family==='floater',now);
        const l = labelFor(soul);
        l.head.set(pos[0], pos[1] + lift, pos[2]);
        const plate = plateAnchor(pos, eye, down, ringR);  // ground point (lying sleepers too), at the ring's near edge
        l.obj.position.set(plate[0], markHeight(waterDetail.regions, plate[0], plate[1], plate[2]) + 0.03, plate[2]);
        l.obj.visible = true;
        if (cards) {
          const activity = at.entities[soul.entityId]?.activity;
          const away = past.current ? null : bodyLabel(soul.body);   // LINK: "Asleep" / "Zombie" over a body whose agent is away
          const doing = past.current ? activityWords(activity,soul.id) : away ?? doingText(soul.doing,activity,soul.id);
          const card = cardText(cards.get(soul.id));
          const text = `${soul.name}|${doing}|${card}|${soul.id === soulId||groupSelection.has(soul.id)}`;
          if (text !== l.text) {
            l.text = text; l.name.textContent = soul.name; l.line.textContent = clip(doing, 48); l.card.textContent = clip(card, 48);
            l.line.style.display = doing && (soul.id===soulId||!!away) ? '' : 'none'; l.card.style.display = card && soul.id===soulId ? '' : 'none';
            (l.obj.element as HTMLElement).style.outline = soul.id === soulId||groupSelection.has(soul.id) ? '2px solid #ffd34d' : 'none';
          }
        }
        if (soul.id === soulId) focus = spot.set(pos[0], pos[1], pos[2]);
      }
      // W4: who can hear each recent line (spectators see all channels).
      if(refresh){const now=Date.now(),recent=past.current?[]:context.current.sim.talk.filter(t=>now-t.at<20000);
        // Prefer Core's edge spectator feed (exact channels) when the client provides it; else legacy talk lines.
        const edgeFeed=((context.current.sim as unknown as {edge?:readonly EdgeSpectatorMessage[]}).edge??[]).filter(m=>now-m.at<120000);
        const posOf=(soulId:string)=>{const id=s.conn.replica.souls.get(soulId)?.entityId,p=id?at.entities[id]?.p:null;return p?[p[0],p[1],p[2]] as const:null;};
        speeches=past.current?[]:edgeFeed.length?speechFromEdge(edgeFeed,posOf).filter(sp=>now-sp.at<20000):recent.map(t=>speechFromTalk(t,posOf(t.from)));
        attentionTargets=new Map([...s.conn.replica.souls.keys()].map(id=>[id,conversationAttention(id,speeches,now)]));
        if(edgeFeed.length&&!fadeOverride.size){const wallToPerf=performance.now()-now,states=fadingFromEdge(edgeFeed,a=>a+wallToPerf);fading.setStates(states);fadedOut=past.current?new Set():beamedOut(states,performance.now());}
        const nameOf=(id:string)=>s.conn.replica.souls.get(id)?.name??'someone',latest=new Map<string,SpectatorSpeech>();
        for(const sp of speeches)if(now-sp.at<8000&&(!latest.get(sp.speaker)||latest.get(sp.speaker)!.at<sp.at))latest.set(sp.speaker,sp);
        for(const [id,l] of labels){
          // DLG2: in dock mode the dialogue dock carries the words and who can hear; the tag only gets a small speaking dot.
          paintSpeakingDot(l.obj.element as HTMLElement,id,context.current.publishSpeechAnchors,performance.now(),camera.position.distanceTo(l.head));
          const chip=l.obj.element.querySelector('[data-channel-chip]') as HTMLElement|null;if(!chip)continue;const sp=latest.get(id);
          if(!sp||context.current.publishSpeechAnchors){chip.style.display='none';continue;}const c=channelChip(sp,nameOf);chip.textContent=c.text;chip.style.color=c.colour;chip.style.display='';}}
      speechLayer.update(speeches,Date.now(),soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId,e=id?at.entities[id]:null;if(!id||!e)return null;const body=recordedBody(records[id]?.body,e.state),b=body?.family==='floater'?floaterBody(body):null;return speechHead.set(e.p[0],e.p[1]+(b?b.hoverHeight+b.radius+.05:1.95),e.p[2]).clone();});
      for (const [id, l] of labels) if (!alive.has(id)) { l.obj.visible = false; if (!s.conn.replica.souls.has(id)) { labelScene.remove(l.obj); l.obj.element.remove(); labels.delete(id); } }
      if (!focus && thingId) {
        const q = thingId.startsWith('kin:') ? kin.view.object(thingId)?.position.toArray() : at.entities[thingId]?.p;
        if (q) focus = spot.set(q[0], q[1], q[2]);
      }
      ring.visible = !!focus;
      if (!following) {followed = null;followView.reset();followMotion.reset();followTick=null;followEpoch=null;}
      if (focus) {
        ring.position.set(focus.x, markHeight(waterDetail.regions, focus.x, thingId?.startsWith('kin:') ? 0 : focus.y, focus.z) + 0.03, focus.z);  // on the water around a swimmer
        if (following) {
          const target = new THREE.Vector3(focus.x, (thingId?.startsWith('kin:') ? 0 : focus.y) + 1, focus.z);
          const offset = camera.position.clone().sub(controls.target);
          const focusId = soulId ?? thingId;
          const epoch=JSON.stringify([s.conn.welcome?.worldId,s.conn.welcome?.epoch,sceneKey,!!past.current]);
          const discontinuity=followTick!==null&&(at.tick<followTick||Math.abs(at.tick-followTick)*dt>1);
          if (followed !== focusId||followEpoch!==epoch||discontinuity) {
            followView.reset();if(offset.length()>12)offset.setLength(12);
            // Explicit selection/seek/scene changes frame the chosen moment.
            // Continuous movement thereafter retains separate position/aim lag.
            followMotion.reset(target.toArray(),target.toArray());controls.target.copy(target);camera.position.copy(target).add(offset);
          }
          followed = focusId;
          followTick=at.tick;followEpoch=epoch;
          const tracked=followMotion.sample(target.toArray(),target.toArray(),step);
          if(tracked){
            camera.position.add(new THREE.Vector3(...tracked.translation));controls.target.fromArray(tracked.aim);
            followView.shiftFrame(new THREE.Vector3(...tracked.offsetTranslation));
          }
        }
      }
      if(viewing==='follow' && at.take && !focus&&initialGate?.snapshot().stage==='ready'){navigation?.release();context.current.setCameraMode('manual');followed=null;}
      if(arrivalPending&&s.conn.welcome&&(s.conn.replica.souls.size||(arrivalWelcome??=now)<now-4000)){const framed=arrivalPending;arrivalPending=null;if(!s.conn.replica.souls.size&&context.current.cameraMode==='broadcast'){controls.target.fromArray(framed.target);camera.position.fromArray(framed.eye);camera.lookAt(controls.target);context.current.cameraMode='manual';context.current.setCameraMode('manual');autoFrame='pending';}}
      if(autoFrame&&context.current.cameraMode!=='manual')autoFrame=null;
      else if(autoFrame==='pending')autoFrame={eye:camera.position.clone(),target:controls.target.clone()};
      else if(autoFrame&&(autoFrame.eye.distanceToSquared(camera.position)>0.0025||autoFrame.target.distanceToSquared(controls.target)>0.0025))autoFrame=null;
      // lane W1: a new world's arrival card covers the view until its first complete frame: no full frames before that,
      // nor the per-frame work only a drawn frame needs (motion, atmosphere, labels): each costs the page 50-150 ms while
      // the socket's join set and the preparation wait for the main thread (also before the first take has opened the
      // initial gate). Only the page's first arrival: once a frame has been shown, later scene changes draw as before.
      const arrivalStage=newWorld&&(entityLayer.active||entityLayer.building)&&!arrivedOnce?(entityLayer.building?'building':initialGate?.snapshot().stage??'waiting'):undefined;
      if(arrivalStage==='first-frame'||arrivalStage==='ready'||arrivalStage==='failed'||arrivalStage==='cancelled')arrivedOnce=true;
      // P7 lever D (phone, new world): the near world is built and its programs linked: draw it now and lift the card after
      // that frame, without the socket's first data (the take's scene, people and the initial gate follow when it comes)
      if(earlyWanted&&!arrivedOnce&&layerStarted&&entityLayer.active&&!entityLayer.building&&!programsPending){arrivedOnce=true;earlyPending=2;earlyArrival.reveal();}
      if(bodyModels.held&&arrivalOver()){bodyModels.held=false;startTemplates();}  // P1 phones: the people stream in now
      if(newWorld&&!templatesStarted&&!bodyModels.held&&(arrivedOnce||layerStarted&&!entityLayer.active)){startTemplates();}
      // (never for ?shot pictures or a Soul's eyes: those tools time their own frames)
      const holdDraw=!shotMode&&!eyes&&(programsPending||(arrivalStage!==undefined&&!arrivedOnce)),warmFrame=warmLayer===1;
      {const still=quality.freezeStill&&!eyes&&!shotMode;entityLayer.interiorFrom=still&&quality.tier==='phone'?camera.position:null;entityLayer.freezeSettled=still;}  // P1 phones: far buildings' furniture is not drawn; PERF-EDEN: still things freeze and cull on every tier
      entityLayer.applyEdge(context.current.sim.edge??[],shown.current?.tick??-Infinity);if(!holdDraw||warmFrame){entityLayer.streamFrom(camera.position);entityLayer.itemPoses(shown.current.entities);entityLayer.update(step,now,geometry.group);}
      // PERF-LOAD: the built layer's first update runs under the card and its programs (scatter and kit pools, creatures,
      // atmosphere: ~0.3 s of links on the first drawn frame) link in parallel before any frame draws them
      if(warmLayer===2){warmLayer=0;const done=()=>{programsPending=false;arrivalMark('programs-linked');};void compileInitialPrograms().then(done,done);}else if(warmLayer===1)warmLayer=2;  // compiled on the next frame, not in the update's task  // no-ops unless this is a new (entity) world
      if(!holdDraw&&shown.current.take)entityLayer.drawHandActuators(shown.current.entities,shown.current.tick,shown.current.take.dt);
      navigation?.update(step);
      rts.update(step);
      hover.update(now);
      if(soulFlight){
        const flight=soulFlight,id=s.conn.replica.souls.get(flight.soulId)?.entityId,q=id?at.entities[id]?.p:null;
        if(!q||context.current.cameraMode!=='manual'||past.current)soulFlight=null;
        else{const wall=performance.now(),pose=flight.step(Math.min(.5,(wall-soulFlightClock)/1000),new THREE.Vector3(q[0],q[1]+1,q[2]));soulFlightClock=wall;  // wall time: a slow frame rate (step is capped at 0.1 s) does not stretch the flight
          controls.target.copy(pose.target);camera.position.copy(pose.eye);camera.lookAt(pose.target);
          if(pose.done){soulFlight=null;if(!soulFlightChip||context.current.selected!==flight.soulId)context.current.onSelect(flight.soulId,soulFlightChip?'chip':undefined);context.current.setThing(null);context.current.cameraMode='follow';context.current.follow=true;context.current.setCameraMode('follow');hapticTick();}}  // #893: Follow starts
      }
      atmosphereSeconds+=step;godLiving?.update(now,light.daylight,!!reducedMotionQuery?.matches||(look.enabled&&shotMode));const godSky=godLiving&&entityLayer.active&&!expansion?godLiving.atmosphere(shown.current?.tick??NaN):forkLand&&!expansion?forkLand.atmosphere():null;  // look pass: a still picture shows patterned lamps at their steady level (repeatable shots)
      if(!holdDraw||warmFrame)try{atmosphere.update({seconds:atmosphereSeconds,dt:step,daylight:light.daylight,camera,eden:(!!expansion||!!godSky)&&!past.current,reducedMotion:!!reducedMotionQuery?.matches,clock:shotClockAt(shown.current?.datetime??adopted?.clock??null,shotHour??visitorPreviewHour()),...(godSky?{profile:'world' as const,weather:godSky.weather,indoors:godSky.indoors}:{})});}catch{}
      try{godLightning?.update(shown.current?.tick??NaN,camera,step,!!reducedMotionQuery?.matches);}catch{}
      if(controls.enabled)controls.update();
      rts.afterControls();  // B2: the head offset over the pivot (controls.update aims at the pivot)
      if(context.current.cameraMode==='follow'&&focus){renderer.domElement.dataset.cameraShot='follow:'+(soulId?s.conn.replica.souls.get(soulId)?.entityId??'':thingId??'');const offset=followView.resolve(controls.target,camera.position.clone().sub(controls.target),visualObstructionRoots(),step);camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);}
      const area = visibleViewport(host.clientWidth, host.clientHeight, context.current.viewportInsets);
      // P7 lever D: an early arrival stays on the near world it drew until the rest is built (a cut to a Soul before that
      // showed hollow ground)
      // P7f: nor before it knows whether Souls live here (a world without them stays on its arrival view; the welcome decides)
      if (context.current.cameraMode === 'broadcast' && !(earlyWanted && entityLayer.filling) && !(arrivalPending && !s.conn.replica.souls.size)) {
        const shot = broadcast.sample(at.entities, records, base, at.tick, dt, area?.aspect ?? camera.aspect, now / 1000, step,visualObstructionRoots());
        if (shot?.pose) {
          camera.position.fromArray(shot.pose.position);
          controls.target.fromArray(shot.pose.target);
          logicalFov = shot.pose.fov;
          camera.lookAt(controls.target);
          renderer.domElement.dataset.cameraShot = shot.shot ?? '';
        }
      }
      refreshCameraGround();
      if(cameraGround.apply(camera,scene)>0&&!(viewing==='manual'&&context.current.manualNavigation==='free'))camera.lookAt(controls.target);  // never underground (Gene)
      if(context.current.cameraMode==='manual'&&expansion?.group.visible)constrainOfficeGuardCamera(camera,controls.target,officeGuardFrom,expansion.officeGuards);
      authoredBoundaries.bind(publication);if(context.current.cameraMode==='manual')authoredBoundaries.constrain(camera,controls.target,officeGuardFrom,at.tick);
      if(shotMode){const pin=shotPin();if(pin){controls.target.fromArray(pin.at);camera.position.fromArray(pin.eye);camera.up.set(0,1,0);camera.lookAt(controls.target);}}  // lookrace: a look's camera is held exactly until the capture
      composeVisibleViewport(camera, host.clientWidth, host.clientHeight, entityLayer.active ? undefined : context.current.viewportInsets, logicalFov);  // new worlds: a centred projection (no inset view offset: it skews the view and moves the pivot off the screen centre)
      if(fadeOverride.size&&!past.current){const states=new Map<string,FadingState>(),now=performance.now();
        for(const soul of s.conn.replica.souls.values()){const v=fadeOverride.get(soul.name.toLowerCase());if(!v)continue;if(!fadeSince.has(soul.id))fadeSince.set(soul.id,now);
          states.set(soul.id,v==='beam'?{idleMinutes:60,beamedAt:fadeSince.get(soul.id)}:v==='reclaim'?{idleMinutes:0,reclaimedAt:fadeSince.get(soul.id)}:{idleMinutes:Number(v)||0});}
        fading.setStates(states);}
      balloonRide.pose(id=>people?.bodyObject(id)??null);
      fading.update(performance.now(),atmosphereSeconds,soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId,p=id?at.entities[id]?.p:null;return p?new THREE.Vector3(p[0],p[1],p[2]):null;},
        // travel keeps the departed Soul's entity (idle fades remove it), so every way a body is drawn must be hidden:
        // a humanoid, a rigid floater (creatures) or the simple stand-in figure
        soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId;return id?people?.bodyObject(id)??floaters.object(id)??standIns.getObjectByName(id)??null:null;});
      // Idle life: breathing, weight shifts, head turns, speaking nods (render-time only).
      idleSouls.length=0;if(!past.current){const nowMs=Date.now();for(const soul of s.conn.replica.souls.values()){const e=at.entities[soul.entityId];if(!e)continue;
        const offscreen=viewerLive&&!bodyViewer.frustum.intersectsSphere(idleSphere.set(idleSphere.center.set(e.p[0],e.p[1]+.9,e.p[2]),1.3));  // PERF-PASSES: no idle offsets for a body outside the view
        idleSouls.push({id:soul.id,root:people?.bodyObject(soul.entityId)??null,p:e.p,yaw:e.yaw??0,activity:String(e.activity??'idle'),speaking:speeches.some(sp=>sp.speaker===soul.id&&nowMs-sp.at<4000),attention:attentionTargets.get(soul.id),offscreen});}}
      if(refresh)idleLife.forget(new Set(idleSouls.map(s=>s.id)));
      idleLife.apply(idleSouls,atmosphereSeconds,step,!!reducedMotionQuery?.matches);
      bodyPoses.apply(idleSouls.map(x=>({...x,body:s.conn.replica.souls.get(x.id)?.body})),atmosphereSeconds,!!reducedMotionQuery?.matches);  // LINK: zombie arms/lurch, floating sleepers
      if(seatSurvey&&!seatSurvey.done&&sceneSettled&&(!initialGate||initialGate.snapshot().stage==='ready')&&(seatSurvey.since??=now)<now-12000){seatSurvey.done=true;try{const seats=findSeats(scene),solids=scene.children.filter(o=>o!==people?.group&&!o.name.startsWith('atmosphere'));(window as unknown as {__simSeatSurvey?:unknown}).__simSeatSurvey=surveySeats(seats,solids,(x,z)=>cameraGround.heightAt(scene,x,z));}catch(e){(window as unknown as {__simSeatSurvey?:unknown}).__simSeatSurvey={error:String(e)};}}  // W8 ?survey=seats
      if(!waterDetailOff)try{waterDetail.update(scene,camera,idleSouls,shown.current.take?shown.current.tick*dt:atmosphereSeconds,light.daylight,undefined,soulId=>{const e=s.conn.replica.souls.get(soulId)?.entityId;return e?floaters.object(e)??standIns.getObjectByName(e)??null:null;});}catch{}  // W11: ripples, glitter, underwater fade (render-time only)
      people?.setSpeaking(new Set(idleSouls.flatMap(x=>{const id=x.speaking?s.conn.replica.souls.get(x.id)?.entityId:undefined;return id?[id]:[];})));  // speakers talk with their hands (library clips)
      placeActivity.update(shown.current.datetime,atmosphereSeconds,light.daylight===null?0:1-light.daylight,!!expansion);
      // Shadow pass: no sub-texel plant stems, no small far casters (render-time only).
      if(expansion){shadowDetail??=new WorldShadowDetail(expansion.group);shadowDetail.apply(camera.position);}
      eyes?.aim();
      expansion?.wallFrames.update(camera,expansion.group.visible&&!past.current);
      // Initial required attachments are prepared together, never per GLB.
      if((!initialGate||initialGate.snapshot().stage==='ready')&&batchEnabled&&(batchGeometry!==geometry||batchRevision!==geometry.staticRenderRevision))void prepareStaticRendering();
      // PERF-BATCH: re-prepare once the layer's revision has been still for 300 ms (things freeze one by one after an
      // arrival or an edit), or after 3 s of continuous change; never while a build is drawing or under the card.
      if(entityBatchEnabled&&entityLayer.active&&!entityLayer.building&&!eyes&&entityLayer.freezeSettled&&entityLayer.staticRevision!==entityBatchRevision){if(entityLayer.staticRevision!==entityBatchSeenRevision){if(entityBatchSeenRevision===entityBatchRevision)entityBatchChangedAt=now;entityBatchSeenRevision=entityLayer.staticRevision;entityBatchStillAt=now;}if(now-entityBatchStillAt>300||now-entityBatchChangedAt>3000)prepareEntityBatches();}
      if(geometry.backdropDetailPending&&(!initialGate||initialGate.snapshot().stage==='ready'))geometry.backdropDetailWhenSettled(loader,now);  // W3: the campus's exact furniture after arrival
      if(look.enabled&&entityLayer.active&&!expansion){if(look.follow)light.follow(controls.target,camera.position);renderer.toneMappingExposure=lookExposure(light.daylight,look.nightExposure);}
      if(adaptive&&entityLayer.active&&!eyes)adaptive.frame(now);const draw=()=>{diagnostics.beginRender(renderer);sunCache?.prepare(renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate);if(!eyes)entityLayer.cull(camera,renderer.domElement.clientHeight,renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate,sunCache?.cullCamera??light.sun.shadow.camera);if(distanceDetail&&!eyes)distanceDetail.apply(scene,camera,renderer.domElement.clientHeight);if(meshLod&&!eyes)meshLod.apply(scene,camera,renderer.domElement.clientHeight);if(farStandIns&&!eyes)farStandIns.apply(scene,camera,renderer.domElement.clientHeight);try{if(!eyes?.render()){if(post&&entityLayer.active)post.render(renderer,scene,camera);else renderer.render(scene,camera);}}finally{farStandIns?.restore();meshLod?.restore();distanceDetail?.restore();entityLayer.uncull();diagnostics.endRender();}};
      if(quality.shadowEvery>1&&!eyes){renderer.shadowMap.autoUpdate=false;if(shadowFrame++%quality.shadowEvery===0)renderer.shadowMap.needsUpdate=true;}  // P1 phones: the shadow map every n-th frame
      if(!waterDetailOff&&!holdDraw)try{waterDetail.applyUnderwater(scene,camera,renderer.domElement);}catch{}  // a camera under the water: gradual fog and tint (restored after the draw)
      if((!holdDraw||warmFrame)&&entityLayer.motionInstancing){fixtureInstances.track(scene);entityLayer.motionInstancer.sync();}  /* PERF-BATCH round 2: moving things and the engine's boats draw as instances */
      if(holdDraw){/* nothing to show yet */}else{
if(entityBatchEnabled&&entityLayer.active&&entityLayer.freezeSettled)entityLayer.decideCuts(camera);if(batchEnabled)staticBatches.withRender(()=>entityBatchEnabled&&entityBatchDraw?entityBatches.withRender(draw,entityLayer.staticRevision):draw());else if(entityBatchEnabled&&entityBatchDraw)entityBatches.withRender(draw,entityLayer.staticRevision);else draw();if(afterNextDraw){const f=afterNextDraw;afterNextDraw=null;f();}if(posterFrames<2&&earlyPosterShown()&&mount.current?.style.visibility==='visible'&&!mount.current.parentElement?.querySelector('.world-initial-loading')&&++posterFrames===2)requestAnimationFrame(removeEarlyPoster);/* P7d: the early renderer's poster goes once two frames of ours are on screen under it */if(earlyPending&&mount.current?.style.visibility==='visible'&&!mount.current.parentElement?.querySelector('.world-initial-loading')&&--earlyPending===0)requestAnimationFrame(()=>{if(!abort.signal.aborted)earlyArrival.mark();});}  // P7 fix: two frames drawn with nothing covering the canvas, then the next frame (the second is on screen) lifts the card
      shadowDetail?.restore();
      waterDetail.restoreUnderwater();
      bodyPoses.restore();
      idleLife.restore();
      fading.restore();
      balloonRide.restore();
      if(!eyes&&!holdDraw)labels2d.render(labelScene,camera);
      // CSS2D owns each projected transform. Read all boxes before writing our
      // separate CSS translation, so packing never changes a body's anchor.
      const hostBox = labels2d.domElement.getBoundingClientRect(), boxes: LabelBox[] = [];
      for (const [id,l] of labels) {
        if (!l.obj.visible || l.obj.element.style.display === 'none') continue;
        const b=l.obj.element.getBoundingClientRect();
        boxes.push({id,x:b.left-hostBox.left-l.offset.dx,y:b.top-hostBox.top-l.offset.dy,width:b.width,height:b.height,selected:id===soulId,previous:l.offset});
      }
      const placements=placeWorldLabels(boxes,area);
      for(const [id,l] of labels) {
        const offset=placements.get(id), el=l.obj.element;
        el.style.visibility=offset?'visible':'hidden';
        if(!offset) continue;
        l.offset=offset; el.style.translate=`${offset.dx}px ${offset.dy}px`;
      }
      // P1: a new world prepares its first frame once its layer is built (layerStarted): before, a gate whose takes and
      // assets were in hand finished while the layer still loaded its snapshot, so the card went, showed bare ground, and came back
      if(initialGate?.attached&&!entityLayer.building&&(!newWorld||layerStarted)&&preparingGeneration!==initialGate.generation){const gate=initialGate;preparingGeneration=gate.generation;const prepared=(async()=>{if(!peopleLater)await people?.appearancesSettled(new Set(initialBodyIds));if(abort.signal.aborted||initialGate!==gate||!gate.attached)return;
        // P1 phones: an old Eden world's town (the expansion, its own lazy chunk) is part of the first frame: wait until it
        // is built, its programs linked and shown (at most 15 s), so the card never goes over the bare hills (live /w/eden
        // on a 4x phone: the town appeared ~1.5 s after the card) and the compile below covers its lights
        if(context.current.edenExpansion){const until=performance.now()+15_000;while(expansionWantedNow!==false&&!expansionFailed&&!past.current&&!expansion?.group.visible&&performance.now()<until){await new Promise(r=>setTimeout(r,100));if(abort.signal.aborted||initialGate!==gate||!gate.attached)return;}}
        await prepareStaticRendering();if(abort.signal.aborted||initialGate!==gate||!gate.attached)return;await compileInitialPrograms();})();void prepared.then(()=>{if(!abort.signal.aborted&&initialGate===gate)gate.preparationComplete(gate.generation);},()=>{if(!abort.signal.aborted&&initialGate===gate)gate.preparationFailed('Rendering preparation');});}
      if (!renderer.getContext().isContextLost()) {if(at.take&&!holdDraw&&initialGate?.snapshot().stage==='first-frame')initialGate.firstFrame(initialGate.generation);drawnTick.current = at.take&&initialGate?.snapshot().stage==='ready' ? at.tick : null;if(drawnTick.current!==null)arrivalMark('first-live-frame');}
      // A paused seek is a discrete displayed moment. Publish its first drawn
      // frame immediately; moving playback retains the existing 250ms cadence.
      const pausedFrameChanged = !!past.current && !past.current.playing &&
        latestViewerState.current?.shownTick !== drawnTick.current;
      // lane W1: the first drawn frame is published at once (the arrival card waits for it), not at the next 250 ms tick
      const firstShown = drawnTick.current !== null && latestViewerState.current?.shownTick == null;
      if (refresh || pausedFrameChanged || firstShown) {
        const points:SpeechAnchorPoint[]=context.current.publishSpeechAnchors?souls.flatMap(soul=>{
          const label=labels.get(soul.id),rec=records[soul.entityId];
          if(!at.take||!at.entities[soul.entityId]||!label?.obj.visible||rec?.kind!=='human')return [];
          const rendered=!!floaters.object(soul.entityId)||!!people?.bodyObject(soul.entityId)||!!standIns.getObjectByName(soul.entityId);
          return [{soulId:soul.id,point:label.head.toArray() as [number,number,number],rendered}];
        }):[];
        let speechAnchors:ReturnType<typeof projectSpeechAnchors>|undefined;
        if(context.current.publishSpeechAnchors&&(!points.length||(initialGate&&(['waiting','downloading','preparing','first-frame'].includes(initialGate.snapshot().stage)||(!arrivalCardDone&&performance.now()<20_000)))))speechAnchors=[];  // F12: none under the arrival card, its ready frame included (that pass held /w/eden's card ~0.15 s at 4x after initial-ready) (the visibility pass cost /w/eden ~0.3 s at 4x before its card). P1: nobody to place: skip the visibility pass over every mesh (~1 ms a frame on Eden 2026)
        else if(context.current.publishSpeechAnchors)try{
          speechVisibility.prepareFresh(visualObstructionRoots());
          // PERF-PASSES: one evaluation for the whole batch: every anchor's score shares one bounds pass over the ~6,000
          // occluders (each score took its own: ~40 ms per refresh on Eden 2026, the p95 frame while orbiting)
          speechAnchors=speechVisibility.evaluate(()=>projectSpeechAnchors(points,camera,host.clientWidth,host.clientHeight,area,p=>speechVisibility.score({position:camera.position.toArray(),target:[...p],fov:camera.fov},['anchor'],{anchor:{p:[...p],yaw:0,points:[[...p]]}})===1));
        }catch{speechAnchors=[];speechVisibility.reset();}
        else speechVisibility.reset();
        emitState(viewerPresentation({room:context.current.edenExpansion?exploreRoom(camera.position.toArray(),EDEN_VIEWER_PLACES,s.conn.replica.souls,at.entities):null,assetDownloads:downloads.snapshot(),soulIds:[...groupSelection],
          drawnTick: drawnTick.current, history: !!past.current, playing: past.current?.playing ?? false,
          cameraMode: viewing, cameraAuto: !!autoFrame&&viewing==='manual',flyingTo:soulFlight?.soulId??null,broadcastSoulId:viewing==='broadcast'&&broadcast.subject?[...s.conn.replica.souls.values()].find(x=>x.entityId===broadcast.subject)?.id??null:null, manualNavigation: context.current.manualNavigation, inputOwned: navigation?.inputOwned ?? false, soulId, entityId: soulId ? s.conn.replica.souls.get(soulId)?.entityId ?? null : thingId,
          loading: initialGate?.snapshot().stage!=='ready'||context.current.loading || (!at.take && renderer.domElement.dataset.sceneBinding!=='unavailable'),
          unavailableReason: context.current.graphicsUnavailable ?? sceneReason ?? (!area ? 'The world view is covered by controls or has no visible area.' : brokenTake ? 'A recorded moment could not be drawn.' : frameGap ? 'No recording covers that moment; displaying the nearest recorded frame.' : !at.take ? 'Waiting for a recorded world frame.' : connectionLost(s.conn) && !past.current ? 'Reconnecting; displaying the last recorded frame.' : null),
          speechAnchors,
        }));
      }

      if(diagnostics.enabled)diagnostics.sample(renderer,now,performance.now()-now,expansion?.wallFrames.inspection()??[],entityLayer.active&&entityBatchEnabled?entityBatches.inspection():batchEnabled?staticBatches.inspection():null);
    };

    // click (not drag) to select a Soul, a thing, or a kin
    const inspectHover=(t:HoverTarget)=>{if(t.kind==='soul'){setPlaceCard(null);context.current.setThing(null);context.current.onSelect(t.id);}else if(t.kind==='object'){setPlaceCard(null);context.current.onSelect(null);context.current.setThing(t.id);}else setPlaceCard(t);};
    const hover=new WorldHover(renderer.domElement,camera,{scene:()=>scene,roots:()=>[entityLayer.sites.group,floaters.root,kin.view.root,standIns,...(people?.pickingRoots()??[]),...visualObstructionRoots()],entity:id=>{const site=entityLayer.sites.hoverTarget(id);if(site)return site;const soul=[...context.current.sim.conn.replica.souls.values()].find(s=>s.entityId===id);if(soul){const q=shown.current.entities[id]?.p??[0,0,0];return {kind:'soul',id:soul.id,name:soul.name,point:new THREE.Vector3(q[0],markHeight(waterDetail.regions,q[0],q[1],q[2]),q[2]),detail:doingText(soul.doing,shown.current.entities[id]?.activity,soul.id)};}const rec=records[id];return rec?{kind:'object',id,name:rec.label??plainWords(rec.def),point:new THREE.Vector3(...(shown.current.entities[id]?.p??[0,0,0])),detail:plainWords(shown.current.entities[id]?.activity)}:null;},places:()=>entityLayer.active?[]:expansion?EDEN_VIEWER_PLACES.filter(p=>p.kind!=='world'):Object.entries(shown.current.take?.finalState.regions??{}).flatMap(([id,r])=>r.polygon&&r.label?[{id,name:r.label,polygon:r.polygon}]:[]),available:()=>(entityLayer.active||drawnTick.current!==null)&&!context.current.loading&&!context.current.graphicsUnavailable,inspect:inspectHover});scene.add(hover.marker);
    // #892 (touch Follow): a fast one-finger sideways flick switches Souls (SoulSwipe: the order is made on a swipe only)
    const touchesDown=new Set<number>(),swipe=new SoulSwipe();let flick:{id:number;x:number;y:number;at:number}|null=null;
    const swipeSoul=(dir:1|-1)=>{
      const c=context.current,followed=c.selected,r=c.sim.conn.replica,frame=shown.current.entities;if(!followed)return;
      const here=[...r.souls.values()].filter(x=>frame[x.entityId]);
      const next=swipe.step(followed,here.map(x=>x.id),dir,performance.now(),()=>{
        const perf=performance.now(),now=perf/1000,speaking=new Map<string,{thread:string;at:number}>();
        for(const [soulId,sp] of speakingNow){const id=r.souls.get(soulId)?.entityId;if(id&&frame[id])speaking.set(id,{thread:sp.thread,at:now-(perf-sp.since)/1000});}
        const score=interestScores(here.map(x=>({id:x.entityId,p:frame[x.entityId].p,activity:frame[x.entityId].activity})),speaking,now);
        return soulRing(followed,here.map(x=>({id:x.id,entityId:x.entityId,p:frame[x.entityId].p})),score);
      });
      if(!next){c.onChipNote?.('The only Soul here');return;}
      controlsApi.current?.flyToSoul(next,{chip:true});
    };
    const onDown = (e: PointerEvent) => {
      groupSelection.clear(); down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      if(e.pointerType==='touch'){if(e.isPrimary)touchesDown.clear();touchesDown.add(e.pointerId);flick=touchesDown.size===1?{id:e.pointerId,x:e.clientX,y:e.clientY,at:e.timeStamp}:null;}
    };
    const onCancel=(e:PointerEvent)=>{touchesDown.delete(e.pointerId);if(flick?.id===e.pointerId)flick=null;};
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) context.current.setCameraMode(cameraModeAfterGesture(context.current.cameraMode));
    };
    const onWheel = () => context.current.setCameraMode(cameraModeAfterGesture(context.current.cameraMode));
    const onUp = (e: PointerEvent) => {
      const touch=e.pointerType==='touch',started=touch&&flick?.id===e.pointerId?flick:null;if(touch)onCancel(e);
      if (touchFree.consumed(e.pointerId)) { down = null; return; }  // #891: a touch gesture (stick, look, pinch, rise, double-tap), not a tap
      if(started&&(context.current.cameraMode==='follow'||chipFlight())&&context.current.selected){const dir=swipeStep(e.clientX-started.x,e.clientY-started.y,e.timeStamp-started.at);if(dir){down=null;swipeSoul(dir);return;}}  // #892: a flick switches; a slower drag orbited
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      if (entityLayer.active && godFeature('flags') && (e.altKey || flagModeRef.current)) return;  // a flag drop (onFlagClick), not a selection: no place card over the god panel
      const target=hover.pick(e.clientX,e.clientY);
      if(touch&&target?.kind==='soul'&&controlsApi.current?.flyToSoul(target.id,{chip:true}))return;  // #892: one tap follows (the card's flight)
      if(touch&&(!target||target.kind==='place')&&(context.current.cameraMode==='follow'||chipFlight())){setPlaceCard(null);soulFlight=null;rts.flyToGround(e);return;}  // #892: a tap on the ground frees the camera there
      if(target)inspectHover(target);else{setPlaceCard(null);context.current.setThing(null);}rts.clickPivot(e);  // C1 + CAMERA-PIVOT: the clicked point (thing or ground) becomes the pivot (manual camera only)

    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onCancel);
    frame=requestAnimationFrame(animate);  // the first shader uploads/draw get their own task after React's mount

    return () => {
      releaseTexturePreparation();
      releaseAssetLoader();
      releaseDownloads();
      eyes?.dispose();
      fixtureInstances.clear();
      waterDetail.dispose();
      games.dispose();
      platformDraw.dispose();
      hover.dispose();
      portraits.dispose();
      for(const type of ['pointerdown','keydown','wheel'] as const)window.removeEventListener(type,stopSoulFlight,{capture:true});
      rts.dispose();touchFree.dispose();
      atmosphere.dispose();forkLand?.dispose();godLiving?.dispose();post?.dispose();godLightning?.dispose();
      speechLayer.dispose();
      fading.dispose();
      balloonRide.dispose();
      rideCarsDrawn.dispose();
      placeActivity.dispose();
      try{nativeSocialDraw?.dispose(people);}catch{problem('Some fixture scenery could not be released.');}
      clearConnectedDressing();
      abort.abort();manager.abort();removeEarlyPoster();
      speechVisibility.reset();
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      renderer.domElement.removeEventListener('click', onFlagClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      navigation?.dispose();
      controls.dispose();
      controlsApi.current = null;
      for (const l of labels.values()) { labelScene.remove(l.obj); l.obj.element.remove(); }
      labels.clear();
      people?.dispose();
      if(entityWorldFramed)entityView.current={eye:camera.position.toArray(),target:controls.target.toArray(),pending:!!arrivalPending,broadcast:context.current.cameraMode==='broadcast'};  // entity worlds only: the camera survives the scene re-mount
      edgeItems.dispose();entityLayer.dispose();const entityDebug=window as unknown as {__simEntity?:{layer:WorldEntityLayer}};if(entityDebug.__simEntity?.layer===entityLayer)delete entityDebug.__simEntity;setFleeSources(null);
      initialGate?.cancel();retryInitial.current=null;staticBatches.dispose();entityBatches.dispose();distanceDetail?.dispose();meshLod?.dispose();farStandIns?.dispose();diagnostics.dispose();placePreviews.dispose();bodyModels.dispose();
      floaters.dispose();
      kin.dispose();
      sceneRequest++;sceneHistory.dispose();
      draco.dispose();
      clearSocialPaths();
      planting?.dispose();planting=null;
      clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=null;
      clearExpansion();cameraGround.bindGround(undefined);geometry.dispose();
      sunCache?.dispose();light.dispose();
      ring.geometry.dispose(); (ring.material as THREE.Material).dispose();
      standInGeometry.dispose(); standInMaterial.dispose();
      resources.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels2d.domElement.remove();
    };
  }, [owner?.worldId, owner?.epoch]);

  useEffect(() => {
    if (!graphicsUnavailable && shown.current.take) return;
    emitState(viewerPresentation({assetDownloads:assetProgress, drawnTick: drawnTick.current,
      history: !!past.current, playing: past.current?.playing ?? false, cameraMode, manualNavigation, inputOwned: controlsApi.current?.inputOwned() ?? false,
      soulId: selected, entityId: selected ? sim.conn.replica.souls.get(selected)?.entityId ?? null : thing,
      loading: !graphicsUnavailable, unavailableReason: graphicsUnavailable ?? 'Waiting for a recorded world frame.',
    }));
  }, [graphicsUnavailable, cameraMode, selected, thing, loading, mode, manualNavigation,assetProgress]);

  // stop any rewind fetch when the view goes away
  useEffect(() => () => { seeking.current?.abort(); if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  // ------------------------------------------------------------------ rewind
  const dt = dtOf(sim), now = serverNow(sim), hour = HOUR_SECONDS / dt;
  const p = past.current;
  const shownTick = p ? p.tick : (now ?? 0);
  const lo = Math.max(0, Math.floor((now ?? 0) - hour)), hi = Math.max(lo + 1, Math.floor(now ?? 0));
  const goLive = () => { controlsApi.current?.releaseInput(); seeking.current?.abort(); seeking.current = null; setLoading(false); past.current = null; setDraft(null); setNote(null); setMode('live'); };
  const seek = async (wanted: number) => {
    controlsApi.current?.releaseInput();
    const s = context.current.sim, at = serverNow(s), dts = dtOf(s);
    if (at === null) { setDraft(null); return; }
    // An explicit seek chooses a recorded moment even inside the live buffer.
    // The separate live command resumes the delayed live view.
    const tick = Math.floor(Math.max(at - HOUR_SECONDS / dts, Math.min(at, wanted), 0));
    // A newer buffered seek also supersedes an older network request.
    seeking.current?.abort(); seeking.current = null;
    const cur = past.current;
    if (cur && cur.chunks[0].fromTick <= tick && tick <= cur.chunks.at(-1)!.toTick) { cur.tick = tick; setLoading(false); setDraft(null); setNote(null); refreshPlayback(n=>n+1); return; }
    const ctl = new AbortController();
    seeking.current = ctl;
    setLoading(true); setNote(null);
    try {
      const { from, to } = rewindWindow(tick, 1 / dts);
      const got = await fetchChunks(from, to, MAX_PAST_CHUNKS, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!got.length) { setNote('Nothing was recorded at that moment. Try a later time.'); return; }
      past.current = { tick: Math.max(got[0].fromTick, Math.min(got.at(-1)!.toTick, tick)), playing: cur?.playing ?? true, chunks: got, extending: false, retryAt: 0, ended: false };
      setMode('past');
      if (got[0].fromTick > tick + 5 / dts) setNote('The recording starts later than that, so this is the earliest moment kept.');
    } catch {
      if (!ctl.signal.aborted) setNote('That moment could not be loaded. Check the connection and try again.');
    } finally {
      if (seeking.current === ctl) { seeking.current = null; setLoading(false); setDraft(null); }
    }
  };
  const commit = (v: number) => { if (commitTimer.current) clearTimeout(commitTimer.current); commitTimer.current = null; void seek(v); };
  const onSlide = (v: number) => {
    setDraft(v);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => commit(v), 600); // keyboard and slow drags; a release commits at once
  };
  const togglePlay = () => { if (past.current) { past.current.playing = !past.current.playing; setNote(null); setMode('past'); refreshPlayback(n=>n+1); } };
  playbackCommands.current = { seek, live: goLive, setPlaying: (playing) => {
    if (!past.current) return false;
    past.current.playing = playing; setNote(null); setMode('past'); refreshPlayback(n=>n+1); return true;
  } };
  useEffect(() => {
    const handle = createWorldViewerHandle(() => ({
      feedbackContext: () => controlsApi.current?.feedbackContext() ?? null,
      setCameraMode: mode => { controlsApi.current?.releaseInput(); context.current.setCameraMode(mode); },
      setManualNavigation: mode => { controlsApi.current?.releaseInput(); context.current.setManualNavigation(mode); context.current.setCameraMode('manual'); },
      resetView: () => controlsApi.current?.reset() ?? false,
      releaseInput: () => controlsApi.current?.releaseInput(),
      moveCamera: delta => controlsApi.current?.move(delta) ?? false,
      locations:()=>controlsApi.current?.locations()??[],
      refreshLocations:()=>controlsApi.current?.refreshLocations(),
      locationPage:()=>controlsApi.current?.locationPage()??null,
      searchLocations:query=>controlsApi.current?.searchLocations(query),
      moreLocations:()=>controlsApi.current?.moreLocations(),
      cancelLocationPictures:()=>controlsApi.current?.cancelLocationPictures(),
      frameLocation:id=>controlsApi.current?.frameLocation(id)??false,
      locationPreview:id=>controlsApi.current?.locationPreview(id)??Promise.resolve(null),
      framePlace: place => controlsApi.current?.framePlace(place) ?? false,
      frameSouls: ids => controlsApi.current?.frameSouls(ids) ?? false,
      flyToSoul: (id,opts) => controlsApi.current?.flyToSoul(id,opts) ?? false,
      frameAll: () => { context.current.setCameraMode('manual'); controlsApi.current?.overview(); },
      placePreview: place => controlsApi.current?.placePreview(place) ?? Promise.resolve(null),
      focusSelected: () => { const found = controlsApi.current?.focusSelected() ?? false; if (found) context.current.setCameraMode('manual'); return found; },
      hasSoul: id => context.current.sim.conn.replica.souls.has(id),
      canFollowSoul: id => {
        const c=context.current,soul=c.sim.conn.replica.souls.get(id);
        return !past.current&&!c.loading&&!c.graphicsUnavailable&&!!shown.current.take&&!!soul&&!!shown.current.entities[soul.entityId];
      },
      hasEntity: id => !!shown.current.entities[id],
      select: (soulId, entityId) => { context.current.onSelect(soulId); context.current.setThing(entityId); },
      seek: tick => playbackCommands.current?.seek(tick) ?? Promise.resolve(),
      live: () => playbackCommands.current?.live(),
      setPlaying: playing => playbackCommands.current?.setPlaying(playing) ?? false,
    }));
    onViewerHandle?.(handle);
    return () => onViewerHandle?.(null);
  }, [onViewerHandle]);

  // ------------------------------------------------------------------ what is shown
  const s = shown.current, r = sim.conn.replica, state = sim.conn.stats.state;
  const takes = takesOf(sim);
  const status = state !== 'open' ? 'Reconnecting to the world…' : !takes ? 'Waiting for the world…' : null;
  const load = state === 'open' && sim.conn.load && sim.conn.load !== 'green' ? sim.conn.load : null;   // LOAD-CONTRACT §3 pill
  const when = clockText(s.datetime);
  const ago = p && now !== null ? agoText((now - p.tick) * dt) : '';
  const soul = selected ? r.souls.get(selected) : undefined;
  const cards = cardsAt(sim.plays, s.tick);
  return (
    <section className="wide world-viewer" data-world-viewer="1" style={embedded ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...(entityWorld ? { position: 'relative' as const } : {}) } : (entityWorld ? { position: 'relative' } : undefined)}>
      {entityWorld && godUi && <Suspense fallback={null}><GodPanel flagMode={flagMode} onFlagMode={setFlagMode} entitiesAt={entitiesAt} /></Suspense>}
      {!hideControls && <div className="row">
        <h2 style={{ margin: 0 }}>World</h2>
        {mode === 'live' && !status ? <span className="ok"><b>● Live</b></span> : null}
        {mode === 'past' ? <span className="warn"><b>⏪ Replaying {ago}</b></span> : null}
        {status ? <span className="dim">{status}</span> : null}
        {load ? <span className="dim" data-world-load={load}>the world is busy</span> : null}
        {when ? <span className="dim">world time {when}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        <button aria-pressed={cameraMode === 'broadcast'} className={cameraMode === 'broadcast' ? 'on primary' : ''} onClick={() => setCameraMode('broadcast')}>Broadcast</button>
        <button aria-pressed={cameraMode === 'manual'} onClick={() => { setCameraMode('manual'); controlsApi.current?.overview(); }}>see everything</button>
        <button disabled={!selected && !thing} aria-pressed={follow} className={follow ? 'on primary' : ''} onClick={() => setCameraMode(follow ? 'manual' : 'follow')}>{follow ? 'following' : 'follow selected'}</button>
      </div>}
      {!hideControls && <div className="row">
        <button aria-pressed={cameraMode==='manual'&&manualNavigation==='orbit'} onClick={()=>{controlsApi.current?.releaseInput();setManualNavigation('orbit');setCameraMode('manual');}}>Orbit camera</button>
        <button aria-pressed={cameraMode==='manual'&&manualNavigation==='free'} onClick={()=>{controlsApi.current?.releaseInput();setManualNavigation('free');setCameraMode('manual');}}>Free camera</button>
        <button onClick={()=>controlsApi.current?.reset()}>Reset camera</button>
        <button onClick={()=>controlsApi.current?.releaseInput()}>Release camera controls</button>
        {cameraMode==='manual'&&<span className="dim">WASD moves horizontally · arrows look left/right/up/down · Q/E down/up (F/R also) · Shift faster · Alt precision. Drag to orbit; right-drag to look in place. Free camera also supports touch look. Escape releases.</span>}
        {cameraMode==='manual'&&manualNavigation==='free' && <>
          {([['Forward',{forward:.5}],['Back',{forward:-.5}],['Left',{right:-.5}],['Right',{right:.5}],['Up',{up:.5}],['Down',{up:-.5}]] as [string,CameraMove][]).map(([label,delta])=><button key={label} onClick={()=>controlsApi.current?.move(delta)}>{label}</button>)}
        </>}
      </div>}
      <div className="world-viewport" style={{ position: 'relative', height: embedded ? undefined : 540, flex: embedded ? 1 : undefined, minHeight: 0, width: '100%', overflow: 'hidden', borderRadius: 4 }}>
        <div className="world-canvas-host" data-initial-revealed={initialProgress.stage==='ready'} data-initial-generation={initialProgress.generation} ref={mount} style={{ position: 'absolute', inset: 0, touchAction: 'none',visibility:initialProgress.stage==='ready'||earlyShown?'visible':'hidden' }} />
        {initialProgress.stage!=='ready'&&(!earlyShown||initialProgress.stage==='failed')&&<div role={initialProgress.stage==='failed'?'alert':progressInCard?undefined:'status'} aria-live={progressInCard?undefined:'polite'} data-initial-stage={initialProgress.stage} data-initial-generation={initialProgress.generation} className="world-initial-loading" style={{position:'absolute',inset:0,display:'grid',placeContent:'center',gap:12,background:'var(--bg, #d3c4aa)',textAlign:'center',padding:24}}>{!progressInCard&&<><strong>{initialProgress.stage==='failed'?'The world could not be prepared':initialProgress.stage==='preparing'||initialProgress.stage==='first-frame'?'Preparing the world…':'Arriving in '+'your world'+'…'}</strong>{initialProgress.stage==='failed'?<><span>{initialProgress.failed.join(', ')} could not be prepared.</span><button onClick={()=>retryInitial.current?.()}>Retry</button></>:<><progress aria-label={initialProgress.bytesTotal!==null?"Initial assets downloaded":"Initial assets prepared"} max={initialProgress.bytesTotal??(initialProgress.required||1)} value={initialProgress.stage==='downloading'?(initialProgress.bytesTotal!==null?initialProgress.bytesLoaded:initialProgress.required?initialProgress.completed:undefined):undefined} style={{width:240}}/><span>{initialProgress.bytesLoaded>0?(initialProgress.bytesLoaded/1048576).toFixed(1)+' MB downloaded · ':''}{initialProgress.completed} of {initialProgress.required||'…'} world parts prepared</span></>}</>}</div>}

        {placeCard&&<article className="world-place-card" aria-label="Selected place"><button className="panel-close" aria-label="Close place" onClick={()=>setPlaceCard(null)}>×</button><h2>{placeCard.name}</h2>{placeCard.detail&&<p>{placeCard.detail}</p>}<p>{[...sim.conn.replica.souls.values()].filter(soul=>{const e=shown.current.entities[soul.entityId];return e&&Math.hypot(e.p[0]-placeCard.point.x,e.p[2]-placeCard.point.z)<placeCard.radius;}).map(soul=>soul.name).join(', ')||'No Souls nearby in the current frame.'}</p><button onClick={()=>{controlsApi.current?.framePoint(placeCard.point,placeCard.radius);setPlaceCard(null);}}>Go to</button></article>}
        {sceneryNotice&&<div role="status" className="world-scenery-note" style={{position:'absolute',left:12,bottom:12,maxWidth:'min(420px, calc(100% - 24px))',padding:'8px 12px',background:'rgba(238,233,221,.94)',color:'#463f32',borderRadius:6,pointerEvents:'none'}}>{sceneryNotice}</div>}
        {(soul ? !hideSoulInfo : !!thing) && <InfoPanel sim={sim} soul={soul ?? null} thing={thing} shown={s} card={soul ? cardText(cards.get(soul.id)) : ''} past={!!p} close={() => { setThing(null); if (soul) onSelect(null); }} />}
      </div>
      {!hideControls && <div className="row">
        <span className={mode === 'live' ? 'ok' : 'warn'} style={{ minWidth: 96 }}>{mode === 'live' ? 'Live now' : `Earlier · ${ago}`}</span>
        <input type="range" aria-label="Look back over the last hour" min={lo} max={hi} step={1} disabled={now === null}
          value={Math.max(lo, Math.min(hi, draft ?? shownTick))}
          onChange={(e) => onSlide(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) commit(Number((e.target as HTMLInputElement).value)); }} />
        <button disabled={now === null || loading} onClick={() => commit((draft ?? shownTick) - 60 / dt)}>back 1 min</button>
        {p ? <button onClick={togglePlay}>{p.playing ? 'pause' : 'play'}</button> : null}
        {p || loading ? <button className="primary" onClick={goLive}>back to live</button> : null}
      </div>}
      {loading ? <p className="dim">Loading that moment…</p> : null}
      {draft !== null && !loading && now !== null ? <p className="dim">Release to watch from {agoText((now - draft) * dt)}.</p> : null}
      {note ? <p className="warn">{note}</p> : null}
      {problems.map((x) => <p key={x} className="warn">{x}</p>)}
      {!hideControls && <p className="dim">Drag to look around, scroll to zoom, click a person or an object to see what it is. The slider looks back over the last hour; “back to live” returns to now.</p>}
    </section>
  );
}

const panelStyle: React.CSSProperties = { position: 'absolute', top: 10, left: 10, zIndex: 2, maxWidth: 300, background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', boxShadow: '0 2px 10px rgba(0,0,0,.18)' };

/** A small card about the selected Soul or thing, from what is on screen and the world's public state. */
function InfoPanel({ sim, soul, thing, shown, card, past, close }: { sim: Sim; soul: PublicSoul | null; thing: string | null; shown: Shown; card: string; past: boolean; close(): void }) {
  const head = (title: string) => <div className="row" style={{ margin: 0 }}><b style={{ flex: 1 }}>{title}</b><button aria-label="close" onClick={close}>×</button></div>;
  const regions = shown.take?.finalState.regions;
  if (soul) {
    const e = shown.entities[soul.entityId], where = e ? placeOf(e.p, regions) : null;
    const doing = past ? activityWords(e?.activity,soul.id) : doingText(soul.doing,e?.activity,soul.id);
    return (
      <div className="world-selection-info world-soul-info" style={panelStyle}>
        {head(soul.name)}
        <div className="dim">{soul.description}</div>
        {doing ? <div>{doing}</div> : null}
        {card ? <div className="dim">last card {card}</div> : null}
        {where ? <div className="dim">in {where}</div> : null}
        {!e ? <div className="dim">not in view at this moment</div> : null}
      </div>
    );
  }
  if (!thing) return null;
  if (thing.startsWith('kin:')) {
    return <div className="world-selection-info world-object-info" style={panelStyle}>{head(plainWords(thing.split(':')[2]) || 'kin')}<div className="dim">A kin floating by. Part of the scenery, not a Soul.</div></div>;
  }
  const take = shown.take, rec = take?.finalState.entities[thing] ?? (take?.entities0?.[thing] as Entity | undefined), e = shown.entities[thing];
  const k = sim.kernel?.things[thing];
  const name = k?.name ?? rec?.label ?? plainWords(rec?.def ?? thing);
  const kind = rec ? (rec.kind === 'human' ? 'a person' : plainWords(rec.def)) : '';
  const where = placeOf(e?.p ?? rec?.pose.p ?? [0, 0, 0], regions);
  const st = (e?.state ?? {}) as { contents?: Entity['contents'] | null };
  const contents = st.contents ?? rec?.contents;
  const phase = e?.phase ?? rec?.phase;
  return (
    <div className="world-selection-info world-object-info" style={panelStyle}>
      {head(name)}
      {kind && kind !== name.toLowerCase() ? <div className="dim">{kind}</div> : null}
      {where ? <div className="dim">in {where}</div> : null}
      {contents ? <div>{contents.fraction > 0 ? `${plainWords(contents.food)}, ${Math.round(contents.fraction * 100)}% full` : 'empty'}</div> : null}
      {phase ? <div>{plainWords(String(phase))}</div> : null}
      {k ? Object.entries(k.states).slice(0, 6).map(([key, v]) => <div key={key}><span className="dim">{plainWords(key)}</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>) : null}
      {!rec && !e ? <div className="dim">Not here at this moment.</div> : null}
    </div>
  );
}
