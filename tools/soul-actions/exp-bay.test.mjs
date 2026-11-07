// PC16 (#695): on a real god world, stairs go up to a rack deck that no step reaches: two Souls set a stair flight up
// against the bay's outer beam, its header on the beam's ledge, through the same invitation, op and receipts as the
// other shared operations (docs/design/shared-execution.md); one Soul sets its five treads one by one. The flight is a
// stairs link from the ground to the deck that is walked only once every tread is in; a Soul who built none of it walks
// up; a removal that would drop someone is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory as plainFactory, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/engine.ts';
import {Db} from '../../apps/server/src/db.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';

const STEP_MS = 50, IN = 0.0254, T = 3 * IN, UP_L = 12 * 0.3048, BEAM_L = 9 * 0.3048, BEAM_H = 4 * IN, ZC = 2 * 0.3048 - 1.5 * IN, GAP = 0.001;
const SPAN = 24 * IN, LEDGE_Y = BEAM_H - 1.625 * IN, JOIST_H = 3.5 * IN, PLY_T = 0.75 * IN;
const seat = (i) => 12 * IN + 6 * IN * i;
const factory = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
const LOW = 4, HIGH = 18, LEDGE_AT = seat(LOW) - BEAM_H / 2 + LEDGE_Y, DECK_Y = LEDGE_AT + JOIST_H + PLY_T;

/** A stable bay a god builds: two uprights standing face to face, step beams (@4) at seat 0 (12 in) on both columns and
 *  beams at seat 14 (8 ft, over a head on the deck) above them, all joined; upright a's base centre at (x0, z0), the bay toward −x. */
/** The bay's middle (x). */
const bayMid = (x0) => x0 - T - GAP - BEAM_L / 2;
function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  const bridge = installEngineBridge({host, god, edge, log: process.env.STAIRS_LOG ? (m) => console.log("[bridge]", m) : () => {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god, bridge});
}
async function world(t, {sharedCarry = true, names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay']} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'exp-bay-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, sharedCarry ? factory : plainFactory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => {try {w.comms?.close();} catch {} for (const h of w.hosts) try {h.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); {const tk=w.host.engine.world.tick; if(w.trace&&tk>=w.trace&&tk%10===5&&tk<w.trace+90){console.log('T',tk,Object.entries(w.souls).map(([n,q])=>{const e=w.E()[q.entityId];return n+':'+e.pose.p[0].toFixed(2)+','+e.pose.p[2].toFixed(2)+'/'+(e.human.activity??'')+(e.human.grip?'*'+e.human.grip.entity.slice(-4):'')}).join(' '), Object.values(w.E()).filter(e=>e.support?.kind==='held').map(e=>e.id.slice(-4)+'@'+e.pose.p[0].toFixed(2)+','+e.pose.p[2].toFixed(2)+'y'+(e.pose.yaw??0).toFixed(2)).join(' '));} if(w.host.clockFailure&&!w.failed){w.failed=true;throw new Error('HALT '+String(w.host.clockFailure).slice(0,300));}} await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared stairs test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls.Ada.entityId].pose.p;
  w.at = async (s, x, z) => {await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));};
  return Object.assign(w, {souls, ax, az, E, idOf: (n) => w.god.model.get(n).id});
}
const ok = (r) => {assert.notEqual(r.accepted, false, JSON.stringify(r)); return r;};
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => {for (let n = 0; n < max && !done(); n++) await w.tick(1);};
const floorsOf = (w, id) => w.host.engine.world.entityPhysicsV1?.byEntity?.[id]?.surfaces ?? [];
const inviteOf = (w, id) => w.edge.together.invite(id);
const offer = (w, s, id) => w.edge.capabilitiesPage(s, {all: true}).capabilities.find((c) => c.id === id);
const phaseOf = (w, c) => w.host.engine.programAction?.(c.op.programId)?.action.phase;
const joinsOf = (w, n) => w.god.model.get(n).joins ?? {};
async function walkTo(w, s, place) {
  const cap = w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.id === `walk:${place}`);
  assert.ok(cap?.available, JSON.stringify(w.edge.capabilities(s).filter((c) => c.verb === 'walk').map((c) => [c.id, c.label, c.available])));
  const r = ok(await act(w, s, {capability: cap.id}));
  await until(w, () => ['completed', 'failed', 'replaced'].includes(read(w, s, r)?.phase), 3000);
  return read(w, s, r);
}
/** Propose `cap` with `params`, the guest accepts revision 1, the world commits. */
async function commit(w, host, guests, cap, params) {
  const p = ok(await act(w, host, {capability: cap, params: {...params, with: guests.map((g) => g.name).join(' and ')}})), id = p.receipt.shared.invite;
  const accepts = [];
  for (const g of guests) accepts.push(ok(await act(w, g, {capability: `accept:${id}`, params: {revision: 1}})));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, host, p)));
  return {p, id, crew: [[host, p], ...guests.map((g, i) => [g, accepts[i]])], op: inviteOf(w, id).shared.op};
}
async function runTo(w, c, phase, max = 3000) {
  for (let n = 0; n < max && phaseOf(w, c) !== phase; n++) await w.tick(1);
  assert.equal(phaseOf(w, c), phase, JSON.stringify(w.host.engine.programAction?.(c.op.programId)?.action));
}
async function toEnd(w, c, max = 4000) {for (let n = 0; n < max && inviteOf(w, c.id).shared.op.phase !== 'ended'; n++) await w.tick(1); assert.equal(inviteOf(w, c.id).shared.op.phase, 'ended', JSON.stringify(inviteOf(w, c.id).shared.op));}

const D = BEAM_L + 2 * T;
const nearest = (o, h) => {const e = [...o.params.height.description.matchAll(/\d+\.\d\d/g)].map((m) => +m[0]), best = [...e].sort((x, y) => Math.abs(x - h) - Math.abs(y - h))[0]; return best;};
const log=(...a)=>console.log(...a);
test('exp', {timeout: 900000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Dee, Eve, Fay} = w.souls, x0 = w.ax + 8, z0 = w.az, xm = x0 + D / 2;
  const box=(n,x,z,h=.15)=>({op: 'place', def: 'core/zone@1', name: n, shape: {area: [[x-h,z-h],[x+h,z-h],[x+h,z+h],[x-h,z+h]]}});
  const yard=(i)=>[xm-3+ (i%4)*2, z0-7-(i>>2)*1.2];
  // name, def, spot x z yaw (site local), stock x z
  const R=Math.PI/2, H=D/2+UP_L/2;
  const stock=[['fa','core/rack-upright@2',-H,0,0,-H,-3.2],['fb','core/rack-upright@2',H,0,0,H,-3.2],
   ['beam1','core/rack-beam@5',0,-.62,0,0,-3.9],['beam3','core/rack-beam@3',0,-.74,0,0,-4.6],['beam2','core/rack-beam@5',0,.62,0,0,3.9],['beam4','core/rack-beam@3',0,.74,0,0,4.6],
   ['joist-0','core/deck-joist@1',-2*SPAN,0,R,-2*SPAN,-2.5],['joist-2','core/deck-joist@1',0,0,R,0,-2.5],['joist-4','core/deck-joist@1',2*SPAN,0,R,2*SPAN,-2.5],
   ['joist-1','core/deck-joist@1',-SPAN,0,R,-SPAN,2.5],['joist-3','core/deck-joist@1',SPAN,0,R,SPAN,2.5],['sheet','core/plywood-sheet@2',0,-2.4,0,3.4,-5.4]];
  await w.at(Ada, xm-2, z0-5.5); await w.at(Bo, xm-3, z0-5.5); await w.at(Cy, xm+2, z0-5.5); await w.at(Dee, xm+3, z0-5.5); await w.at(Eve, xm-1, z0+5.5); await w.at(Fay, xm+1, z0+5.5);
  ok(w.god.act({ops: [
    ...stock.flatMap(([n,def,x,z,r,sx,sz])=>[{op:'place',def,name:n,p:[xm+sx,z0+sz],r},box('to-'+n,xm+x,z0+z)]),
    {op: 'place', def: 'core/deck-stair@1', name: 'flight', p: [xm + 2.3, z0 + 2.4], r: Math.PI / 2},
    ...[1,2,3,4,5].map((i) => ({op: 'place', def: 'core/deck-stair-tread@1', name: `tread-${i}`, p: [xm - 2.4, z0 + 0.9 + 0.4 * i], r: 0})),
  ]}));
  await w.tick(60);
  const t0 = w.now(), pairs=[[Ada,Bo],[Cy,Dee],[Eve,Fay]];
  const T_=()=>((w.now()-t0)/1000).toFixed(1);
  const [AB,CD,EF]=pairs;
  const rounds=[[['fa',AB],['fb',CD]],[['joist-0',AB],['joist-4',CD]],[['joist-2',AB],['joist-1',EF]],[['joist-3',EF]],[['beam1',AB],['beam2',EF]],[['beam3',CD],['beam4',EF]],[['sheet',AB]]];
  for(const batch of rounds){
    const cs=[];
    for(const [n,[s1,s2]] of batch){const id=w.idOf(n);
      const pv=await act(w,s1,{capability:`carry-with:${id}`,params:{to:'to-'+n,with:s2.name}}); if(pv.accepted===false){log('REFUSED',n,JSON.stringify(pv).slice(0,400));assert.fail(n);}
      const iid=pv.receipt.shared.invite; ok(await act(w,s2,{capability:`accept:${iid}`,params:{revision:1}})); cs.push({n,id,iid,p:pv,s1});}
    await until(w,()=>cs.every(c=>inviteOf(w,c.iid).shared.op?.phase==='ended'||inviteOf(w,c.iid).state==='closed'),4000);
    for(const c of cs){const e=w.E()[c.id];const tgt=stock.find(q=>q[0]===c.n);log(c.n,inviteOf(w,c.iid).shared.op?.result,'at',(e.pose.p[0]-xm).toFixed(3),(e.pose.p[2]-z0).toFixed(3),'yaw',(e.pose.yaw??0).toFixed(3),T_(), read(w,c.s1,c.p).reason?.slice(0,160));}
  }
  log('positions', Object.entries(w.souls).map(([n,q])=>n+':'+w.E()[q.entityId].pose.p.map(v=>v.toFixed(2)).join(',')).join(' '));
  const a = await commit(w, Ada, [Bo], `raise-with:${w.idOf('fa')}`, {}), b = await commit(w, Cy, [Dee], `raise-with:${w.idOf('fb')}`, {});
  await runTo(w, a, 'hold'); await runTo(w, b, 'hold'); await w.tick(25);
  log('raised', T_(), JSON.stringify(w.E()[w.idOf('fa')].pose), JSON.stringify(w.E()[w.idOf('fb')].pose));
  const seatB = async (s1, s2, beam, column, h) => {const id = w.idOf(beam), o = offer(w, s1, `connect-beam-with:${id}`); if(!o?.available) log('no offer', beam, JSON.stringify(o)); const c = await commit(w, s1, [s2], `connect-beam-with:${id}`, {column, height: nearest(o, h)}); await toEnd(w, c); log(beam, column, h, inviteOf(w, c.id).shared.op.result, read(w,s1,c.p).reason.slice(0,80), T_());};
  await seatB(Eve, Fay, 'beam1', 'l', 0.914); await seatB(Eve, Fay, 'beam2', 'r', 0.914);
  await seatB(Eve, Fay, 'beam3', 'l', 0.305); await seatB(Eve, Fay, 'beam4', 'r', 0.305);
  ok(await act(w, Ada, {capability: `stop-carry:${a.op.id}`})); ok(await act(w, Cy, {capability: `stop-carry:${b.op.id}`}));
  await toEnd(w, a); await toEnd(w, b); log('released', w.E()[w.idOf('fa')].support.kind, w.E()[w.idOf('fb')].support.kind, T_());
  for (const k of [0,4,2,1,3]) {const [s1,s2]={0:[Ada,Bo],1:[Ada,Bo],4:[Cy,Dee],3:[Cy,Dee],2:[Eve,Fay]}[k]; const id=w.idOf(`joist-${k}`), o=offer(w,s1,`install-joist-with:${id}`); if(!o?.available)log(`joist-${k}`, JSON.stringify(o)); const pv=await act(w,s1,{capability:`install-joist-with:${id}`,params:{at:(k-2)*SPAN*Math.sign(Math.cos(w.E()[w.idOf('beam1')].pose.yaw)),with:s2.name}}); if(pv.accepted===false){log("REFUSED",JSON.stringify(pv));log('positions', Object.entries(w.souls).map(([n,q])=>n+':'+w.E()[q.entityId].pose.p.map(v=>v.toFixed(2)).join(',')).join(' '));const o2=offer(w,s1,`install-joist-with:${id}`);const pl=w.edge.bindOne?.(s1,`install-joist-with:${id}`)?.plan?.together?.choices?.find(c=>Math.abs(c.at-(k-2)*SPAN*Math.sign(Math.cos(w.E()[w.idOf('beam1')].pose.yaw)))<.1);log(JSON.stringify(w.host.engine.previewSeatV1?.('install_joist_v1',{crew:[s1.entityId,s2.entityId],...pl.params})));const e=w.E()[id];log(JSON.stringify({p:e.pose,ph:e.phase,su:e.support,r:e.reservedBy,c:e.connections}));} assert.notEqual(pv.accepted,false); const iid=pv.receipt.shared.invite, ga=ok(await act(w,s2,{capability:`accept:${iid}`,params:{revision:1}})); await until(w,()=>inviteOf(w,iid).state!=='pending',60); const c={id:iid,p:pv}; await toEnd(w,c); log('joist',k,inviteOf(w,c.id).shared.op.result, T_());}
  log('positions', Object.entries(w.souls).map(([n,q])=>n+':'+w.E()[q.entityId].pose.p.map(v=>v.toFixed(2)).join(',')).join(' '));
  const ss=w.idOf('sheet'), so=offer(w,Ada,`lay-sheet-with:${ss}`); log('sheet', so?.available, so?.blocked?.reason); const sc=await commit(w,Ada,[Bo],`lay-sheet-with:${ss}`,{}); await toEnd(w,sc); log(inviteOf(w,sc.id).shared.op.result, read(w,Ada,sc.p).reason.slice(0,100), T_());
  await w.at(Eve,xm-3.4,z0+2.5); await w.at(Cy,xm+.8,z0+3.2); await w.at(Dee,xm+3.2,z0+3.2); await w.tick(5);
  const fi=w.idOf('flight'), fo=offer(w,Cy,`install-flight-with:${fi}`); log('flight', JSON.stringify(fo).slice(0,200)); const fc=await commit(w,Cy,[Dee],`install-flight-with:${fi}`,{at:0}); await toEnd(w,fc); log(inviteOf(w,fc.id).shared.op.result, read(w,Cy,fc.p).reason.slice(0,100), T_());
  await w.tick(20);
  for (const i of [1,2,3,4,5]) {const id=w.idOf(`tread-${i}`), o=offer(w,Eve,`install-tread:${id}`); if(!o?.available) log('tread', i, JSON.stringify(o)); const r=ok(await act(w,Eve,{capability:o.id})); await until(w,()=>['completed','failed','replaced'].includes(read(w,Eve,r)?.phase),3000); log('tread',i,read(w,Eve,r).phase,read(w,Eve,r).reason??'',T_()); await w.tick(15);}
  log('link', JSON.stringify((w.host.engine.world.entityPhysicsV1?.byEntity?.[fi]?.links??[]).find(l=>l.kind==='stairs')));
  const up=await walkTo(w,Fay,'sheet'); log('walk',up.phase,JSON.stringify(up.endedAt),w.E()[Fay.entityId].pose.p,w.E()[Fay.entityId].human.level, T_());
  log('violations', JSON.stringify((w.host.engine.rt?.violations ?? []).slice(0,5)));
});
