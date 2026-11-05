import * as THREE from 'three';
import {WorldRenderedVisibility} from './WorldRenderedVisibility.ts';
import { arrivalOver } from './arrival-marks.ts';
import { Director } from '../../../mars/viewer/cinematography/director.ts';
import type { Observation } from '../../../mars/viewer/cinematography/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import { floaterBody } from '../../../mars/viewer/engine/bodies/body.ts';
import type { CameraPose, SubjectPose } from '../../../mars/viewer/engine/camera/shots.ts';
import { WorldDirector, MIN_CUT, type DirectorChoice, type Landmark } from './WorldDirector.ts';
import { WORLD_PLACE_VIEWS, REGION_PLACE_VIEWS } from './WorldPlaces.ts';
import { WorldTour, type TourView } from './WorldTour.ts';
import { speakingNow } from './dialogue-speaking.ts';
import { BALLOON } from './WorldBalloonRide.ts';
import { liftHorizon } from './broadcast-horizon.ts';

export type WorldCameraMode = 'broadcast' | 'manual' | 'follow';
export type CarrierPose = { p: readonly number[]; yaw: number };
/** A body standing in a carrier's basket (within its footprint, at its floor) rides it. */
export function ridingCarrier(p: readonly number[], carriers: readonly CarrierPose[]): CarrierPose | null {
  const { length, width, height } = BALLOON.basket, reach = Math.hypot(length, width) / 2 + .15;
  for (const c of carriers) if (Math.hypot(p[0] - c.p[0], p[2] - c.p[2]) <= reach && p[1] > c.p[1] - .4 && p[1] < c.p[1] + height) return c;
  return null;
}
/** The carrier's visual envelope for sizing a shot: basket corners and the lower envelope (its 3.8 m ring, 7.2 m up). */
export function carrierFraming(c: CarrierPose): [number, number, number][] {
  const { basket: { length, width, height } } = BALLOON, [x, y, z] = c.p, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), belly = 7.2, radius = 3.8;
  const at = (f: number, r: number, h: number): [number, number, number] => [x + f * cs - r * sn, y + h, z + f * sn + r * cs];
  const out: [number, number, number][] = [];
  for (const [f, r] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) out.push(at(f * length / 2, r * width / 2, 0), at(f * length / 2, r * width / 2, height));
  for (const [f, r] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) out.push(at(f * radius, r * radius, belly));
  return out;
}
/** V1 (3.2 walk): a rider's shot. The director framed basket + envelope from its elevated "context" ray, ~19 m above the
 * basket at dpr 2, so the envelope hid the rider; and once the envelope blocked its own pose it stopped tracking and the
 * balloon drifted out of a frozen frame. A ridden carrier gets its own side-on shot instead: the eye a little above the
 * basket floor (under the envelope mouth), RIDER_DISTANCE out, looking at the basket and lower envelope. It holds for
 * any carrier (Eden 2026's native ride and god balloons alike) because it uses only the carrier's pose. */
export const RIDER_EYE_MAX = 4, RIDER_EYE = 3.6, RIDER_DISTANCE = 14, RIDER_AIM = 3;
export function riderPose(c: CarrierPose, azimuth: number): CameraPose {
  const [x, y, z] = c.p;
  return { position: [x + Math.cos(azimuth) * RIDER_DISTANCE, y + RIDER_EYE, z + Math.sin(azimuth) * RIDER_DISTANCE], target: [x, y + RIDER_AIM, z], fov: 45 };
}
/** The side of the basket: perpendicular to the carrier's heading, then the other side, then the diagonals and ends. */
export const riderAzimuths = (yaw: number) => [.5, -.5, .25, -.25, .75, -.75, 0, 1].map(k => yaw + k * Math.PI);
/** The ride shot drifts slowly round the basket (radians per second) so a long ride is not a still. */
const RIDER_DRIFT = .03;
/** Rendered rays a frame may spend on a pending shot decision (beyond the
 * held shot's own tracking); one search step may finish past it. */
const DECISION_RAYS = 100;

/** VF1: Broadcast's opening and "nothing is happening" views: authored establishing views of Eden's town
 * (water-dominated views such as the lake and pier are left out). The first is the opening shot. */
const EDEN_LANDMARKS: readonly Landmark[] = (['commons', 'homes', 'market', 'bandstand', 'library', 'courtyard', 'farm', 'amphitheatre', 'domequarter', 'rooftops', 'kiosks', 'teahouse'] as const)
  .map(id => ({ id, label: WORLD_PLACE_VIEWS[id].label, p: WORLD_PLACE_VIEWS[id].p, target: WORLD_PLACE_VIEWS[id].target }));
/** VF5: the idle tour's views: Eden's town places (not the interior previews) and every Regions district. */
const TOUR_VIEWS: readonly TourView[] = [
  ...Object.entries(WORLD_PLACE_VIEWS).filter(([id]) => !['libraryroom', 'homecourtyard', 'roofseating', 'presentation', 'classroom'].includes(id)).map(([id, v]) => ({ id, label: v.label, p: v.p, target: v.target })),
  ...Object.entries(REGION_PLACE_VIEWS).map(([id, v]) => ({ id, label: v.label, p: v.p, target: v.target })),
];
/** A subject drawn smaller than this fraction of the frame height is "lost in the scenery". */
const MIN_SUBJECT_FRACTION = .045;
const EMPTY_SECONDS = 1.5;
/** DIRECTOR2: what took the director off its rhythm (resets, solver rejections), for the cut logger; last 50. */
/** DIRECTOR2: a speck framing is left after EMPTY_SECONDS, but not before the shot has had MIN_CUT on screen (leaving a
 *  shot cut to 2 s ago made a cut pair under MIN_CUT); until then the camera stays on it. */
export const leaveSpeck = (smallFor: number, shotAge: number) => smallFor >= EMPTY_SECONDS && shotAge >= MIN_CUT;
const broadcastLog = (ev: string, key: string) => { const l = ((globalThis as unknown as { __simBroadcastLog?: { t: number; ev: string; key: string }[] }).__simBroadcastLog ??= []); l.push({ t: Date.now() / 1000, ev, key }); if (l.length > 50) l.shift(); };
const projector = new THREE.PerspectiveCamera(), projected = new THREE.Vector3();
/** How much of the frame height a standing body at `p` fills from `pose` (0 when behind or outside the frame). */
export function subjectFraction(pose: CameraPose, aspect: number, p: readonly number[], height: number): number {
  projector.fov = pose.fov; projector.aspect = aspect; projector.near = .1; projector.far = 2000; projector.updateProjectionMatrix();
  projector.position.fromArray(pose.position as number[]); projector.lookAt(pose.target[0], pose.target[1], pose.target[2]); projector.updateMatrixWorld();
  const feet = projected.set(p[0], p[1], p[2]).project(projector).clone(), head = projected.set(p[0], p[1] + height, p[2]).project(projector);
  if (feet.z > 1 || head.z > 1 || Math.abs(head.x) > 1 || Math.abs(feet.x) > 1 || Math.min(head.y, feet.y) > 1 || Math.max(head.y, feet.y) < -1) return 0;
  return Math.abs(head.y - feet.y) / 2;
}

/** A presentation-only camera over the same public take frame the viewer draws.
 * Recorded activities nominate shots; selection/private intention never does.
 * It uses the existing safety/readability director, rather than a second mover. */
export class WorldBroadcast {
  constructor() { broadcastLog('mount', ''); }
  private rendered=new WorldRenderedVisibility();
  // Rendered occluders also bound indoor framing: clearance around the camera
  // and the reach of a blocked sightline (see feasibleShots' enclosed pass).
  private director = new Director('clear',Object.assign((pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>this.rendered.score(pose,ids,subjects),
    {clear:(p:readonly number[],radius:number)=>this.rendered.clear(p,radius),
     seen:(pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>this.rendered.seen(pose,ids,subjects),
     around:(p:readonly number[],far:number,walls?:number)=>this.rendered.around(p,far,walls),reach:(a:readonly number[],b:readonly number[])=>this.rendered.reach(a,b),
     foreground:(pose:CameraPose,aspect:number)=>this.rendered.foreground(pose,aspect)}));
  private lastTick = -Infinity;
  private lastDecisionWall = -Infinity;
  private signature = '';
  private semanticVersion = 0;
  private picker = new WorldDirector();
  private tour = new WorldTour(TOUR_VIEWS);
  private choice: DirectorChoice | null = null;
  private lastPick = -Infinity;
  private emptySince: number | null = null;
  private cutAt = -Infinity;
  private ride: { azimuth: number; checked: number } | null = null;
  /** P7f: the view the arrival camera already shows (arrival-shot.ts: the phone's poster, LiveWorld's first frames), or null.
   *  The first tour shot is then that view's opening push from k = 0 (WorldTour.openingMove), even when the arrival is
   *  already over (the phone holds the broadcast until its world is filled in), so it starts exactly where the camera is.
   *  Cleared by the first shot of any kind. */
  opening: string | null = null;
  /** Set by the viewer: Soul → entity (for who is speaking) and whether Eden's town views apply. */
  hints?: () => { soulEntity(soulId: string): string | null; eden: boolean; daylight?: number | null;
    /** R4-LIVE: a god world's own establishing views (its named buildings, plazas, landmarks); Eden's when `eden`. */
    views?: readonly TourView[];
    /** V1: where the world's ride carriers are this frame (basket floor centre and yaw): Eden's balloon, a god's balloons. */
    carriers?: readonly CarrierPose[] };
  private godViews: { key: string; tour: WorldTour; views: readonly TourView[]; landmarks: readonly Landmark[] } | null = null;
  /** The establishing views of this world: Eden's town, a god world's own landmarks, or none. */
  private viewsOf(hints: ReturnType<NonNullable<WorldBroadcast['hints']>> | undefined): { tour: WorldTour; views: readonly TourView[]; landmarks: readonly Landmark[] } | null {
    if (!hints) return null;
    if (hints.eden) return { tour: this.tour, views: TOUR_VIEWS, landmarks: EDEN_LANDMARKS };
    if (!hints.views?.length) return null;
    const key = JSON.stringify(hints.views.map(v => [v.id, v.p, v.target]));
    if (this.godViews?.key !== key) this.godViews = { key, tour: new WorldTour(hints.views), views: hints.views, landmarks: hints.views.map(v => ({ id: v.id, label: v.label, p: v.p, target: v.target })) };
    return this.godViews;
  }

  /** #892: the body the current shot is about (its focus), or null for a landmark or no shot. */
  get subject(): string | null { return this.choice?.kind === 'subjects' ? this.choice.focus : null; }

  reset() {
    broadcastLog('reset', this.choice?.key ?? '');
    this.director.reset('live-world');this.rendered.reset();
    this.lastTick = this.lastDecisionWall = -Infinity;
    this.signature = '';
    this.semanticVersion = 0;
    this.picker.reset(); this.tour.reset(); this.godViews?.tour.reset(); this.choice = null; this.lastPick = -Infinity; this.emptySince = null; this.ride = null;
  }

  /** The shot for this frame, its aim lifted toward the horizon (C1, broadcast-horizon.ts). */
  sample(frame: Record<string, SampledEntity>, records: Record<string, Entity>, scene: SpatialScene | null,
    tick: number, dt: number, aspect: number, wallSeconds: number, movementDt: number,renderRoots:readonly THREE.Object3D[]=[] ) {
    const shot = this.direct(frame, records, scene, tick, dt, aspect, wallSeconds, movementDt, renderRoots);
    return shot?.pose ? { ...shot, pose: { ...shot.pose, target: liftHorizon(shot.pose.position, shot.pose.target) } } : shot;
  }
  private direct(frame: Record<string, SampledEntity>, records: Record<string, Entity>, scene: SpatialScene | null,
    tick: number, dt: number, aspect: number, wallSeconds: number, movementDt: number,renderRoots:readonly THREE.Object3D[]=[] ) {
    if (!scene || !Number.isFinite(tick) || !Number.isFinite(dt) || dt <= 0) return null;
    if (tick < this.lastTick) this.reset(); // seek/epoch, never blend old and new scenes
    const people = Object.keys(frame).filter(id => records[id]?.kind === 'human').sort();
    if (!people.length) { // nobody here at all: the town tour (Eden), else nothing to direct
      const hints = this.hints?.(), v = this.viewsOf(hints);this.lastTick = tick;
      return v ? this.tourShot(wallSeconds, hints?.daylight ?? null, v.views.find(x => x.id === this.opening) ?? null, renderRoots, v.tour) : null;
    }
    // VF1: WorldDirector decides what is worth watching and for how long (4x a second; cheap, no rays).
    if (wallSeconds - this.lastPick >= .25 || !this.choice) {
      this.lastPick = wallSeconds;
      // DIRECTOR2: speakingNow.since is on the performance.now() clock; the director's `now` is wall seconds.
      const hints = this.hints?.(), speaking = new Map<string, { thread: string; at: number }>(), perfNow = performance.now();
      if (hints) for (const [soulId, sp] of speakingNow) { const id = hints.soulEntity(soulId); if (id && frame[id]) speaking.set(id, { thread: sp.thread, at: wallSeconds - (perfNow - sp.since) / 1000 }); }
      const before = this.choice?.key;
      const carriers = hints?.carriers ?? [];
      this.choice = this.picker.choose({ bodies: people.map(id => ({ id, p: frame[id].p, activity: frame[id].activity, riding: records[id]?.body?.family !== 'floater' && !!ridingCarrier(frame[id].p, carriers) })), speaking, now: wallSeconds, landmarks: this.viewsOf(hints)?.landmarks ?? [] });
      if (this.choice?.key !== before) { this.cutAt = wallSeconds; const cuts = ((globalThis as unknown as { __simBroadcastCuts?: { t: number; key: string; label: string }[] }).__simBroadcastCuts ??= []); cuts.push({ t: Date.now() / 1000, key: this.choice?.key ?? '', label: this.choice?.label ?? '' }); if (cuts.length > 400) cuts.shift(); this.emptySince = null; if (this.choice?.kind === 'landmark' || before?.startsWith('landmark:')) this.director.reset('live-world'); }
    }
    const choice = this.choice;
    if (!choice) return null;
    if (choice.kind === 'landmark') { // nothing interesting: the cinematic town tour (now and then where the people are)
      this.lastTick = tick;
      const hints = this.hints?.(), v = this.viewsOf(hints);
      if (!v) { this.choice = null; return null; }
      const prefer = v.views.find(x => x.id === choice.landmark.id) ?? null;
      return this.tourShot(wallSeconds, hints?.daylight ?? null, prefer, renderRoots, v.tour);
    }
    this.opening = null;
    const { focus, phase } = choice, members = choice.members.filter(id => frame[id]);
    const ridden = frame[focus] && records[focus]?.body?.family !== 'floater' ? ridingCarrier(frame[focus].p, this.hints?.().carriers ?? []) : null;
    if (ridden) { this.lastTick = tick; this.signature = ''; return { pose: this.riderShot(ridden, frame[focus].p, wallSeconds, movementDt, renderRoots), shot: `${choice.label}:ride-side` }; }
    this.ride = null;
    // Conversations prefer the two-shot; everything else uses the readable "clear" program.
    this.director.policy = choice.twoShot ? 'restrained' : 'clear';
    const signature = JSON.stringify([phase, focus, members, aspect]);
    const changed = signature !== this.signature;
    if (changed) { this.semanticVersion++; this.signature = signature; }
    const subjects: Observation['subjects'] = {};
    const carriers = this.hints?.().carriers ?? [];
    let carrier: CarrierPose | null;
    for (const id of people) {
      const e = frame[id], body = records[id].body;
      if (body?.family === 'floater') {
        const b = floaterBody(body), y = e.p[1] + b.hoverHeight;
        subjects[id] = { p: [...e.p], yaw: e.yaw, height: b.hoverHeight + b.radius * 2,
          points: [[e.p[0], y, e.p[2]], [e.p[0], y + b.radius, e.p[2]]] };
      } else if (carrier = ridingCarrier(e.p, carriers)) {
        // V1 (3.2 walk): a rider framed like a pedestrian put the camera ~4 m off and the basket filled the frame.
        // Frame the carrier (basket and envelope) instead; the rider's head and torso stay the visibility probes.
        subjects[id] = { p: [...e.p], yaw: e.yaw, height: 1.75, kind: 'human',
          points: [[e.p[0], e.p[1] + 1.05, e.p[2]], [e.p[0], e.p[1] + 1.65, e.p[2]]],
          framingPoints: carrierFraming(carrier) };
      } else {
        const height = e.activity === 'sit' ? 1.35 : 1.75;
        subjects[id] = { p: [...e.p], yaw: e.yaw, height, kind: 'human',
          points: [[e.p[0], e.p[1] + height * .6, e.p[2]], [e.p[0], e.p[1] + height - .1, e.p[2]]],
          // Frame soles/hair and gesture width; face/torso remain the visibility probes.
          framingPoints: [[e.p[0], e.p[1]-.06, e.p[2]], [e.p[0], e.p[1]+height+.1, e.p[2]],
            [e.p[0]-.35, e.p[1]+height*.5, e.p[2]], [e.p[0]+.35, e.p[1]+height*.5, e.p[2]]] };
      }
    }
    const observation: Observation = {
      schema: 'mars-camera-observation/1', session: 'live-world', tick, time: tick * dt, aspect,
      semanticVersion: this.semanticVersion, geometryVersion: 0, eventCursor: this.semanticVersion,
      subjects, scene, activity: { phase, focus, members, departing: [],
        ...(phase === 'presenting' ? { speaker: focus, presenter: focus } : {}) },
    };
    // A decision is due 10x a second (or at once on a new activity). Its
    // candidate search is spread over display frames (DECISION_RAYS of
    // rendered rays per frame) while the held shot keeps tracking; the
    // choice is re-validated on the frame it is applied (Director.advance).
    const decide = changed || wallSeconds - this.lastDecisionWall >= .1;
    if(decide&&(changed||!this.director.searching))this.rendered.prepare(renderRoots);
    const budget=this.rendered.work+DECISION_RAYS;
    const result = this.rendered.evaluate(()=>this.director.advance(observation, movementDt, decide, changed, ()=>this.rendered.work<budget));
    if (decide) this.lastDecisionWall = wallSeconds;
    this.lastTick = tick;
    // A framing in which the subject is only a speck (a swimmer far out on the lake, a Soul behind a hill) is
    // not a shot: after a moment the director looks elsewhere.
    if (result?.pose && subjects[focus]) {
      const small = subjectFraction(result.pose, aspect, subjects[focus].p, subjects[focus].height ?? 1.75) < MIN_SUBJECT_FRACTION;
      if (!small) this.emptySince = null;
      else if (leaveSpeck(wallSeconds - (this.emptySince ??= wallSeconds), wallSeconds - this.cutAt)) { broadcastLog('reject', choice.key); this.picker.reject(choice.key, wallSeconds); this.lastPick = -Infinity; this.emptySince = null; }
    }
    return result ? { ...result, shot: `${choice.label}:${result.shot ?? ''}` } : result;
  }
  /** The ride shot (see riderPose): a clear side is picked on entry and re-checked once a second against the drawn
   * scenery (hills, trees, buildings near a low basket); a blocked side cuts to the next clear one. */
  private riderShot(c: CarrierPose, rider: readonly number[], wallSeconds: number, step: number, renderRoots: readonly THREE.Object3D[]): CameraPose {
    const head = [rider[0], rider[1] + 1.6, rider[2]];
    let prepared = false;
    const clear = (azimuth: number) => { if (!prepared) { this.rendered.prepare(renderRoots); prepared = true; }
      const eye = riderPose(c, azimuth).position, length = Math.hypot(eye[0] - head[0], eye[1] - head[1], eye[2] - head[2]);
      return this.rendered.evaluate(() => this.rendered.clear(eye, .8) && this.rendered.reach(eye, head) >= length - .6); };
    if (!this.ride) this.ride = { azimuth: riderAzimuths(c.yaw).find(clear) ?? riderAzimuths(c.yaw)[0], checked: wallSeconds };
    else {
      this.ride.azimuth += RIDER_DRIFT * Math.max(0, Math.min(.1, step));
      if (wallSeconds - this.ride.checked >= 1) { this.ride.checked = wallSeconds;
        if (!clear(this.ride.azimuth)) this.ride.azimuth = riderAzimuths(this.ride.azimuth - Math.PI / 2).find(clear) ?? this.ride.azimuth; }
    }
    return riderPose(c, this.ride.azimuth);
  }
  /** A tour pose; a new move is checked once against the drawn scenery (clear path, target in sight). */
  private tourShot(wallSeconds: number, daylight: number | null, prefer: TourView | null, renderRoots: readonly THREE.Object3D[], tour: WorldTour = this.tour) {
    let prepared = false;
    const ready = () => { if (!prepared) { this.rendered.prepare(renderRoots); prepared = true; } };
    const opening = this.opening !== null && prefer?.id === this.opening; this.opening = null;
    const pose = tour.pose(wallSeconds, { daylight, prefer, quick: opening || !arrivalOver(),
      clear: p => { ready(); return this.rendered.evaluate(() => this.rendered.clear(p, .8)); },
      sight: (a, b) => { ready(); const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); return this.rendered.evaluate(() => this.rendered.reach(a, b)) >= Math.min(length * .6, 25); },
      open: p => { ready(); return this.rendered.evaluate(() => this.rendered.reach(p, [p[0], p[1] + 40, p[2]])) >= 39; } });
    return { pose: { position: pose.position, target: pose.target, fov: pose.fov }, shot: 'tour:' + pose.id };
  }
}

/** Same one-second camera response on 30/60/120Hz displays. */
export const followWeight = (seconds: number) => 1 - Math.exp(-6 * Math.max(0, Math.min(.1, seconds)));
