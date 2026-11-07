// What a floater (a static head: no hands, no arms, no feet, no lap) can do with each Mars verb.
// Every verb in api/registry.ts createRegistry() and every sequence built-in has exactly one entry
// (engine/test/floaters.test.ts enforces this both ways), each with a named reason:
//   works        — the verb's meaning survives intact with a head (face, converse, controls).
//   approximates — the verb runs with the ordinary engine semantics on the ground pose and the head is
//                  drawn hovering there (walk → glide, sit / audience / fire place → hover at the slot,
//                  sleep → settle low over the mat). The approximation is named so a UI can say so.
//   refuses      — the verb needs hands, arms, feet or a seat to ride; it is refused by name, never faked.
// Roles: a composite verb may admit a floater in one role (listener) and refuse it in another (reader).
// A role is a top-level param key; a floater id found under it gets that role's verdict, anywhere else
// the verb's own verdict. Delegating verbs (living_intention, gathering_continuation) judge their bound
// child verbs. A verb with no floater among its params is not this module's business: 'works' (humanoid).
// Pure and deterministic: no Runtime, no registry import (the table is checked against it in tests).
import {hasDeclaredProfile,profileActionProblem} from './action-profile.ts';
import type { Body } from '../world/types.ts';
import {hasBodyDance} from './motion.ts';
import { creatureOf } from './creatures.ts';

/** Ground-world swimming verbs, judged by body (creatures that swim) rather than by the table. */
const SWIM_VERBS: ReadonlySet<string> = new Set(['swim_to', 'ground_travel']);

export type Verdict = 'works' | 'approximates' | 'refuses';
export type Rule = { status: Verdict; reason: string; note: string };
export type VerbPolicy = Rule & {
  /** Verdicts for floaters named under these top-level param keys. */
  roles?: Record<string, Rule>;
  /** Judge the bound child verb(s) instead (see admitFloaters). */
  delegate?: 'objectives' | 'binding';
};

const works = (reason: string, note: string): Rule => ({ status: 'works', reason, note });
const approx = (reason: string, note: string): Rule => ({ status: 'approximates', reason, note });
const refuse = (reason: string, note: string): Rule => ({ status: 'refuses', reason, note });

// The named reasons. Keep them stable: UIs, logs and the Soul's card filter key on them.
export const R = {
  headOnly: 'floater.head-only',
  noBody: 'floater.body-independent',
  control: 'floater.control-only',
  glide: 'floater.glide',
  hoverSlot: 'floater.hover-at-slot',
  hoverSeat: 'floater.hover-at-seat',
  settle: 'floater.settle-rest',
  noHands: 'floater.no-hands',
  noArms: 'floater.no-arms',
  noFeet: 'floater.no-feet',
  climb: 'floater.climb-unsupported',
  ride: 'floater.cannot-ride',
  noAlternative: 'floater.no-admissible-alternative',
} as const;

const HANDS = (what: string) => refuse(R.noHands, `needs hands: ${what}`);
const CONTROL = (parent: string) => works(R.control, `steers an existing ${parent}; admission is decided when the session starts or a member joins`);
const listener = approx(R.hoverSeat, 'listens from a seat or place: hovers there facing the activity; no seated posture');

export const FLOATER_POLICY: Readonly<Record<string, VerbPolicy>> = {
  computer_workshop: HANDS('computer practice and workshop task execution'),
  computer_workshop_control: CONTROL('computer_workshop'),
  library_reading: HANDS('holding, carrying and reading the same book'),
  library_reading_control: CONTROL('library_reading'),
  // locomotion and the social core
  walk_to: approx(R.glide, 'glides at constant hover over the ordinary ground route; level changes only through floater-passable openings (bodies/float.ts), stairs/ladders refused by name'),
  ambient_wander: approx(R.glide, 'background strolls become glides between standable points'),
  paired_walk: approx(R.glide, 'glides beside its partner at the shared speed along the authored corridor'),
  paired_walk_control: CONTROL('paired_walk'),
  face: works(R.headOnly, 'turning to face something is a yaw; heads do it natively'),
  converse: works(R.headOnly, 'a conversation circle of faces; nothing is held'),
  sit: approx(R.hoverSeat, 'claims the seat as usual and hovers above it; no seated posture'),
  take_slot: approx(R.hoverSlot, 'holds the slot (seat / audience / fire place) hovering at it'),
  stand: approx(R.hoverSlot, 'releases the held seat or slot; the head simply rises back to cruising hover'),
  gather: approx(R.hoverSlot, 'each floater holds its assigned slot hovering'),
  campfire_circle: approx(R.hoverSlot, 'hovers at its fire place facing the fire; no hands to warm'),
  // carrying and construction
  carry: HANDS('lifting a component with a crew'),
  move_fixture: HANDS('moving a chair or table'),
  raise_upright: HANDS('walking an upright up'),
  connect_beam: HANDS('seating a beam'),
  release_support: HANDS('letting go of an upright it never held'),
  install_joist: HANDS('setting a joist'),
  install_plywood: HANDS('laying a sheet'),
  install_stair_flight: HANDS('walking a stair flight into place'),
  install_tread: HANDS('installing a tread'),
  climb_frame: refuse(R.climb, 'climbing bracing like a ladder needs hands and feet; floaters do not climb'),
  beam_walk: refuse(R.noFeet, 'balance-limited walking on a beam'),
  hand_up: HANDS('handing a sheet up or receiving it'),
  install_rail: HANDS('fastening a rail'),
  install_panel: HANDS('mounting a panel'),
  place_equipment: HANDS('setting equipment down'),
  paint: HANDS('sweeping a brush'),
  install_top_plate: HANDS('raising a top plate'),
  install_rafter: HANDS('setting a rafter'),
  install_blocking: HANDS('fitting blocking'),
  // small items and food
  take_item: HANDS('grasping a small item'),
  put_item: HANDS('releasing a held item'),
  serve: HANDS('filling a bowl from a pot'),
  eat: HANDS('bowl in one hand, spoon in the other'),
  hold_items: HANDS('keeping items at the hands'),
  prepare_food: HANDS('scooping with a held spoon'),
  stow_items: HANDS('putting held items away'),
  repair_v1: HANDS('working a held tool against a thing'),
  // Soul Actions: hand contact with world things (entries 1-44)
  hand_actuator_v1: HANDS('working a switch, door, drawer, board or rope by hand'),
  let_go_v1: HANDS('letting an idle gesture go before a reach'),
  watering_can_v1: HANDS('carrying, filling and tilting a can by its handle'),
  cup_v1: HANDS('holding, drinking from and rinsing a mug'),
  hand_over_v1: HANDS('handing a held thing to another body'),
  hand_hold_v1: HANDS('holding another body\'s hand'),
  setup_room: HANDS('moving a chair and a table'),
  shared_food_break: HANDS('taking utensils, serving and eating'),
  tidy_table: HANDS('moving loose items between slots'),
  tidy_table_control: CONTROL('tidy_table'),
  tidy_table_transfer: HANDS('take/put of one item'),
  communal_supper: HANDS('preparation, a held meal and vessel storage'),
  communal_supper_control: CONTROL('communal_supper'),
  room_preparation: HANDS('cleanup and room setup'),
  room_preparation_control: CONTROL('room_preparation'),
  // vehicles
  mount: refuse(R.ride, 'no body to stand or sit on an EUC or bicycle'),
  ride_to: refuse(R.ride, 'needs a mounted rider'),
  ride_loop: refuse(R.ride, 'needs a mounted rider'),
  dismount: refuse(R.ride, 'needs a mounted rider'),
  forklift_pick: refuse(R.ride, 'needs a mounted forklift operator'),
  forklift_deliver: refuse(R.ride, 'needs a mounted forklift operator'),
  forklift_present: refuse(R.ride, 'needs a mounted forklift operator'),
  forklift_back: refuse(R.ride, 'needs a mounted forklift operator'),
  // objects and seated work
  display_control: works(R.noBody, 'no actor: switches a display directly'),
  work_at: HANDS('typing at a computer'),
  read_book: HANDS('holding a book and turning pages'),
  chess_move: HANDS('moving a chess token'),
  drawing_work: HANDS('drawing with a held pencil'),
  computer_music: { ...HANDS('performing at a computer'), roles: { performer: HANDS('performing at a computer'), listeners: listener } },
  music_gathering: {
    ...HANDS('performing at a computer'),
    roles: { performer: HANDS('performing at a computer'), listeners: listener, dancers: refuse(R.noArms, 'grounded dance is planted-foot rhythmic arm movement') },
  },
  music_gathering_control: { ...CONTROL('music_gathering'), roles: { actor: refuse(R.noArms, 'joining as a dancer: planted-foot arm movement') } },
  grounded_dance: refuse(R.noArms, 'planted-foot rhythmic arm movement'),
  open_jam: { ...HANDS('taking turns at the workstation'), roles: { rounds: HANDS('performing a round at the workstation'), listeners: listener, dancers: refuse(R.noArms, 'grounded dance is planted-foot arm movement') } },
  open_jam_control: CONTROL('open_jam'),
  // classroom
  classroom_session: {
    ...approx(R.hoverSlot, 'host, presenters and audience hold their stations and seats hovering; talk is speech; no hands are used'),
    roles: { audience: listener },
  },
  classroom_control: CONTROL('classroom_session'),
  // reading and art
  reading_circle: { ...HANDS('the reader holds the book'), roles: { reader: HANDS('holding and reading the book'), listeners: listener } },
  reading_circle_control: { ...CONTROL('reading_circle'), roles: { intent: listener } },
  art_sharing: approx(R.hoverSlot, 'free-handed viewers at declared viewing places; attention is a facing; floaters hover at their places'),
  art_sharing_control: { ...CONTROL('art_sharing'), roles: { intent: approx(R.hoverSlot, 'joining or leaving a viewing place') } },
  gallery_tour: approx(R.hoverSlot, 'sharing circles at each stop (hover at viewing places) and glides between stops'),
  gallery_tour_control: { ...CONTROL('gallery_tour'), roles: { intent: approx(R.hoverSlot, 'joining or leaving a tour') } },
  // warm-up
  group_warmup: refuse(R.noArms, 'instructor and followers move their arms'),
  warmup_participant: refuse(R.noArms, 'follows instructor arm movements'),
  group_warmup_control: { ...CONTROL('group_warmup'), roles: { actor: refuse(R.noArms, 'joining a warm-up follows arm movements') } },
  // garden
  garden_care: HANDS('watering from a held bowl'),
  garden_circuit: HANDS('carrying a water pot'),
  garden_circuit_control: CONTROL('garden_circuit'),
  seed_planting: HANDS('carrying a seed bowl and depositing seed'),
  // sleep
  sleep: approx(R.settle, 'walks (glides) to the mat and settles low over it; the head rises as standingFraction returns'),
  sleep_on_mat: approx(R.settle, 'settles low over the mat instead of lying prone'),
  sleep_control: CONTROL('sleep'),
  // routines
  purposeful_routine: HANDS('its work, meal and notes need hands'),
  purposeful_routine_control: CONTROL('purposeful_routine'),
  gathering_continuation: { ...HANDS('a work binding needs a computer'), delegate: 'binding' },
  gathering_continuation_control: CONTROL('gathering_continuation'),
  living_intention: { ...works(R.headOnly, 'judged per objective alternative'), delegate: 'objectives' },
  living_intention_control: CONTROL('living_intention'),
  // sequence built-ins (sequence/runner.ts SEQUENCE_VERBS)
  mark: works(R.noBody, 'sequence marker: no actor'),
  cancel: works(R.noBody, 'cancels an action: no body involved'),
};

export type Admission = Rule & {
  verb: string;
  /** Floater ids the verdict is about (sorted). Empty when no floater is involved. */
  floaters: string[];
  /** For a refusal, the floaters and roles that caused it. */
  blockedBy?: { id: string; role: string; reason: string }[];
  /** living_intention: indices of objectives with no admissible alternative / admissible alternatives per objective. */
  alternatives?: { objective: number; admissible: number[] }[];
};

type BodyLookup = (id: string) => Body | undefined;
const RANK: Record<Verdict, number> = { works: 0, approximates: 1, refuses: 2 };

/** Every string anywhere in `v` (ids are strings; params are plain JSON). */
function strings(v: unknown, out: Set<string>): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/**
 * Body-aware admission: may these params run with the floaters among them? `bodyOf` returns an
 * entity's body (absent = humanoid). Pure: params are read, never modified. Unknown verbs are refused
 * ('floater.unknown-verb') when a floater is named, since nobody has judged them.
 */
export function admitFloaters(verb: string, params: unknown, bodyOf: BodyLookup): Admission {
  const isFloater = (id: string) => bodyOf(id)?.family === 'floater';
  const involved=[...strings(params,new Set())];
  for(const id of involved)if(hasDeclaredProfile(bodyOf(id))){const problem=profileActionProblem(bodyOf(id),verb,params as Record<string,unknown>);if(problem)return {verb,status:'refuses',reason:'body.unsupported',note:problem,floaters:[id]};}
  const named = involved.filter(isFloater).sort();
  const policy = FLOATER_POLICY[verb];
  if(verb==='body_motion_v1'&&named.length){const p=params as {actor?:string;motion?:string};
    if(named.length===1&&named[0]===p.actor&&p.motion==='dance'&&hasBodyDance(bodyOf(named[0])))return {verb,status:'works',reason:'body.authored-motion',note:'bounded in-place dance; no hands or root movement',floaters:named};
    return {verb,status:'refuses',reason:'body.unsupported',note:'This body has no admitted dance adapter.',floaters:named};
  }
  if (named.length && SWIM_VERBS.has(verb)) {
    // ground-world swimming (locomotion/swim.ts, registered by the ground bridge): creatures whose species swims
    const dry = named.filter((id) => !creatureOf(bodyOf(id))?.swimSpeed);
    if (!dry.length) return { verb, status: 'works', reason: 'creature.swims', note: 'a swimming creature paddles at its own pace', floaters: named };
    return { verb, status: 'refuses', reason: 'floater.no-swim', note: creatureOf(bodyOf(dry[0]))?.cannot.swim ?? 'this body does not swim', floaters: named, blockedBy: dry.map((id) => ({ id, role: '*', reason: 'floater.no-swim' })) };
  }
  if (!named.length) return { verb, status: 'works', reason: 'floater.not-involved', note: 'no floater among the params; ordinary validation applies', floaters: [] };
  if (!policy) return { verb, status: 'refuses', reason: 'floater.unknown-verb', note: `no floater policy for ${verb}`, floaters: named, blockedBy: named.map((id) => ({ id, role: '*', reason: 'floater.unknown-verb' })) };
  const p = (params ?? {}) as Record<string, unknown>;

  if (policy.delegate === 'objectives') return admitObjectives(verb, p, bodyOf, named);
  if (policy.delegate === 'binding') {
    const b = p.binding as { kind?: string } | undefined;
    const child = b?.kind === 'discussion' ? FLOATER_POLICY.converse : policy;
    const role = b?.kind === 'discussion' ? 'binding(discussion → converse)' : 'binding(work → work_at)';
    return finish(verb, named, named.map((id) => ({ id, role, rule: child })));
  }
  const judged: { id: string; role: string; rule: Rule }[] = [];
  const seen = new Set<string>();
  for (const [key, rule] of Object.entries(policy.roles ?? {})) {
    for (const id of [...strings(p[key], new Set())].filter(isFloater).sort()) {
      if (seen.has(id)) continue;
      seen.add(id);
      judged.push({ id, role: key, rule });
    }
  }
  for (const id of named) if (!seen.has(id)) judged.push({ id, role: '*', rule: policy });
  return finish(verb, named, judged);
}

function finish(verb: string, named: string[], judged: { id: string; role: string; rule: Rule }[]): Admission {
  let worst = judged[0].rule;
  for (const j of judged) if (RANK[j.rule.status] > RANK[worst.status]) worst = j.rule;
  const out: Admission = { verb, status: worst.status, reason: worst.reason, note: worst.note, floaters: named };
  if (worst.status === 'refuses') out.blockedBy = judged.filter((j) => j.rule.status === 'refuses').map((j) => ({ id: j.id, role: j.role, reason: j.rule.reason }));
  return out;
}

/** living_intention: each objective needs at least one alternative whose binding admits the floater. */
function admitObjectives(verb: string, p: Record<string, unknown>, bodyOf: BodyLookup, named: string[]): Admission {
  const objectives = Array.isArray(p.objectives) ? (p.objectives as { alternatives?: { verb?: string; params?: unknown }[] }[]) : [];
  const alternatives: { objective: number; admissible: number[] }[] = [];
  let worst: Verdict = 'works';
  const dead: number[] = [];
  objectives.forEach((o, i) => {
    const ok: number[] = [];
    let best: Verdict = 'refuses';
    (o.alternatives ?? []).forEach((a, j) => {
      // the objective's actor is implicit in living_intention: judge the child as if it named the actor
      const child = admitFloaters(String(a.verb), { ...(a.params as object), __actor: p.actor }, bodyOf);
      if (child.status !== 'refuses') {
        ok.push(j);
        if (RANK[child.status] < RANK[best]) best = child.status;
      }
    });
    alternatives.push({ objective: i, admissible: ok });
    if (!ok.length) dead.push(i);
    else if (RANK[best] > RANK[worst]) worst = best;
  });
  if (dead.length)
    return {
      verb,
      status: 'refuses',
      reason: R.noAlternative,
      note: `objective(s) ${dead.join(', ')} have no alternative a floater can do`,
      floaters: named,
      blockedBy: named.map((id) => ({ id, role: `objectives[${dead.join(',')}]`, reason: R.noAlternative })),
      alternatives,
    };
  return { verb, status: worst, reason: worst === 'works' ? R.headOnly : 'floater.via-alternatives', note: 'every objective has an admissible alternative; the floater must be bound to those', floaters: named, alternatives };
}

/** The policy as table rows (for docs / UIs), in registry order of the given verbs. */
export function policyRows(verbs: readonly string[]): { verb: string; status: Verdict; reason: string; note: string; roles: string }[] {
  return verbs.map((verb) => {
    const p = FLOATER_POLICY[verb];
    if (!p) return { verb, status: 'refuses' as Verdict, reason: 'floater.unknown-verb', note: 'not in FLOATER_POLICY', roles: '' };
    const roles = Object.entries(p.roles ?? {}).map(([k, r]) => `${k}: ${r.status} (${r.reason})`).join('; ') + (p.delegate ? `${p.roles ? '; ' : ''}delegates to ${p.delegate}` : '');
    return { verb, status: p.status, reason: p.reason, note: p.note, roles };
  });
}
