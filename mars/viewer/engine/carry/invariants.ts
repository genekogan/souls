// Carry invariants (spec §11, §31), checked at the end of every tick from the
// world state alone (no action internals; a `keepYawV1` carry's flag only admits
// the load's other frame along its axis, #1031): a carried load is held by exactly
// its crew; while the crew is moving it ('carry' activity) every carrier is on
// its slot-derived position and the load's footprint clears static geometry.
import type { Vec2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
import { entityFrame, formationFor, gripError, isCarryLoad, toWorld } from './formation.ts';
import { poseHit } from './sweep.ts';
import { activeLoadDiscs, carryExecsOf } from './actions.ts';
import { HAND_REACH, LIFT_APEX_MAX } from '../construction/liftcrew.ts';
import { CATALOG, HUMAN_RADIUS } from '../world/catalog.ts';
import { linkUnder, stairClearance } from './climb.ts';
import { fragileLoadsOk } from './fragile.ts';
import { hypot } from '../core/math.ts';
import { relevantEntities } from '../world/relevant.ts';

export const GRIP_TOL = 0.05; // m
const CLEAR_TOL = 0.03; // m, same tolerance as the human clearance invariant

export const carryIntegrity: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const e of relevantEntities(rt.world)) {   // carried loads (a phase) only (world/relevant.ts)
    if (!isCarryLoad(e)) continue;
    const s = e.support;
    if (s?.kind === 'forks') continue; // on a forklift: covered by the forkliftLoad invariant (vehicles/forklift.ts)
    if (s?.kind !== 'held' || !s.by.length) {
      out.push({ code: 'carry.support', message: `${e.id} is carried but not held (support ${s?.kind ?? 'none'})`, subjects: [e.id], at: e.pose.p });
      continue;
    }
    const gripping = relevantEntities(rt.world).filter((h) => h.human?.grip?.entity === e.id).map((h) => h.id);
    const crew = s.by;
    if (gripping.length !== crew.length || crew.some((c) => !gripping.includes(c)) || crew.some((c) => ents[c]?.kind !== 'human')) {
      out.push({ code: 'carry.support', message: `${e.id} is held by [${crew.join(', ')}] but gripped by [${gripping.join(', ')}]`, subjects: [e.id, ...crew], at: e.pose.p });
      continue;
    }
    if (!crew.every((c) => ents[c].human!.activity === 'carry')) continue; // lifting / setting down: load in transition
    const f = formationFor(e.def, crew.length);
    const q = entityFrame(e).q;
    // carriers in slot order of their grips
    const slotIdx = crew.map((c) => f.carriers.findIndex((k) => k.slot === ents[c].human!.grip!.slot));
    const actual = Array.from<Vec2>({ length: crew.length });
    crew.forEach((c, j) => (actual[slotIdx[j]] = [ents[c].pose.p[0], ents[c].pose.p[2]]));
    let ge = gripError(f, q, actual);
    // #1031: a `keepYawV1` carry poses the load in either frame along its axis, so the whole crew may stand at the
    // stations of the other one; every carrier must still be on its station in that one frame
    if (e.reservedBy && carryExecsOf(rt).get(e.reservedBy)?.p.keepYaw) {
      const other = gripError(f, { ...q, th: q.th + Math.PI }, actual);
      if (other.max < ge.max) ge = other;
    }
    if (ge.max > GRIP_TOL) {
      const who = crew[slotIdx.indexOf(ge.carrier)];
      out.push({ code: 'carry.grip-drift', message: `${who} is ${ge.max.toFixed(3)} m off grip ${f.carriers[ge.carrier].slot} of ${e.id}`, subjects: [e.id, who], at: e.pose.p });
    }
    const sp = rt.services.spatial as Spatial;
    sp.sync(rt.world);
    const lvl = ents[crew[0]].human!.level;
    const g = sp.level(lvl);
    if (!g) continue;
    const loadOnly = { ...f, discs: f.discs.filter((d) => d.part === 'load') };
    const hit = { p: [0, 0] as Vec2 };
    if (poseHit(g, loadOnly, q, -CLEAR_TOL, hit) >= 0)
      out.push({ code: 'carry.load-static', message: `carried ${e.id} (${f.name}) overlaps static geometry near (${hit.p[0].toFixed(2)}, ${hit.p[1].toFixed(2)})`, subjects: [e.id], at: [hit.p[0], e.pose.p[1], hit.p[1]] });
  }
  return out;
};

/** No person outside the crew stands inside a carried load's disc cover (+ body radius) — review C3. */
export const humanLoadClearance: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const discs = activeLoadDiscs(rt);
  if (!discs.length) return out;
  for (const h of relevantEntities(rt.world)) {   // bodies only
    if (h.kind !== 'human' || !h.human) continue;
    for (const d of discs) {
      if (d.crew.includes(h.id) || h.human.level !== d.level || seen.has(`${h.id}|${d.entity}`)) continue;
      const gap = hypot(h.pose.p[0] - d.p[0], h.pose.p[2] - d.p[1]) - d.r;
      if (gap < HUMAN_RADIUS - CLEAR_TOL) {
        seen.add(`${h.id}|${d.entity}`);
        out.push({ code: 'collision.human-load', message: `${h.id} overlaps the carried ${d.entity} (body centre ${gap.toFixed(2)} m from the load cover, needs ${HUMAN_RADIUS} m)`, subjects: [h.id, d.entity], at: h.pose.p });
      }
    }
  }
  return out;
};

/**
 * A load carried on a flight (crew activity climb-*) stays above the flight's step profile: every
 * sampled point of its box is at least the step height under it − 0.02 m (climb.ts stairClearance).
 * The flight is found geometrically (nearest link centreline), not from the action.
 */
export const carryStairsClearance: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  let sp: Spatial | null = null;
  for (const e of relevantEntities(rt.world)) {   // components only
    if (e.kind !== 'component' || e.phase !== 'carried' || e.support?.kind !== 'held' || !e.support.by.length) continue;
    if (!e.support.by.every((c) => ents[c]?.human?.activity.startsWith('climb'))) continue;
    if (!sp) { sp = rt.services.spatial as Spatial; sp.sync(rt.world); }
    const f = formationFor(e.def, e.support.by.length);
    const q = entityFrame(e).q;
    const link = linkUnder(sp.scene.links, [q.x, q.z], f.length);
    if (!link) continue;
    const iss = stairClearance(link, e.def, e.pose);
    if (iss)
      out.push({
        code: 'carry.stairs-clearance',
        message: `carried ${e.id} (${f.name}) is ${iss.deficit.toFixed(3)} m below the ${iss.surface.toFixed(2)} m step surface of ${link.id} at (${iss.at[0].toFixed(2)}, ${iss.at[1].toFixed(2)}, ${iss.at[2].toFixed(2)})`,
        subjects: [e.id, link.id],
        at: iss.at,
      });
  }
  return out;
};

/** Fixture transport's authored hand segment stays reachable throughout lift/move/lower. */
export const fixtureCarryReach: Invariant = rt => {
  const out: Diagnostic[]=[];
  for(const e of relevantEntities(rt.world)){   // held things only
    const capability=CATALOG[e.def]?.capabilities?.fixtureCarry;
    if(e.kind!=='fixture'||!capability||e.support?.kind!=='held'||!e.reservedBy||rt.records.get(e.reservedBy)?.verb!=='move_fixture'||!rt.isActive(e.reservedBy))continue;
    for(const id of e.support.by){
      const actor=rt.world.entities[id], grip=capability.handling.grips[e.support.by.length]?.find(g=>g.id===actor?.human?.grip?.slot);
      if(!actor?.human||!grip){out.push({code:'carry.fixture-grip',message:`${id} has no authored grip for held fixture ${e.id}`,subjects:[id,e.id]});continue;}
      for(const sign of [-.5,.5]){
        const span=grip.span??[0,0,0];
        const hand=toWorld(e.pose,[grip.local[0]+sign*span[0],grip.local[1]+sign*span[1],grip.local[2]+sign*span[2]]);
        if(hypot(actor.pose.p[0]-hand[0],actor.pose.p[2]-hand[2])>HAND_REACH+1e-6||hand[1]-actor.pose.p[1]>LIFT_APEX_MAX+1e-6)
          out.push({code:'carry.fixture-reach',message:`${id} cannot reach ${e.id} grip ${grip.id}`,subjects:[id,e.id],at:hand});
      }
    }
  }
  return out;
};

export const CARRY_INVARIANTS = [carryIntegrity, humanLoadClearance, carryStairsClearance, fragileLoadsOk, fixtureCarryReach];
