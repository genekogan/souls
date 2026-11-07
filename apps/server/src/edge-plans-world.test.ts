// Plans and fade-by-abandonment in a real native Eden world (nav/1, activities): "lie down for 90 minutes" stays green
// (a plan keeps the body lying; a single long lie holds by itself), a chosen seat holds, an abandoned Soul still fades,
// the plan-driven acts are ordinary logged decisions (the world replays to the same state), and events carry `where`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {kernelHash} from '@souls/kernel';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {registerEdgeEvents} from './edge/events/index.ts';
import {registerEdgePlans} from './edge/plans/index.ts';
import {edgeSoulResolver} from './edge/routes.ts';
import {WorldHost} from './world.ts';

const MIN = 60_000;

test('plans + fade by abandonment in a native world: lie 90 min on instruction stays green; replay is exact', {timeout: 900000}, async t => {
  const w = await edenNavWorld(4); t.after(() => {w.f.host.stop(); w.f.db.close();});
  let now = 1_900_000_000_000;
  const app = new Hono(), deps = {host: w.f.host, db: w.f.db, souls: w.f.souls, soul: edgeSoulResolver(w.f.host, w.f.souls, () => undefined), ledger: w.ledger};
  const comms = registerEdgeComms(app, deps, {fading: true, beam: true, now: () => now, sweepMs: 0}); w.ledger.attachComms(comms as never);
  const events = registerEdgeEvents(app, deps, comms, {placeName: id => w.ledger.places.byId.get(id)?.name ?? null});
  const plans = registerEdgePlans(app, deps, comms, events, w.ledger, {tickMs: 0});
  t.after(() => {plans.close(); events.close(); comms.close();});
  const [ana, ben, cai, dot] = w.souls, body = (s: typeof ana) => w.engine.world.entities[s.entityId];
  /** World time passes in ticks; wall time (fading, plan deadlines) in the fake clock. */
  let lieTicks = 0, allTicks = 0;
  const run = async (ticks: number) => {for (let i = 0; i < ticks; i++) {w.f.host.tickOnce(); allTicks++; if (body(ana)?.human?.activity === 'lie') lieTicks++; if (i % 20 === 0) {await setImmediate(); w.f.host.drainInputs(); plans.tick();}} await setImmediate(); w.f.host.drainInputs();};
  const settle = async <T>(p: Promise<T>) => {let done = false; p.then(() => done = true, () => done = true); for (let i = 0; i < 400 && !done; i++) {w.f.host.tickOnce(); await setImmediate(); w.f.host.drainInputs();} assert.ok(done, 'settled'); return p;};
  comms.sweep();
  // spread out first (two bodies lying side by side at the spawn point nudge each other: pose.moved)
  for (const [s, to] of [[ana, 'walk:eden-gardens'], [ben, 'walk:eden-stone-garden']] as const) {const r = await settle(w.ledger.act(s, {capability: to})) as any; assert.equal(r.accepted, true, to + ' ' + JSON.stringify(r)); await w.run([{soulId: s.soulId, id: r.receipt.id}], 6000);}
  // Ana: the owner says "lie down for an hour and a half" → a one-step plan; each lie lasts 20 s here, the plan keeps her lying
  const made = await settle(plans.create(ana, {steps: [{do: 'lie down', for: '90m', params: {seconds: 20}}]}));
  assert.equal(made.plan.steps[0].status, 'running', JSON.stringify(made.plan));
  assert.equal(made.plan.steps[0].capability, 'lie:here');
  // Ben: "lie down" once, for 30 min (one act, no plan) — the activity in progress holds him
  const lie = await settle(w.ledger.act(ben, {capability: 'lie down', params: {seconds: 1800}})) as any; assert.equal(lie.accepted, true, JSON.stringify(lie));
  // Cai: "sit down" — sits, the act ends, the seat stays held: a chosen posture
  const fire = await settle(w.ledger.act(cai, {capability: 'walk:social-eden-fire-circle'})) as any; assert.equal(fire.accepted, true);
  await w.run([{soulId: cai.soulId, id: fire.receipt.id}], 6000);
  const sit = await settle(w.ledger.act(cai, {capability: 'sit down', params: {seconds: 5}})) as any; assert.equal(sit.accepted, true, JSON.stringify(sit));
  await w.run([{soulId: cai.soulId, id: sit.receipt.id}], 3000);
  assert.equal(w.ledger.receipt(cai.soulId, sit.receipt.id)!.phase, 'completed'); assert.equal(body(cai).human.activity, 'sit');
  // Dot: does nothing at all (truly abandoned)
  const lying = new Set<string>(), colours: Record<string, string[]> = {ana: [], ben: [], cai: [], dot: []};
  for (let m = 0; m < 90; m += 5) {
    now += 5 * MIN;
    await run(600);                                   // 30 s of world time per 5 wall minutes: Ana's 20-s lies end and start again
    if (body(ana).human.activity === 'lie') lying.add(String(m));
    comms.sweep();
    for (const [n, s] of [['ana', ana], ['ben', ben], ['cai', cai], ['dot', dot]] as const) colours[n]!.push(comms.fading.status(s.soulId)!.colour);
  }
  t.diagnostic(JSON.stringify({colours, lyingSamples: lying.size, reissues: plans.current(ana).plan?.steps[0]}));
  assert.ok(colours.ana!.every(c => c === 'green'), 'Ana lying 90 min under a plan stays green: ' + colours.ana!.join(' '));
  assert.ok(colours.ben!.every(c => c === 'green'), 'Ben lying on a single 30-min act stays green: ' + colours.ben!.join(' '));
  assert.ok(colours.cai!.every(c => c === 'green'), 'Cai, seated by her own choice, stays green: ' + colours.cai!.join(' '));
  assert.equal(colours.dot!.at(-1), 'gone', 'Dot, abandoned, still fades at 60');
  t.diagnostic(`Ana lying ${lieTicks}/${allTicks} ticks`);
  assert.ok(lieTicks / allTicks > 0.5, `Ana is lying most of the time (${lieTicks}/${allTicks} ticks)`);
  const acts = w.f.db.db.prepare("SELECT capability, client_ref FROM edge_receipts_v1 WHERE world_id=? AND soul_id=? ORDER BY created_at").all(w.f.host.worldId, ana.soulId) as {capability: string; client_ref: string}[];
  const lies = acts.filter(a => a.client_ref?.startsWith('pl:'));
  assert.ok(lies.length >= 10 && lies.every(a => a.capability === 'lie:here' && /^pl:pl_[^:]+:0:\d+$/.test(a.client_ref)), `the plan lay down again each time the lie ended (${lies.length} acts)`);
  // the plan's events: started once (with what it chose), its receipts tagged and quiet, `where` on them
  const env = (await comms.streams.read(ana.soulId, 0, 1000)).events.map(e => events.envelope(ana.soulId, e));
  assert.equal(env.filter(e => e.kind === 'plan.step.started').length, 1);
  const planReceipts = env.filter(e => e.raw === 'receipt' && (e.data?.receipt as any)?.capability === 'lie:here');
  assert.ok(planReceipts.length >= 10 && planReceipts.every(e => e.salience <= 1 && (e.data?.plan as any)?.step === 0), 'plan-driven receipts are tagged and quiet');
  assert.equal(env.find(e => e.raw === 'receipt' && (e.data?.receipt as any)?.capability === 'walk:eden-gardens' && (e.data?.receipt as any)?.phase === 'completed')?.salience, 3, 'her own walk is not');
  assert.ok(env.find(e => e.raw === 'receipt')!.where?.place, 'receipts say where');
  now += 1 * MIN; plans.tick(); await run(40);
  assert.equal(plans.current(ana).plan, null, 'done after 90 min');
  assert.equal((await comms.streams.read(ana.soulId, 0, 1000)).events.map(e => events.envelope(ana.soulId, e)).filter(e => e.kind === 'plan.done').length, 1);
  // replay: plan acts are ordinary logged decisions; snapshot and genesis both rebuild the same state
  await run(40); w.f.host.saveSnapshot(true);
  const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
  for (const mode of ['snapshot', 'genesis']) {
    if (mode === 'genesis') w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, w.fac, w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true});
    assert.equal(h.boot().from, mode);
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, `replay from ${mode}`);
    h.stop();
  }
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('Core-A/B composition: plan resolves a structured seat intent when it starts and attention reports its actual choice', {timeout: 120000}, async t => {
  const w = await edenNavWorld(1); t.after(() => {w.f.host.stop();w.f.db.close();});
  let now = 1_900_000_000_000;
  const app = new Hono(), deps = {host:w.f.host,db:w.f.db,souls:w.f.souls,soul:edgeSoulResolver(w.f.host,w.f.souls,()=>undefined),ledger:w.ledger};
  const comms = registerEdgeComms(app,deps,{fading:true,beam:true,now:()=>now,sweepMs:0});w.ledger.attachComms(comms as never);
  const events = registerEdgeEvents(app,deps,comms,{placeName:id=>w.ledger.places.byId.get(id)?.name??null});
  const plans = registerEdgePlans(app,deps,comms,events,w.ledger,{tickMs:0});t.after(()=>{plans.close();events.close();comms.close();});
  const soul=w.souls[0]!;
  const settle=async<T>(p:Promise<T>)=>{let done=false;p.finally(()=>{done=true;});for(let i=0;i<400&&!done;i++){w.f.host.tickOnce();await setImmediate();w.f.host.drainInputs();}assert.ok(done);return p;};
  const walk=await settle(w.ledger.act(soul,{verb:'go',target:{place:'social-eden-fire-circle'}})) as any;
  assert.equal(walk.accepted,true,JSON.stringify(walk));await w.run([{soulId:soul.soulId,id:walk.receipt.id}],6000);
  const made=await settle(plans.create(soul,{steps:[{for:'1s'},{do:{verb:'sit',target:{nearest:'seat',free:true}},params:{seconds:5}},{do:{verb:'look',target:'left'},params:{seconds:2}}]}));
  assert.equal(made.plan.steps[1]!.status,'pending');assert.equal(made.plan.steps[1]!.capability,undefined,'seat is not preselected at plan creation');
  now+=1001;plans.tick();
  for(let i=0;i<3000&&plans.current(soul).plan;i++){w.f.host.tickOnce();if(i%20===0){await setImmediate();w.f.host.drainInputs();plans.tick();}}
  const final=plans.get(soul,made.plan.id).plan;
  assert.equal(final.state,'done',JSON.stringify(final));assert.match(final.steps[1]!.capability!,/^sit:/);assert.equal(final.steps[2]!.capability,'look:left');
  const env=(await comms.streams.read(soul.soulId,0,1000)).events.map(e=>events.envelope(soul.soulId,e));
  const attention=env.find(e=>(e.data?.receipt as any)?.capability==='look:left');
  assert.equal(attention?.salience,0);assert.equal((attention?.data?.receipt as any)?.chosen.direction,'left');
  assert.equal((attention?.data?.receipt as any)?.chosen.seconds,2,'intent params reach resolver');
  const arrival=env.find(e=>e.kind==='arrive');assert.equal(arrival?.text,'You arrived at Campfire clearing.');
  assert.deepEqual(w.engine.runtime.violations,[]);
});
