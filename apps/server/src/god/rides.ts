// E-life B7 (overnight 2026-10-17): a god-built balloon is a ride residents take, as old Eden's balloon was.
// A god's balloon (a def with a `carrier` component tagged balloon: core/balloon, Eden 2026's launch balloon) is depiction
// only; old Eden's ride was a native carrier (carrier/1: a basket with two places that flies a deterministic route and
// lands, its riders carried and stepping out by themselves) plus the social `ride` object. This installs exactly that
// native carrier at the god balloon's spot, through the host's logged rules fact (host.installCarrierV1, as the rowing
// punts are installed), then publishes the `ride` object, so join/leave/invite/receipts are the old ride's own.
//   • The balloon named `eden-balloon` at old Eden's launch meadow flies old Eden's sightseeing loop (11.2 min, brisk),
//     moved to start and end at its home; the viewer's balloon ride follows the native carrier `eden-balloon`.
//   • Any other god balloon flies a 6-minute loop round its own home (a 150 m ring at 60–80 m up).
// Prospective only: a carrier is installed once (idempotent by id); earlier history replays unchanged. E2: when a god's
// ferris wheel or carousel is resized or moved, its ride re-routes (logged `carrierRerouteV1`, once parked and empty).
import type { WorldModel } from '@souls/world-compiler';
import type { WorldHost } from '../world.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { CARRIER_ROUTES, type CarrierInstallSpec, type RouteKey } from '../../../../mars/viewer/engine/vehicles/carrier.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V3 = [number, number, number];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The native carrier route for a balloon at `home`: old Eden's loop moved to it, or a ring round it. */
export function balloonRoute(name: string, home: V3): { route: string; keys: RouteKey[] } {
  const old = CARRIER_ROUTES['eden-commons-loop-brisk'], k0 = old.keys[0].p;
  if (name === 'eden-balloon' && Math.hypot(home[0] - k0[0], home[2] - k0[2]) < 25) {
    const d: V3 = [home[0] - k0[0], home[1] - k0[1], home[2] - k0[2]];
    return { route: 'eden-commons-loop-brisk', keys: old.keys.map((k, i) => ({ t: k.t, p: (i === 0 || i === old.keys.length - 1 ? [...home] : [r2(k.p[0] + d[0]), r2(k.p[1] + d[1]), r2(k.p[2] + d[2])]) as V3 })) };
  }
  const ring: RouteKey[] = [{ t: 0, p: [...home] as V3 }, { t: 30, p: [r2(home[0]), r2(home[1] + 30), r2(home[2])] }];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push({ t: 60 + i * 30, p: [r2(home[0] + 150 * Math.sin(a)), r2(home[1] + 60 + 20 * Math.sin(2 * a)), r2(home[2] - 150 + 150 * Math.cos(a))] }); }
  ring.push({ t: 360, p: [...home] as V3 });
  // the ring starts and ends straight above home (a = 0 → (x, z - 150 + 150)); the climb and descent are vertical
  return { route: `ring-150`, keys: ring };
}

/** E-life B7: a god's ferris wheel or carousel as a ride: its two-place car boards at the front and goes round with the
 *  wheel (once round a ferris wheel at its own 0.8 rpm, 75 s; three turns of a carousel, 45 s), then back. Keys in the
 *  thing's own frame (x across, y up, z out of its front), turned and moved by its world pose. */
export function attractionRoute(kind: 'ferris-wheel' | 'carousel', wp: { x: number; z: number; yaw: number; s: number }, ground: number, size: [number, number, number]): { home: V3; keys: RouteKey[]; route: string } {
  const c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw), W = (x: number, y: number, z: number): V3 => [r2(wp.x + (x * c + z * sn) * wp.s), r2(ground + y * wp.s), r2(wp.z + (-x * sn + z * c) * wp.s)];
  const keys: RouteKey[] = [];
  if (kind === 'ferris-wheel') {
    const R = Math.max(2, size[0] / 2 - 1.0), cy = R + 1.0, front = size[2] / 2 + 1.6, home = W(0, 0, front + 1.5);
    keys.push({ t: 0, p: home }, { t: 6, p: W(0, cy - R, front) });
    for (let k = 1; k <= 8; k++) { const a = (k / 8) * Math.PI * 2; keys.push({ t: 6 + k * 75 / 8, p: W(R * Math.sin(a), cy - R * Math.cos(a), front) }); }
    keys.push({ t: 6 + 75 + 6, p: home });
    return { home, keys, route: 'ferris-wheel-once' };
  }
  const R = Math.max(1.5, size[0] / 2 - 1.5), out = size[2] / 2 + 1.6, home = W(0, 0, out);
  keys.push({ t: 0, p: home }, { t: 4, p: W(0, 0.6, R) });
  for (let k = 1; k <= 24; k++) { const a = (k / 8) * Math.PI * 2; keys.push({ t: 4 + k * 45 / 24, p: W(R * Math.sin(a), 0.6, R * Math.cos(a)) }); }
  keys.push({ t: 4 + 45 + 4, p: home });
  return { home, keys, route: 'carousel-three-turns' };
}

type Wanted = CarrierInstallSpec & { entity: string; attraction?: boolean };
/** E2: does an installed carrier's home or route differ from what its attraction now wants (it was resized or moved)? */
export function rerouteNeeded(c: { home: number[]; route: { keys: RouteKey[] } } | undefined, s: CarrierInstallSpec): boolean {
  if (!c || !s.routeKeys) return false;
  const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.02);
  if (!near(c.home, [s.at[0], s.y ?? 0, s.at[1]])) return true;
  const a = c.route.keys, b = s.routeKeys;
  return a.length !== b.length || a.some((k, i) => Math.abs(k.t - b[i].t) > 1e-6 || !near(k.p, b[i].p));
}

export function installGodRides(o: { host: WorldHost; edge: EdgeLedger; model: WorldModel; log?: (m: string) => void }) {
  const { host, edge, model } = o, log = o.log ?? (() => {});
  const engine = () => host.engine as any;
  let busy = false, retryAt = 0, closed = false;
  /** The god balloons and the native carrier each one should have. */
  const wanted = (): Wanted[] => {
    const out: Wanted[] = [];
    for (const e of model.entities.values()) {
      const def = model.resolvedDef(e.def) as any; if (!def?.components?.carrier) continue;
      const tags: string[] = def.tags ?? [], attraction = tags.includes('ferris-wheel') ? 'ferris-wheel' : tags.includes('carousel') ? 'carousel' : null;
      if (attraction && e.in.parent === 'world') {
        const wp = model.worldPose(e), name = String(e.name ?? ''), id = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name) && !model.entities.has(name) ? name : `ride-${e.id.toLowerCase()}`;
        const baked = model.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), r = attractionRoute(attraction, wp, model.terrain.sample(wp.x, wp.z), baked.box as [number, number, number]);
        out.push({ entity: e.id, id, attraction: true, def: 'hot-air-balloon', label: (name || attraction).replace(/-/g, ' '), at: [r.home[0], r.home[2]], y: r.home[1], yaw: wp.yaw - Math.PI / 2, route: r.route, routeKeys: r.keys, waitSeconds: 30 });
        continue;
      }
      if (!tags.includes('balloon')) continue;
      const wp = model.worldPose(e), home: V3 = [r2(wp.x), r2(model.terrain.sample(wp.x, wp.z)), r2(wp.z)];
      const name = String(e.name ?? ''), id = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name) && !model.entities.has(name) ? name : `ride-${e.id.toLowerCase()}`;
      const r = balloonRoute(name, home);
      out.push({ entity: e.id, id, def: 'hot-air-balloon', label: (name || 'balloon').replace(/-/g, ' '), at: [home[0], home[2]], y: home[1], yaw: Math.PI, route: r.route, routeKeys: r.keys, waitSeconds: 60 });
    }
    return out;
  };
  // V7c (tranche 2026-10-19): this ran every 20 ticks and read every comms object (all of them, JSON-parsed) once per
  // carrier. Now: one read per publish, and only when the set of balloon carriers changed since the last complete publish
  // (ride objects are never removed at runtime, so an unchanged carrier set has nothing new to publish).
  let published: string | null = null;
  const publish = () => {
    if (!edge.comms) return;
    const balloons = ((engine().carriers?.() ?? []) as { id: string; def: string; label: string; pose: { p: number[] } }[]).filter((c) => c.def === 'hot-air-balloon');
    const key = balloons.map((c) => c.id).sort().join('\n');
    if (key === published) return;
    const have = new Set(edge.comms.objects.all().map((x) => x.id));
    let complete = true;
    for (const c of balloons) {
      if (have.has(`ride-${c.id}`)) continue;
      const vehicle = /ferris/.test(c.id) ? 'ferris-wheel' : /carousel/.test(c.id) ? 'carousel' : 'balloon';
      const place = edge.places.containing(c.pose.p[0], c.pose.p[2], 0).find((p) => !p.carrier)?.id ?? [...edge.places.byId.values()].find((p) => p.parent === null)?.id;
      if (!place) { complete = false; continue; }
      try { edge.comms.objects.create({ id: `ride-${c.id}`, kind: 'ride', name: c.label, placeId: place, params: { carrier: c.id, vehicle } }); } catch { complete = false; }
    }
    if (complete) published = key;
  };
  const reconcile = () => {
    if (closed || busy) return;
    publish();
    if (host.engine.world.tick < retryAt) return;
    retryAt = host.engine.world.tick + 20 * 60;
    const all = wanted(), missing = all.filter((s) => !engine().world.entities[s.id]?.carrier);
    // E2: an attraction resized or moved since its ride was installed (a bigger ferris wheel) re-routes its carrier
    const moved = all.filter((s) => s.attraction && rerouteNeeded(engine().world.entities[s.id]?.carrier, s));
    if (!missing.length && !moved.length) return;
    busy = true;
    void (async () => {
      for (const spec of missing) { if (closed) break; const { entity: _e, attraction: _a, ...s } = spec; try { await host.installCarrierV1(s); log(`balloon ride installed: ${s.id} (${s.route})`); } catch (error) { log(`balloon ride refused: ${s.id}: ${error instanceof Error ? error.message : String(error)}`); } }
      for (const spec of moved) { if (closed) break; const { entity: _e, attraction: _a, ...s } = spec; try { await host.rerouteCarrierV1(s); log(`ride re-routed: ${s.id} (home ${s.at.join(', ')})`); } catch (error) { log(`ride re-route waits: ${s.id}: ${error instanceof Error ? error.message : String(error)}`); } }
      publish();
    })()
      .finally(() => { busy = false; });
  };
  const listener = { afterTick: (tick: number) => { if (tick % 20 === 10) reconcile(); } };
  host.listeners.push(listener as never);
  return { reconcile, wanted, close() { closed = true; const at = host.listeners.indexOf(listener as never); if (at >= 0) host.listeners.splice(at, 1); } };
}
