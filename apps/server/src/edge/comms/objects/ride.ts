// Kind `ride` (OBJECT-CONTRACT-v1 §7): the social face of a native carrier (carrier/1: a balloon basket with
// seats that carries its riders on a route and back). Rider membership is physical: who rides is read from the
// native carrier every time, never stored as object bookkeeping, so the object, channel, observe and capacity can
// never disagree with the bodies. join / leave / start move the body (logged decisions with normal receipts).
// Talking in the air needs nothing here: the basket is an enclosed carrier place, so `say` reaches only riders and
// `converse` works as anywhere else.
import type {ActionCtx, CarrierView, ObjectEvent, ObjectKind, SoulRef, TimeCtx} from './types.ts';

export type RideState = {carrier: string; capacity: number; phase: string; riders: SoulRef[]; seatsFree: number; departsInSeconds: number | null; holding: boolean; flights: number; routeSeconds: number; door: [number, number] | null;
  /** together/1: invited companions the basket keeps a place for and waits for (absent on older objects). */
  keptFor?: SoulRef[]; rowing?: boolean;
  /** RIDE-EXIT: riders back on the ground who are still stepping out (their body is in the basket/punt until the engine sets it down). */
  stepping?: SoulRef[];
  /** D1: riders still boarding (walking into their seat); they are "in" the basket or punt only once seated. */
  boarding?: SoulRef[];
  /** seconds a boarding ride waits for more riders before it departs by itself */
  waitSeconds?: number;
  /** VEHICLE-STEER: the rider steering it now (null: it follows its own route, or flies itself back). */
  steeredBy?: SoulRef | null;
  /** RIDE-LABELS: what the carrier is (a god ferris wheel or carousel is a balloon carrier on the attraction's route). */
  vehicle?: Vehicle};
export type Vehicle = 'balloon' | 'punt' | 'ferris-wheel' | 'carousel';
/** RIDE-LABELS: the vehicle of a carrier: its def (punt), the attraction route it was installed with, or the carrier id
 *  (installGodRides names attraction carriers after the wheel or carousel); sticky so a steered or re-routed ride keeps it. */
export function vehicleOf(v: {def?: string; id?: string; route?: {id?: string}} | null, prior?: Vehicle): Vehicle {
  if (v?.def === 'rowing-punt') return 'punt';
  const r = v?.route?.id ?? '';
  if (/^ferris-wheel/.test(r)) return 'ferris-wheel';
  if (/^carousel/.test(r)) return 'carousel';
  if (prior) return prior;
  return /ferris/.test(v?.id ?? '') ? 'ferris-wheel' : /carousel/.test(v?.id ?? '') ? 'carousel' : 'balloon';
}
const attraction = (s: RideState) => s.vehicle === 'ferris-wheel' ? 'ferris wheel' : s.vehicle === 'carousel' ? 'carousel' : null;

const view = (ctx: TimeCtx | ActionCtx, id: string): CarrierView | null => ctx.carrier?.(id) ?? null;
function from(state: RideState, v: CarrierView | null): RideState {
  if (!v) return {...state, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null};
  return {carrier: state.carrier, rowing: v.def === 'rowing-punt', vehicle: vehicleOf(v, state.vehicle), capacity: v.capacity, phase: v.phase, holding: v.holding, flights: v.flights, seatsFree: v.seatsFree, routeSeconds: Math.round(v.route.seconds),
    door: v.door as [number, number] | null, departsInSeconds: v.departsInSeconds, waitSeconds: (v as {waitSeconds?: number}).waitSeconds ?? 45, keptFor: (v as {hold?: {for: SoulRef[]}}).hold?.for ?? [],
    riders: v.riders.filter(r => r.soulId && r.phase !== 'leaving').map(r => ({soulId: r.soulId!, name: r.name ?? 'someone'})),
    stepping: v.riders.filter(r => r.soulId && r.phase === 'leaving').map(r => ({soulId: r.soulId!, name: r.name ?? 'someone'})),
    boarding: v.riders.filter(r => r.soulId && r.phase === 'boarding').map(r => ({soulId: r.soulId!, name: r.name ?? 'someone'})),
    steeredBy: ((v as {steer?: {by: SoulRef | null}}).steer?.by) ?? null};
}
/** VERBS (accept2 brief 10): the refusal for a ride the world would not board today; join offers it as unavailable. */
const blockedRefusal = (s: RideState, b: {code: string; message: string}) => ({code: 'ride.blocked', reason: `This ${s.rowing ? 'punt' : 'ride'} cannot be boarded right now: ${b.message} (${b.code}).`});
const minutes = (s: number) => s >= 90 ? `about ${Math.round(s / 60)} minutes` : `${Math.round(s)} seconds`;

export const rideKind: ObjectKind<RideState> = {
  kind: 'ride',
  description: 'A native ride for one or two people: balloon flight, rowing punt, ferris wheel or carousel (state.vehicle). Join walks to its boarding point. A balloon join completes when seated; a punt join completes only after its water loop and disembarkation. Both depart automatically after boarding (sooner when full; balloon riders may also start early) and return to their starting point. A punt is open to shore speech; a balloon basket is private. Invite companions with params {"with":["<Soul ID or name>"]}; each independently accepts, and the ride keeps their place for up to 90 seconds. Read the object and receipt to distinguish boarding, travelling, returned and ashore.',
  listed: true,
  roles: [{id: 'rider', relations: [{name: 'shares', to: 'rider'}]}],
  schema: {
    rowing: {type: 'boolean', visibility: 'public'},
    vehicle: {type: 'string', visibility: 'public', description: 'balloon, punt, ferris-wheel or carousel'},
    carrier: {type: 'string', visibility: 'public'}, capacity: {type: 'integer', visibility: 'public'}, phase: {type: 'string', visibility: 'public'},
    riders: {type: 'soul[]', visibility: 'public'}, seatsFree: {type: 'integer', visibility: 'public'}, departsInSeconds: {type: 'json', visibility: 'public'},
    holding: {type: 'boolean', visibility: 'public'}, flights: {type: 'integer', visibility: 'public'}, routeSeconds: {type: 'integer', visibility: 'public'}, door: {type: 'json', visibility: 'public'},
    keptFor: {type: 'json', visibility: 'public', description: 'invited companions the basket keeps a place for and waits for'},
    stepping: {type: 'soul[]', visibility: 'public', description: 'riders back on the ground who are stepping out now'},
    waitSeconds: {type: 'integer', visibility: 'public', description: 'seconds it waits at boarding before it departs by itself'},
    steeredBy: {type: 'json', visibility: 'public', description: 'the rider steering it now; null when it follows its own route'},
  },
  initial(params, ctx) {
    const carrier = String(params.carrier ?? '');
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(carrier)) throw new Error('ride needs params.carrier (a native carrier entity id)');
    const pv = String(params.vehicle ?? ''), prior = (['balloon', 'ferris-wheel', 'carousel'] as const).find(x => x === pv);
    return from({carrier, ...(prior ? {vehicle: prior} : {}), capacity: 0, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null, holding: false, flights: 0, routeSeconds: 0, door: null, keptFor: []}, view(ctx, carrier));
  },
  rolesOf: (s, soulId) => s.riders.some(r => r.soulId === soulId) || (s.stepping ?? []).some(r => r.soulId === soulId) ? ['rider'] : [],
  personal: (s, soulId) => ({riding: s.riders.some(r => r.soulId === soulId)}),
  advance(state, ctx) {
    const next = from(state, view(ctx, state.carrier));
    if (JSON.stringify({...next, departsInSeconds: null}) === JSON.stringify({...state, departsInSeconds: null})) return null;
    const to = next.riders.map(r => r.soulId), events: ObjectEvent[] = [], was = [...new Set([...state.riders.map(r => r.soulId), ...to])];
    if (state.phase !== next.phase && was.length) {
      if (next.phase === 'aloft') events.push({to: was, text: next.rowing ? `You row away from the bank. The water loop takes ${minutes(next.routeSeconds)}; you can talk in the open punt.` : attraction(next) ? `The ${attraction(next)} starts. The ride takes ${minutes(next.routeSeconds)}; you can talk freely in the car (only riders hear you).` : `The balloon lifts off. The flight takes ${minutes(next.routeSeconds)}; you can talk freely in the basket (only riders hear you).`});
      if (next.phase === 'landed' || (state.phase === 'aloft' && next.phase === 'parked')) events.push({to: was, text: next.rowing ? 'The punt has returned to its bank; you are disembarking. Wait for the row receipt and your ashore observation.' : attraction(next) ? `The ${attraction(next)} has stopped where you boarded; you step out.` : 'The balloon has landed where it started; you step out onto the grass.'});
    }
    // D1 (playtest 121122 zed-019: "You are in the punt" at accept, rowing ~10 s later): a rider is in only once seated
    const seated = (x: RideState, id: string) => x.riders.some(o => o.soulId === id) && !(x.boarding ?? []).some(o => o.soulId === id);
    const into = next.rowing ? 'the punt' : attraction(next) ? `the ${attraction(next)} car` : 'the basket';
    if (next.phase === 'boarding') for (const r of next.riders.filter(r => seated(next, r.soulId) && !seated(state, r.soulId)))
      events.push({to: to.filter(id => id !== r.soulId), text: `${r.name} climbs into ${into} with you.`, untrusted: true}, {to: [r.soulId], text: (next.keptFor ?? []).length
        ? `You are in ${into}. It waits for ${(next.keptFor ?? []).map(k => k.name).join(', ')} before departing, and lifts off by itself once they are aboard.` : `You are in ${into}. It departs in about ${next.departsInSeconds ?? 0} seconds, or now if a rider says start.`, untrusted: true});
    // RIDE-EXIT: the owner-readable end of a ride: the body is out and standing on the ground.
    const inside = (x: RideState) => [...x.riders, ...(x.stepping ?? [])];
    if (state.phase === 'aloft' || state.phase === 'landed') for (const r of inside(state).filter(r => !inside(next).some(o => o.soulId === r.soulId)))
      events.push({to: [r.soulId], text: next.rowing ? 'You are ashore, standing on the bank by the punt; you can go anywhere now.' : attraction(next) ? `You are off the ${attraction(next)}, standing on the ground by it; you can go anywhere now.` : 'You are out of the balloon, standing on the ground by its basket; you can go anywhere now.'});
    if (!state.holding && next.holding && to.length) events.push({to, text: next.rowing ? 'The punt waits at the bank until its disembarkation point is clear.' : 'The balloon hovers above its landing spot until the ground below is clear.'});
    return {state: next, events};
  },
  actions: {
    join: {
      movesBody:true,
      label: 'Join the ride: board, travel and return (punt receipt includes disembarkation)', roles: 'anyone', reach: 'anywhere', params: {},
      // RIDE-EXIT (A): the offer states the commitment so an agent can tell its owner before joining.
      labelFor: s => attraction(s)
        ? `Ride the ${attraction(s)}: it starts by itself ${s.departsInSeconds != null ? `in ~${s.departsInSeconds} s` : `~${s.waitSeconds ?? 45} s after you are seated`}, ${s.vehicle === 'carousel' ? 'turns' : 'goes round'} for ${minutes(s.routeSeconds)} and stops where you boarded; you cannot get off while it ${s.vehicle === 'carousel' ? 'turns' : 'goes round'}`
        : s.rowing
        ? `Board the punt: it pushes off by itself ${s.departsInSeconds != null ? `in ~${s.departsInSeconds} s` : `~${s.waitSeconds ?? 45} s after you are aboard`}, rows ${minutes(s.routeSeconds)} on the water and returns to this bank, where you step ashore`
        : `Board the balloon: it lifts off by itself ${s.departsInSeconds != null ? `in ~${s.departsInSeconds} s` : `~${s.waitSeconds ?? 45} s after you are seated`}, flies ${minutes(s.routeSeconds)} and lands where it started; you cannot get off in the air`,
      available: (s, ctx) => s.riders.some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.already-aboard', reason: 'You are already in it.'}
        : s.phase === 'aloft' ? {code: 'ride.departed', reason: s.rowing ? 'It is out on the water; it returns to this bank.' : attraction(s) ? `The ${attraction(s)} is going round; it stops where you boarded.` : 'It is in the air; it lands where it started.'}
        : s.phase === 'landed' ? {code: 'ride.landing', reason: 'It has just returned; its riders are stepping out.'}
        : s.phase === 'closed' ? {code: 'ride.closed', reason: 'This ride is not running.'}
        // VERBS (accept2 brief 10): the world would refuse a new boarding today (a punt whose bank or water no longer qualifies)
        : view(ctx, s.carrier)?.blocked ? blockedRefusal(s, view(ctx, s.carrier)!.blocked!)
        : s.seatsFree < 1 && !(s.keptFor ?? []).some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.full', reason: (s.keptFor ?? []).length ? `The last place is kept for ${(s.keptFor ?? []).map(r => r.name).join(', ')}.` : 'Every place in this ride is taken.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.join.available!(s, ctx); },
      apply(s, _p, _ctx) {
        return {state: s, result: {boarding: s.carrier}, bodies: [{label: s.rowing ? 'Row the punt loop and disembark' : attraction(s) ? `Ride the ${attraction(s)}` : 'Board the balloon', steps: [
          ...(!s.rowing ? [{verb: 'stand', params: {}}] : []), {verb: 'walk_to', params: {to: s.rowing ? s.door : s.carrier, standoff: s.rowing ? 0 : 2.2, ...(s.rowing ? {} : {stand: 'clear/1'})}}, {verb: 'mars:carrier_ride', params: {carrier: s.carrier, ...(s.rowing ? {throughReturn: true} : {})}}]}]};
      },
    },
    leave: {
      movesBody:true,
      label: 'Disembark at the boarding point (only while parked)', roles: ['rider'], reach: 'anywhere', params: {},
      available: (s, ctx) => (s.stepping ?? []).some(r => r.soulId === ctx.soul.soulId) ? null : s.phase === 'aloft' ? {code: 'ride.aloft', reason: s.rowing ? 'You are on the water; finish the loop and disembark at the bank.' : 'You are in the air; it lands by itself and you step out then.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.leave.available!(s, ctx); },
      apply(s, _p, ctx) {
        // Already stepping out (the ride is back on the ground): the engine is moving the body out; nothing new to start.
        if ((s.stepping ?? []).some(r => r.soulId === ctx.soul.soulId)) return {state: s, result: {steppingOut: s.carrier, onGroundWithinSeconds: 12}};
        const rider = ctx.carrier?.(s.carrier)?.riders.find(r => r.soulId === ctx.soul.soulId), exit = rider?.exit ?? s.door;
        // A rider seated in a parked balloon: a walk cannot start inside the basket (route.start-blocked), so carrier_alight ends the
        // held ride, whose own step-out walks the body out through the door before lift-off (carrier.ts).
        if (rider && !s.rowing) return {state: s, result: {leaving: s.carrier}, bodies: [{label: 'Step out of the balloon', steps: [{verb: 'mars:carrier_alight', params: {carrier: s.carrier}}]}]};
        return {state: s, result: {leaving: s.carrier}, bodies: [{label: s.rowing ? 'Disembark the punt' : 'Step out of the balloon', steps: [{verb: 'walk_to', params: {to: exit, standoff: 0}}]}]};
      },
    },
    start: {
      movesBody:true,
      label: 'Depart now instead of waiting for more riders', roles: ['rider'], reach: 'anywhere', params: {},
      // r3 quality case 33: a host who forced "start" while the invited companion (who had accepted) was still walking to the
      // basket left them behind (carrier.departed). While a place is kept for an invited companion, it departs by itself.
      available: s => s.rowing ? {code: 'ride.automatic', reason: 'The punt departs automatically after boarding; wait for the rowing receipt.'} : s.phase !== 'boarding' ? {code: 'ride.not-boarding', reason: 'It is not waiting at its boarding point.'}
        : (s.keptFor ?? []).length ? {code: 'ride.keeping-place', reason: `It is keeping a place for ${(s.keptFor ?? []).map(k => k.name).join(', ')} (invited) and departs by itself once they are aboard or the hold ends; starting now would leave them behind. Keep waiting.`} : null,
      validate(s, _p, ctx) { return rideKind.actions.start.available!(s, ctx); },
      apply(s) { return {state: s, result: {departing: s.carrier}, bodies: [{label: s.rowing ? 'Start the rowing loop' : 'Ask the balloon to lift off', steps: [{verb: 'mars:carrier_depart', params: {carrier: s.carrier}}]}]}; },
    },
    // VEHICLE-STEER (Gene 2026-10-23, #12): one verb for every ride. The engine owns the physics and the honest refusals
    // (another rider steering, no landing spot, no open water, out of bounds); this resolves the destination for the Soul.
    steer: {
      movesBody: true,
      label: 'Steer it: to a place (to) or a direction + distance; add land to set down there; land alone lands here (a punt rows back to its bank); stop holds here',
      roles: ['rider'], reach: 'anywhere',
      params: {
        to: {type: 'string', maxLength: 100, optional: true, description: 'a place you know'},
        direction: {type: 'string', maxLength: 10, optional: true, description: 'N, NE, E, SE, S, SW, W or NW (with distance)'},
        distance: {type: 'integer', min: 5, max: 1000, optional: true, description: 'metres in that direction'},
        land: {type: 'boolean', optional: true, description: 'set down (there, or here); a punt lands only at its own bank'},
        stop: {type: 'boolean', optional: true, description: 'stop and hold here; with no new steer it rejoins its own route after 2 minutes'},
      },
      available: (s, ctx) => !s.riders.some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.not-aboard', reason: 'Only a seated rider can steer; join it first.'}
        : s.phase !== 'aloft' && s.phase !== 'boarding' ? {code: 'ride.on-ground', reason: 'It is on the ground; its riders are stepping out.'}
        : s.steeredBy && s.steeredBy.soulId !== ctx.soul.soulId ? {code: 'ride.steered', reason: `${s.steeredBy.name} is steering it; wait until they stop or land.`}
        : null,
      validate(s, p, ctx) {
        const no = rideKind.actions.steer.available!(s, ctx); if (no) return no;
        const modes = [p.to !== undefined, p.direction !== undefined || p.distance !== undefined, p.stop === true].filter(Boolean).length;
        if (modes > 1 || (p.stop && p.land) || (modes === 0 && !p.land)) return {code: 'ride.steer-params', reason: 'Steer with one of: to (a place), direction + distance, land, or stop.'};
        const t = p.stop || (p.land && modes === 0) ? null : ctx.steerTarget?.(s.carrier, {to: p.to as string | undefined, direction: p.direction as string | undefined, distance: p.distance as number | undefined});
        if (t === undefined) return {code: 'steer.unavailable', reason: 'Steering is not available here.'};
        if (t && !t.ok) return {code: t.code, reason: t.reason};
        return ctx.steerCheck?.(s.carrier, {...(t ? {x: t.x, z: t.z} : {}), ...(p.land ? {land: true} : {}), ...(p.stop ? {stop: true} : {})}) ?? null;
      },
      apply(s, p, ctx) {
        const what = s.rowing ? 'the punt' : 'the balloon';
        const t = p.stop || (p.land && p.to === undefined && p.direction === undefined) ? null : ctx.steerTarget!(s.carrier, {to: p.to as string | undefined, direction: p.direction as string | undefined, distance: p.distance as number | undefined});
        const at = t && t.ok ? t : null, land = p.land === true;
        const doing = p.stop ? `stops ${what} where it is` : at ? `steers ${what} toward ${at.label}${land ? (s.rowing ? '' : ' to land there') : ''}` : s.rowing ? 'rows the punt back to its bank' : 'brings the balloon down here';
        return {state: s, result: {steering: s.carrier, ...(at ? {toward: at.label} : {}), land, stop: p.stop === true},
          events: [{to: s.riders.map(r => r.soulId).filter(id => id !== ctx.soul.soulId), text: `${ctx.nameOf(ctx.soul.soulId)} ${doing}.`, untrusted: true}],
          bodies: [{label: `Steer ${what}${at ? ` toward ${at.label}` : p.stop ? ': stop' : ': land'}`, steps: [{verb: 'mars:carrier_steer', params: {carrier: s.carrier, ...(at ? {x: at.x, z: at.z} : {}), ...(land ? {land: true} : {}), ...(p.stop ? {stop: true} : {})}}]}]};
      },
    },
  },
};
