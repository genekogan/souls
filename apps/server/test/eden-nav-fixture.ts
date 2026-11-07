// A native Eden world like the live edge preview (commons, shore, east/north ground, classroom, social fire) plus
// nav/1 (solid buildings, the library interior, ground south to the park) and W1 places, for nav/activity tests.
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {edenLectureFactoryV1,edenGroundFactoryV1,retainedCommonsShoreFactory,commonsNewcomerResourcesFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {fixture,invite,accept} from './native-owner-fixture.ts';
import {LivingWorld} from '../src/living.ts';
import {EdgeLedger} from '../src/edge/ledger/ledger.ts';
import {navSpecFromPlaces, type NavSpec, type Solid} from '../src/edge/ledger/nav.ts';
import {loadSpots} from '../src/edge/ledger/activities.ts';
import type {PlaceData} from '../src/edge/ledger/places.ts';
import {CN5_DISTRICT_GROUND, CN5_DISTRICT_PLACES} from '../src/edge/ledger/districts.ts';

export const EDEN_PLACES = JSON.parse(readFileSync(new URL('./fixtures/eden-places.v1.json', import.meta.url), 'utf8')) as PlaceData;
export const EDEN_SPOTS = JSON.parse(readFileSync(new URL('../../../tools/core/eden-activity-spots.v1.json', import.meta.url), 'utf8'));
/** CN5: World's live places and activity spots (2026-10-07 snapshot), Core's provisional district solids. */
export const CN5_PLACES = JSON.parse(readFileSync(new URL('./fixtures/eden-places-cn5.v1.json', import.meta.url), 'utf8')) as PlaceData;
/** World's live Eden activity spots (worlds/eden/activity-spots.v1.json), for the leisure activities. */
export const WORLD_SPOTS = JSON.parse(readFileSync(new URL('../../../worlds/eden/activity-spots.v1.json', import.meta.url), 'utf8'));
export const CN5_SPOTS = JSON.parse(readFileSync(new URL('./fixtures/eden-activity-spots-cn5.v1.json', import.meta.url), 'utf8'));
export const CN5_DISTRICT_SOLIDS = JSON.parse(readFileSync(new URL('../../../tools/core/eden-district-solids.v1.json', import.meta.url), 'utf8'));
/** The descriptor's nav.ground for the preview: the lawn south of the commons and the park (never west of the shore gate). */
export const SOUTH_GROUND = [{id: 'eden-south-lawn', boundsXZ: [-29.5, 30, 30, 85] as [number, number, number, number]}, {id: 'eden-south-park', boundsXZ: [-29.5, 85, 33, 136] as [number, number, number, number]}];
export const NATIVE_PLACES = ['commons-kitchen', 'eden-stone-garden', 'eden-bandstand', 'eden-market-kiosks', 'eden-north-woods', 'eden-gardens', 'eden-market-1', 'eden-tea-house', 'eden-dome', 'eden-pergola-court', 'eden-amphitheatre', 'eden-hex-pavilion',
  'region-park', 'region-park.gazebo', 'region-park.playground', 'eden-library-1'];
const placement = {worldEast: 'world-v2' as const, id: 'eden-classroom-1', origin: [42, -6] as [number, number], yaw: 0, audienceSeats: 20 as const, lesson: 'Eden: observe, ask, give a direction, watch what changes.'};

export const factory = async () => nativeSleepSnapshotFactoryV1(edenLectureFactoryV1(commonsNewcomerResourcesFactory(await edenGroundFactoryV1(await retainedCommonsShoreFactory({socialEdenV1: true, foodDeliveryV1: true})))));

/** Inside a solid box, shrunk by `shrink` metres (a body touching a wall is not inside it). */
export function inSolid(x: number, z: number, s: Solid, shrink = 0): boolean {
  const dx = x - s.c[0], dz = z - s.c[1], c = Math.cos(s.yaw), n = Math.sin(s.yaw), lx = dx * c + dz * n, lz = -dx * n + dz * c;
  return Math.abs(lx) < s.half[0] - shrink && Math.abs(lz) < s.half[1] - shrink;
}

export async function edenNavWorld(souls: number, opts: {nav?: boolean; cn5?: boolean; spots?: unknown; diagnosticSoulIds?: readonly string[]} = {}) {
  const PLACES = opts.cn5 ? CN5_PLACES : EDEN_PLACES, SPOTS = opts.spots ?? (opts.cn5 ? CN5_SPOTS : EDEN_SPOTS);
  const GROUND = opts.cn5 ? [...SOUTH_GROUND, ...CN5_DISTRICT_GROUND] : SOUTH_GROUND;
  const NATIVE = opts.cn5 ? [...NATIVE_PLACES, 'eden-south-lawn', ...CN5_DISTRICT_PLACES] : NATIVE_PLACES;
  const fac = await factory(), f = fixture(':memory:', fac, {durableClockV1: true});
  f.souls.enableLifecycle(); f.brain.quiesce();
  await accept<unknown>(f.host, new LivingWorld(f.host).install(['Owners drive their Souls.'])); for (let i = 0; i < 4; i++) f.host.tickOnce();
  await accept(f.host, f.host.installCommonsProvisionsV1()); await accept(f.host, f.host.installCommonsKitchenV1()); await accept(f.host, f.host.installRetainedCommonsShoreV1());
  const layout = JSON.parse(readFileSync(new URL('../../../packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json', import.meta.url), 'utf8'));
  await accept(f.host, f.host.installCommonsNewcomerResourcesV1(layout.placements)); await accept(f.host, f.host.installNativeSleepSnapshotV1());
  await accept(f.host, f.host.installEdenGroundV1()); await accept(f.host, f.host.installEdenLectureV1(placement)); await accept(f.host, f.host.installSocialEdenV1());
  for (const p of [f.host.enableYieldTimeoutV1(), f.host.enableSpreadV2(), f.host.enableContinuousDayV1(), f.host.enableReflexTimeoutV1(), f.host.enableEdgeMotionV1(), ...(opts.cn5 ? [f.host.enableSpreadClearV1()] : [])]) await accept<unknown>(f.host, p);
  const rows: any[] = [];
  if(opts.diagnosticSoulIds){if(opts.diagnosticSoulIds.length!==souls||new Set(opts.diagnosticSoulIds).size!==souls||opts.diagnosticSoulIds.some(id=>!/^s_[0-9a-f]{10}$/.test(id)))throw Error('exact logged diagnostic IDs required');}
  for (let i = 0; i < souls; i++) {
    await invite(f, 'nav' + i);
    if(!opts.diagnosticSoulIds){rows.push(await accept(f.host, f.souls.create('dev:nav' + i, {name: 'Nav ' + i, description: 'walker'})));continue;}
    // Diagnostic ONLY: original hosted birth identities through the existing
    // lifecycle journal/native admission seam, never pose SQL or teleportation.
    const soulId=opts.diagnosticSoulIds[i],entityId='h_'+soulId.slice(2),runner=f.souls.lifecycle!,requestId='lc_'+String(i+1).padStart(32,'0');
    runner.journal.acceptCreate({worldId:f.host.worldId,soulId,entityId,owner:'dev:nav'+i},requestId,{name:'Nav '+i,description:'walker',native:false},()=>true);runner.pump();
    for(let j=0;j<50&&!f.souls.controlReady(f.db.soul(soulId)!);j++){await setImmediate();f.host.drainInputs();runner.pump();}
    const row=f.db.soul(soulId)!;if(!f.souls.controlReady(row)||runner.faults.size)throw Error('logged diagnostic birth did not admit');rows.push(row);
  }
  let spec: NavSpec | null = null;
  const spots = loadSpots(SPOTS).data, engine = f.host.engine as any, extra = opts.cn5 ? loadSpots(CN5_DISTRICT_SOLIDS).data.solids : [];
  if (opts.nav !== false) {
    const native = new Set([...Object.entries(engine.world.regions as Record<string, any>).filter(([, r]) => !String(r.provenance?.note ?? '').includes('placeRegionsV1')).map(([id]) => id), ...PLACES.places.filter(p => (p.occupiers ?? []).length).map(p => p.id)]);
    spec = navSpecFromPlaces(PLACES, {native, ground: GROUND, area: [engine.groundBoundsV1()], extraSolids: [...spots.solids, ...extra], rings: spots.rings, interiors: spots.interiors, platforms: spots.platforms});
    await accept(f.host, f.host.installNavV1(spec));
  }
  const byId = new Map(PLACES.places.map(p => [p.id, p]));
  const admitted = await accept(f.host, f.host.installPlaceRegionsV1(NATIVE.filter(id => byId.has(id)).map(id => ({id, label: byId.get(id)!.name, polygon: byId.get(id)!.polygon}))));
  const ledger = new EdgeLedger(f.host, f.db, PLACES, {spots: SPOTS});
  const souls_ = rows.map(r => ({soulId: r.id, entityId: r.entity_id, name: r.name, owner: r.owner}));
  return {f, fac, ledger, spec, spots, admitted, souls: souls_, engine,
    /** ledger.act through the real sequencer (it awaits the logged decision). */
    act: (soul: typeof souls_[number], capability: string, params?: object) => accept(f.host, ledger.act(soul, {capability, ...(params ? {params} : {})})),
    /** Tick until every listed receipt is terminal (or the limit), calling `each` every tick. */
    async run(receipts: {soulId: string; id: string}[], limit: number, each?: (tick: number) => void) {
      for (let i = 0; i < limit; i++) {
        if (receipts.every(r => !['waiting', 'started'].includes(ledger.receipt(r.soulId, r.id)!.phase))) return i;
        f.host.tickOnce(); each?.(f.host.engine.world.tick); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}
      }
      return limit;
    }};
}
