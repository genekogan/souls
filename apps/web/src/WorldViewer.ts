import type {AssetDownloadProgress} from './AssetDownloads.ts';
import type {WorldLocation} from './WorldLocations.ts';
import type {WorldPlaceId} from './WorldPlaces.ts';
import type { WorldCameraMode } from './WorldBroadcast.ts';
export type { ViewportInsets } from './WorldViewport.ts';
import type { CameraMove, ManualNavigation } from './WorldNavigation.ts';
import type {WorldSpeechAnchor} from './WorldSpeechAnchors.ts';
export type {WorldSpeechAnchor} from './WorldSpeechAnchors.ts';
export type { CameraMove, ManualNavigation } from './WorldNavigation.ts';

export type WorldViewContext = {camera:{position:[number,number,number];target:[number,number,number];fov:number};placeId:string|null};
/** Additive presentation boundary v1. Commands never steer or pause the world. */
export interface WorldViewerHandle {
  /** Read public camera/place context only when feedback opens; no per-frame React updates. */
  feedbackContext?(): WorldViewContext | null;
  setCameraMode(mode: WorldCameraMode): void;
  frameAll(): void;
  /** Select and frame the speakers together; presentation only. */
  frameSouls?(ids:readonly string[]):boolean;
  /** B3: select this Soul and fly the camera to its Follow shot, then follow it; false when it is not in the live picture. */
  flyToSoul?(id:string,opts?:{chip?:boolean}):boolean;
  /** Local current-world scenery tour; no simulation command or selection. */
  framePlace?(place:WorldPlaceId): boolean;
  placePreview?(place:WorldPlaceId):Promise<string|null>;
  locations?():readonly WorldLocation[];
  frameLocation?(id:string):boolean;
  locationPreview?(id:string):Promise<string|null>;
  refreshLocations?():void;
  locationPage?():import('./WorldLocations.ts').WorldLocationPage|null;
  searchLocations?(query:string):void;
  moreLocations?():void;
  cancelLocationPictures?():void;
  focusSelected(): boolean;
  selectSoul(id: string | null): boolean;
  /** True only when this Soul has a body in the currently depicted live frame. */
  canFollowSoul?(id: string): boolean;
  selectEntity(id: string | null): boolean;
  seek(tick: number): Promise<void>;
  live(): void;
  setPlaying(playing: boolean): boolean;
  setManualNavigation?(mode: ManualNavigation): void;
  resetView?(): boolean;
  releaseInput?(): void;
  moveCamera?(delta: CameraMove): boolean;
}
export interface WorldViewerState {
  /** Last successfully drawn recording tick, not the server's latest tick. */
  shownTick: number | null;
  presentation: 'live' | 'history';
  cameraMode: WorldCameraMode;
  /** QA2 F10: the camera left Broadcast by itself (a Soul-less world's arrival framing), not by the visitor's hand. */
  cameraAuto?: boolean;
  /** Canonical selection only. Decorative kin inspection stays inside the viewer. */
  selection: { soulId: string | null; entityId: string | null; soulIds?:readonly string[] };
  /** #892: the Soul Broadcast is showing now (its shot's subject), in Broadcast only. */
  broadcastSoulId?: string | null;
  /** #892: the Soul a flyToSoul glide is on its way to (the camera is 'manual' until it arrives and follows). */
  flyingTo?: string | null;
  playback: 'live' | 'playing' | 'paused';
  loading: boolean;
  assetDownloads?:AssetDownloadProgress;
  room?:{id:string;name:string;soulIds:readonly string[]}|null;
  unavailableReason: string | null;
  /** All movement keys/pointers are scoped to the viewport, never document keys. */
  inputScope: 'viewport-pointer';
  manualNavigation?: ManualNavigation;
  inputOwned?: boolean;
  /** Last drawn frame, canvas-local CSS pixels. Empty during unavailable views.
   * Scenery/fixture occlusion, not other actors or CSS label packing. */
  speechAnchors?: readonly WorldSpeechAnchor[];
}
export const WORLD_VIEWER_CAPABILITIES = Object.freeze({
  version: 1, manualOrbit: true, manualFree: 'controls-preview' as const, movablePivot: 'pan-focus-preview' as const,
  reset: true, releaseInput: true, keyboardNavigation: 'controls-preview' as const,
  followOrbitZoom: true, viewportInsets: 'projection-preview' as const, broadcast: 'preview' as const,
});

/** A replaceable port keeps a published handle fresh across React renders. */
export interface WorldViewerPort {
  feedbackContext?(): WorldViewContext | null;
  setCameraMode(mode: WorldCameraMode): void;
  frameAll(): void;
  /** Select and frame the speakers together; presentation only. */
  frameSouls?(ids:readonly string[]):boolean;
  /** B3: select this Soul and fly the camera to its Follow shot, then follow it; false when it is not in the live picture. */
  flyToSoul?(id:string,opts?:{chip?:boolean}):boolean;
  /** Local current-world scenery tour; no simulation command or selection. */
  framePlace?(place:WorldPlaceId): boolean;
  placePreview?(place:WorldPlaceId):Promise<string|null>;
  locations?():readonly WorldLocation[];
  frameLocation?(id:string):boolean;
  locationPreview?(id:string):Promise<string|null>;
  refreshLocations?():void;
  locationPage?():import('./WorldLocations.ts').WorldLocationPage|null;
  searchLocations?(query:string):void;
  moreLocations?():void;
  cancelLocationPictures?():void;
  focusSelected(): boolean;
  hasSoul(id: string): boolean;
  canFollowSoul?(id: string): boolean;
  hasEntity(id: string): boolean;
  select(soulId: string | null, entityId: string | null): void;
  seek(tick: number): Promise<void>;
  live(): void;
  setPlaying(playing: boolean): boolean;
  setManualNavigation?(mode: ManualNavigation): void;
  resetView?(): boolean;
  releaseInput?(): void;
  moveCamera?(delta: CameraMove): boolean;
}
export function createWorldViewerHandle(current: () => WorldViewerPort): WorldViewerHandle {
  return {
    feedbackContext: () => current().feedbackContext?.() ?? null,
    setCameraMode: mode => { if (mode === 'broadcast' || mode === 'follow' || mode === 'manual') current().setCameraMode(mode); },
    frameAll: () => current().frameAll(),
    frameSouls: ids => current().frameSouls?.(ids) ?? false,
    flyToSoul: (id,opts) => current().flyToSoul?.(id,opts) ?? false,
    framePlace: place => current().framePlace?.(place) ?? false,
    placePreview: place => current().placePreview?.(place) ?? Promise.resolve(null),
    locations:()=>current().locations?.()??[],
    refreshLocations:()=>current().refreshLocations?.(),
    locationPage:()=>current().locationPage?.()??null,
    searchLocations:query=>current().searchLocations?.(query),
    moreLocations:()=>current().moreLocations?.(),
    cancelLocationPictures:()=>current().cancelLocationPictures?.(),
    frameLocation:id=>current().frameLocation?.(id)??false,
    locationPreview:id=>current().locationPreview?.(id)??Promise.resolve(null),
    focusSelected: () => current().focusSelected(),
    canFollowSoul: id => current().canFollowSoul?.(id) ?? false,
    selectSoul: id => { const p = current(); if (id !== null && !p.hasSoul(id)) return false; p.select(id, null); return true; },
    selectEntity: id => { const p = current(); if (id !== null && !p.hasEntity(id)) return false; p.select(null, id); return true; },
    seek: tick => Number.isFinite(tick) ? current().seek(tick) : Promise.resolve(),
    live: () => current().live(),
    setPlaying: playing => current().setPlaying(playing),
    setManualNavigation: mode => { if(mode==='free'||mode==='orbit')current().setManualNavigation?.(mode); },
    resetView: () => current().resetView?.() ?? false,
    releaseInput: () => current().releaseInput?.(),
    moveCamera: delta => current().moveCamera?.(delta) ?? false,
  };
}
export function viewerPresentation(input: {
  drawnTick: number | null; history: boolean; playing: boolean;
  cameraMode: WorldCameraMode; cameraAuto?: boolean; soulId: string | null; entityId: string | null;
  loading: boolean; unavailableReason: string | null;
  assetDownloads?:AssetDownloadProgress;
  room?:{id:string;name:string;soulIds:readonly string[]}|null;
  manualNavigation?: ManualNavigation; inputOwned?: boolean; soulIds?:readonly string[];
  speechAnchors?: readonly WorldSpeechAnchor[];
  broadcastSoulId?: string | null;
  flyingTo?: string | null;
}): WorldViewerState {
  return {
    shownTick: input.drawnTick !== null && Number.isFinite(input.drawnTick) ? input.drawnTick : null,
    presentation: input.history ? 'history' : 'live', cameraMode: input.cameraMode, ...(input.cameraAuto ? { cameraAuto: true } : {}),
    selection: { ...(input.soulIds?.length?{soulIds:[...input.soulIds]}:{}),soulId: input.soulId, entityId: !input.soulId && input.entityId?.startsWith('kin:') ? null : input.entityId },
    ...(input.broadcastSoulId&&input.cameraMode==='broadcast'?{broadcastSoulId:input.broadcastSoulId}:{}),
    ...(input.flyingTo?{flyingTo:input.flyingTo}:{}),
    playback: input.history ? input.playing ? 'playing' : 'paused' : 'live',
    loading: input.loading, unavailableReason: input.unavailableReason,
    ...(input.assetDownloads?{assetDownloads:{...input.assetDownloads}}:{}),
    ...(input.room!==undefined?{room:input.room}:{}),
    inputScope: 'viewport-pointer',
    ...(input.manualNavigation ? {manualNavigation:input.manualNavigation} : {}),
    ...(input.inputOwned!==undefined ? {inputOwned:input.inputOwned} : {}),
    ...(input.speechAnchors!==undefined ? {speechAnchors:input.drawnTick===null||!Number.isFinite(input.drawnTick)||input.loading||input.unavailableReason?[]:input.speechAnchors.map(a=>({...a}))} : {}),
  };
}
/** A gesture adjusts Follow; it only takes over an automatic Broadcast shot. */
export const cameraModeAfterGesture = (mode: WorldCameraMode): WorldCameraMode => mode === 'broadcast' ? 'manual' : mode;
