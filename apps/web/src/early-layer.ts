// P7b lever E1 (team/lanes/t4-p7.md "P7b design"): on a phone-tier page of a new world with the early arrival (lever D),
// the world's entity layer starts as soon as its own code and the snapshot are in (early-entry.ts, the page's first
// loading phase), so the terrain and the near ring are built while React, the Shell and the rest of the page still
// download (phased-entry.ts). LiveWorld then adopts that started layer instead of making its own. Everywhere else
// (desktops, old worlds, pictures, `?earlyLayer=0`) LiveWorld makes and starts its layer as before.
import { WorldEntityLayer } from './WorldEntityLayer.ts';
import { apiPath } from './world-path.ts';
import { newWorld } from './world-kind.ts';
import { browserQuality } from './quality-tier.ts';
import { earlyArrivalWanted } from './early-arrival.ts';
import { clerkSatelliteSyncs } from './clerk-sync.ts';
import { inlineClerkSatellite } from './inline-config.ts';

export type EarlyLayer = { layer: WorldEntityLayer; started: Promise<void>; abort: AbortController };
let early: EarlyLayer | null = null, claimed = false;

/** The early layer's gate: lever D's (phone tier, new world, not a picture), unless `?earlyLayer=0`. */
export function earlyLayerWanted(search = location.search): boolean {
  const q = new URLSearchParams(search);
  // lane PAIR-UI: an #approve link may be handed to an open tab of this world (Shell.tsx); never draw a world before that
  if (/^#approve\//.test(globalThis.location?.hash ?? '')) return false;
  // #531: this page is about to leave for Clerk's sync and come back as a new document, so it draws nothing first
  if (inlineClerkSatellite() && clerkSatelliteSyncs(globalThis.location?.href ?? '', globalThis.document?.cookie ?? '')) return false;
  return q.get('earlyLayer') !== '0' && earlyArrivalWanted(browserQuality().tier, newWorld, search, q.has('shot'));
}

/** Start the layer now (once per page; never after LiveWorld has made its own). `onSnapshot` as WorldEntityLayer.start. */
export function startEarlyLayer(onSnapshot?: () => void): boolean {
  if (early || claimed) return false;
  const abort = new AbortController(), layer = new WorldEntityLayer(apiPath);
  early = { layer, abort, started: layer.start(abort.signal, onSnapshot) };
  if (onSnapshot) void early.started.then(onSnapshot, onSnapshot);   // the page's second phase never waits on a failed start
  return true;
}

/** LiveWorld: the started early layer, at most once per page; afterwards (or when there was none) no early layer starts. */
export function takeEarlyLayer(): EarlyLayer | null {
  claimed = true;
  const e = early; early = null;
  return e;
}

/** The started early layer without claiming it (early-render.ts draws it before LiveWorld exists). */
export function peekEarlyLayer(): EarlyLayer | null { return claimed ? null : early; }

// P7d (team/lanes/t4-p7.md "P7d design"): the early renderer's hand-over. early-render.ts (a chunk of its own, asked for
// when the snapshot is in) makes the renderer, scene, camera, daylight and atmosphere for the early layer and draws the
// arrival into a poster; LiveWorld adopts them (no second GL context, the programs already linked) and removes the
// poster once it has drawn the world itself. Kept here (phase one, no imports) so LiveWorld never loads the renderer's code.
/** What LiveWorld adopts. Typed loosely here (this module stays free of three's code); LiveWorld knows the types. */
export type EarlyRenderHandOver = { renderer: unknown; scene: unknown; camera: unknown; light: unknown; atmosphere: unknown; standIns: { removeFromParent(): unknown }[]; target?: [number, number, number]; eye?: [number, number, number]; opening?: string | null; clock?: string | null };
let hand: EarlyRenderHandOver | null = null, renderClaimed = false, poster: HTMLElement | null = null;
/** early-render.ts: offer the made renderer (false when LiveWorld already made its own). */
export function offerEarlyRender(h: EarlyRenderHandOver): boolean { if (renderClaimed) return false; hand = h; return true; }
/** Whether LiveWorld has come (it then owns the renderer it took, or made its own): the early renderer stops drawing. */
export const earlyRenderClaimed = (): boolean => renderClaimed;
/** LiveWorld: the early renderer's objects, at most once per page; afterwards no early renderer draws. */
export function takeEarlyRender(): EarlyRenderHandOver | null { renderClaimed = true; const h = hand; hand = null; return h; }
/** The arrival's poster (a still of the early renderer's first frame, over the page) until LiveWorld has drawn. */
export function setEarlyPoster(el: HTMLElement): void { poster = el; }
export function removeEarlyPoster(): void { const p = poster; poster = null; p?.remove(); }
export const earlyPosterShown = (): boolean => !!poster;
