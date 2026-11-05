// together/1 (core-next4; Gene: gestures are "absolutely. critical even"; Souls do things together):
// paired gestures with light consent (accept / decline / ignore), doing it back accepts, dance together and group
// activities in sync, follow / walk with, conversations survive all of it; carry / give / put down / pick up / eat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {writeFileSync} from 'node:fs';
import {kernelHash} from '@sim/kernel';
import {edenNavWorld, factory} from '../test/eden-nav-fixture.ts';
import {WorldHost} from './world.ts';
import {besideEachOther, TOGETHER_RADIUS} from './edge/ledger/together.ts';
import {mountEdgeRoutes, edgeSoulResolver} from './edge/routes.ts';

async function world(n: number, pinned?: string[]) {
  const ids=pinned??process.env.TOGETHER_DIAGNOSTIC_IDS?.split(',');const w = await edenNavWorld(n,{...(ids?{diagnosticSoulIds:ids}:{})}), app = new Hono(), bearer = (c: any) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const comms = mountEdgeRoutes(app, {host: w.f.host, db: w.f.db, souls: w.f.souls, soul: edgeSoulResolver(w.f.host, w.f.souls, bearer), ledger: w.ledger});
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const act = async (s: typeof w.souls[number], capability: string, params?: object, ok = true) => {const out: any = await w.act(s, capability, params); if (ok) assert.equal(out.accepted, true, capability + ' ' + JSON.stringify(out)); return out;};
  const phase = (s: {soulId: string}, out: any) => w.ledger.receipt(s.soulId, out.receipt.id)!;
  const events = (s: {soulId: string}, kind: string) => (w.f.db.db.prepare('SELECT body FROM edge_comms_stream WHERE soul_id=? AND kind=? ORDER BY seq').all(s.soulId, kind) as {body: string}[]).map(r => JSON.parse(r.body));
  const gap = (a: {entityId: string}, b: {entityId: string}) => Math.hypot(body(a).pose.p[0] - body(b).pose.p[0], body(a).pose.p[2] - body(b).pose.p[2]);
  /** A fresh replay of the log from genesis reaches the same world (paired poses, holds and releases are native and logged). */
  const replayExact = async () => {
    w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, await factory(), w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  };
  return {...w, comms, body, act, phase, events, gap, replayExact};
}

const gestures = (pinned?: string[]) => async (t: import('node:test').TestContext) => {
  const w = await world(3, pinned); t.after(() => {w.comms.close(); w.f.host.stop(); w.f.db.close();});
  const [a, b, c] = w.souls;
  // everyone to the fire circle, near each other
  const walks = await Promise.all(w.souls.map(s => w.act(s, 'walk:social-eden-fire-circle'))) as any[];
  await w.run(walks.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 8000);
  if (w.gap(a, b) > 6) {const g = await w.act(b, 'go-near:' + a.soulId); await w.run([{soulId: b.soulId, id: g.receipt.id}], 3000);}
  if (w.gap(a, c) > 8) {const g = await w.act(c, 'go-near:' + a.soulId); await w.run([{soulId: c.soulId, id: g.receipt.id}], 3000);}
  // a and b are talking
  const cv: any = w.comms.conversations.handle(a, {op: 'start', with: [b.soulId], text: 'hello'}); assert.equal(cv.accepted, true, JSON.stringify(cv));
  assert.equal((w.comms.conversations.handle(b, {op: 'accept', conversation: cv.conversation.id}) as any).accepted, true);
  // discoverable: gestures listed, also in doHere
  const caps = w.ledger.capabilities(a);
  for (const id of ['hug:' + b.soulId, 'high-five:' + b.soulId, 'handshake:' + b.soulId, 'dance-with:' + b.soulId, 'follow:' + b.soulId, 'bow:here', 'clap:here', 'point:here']) assert.ok(caps.some(x => x.id === id), 'offers ' + id);
  assert.ok((w.ledger.observe(a, new Set()) as any).doHere.some((d: any) => d.id === 'hug:' + b.soulId), 'doHere lists a hug');

  // 1. hug: asked in plain words; b hears the invitation, accepts; both hug, facing, close, in sync
  const hug = await w.act(a, 'hug ' + b.name); assert.equal(hug.resolved?.to, 'hug:' + b.soulId);
  for (let i = 0; i < 40; i++) w.f.host.tickOnce();
  const inv = w.events(b, 'invite').at(-1); assert.equal(inv?.invite?.what, 'hug', JSON.stringify(inv));
  const obsB: any = w.ledger.observe(b, new Set()); assert.equal(obsB.invites?.[0]?.id, inv.invite.id); assert.ok(obsB.doHere[0].id.startsWith('accept:'), 'accept leads doHere');
  const yes = await w.act(b, 'accept'); assert.equal(yes.resolved?.to, 'accept:' + inv.invite.id);
  const first: Record<string, number> = {}, last: Record<string, number> = {}; let closest = 99, partnered = false;
  await w.run([{soulId: a.soulId, id: hug.receipt.id}, {soulId: b.soulId, id: yes.receipt.id}], 3000, tick => {
    for (const s of [a, b]) if (w.body(s).human.activity === 'hug') {first[s.soulId] ??= tick; last[s.soulId] = tick; partnered ||= w.body(s).human.partner === (s === a ? b : a).entityId;}
    if (w.body(a).human.activity === 'hug' && w.body(b).human.activity === 'hug') closest = Math.min(closest, w.gap(a, b));
  });
  assert.equal(w.phase(a, hug).phase, 'completed', JSON.stringify(w.phase(a, hug))); assert.equal(w.phase(b, yes).phase, 'completed');
  assert.ok(first[a.soulId] && first[b.soulId], 'both hugged'); assert.ok(Math.abs(first[a.soulId] - first[b.soulId]) <= 2 && Math.abs(last[a.soulId] - last[b.soulId]) <= 2, `in sync ${JSON.stringify({first, last})}`);
  assert.ok(partnered, 'partner published'); assert.ok(closest < 0.62 && closest >= 0.48, 'arms-length hug distance ' + closest);
  assert.ok(w.events(a, 'invite.accepted').length >= 1, 'a hears the acceptance');

  // solo gestures: bow to someone (turns to face them), clap
  const bow = await w.act(c, 'bow to ' + a.name); assert.equal(bow.resolved?.to, 'bow:here');
  let bowed = false, facing = 9; await w.run([{soulId: c.soulId, id: bow.receipt.id}], 600, () => {if (w.body(c).human.activity === 'bow') {bowed = true; const d = [w.body(a).pose.p[0] - w.body(c).pose.p[0], w.body(a).pose.p[2] - w.body(c).pose.p[2]]; facing = Math.abs(Math.atan2(Math.sin(Math.atan2(d[1], d[0]) - w.body(c).pose.yaw), Math.cos(Math.atan2(d[1], d[0]) - w.body(c).pose.yaw)));}});
  assert.ok(bowed, 'bowed'); assert.ok(facing < 0.1, 'facing them ' + facing); assert.equal(w.phase(c, bow).phase, 'completed');
  const clap = await w.act(c, 'applaud'); assert.equal(clap.resolved?.to, 'clap:here'); await w.run([{soulId: c.soulId, id: clap.receipt.id}], 600); assert.equal(w.phase(c, clap).phase, 'completed');

  // 2. high-five declined: a's act fails invite.declined
  const hf = await w.act(a, 'high-five:' + b.soulId); for (let i = 0; i < 20; i++) w.f.host.tickOnce();
  const no = await w.act(b, 'no thanks'); assert.match(no.resolved?.to ?? '', /^decline:/);
  await w.run([{soulId: a.soulId, id: hf.receipt.id}], 400);
  assert.equal(w.phase(a, hf).phase, 'failed'); assert.equal(w.phase(a, hf).code, 'invite.declined');

  // 3. handshake ignored: it lapses after 30 s
  const hs = await w.act(a, 'shake hands with ' + b.name); assert.equal(hs.resolved?.to, 'handshake:' + b.soulId);
  await w.run([{soulId: a.soulId, id: hs.receipt.id}], 900);
  assert.equal(w.phase(a, hs).phase, 'failed'); assert.equal(w.phase(a, hs).code, 'invite.expired'); assert.ok(w.events(b, 'invite.expired').length, 'b hears it lapsed');

  // 4. doing it back is accepting: a offers a hug, b "hugs a" → accept
  const h2 = await w.act(a, 'hug:' + b.soulId); for (let i = 0; i < 10; i++) w.f.host.tickOnce();
  const back = await w.act(b, 'hug:' + a.soulId); assert.match(back.resolved?.to ?? '', /^accept:/, JSON.stringify(back));
  await w.run([{soulId: a.soulId, id: h2.receipt.id}, {soulId: b.soulId, id: back.receipt.id}], 3000);
  assert.equal(w.phase(a, h2).phase, 'completed'); assert.equal(w.phase(b, back).phase, 'completed');

  // 4b. a handshake right after a hug: they step back to arm's length (0.85 m)
  const sh = await w.act(b, 'handshake:' + a.soulId); assert.equal(sh.accepted, true, JSON.stringify(sh)); for (let i = 0; i < 10; i++) w.f.host.tickOnce();
  const shy = await w.act(a, 'accept'); assert.equal(shy.accepted, true, JSON.stringify(shy)); let shook = 0;
  await w.run([{soulId: b.soulId, id: sh.receipt.id}, {soulId: a.soulId, id: shy.receipt.id}], 2000, () => {if (w.body(a).human.activity === 'handshake' && w.body(b).human.activity === 'handshake') shook = w.gap(a, b);});
  assert.ok(Math.abs(shook - 0.85) < 0.08, 'handshake at arm\'s length: ' + shook);

  // 5. dance together: paired, facing, one shared end tick
  const dn = await w.act(a, 'dance with ' + b.name, {seconds: 8}); assert.equal(dn.resolved?.to, 'dance-with:' + b.soulId);
  for (let i = 0; i < 10; i++) w.f.host.tickOnce();
  const dy = await w.act(b, 'yes');
  let both = 0, untils = new Set<number>();
  await w.run([{soulId: a.soulId, id: dn.receipt.id}, {soulId: b.soulId, id: dy.receipt.id}], 3000, () => {if (w.body(a).human.activity === 'dance' && w.body(b).human.activity === 'dance') {both++; untils.add(w.body(a).human.together.until); untils.add(w.body(b).human.together.until);}});
  assert.ok(both > 100, 'danced together ' + both); assert.equal(untils.size, 1, 'one shared end tick');
  assert.equal(w.phase(a, dn).phase, 'completed'); assert.equal(w.phase(b, dy).phase, 'completed');

  // 6. group jumping jacks: shared window, late joins and safe settling
  const groupBeginTick=w.f.host.engine.world.tick,intervals:unknown[]=[],frames:{tick:number;actors:{soulId:string;activity:string;until:number|undefined;late?:true;holders:string[]}[]}[]=[],lastDiagnostic=new Map<string,string>();
  const capture=()=>{const rt=w.f.host.engine.runtime;for(const actor of[a,b,c]){const h=w.body(actor).human,holders=(w.f.host.engine as unknown as {rt:{holder(resource:string):string[]}}).rt.holder('actor:'+actor.entityId),row={tick:rt.tick,soulId:actor.soulId,entityId:actor.entityId,pose:structuredClone(w.body(actor).pose),activity:h.activity,together:structuredClone(h.together??null),holders:[...holders],program:w.f.host.engine.programOf(actor.entityId)};const key=JSON.stringify({...row,tick:0,pose:undefined});if(lastDiagnostic.get(actor.soulId)!==key){intervals.push(row);lastDiagnostic.set(actor.soulId,key);}}};
  capture();
  const jj = await w.act(a, `jumping jacks with ${b.name} and ${c.name}`, {seconds: 6}); assert.equal(jj.resolved?.to, 'jumping-jacks:here', JSON.stringify(jj));
  for (let i = 0; i < 10; i++) w.f.host.tickOnce();
  const [jb, jc] = [await w.act(b, 'accept'), await w.act(c, 'accept')];
  const started: Record<string, number> = {}, ended: Record<string, number> = {};
  await w.run([{soulId: a.soulId, id: jj.receipt.id}, {soulId: b.soulId, id: jb.receipt.id}, {soulId: c.soulId, id: jc.receipt.id}], 4000, tick => {capture();frames.push({tick,actors:[a,b,c].map(actor=>({soulId:actor.soulId,activity:w.body(actor).human.activity,until:w.body(actor).human.together?.until,late:w.body(actor).human.together?.late,holders:[...(w.f.host.engine as unknown as {rt:{holder(resource:string):string[]}}).rt.holder('actor:'+actor.entityId)]}))});for (const s of [a, b, c]) {if (w.body(s).human.activity === 'jumping-jacks') {started[s.soulId] ??= tick; ended[s.soulId] = tick;}}});
  capture();
  const records=[...w.f.host.engine.runtime.records.values()].filter(r=>{const p=r.params as {actor?:string};return [a,b,c].some(s=>s.entityId===p?.actor)&&((r.verb==='pose_v1'&&r.history.some(h=>h.tick>=groupBeginTick))||r.id.includes(':make-way:'));}).map(r=>({id:r.id,verb:r.verb,parent:r.parent,status:r.status,requestedTick:r.requestedTick,endedTick:r.endedTick,params:r.params,history:r.history,diagnostic:r.diagnostic,outputs:r.outputs}));
  const overlap={maxSimultaneous:Math.max(...frames.map(f=>f.actors.filter(a=>a.activity==='jumping-jacks').length)),threeParticipantTicks:frames.filter(f=>f.actors.every(a=>a.activity==='jumping-jacks')).length};
  const packet={groupBeginTick,ids:w.souls,started,ended,intervals,frames,overlap,records,receiptPhases:[w.phase(a,jj),w.phase(b,jb),w.phase(c,jc)],paidUsd:w.f.db.paidCost(),originalHosted:{started:[1682,1683,1783],lastActivity:[1753,1801,1801],receiptEnds:[1802,1818,1802]}};
  t.diagnostic('group diagnostic '+JSON.stringify(packet));
  if(process.env.TOGETHER_DIAGNOSTIC_FILE)writeFileSync(process.env.TOGETHER_DIAGNOSTIC_FILE,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
  t.diagnostic(JSON.stringify({started, ended}));
  for (const [s, r] of [[a, jj], [b, jb], [c, jc]] as const) assert.equal(w.phase(s, r).phase, 'completed', s.name + JSON.stringify(w.phase(s, r)));
  assert.equal(Object.keys(started).length, 3, 'all three did jumping jacks');
  // The native pose shares one scheduled window. A late guest joins the
  // remaining window; an existing make-way walk may interrupt expression and
  // defer the truthful terminal receipt until the actor safely settles.
  // This is not a claim of uninterrupted three-person exercise or equal
  // receipt deadlines (pose.ts checks nudged() before the shared-until rule).
  // E2 #2 (once-v1, 2026-10-16; once-v2 #508): a guest who arrives after the shared window closed, even after every member left, does it alone at once, marked late;
  // its own window is not the shared one, and it never borrows a settling body's stale deadline.
  const lateActors=new Set(frames.flatMap(f=>f.actors.filter(x=>x.late).map(x=>x.soulId)));
  assert.ok(lateActors.size<=1&&!lateActors.has(a.soulId),'only a guest can be late, never the host');
  if(pinned)assert.ok(lateActors.has(c.soulId),'#508: with these ids c arrives after the window and the group left: late');
  const sharedUntils=new Set(frames.flatMap(f=>f.actors.flatMap(x=>x.until===undefined||x.late?[]:[x.until])));
  assert.equal(sharedUntils.size,1,'one actual shared pose deadline');const commonUntil=[...sharedUntils][0];
  assert.ok(overlap.maxSimultaneous>=2,'actual overlapping participation, not invitation-only');
  assert.ok(frames.every(f=>f.tick<commonUntil||f.actors.every(x=>x.activity!=='jumping-jacks'||lateActors.has(x.soulId))),'no jumping-jacks beyond the shared pose window (except a late guest alone)');
  for(const [actor,receipt] of [[a,jj],[b,jb],[c,jc]] as const){
    const record=records.find(r=>r.verb==='pose_v1'&&(r.params as {actor?:string;activity?:string}).actor===actor.entityId&&(r.params as {activity?:string}).activity==='jumping-jacks');
    assert.ok(record,'actual grouped pose record');const terminal=w.phase(actor,receipt).endedTick!;
    assert.equal(terminal,record.endedTick,'terminal receipt reflects actual native completion');assert.ok(terminal>=commonUntil,'no fabricated early completion');
    if(lateActors.has(actor.soulId)){const own=frames.find(f=>f.actors.find(x=>x.soulId===actor.soulId)!.late)!.actors.find(x=>x.soulId===actor.soulId)!.until!;assert.ok(own>commonUntil&&terminal>=own,'a late guest completes its own window');assert.equal((record.outputs as {late?:boolean}|undefined)?.late,true,'late is recorded');continue;}
    const release=frames.find(f=>f.tick>=commonUntil&&f.actors.find(x=>x.soulId===actor.soulId)!.holders.length===0);
    assert.ok(release,'owned actor settling actually releases');assert.ok(terminal>=release.tick&&terminal<=release.tick+1,'completion on holder-free tick or next fixed tick in submission order');
    assert.equal(frames.find(f=>f.tick===terminal)!.actors.find(x=>x.soulId===actor.soulId)!.holders.length,0,'completion cannot precede owned settling release');
  }
  t.diagnostic('legacy group coverage '+JSON.stringify({commonUntil,overlap,lateJoinTicks:Math.max(...Object.values(started))-Math.min(...Object.values(started)),earlyActivityLoss:Object.entries(ended).filter(([,tick])=>tick<commonUntil-1),uninterruptedThreePersonSynchronizationQualified:Math.max(...Object.values(started))-Math.min(...Object.values(started))<=1&&frames.filter(f=>f.tick>=Math.max(...Object.values(started))&&f.tick<commonUntil).every(f=>f.actors.every(a=>a.activity==='jumping-jacks'))}));

  // 7. walking together: a invites c along on a walk; c accepts and walks with a until a arrives
  const go = await w.act(a, 'walk:commons-kitchen', {with: [c.name]}); assert.equal(go.accepted, true);
  for (let i = 0; i < 10; i++) w.f.host.tickOnce();
  const along = await w.act(c, 'accept');
  assert.equal((w.ledger.observe(c, new Set()) as any).self.following?.soulId, a.soulId);
  await w.run([{soulId: a.soulId, id: go.receipt.id}, {soulId: c.soulId, id: along.receipt.id}], 8000);
  assert.equal(w.phase(a, go).phase, 'completed'); assert.equal(w.phase(c, along).phase, 'completed', JSON.stringify(w.phase(c, along)));
  assert.ok(w.gap(a, c) <= 2.2, 'shared outing ends beside the host: ' + w.gap(a, c).toFixed(1));
  // follow: c walks with a (no invitation needed; a is told and can ask c to stop)
  const fo = await w.act(c, 'walk with ' + a.name); assert.equal(fo.resolved?.to, 'follow:' + a.soulId);
  assert.ok(w.events(a, 'follow').length, 'a hears c is walking with them');
  const again: any = await w.act(c, 'follow ' + a.name, undefined, false); assert.equal(again.code, 'follow.already', JSON.stringify(again).slice(0, 300));
  const home = await w.act(a, 'walk:social-eden-fire-circle');
  await w.run([{soulId: a.soulId, id: home.receipt.id}], 6000);
  for (let i = 0; i < 300; i++) {w.f.host.tickOnce(); if (i % 20 === 0) {await new Promise(r => setImmediate(r)); w.f.host.drainInputs();}}
  assert.ok(w.gap(a, c) < 4.5, 'c kept up with a: ' + w.gap(a, c).toFixed(1)); assert.equal(w.phase(c, fo).phase, 'started');
  assert.equal((w.ledger.observe(c, new Set()) as any).self.following?.soulId, a.soulId);
  const stop = await w.act(a, 'ask-to-stop:' + c.soulId); assert.equal(stop.receipt.phase, 'completed');
  for (let i = 0; i < 40; i++) w.f.host.tickOnce();
  assert.equal(w.phase(c, fo).phase, 'failed'); assert.equal(w.phase(c, fo).code, 'follow.asked-to-stop');

  // conversations survive gestures, dancing, following
  assert.equal((w.comms.conversations.list(a) as any).conversations.find((x: any) => x.id === cv.conversation.id)?.state, 'open', 'still talking');
  // unsupported touch stays honest; far partners get the walk there
  const kiss: any = await w.act(a, 'kiss ' + b.name, undefined, false); assert.equal(kiss.accepted, false);
  assert.deepEqual(w.f.host.engine.runtime.violations, []); assert.equal(w.f.db.paidCost(), 0);
  await w.replayExact();
};
test('together: hug (accept), high-five (decline), handshake (lapses), hug back = accept, dance together, group jumping jacks, follow; conversation survives', {timeout: 900000}, gestures());
// #508 (2026-11-05): the ids a CI run failed with. The third Soul's approach nudges the second into a courtesy step; the host
// and that settling body both clear their group state before the third arrives after the window. Under once-v1 it saw nobody,
// waited 20 s and opened a second, unmarked window (two shared deadlines); under once-v2 it does it alone at once, marked late.
test('together: the same scene with the #508 CI ids: a guest arriving after the group left is late, never a second window', {timeout: 900000}, gestures(['s_2ff1c5c8dc', 's_736fa001c3', 's_a375a2c19a']));

// F1 (2026-10-20): with these soul ids the host's meet spot is a detour around the third soul, so the guest accepts while the
// host is still walking. The guest used to plan against the moving host, walked across its path (nudging it aside) and
// ended with the bystander between them: both waited for clearance until pose.pair-not-ready (~1% of random-id runs).
test('together: a guest who accepts while the host is still walking meets it at its spot (pinned ids)', {timeout: 300000}, async t => {
  const w = await world(3, ['s_f3b92c1af4', 's_a8326af58b', 's_b4e25bf470']); t.after(() => {w.comms.close(); w.f.host.stop(); w.f.db.close();});
  const [a, b, c] = w.souls;
  const walks = await Promise.all(w.souls.map(s => w.act(s, 'walk:social-eden-fire-circle'))) as any[];
  await w.run(walks.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 8000);
  if (w.gap(a, b) > 6) {const g = await w.act(b, 'go-near:' + a.soulId); await w.run([{soulId: b.soulId, id: g.receipt.id}], 3000);}
  if (w.gap(a, c) > 8) {const g = await w.act(c, 'go-near:' + a.soulId); await w.run([{soulId: c.soulId, id: g.receipt.id}], 3000);}
  const hug = await w.act(a, 'hug ' + b.name); for (let i = 0; i < 40; i++) w.f.host.tickOnce();
  const yes = await w.act(b, 'accept'); assert.match(yes.resolved?.to ?? '', /^accept:/);
  let both = 0; await w.run([{soulId: a.soulId, id: hug.receipt.id}, {soulId: b.soulId, id: yes.receipt.id}], 3000, () => {if (w.body(a).human.activity === 'hug' && w.body(b).human.activity === 'hug') both++;});
  assert.equal(w.phase(a, hug).phase, 'completed', JSON.stringify(w.phase(a, hug))); assert.equal(w.phase(b, yes).phase, 'completed', JSON.stringify(w.phase(b, yes)));
  assert.ok(both > 0, 'they hugged together');
});

test('together: pick up, carry, give (accepted), put down, pick up again, eat; hands hold one thing', {timeout: 900000}, async t => {
  const w = await world(2); t.after(() => {w.comms.close(); w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls;
  const walks = await Promise.all(w.souls.map(s => w.act(s, 'walk:eden-library-1'))) as any[];
  await w.run(walks.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 8000);
  // a takes a book from a shelf
  const pk = await w.act(a, 'pick up a book'); assert.equal(pk.resolved?.to, 'pick-up:book', JSON.stringify(pk));
  await w.run([{soulId: a.soulId, id: pk.receipt.id}], 4000); assert.equal(w.phase(a, pk).phase, 'completed', JSON.stringify(w.phase(a, pk)));
  assert.equal((w.ledger.observe(a, new Set()) as any).self.holding?.kind, 'book'); assert.equal(w.body(a).human.holding, 'book'); assert.equal(w.body(a).human.prop, 'book', 'carried visibly');
  const full: any = await w.act(a, 'pick up a book', undefined, false); assert.equal(full.code, 'hands.full');
  // carried through a walk
  const wk = await w.act(a, 'wander:here', {seconds: 5}); await w.run([{soulId: a.soulId, id: wk.receipt.id}], 2000); assert.equal(w.body(a).human.prop, 'book', 'still in hand after a stroll');
  if (w.gap(a, b) > 6) {const g = await w.act(b, 'go-near:' + a.soulId); await w.run([{soulId: b.soulId, id: g.receipt.id}], 3000);}
  // a gives it to b ("give her the book" → the only one near)
  // GEST-LIVE: naming a different item than the one in hand is refused, and the suggestion gives what is held
  const wrong: any = await w.act(a, `give ${b.name} the frisbee`, undefined, false); assert.equal(wrong.code, 'item.not-held', JSON.stringify(wrong)); assert.equal(wrong.did_you_mean?.[0]?.id, 'give:' + b.soulId);
  const gv = await w.act(a, `give ${b.name} the book`); assert.equal(gv.resolved?.to, 'give:' + b.soulId, JSON.stringify(gv));
  for (let i = 0; i < 20; i++) w.f.host.tickOnce();
  // GEST-LIVE: "take the book" beside the library shelves accepts the offered book (it used to pick one off a shelf)
  const tk = await w.act(b, 'take the book'); assert.match(String(tk.resolved?.to), /^accept:inv_/, JSON.stringify(tk)); let both = false;
  await w.run([{soulId: a.soulId, id: gv.receipt.id}, {soulId: b.soulId, id: tk.receipt.id}], 3000, () => {both ||= w.body(a).human.activity === 'give' && w.body(b).human.activity === 'take';});
  assert.ok(both, 'hand-over seen'); assert.equal(w.phase(a, gv).phase, 'completed'); assert.equal(w.phase(b, tk).phase, 'completed');
  assert.equal((w.ledger.observe(b, new Set()) as any).self.holding?.kind, 'book'); assert.equal((w.ledger.observe(a, new Set()) as any).self.holding, null);
  assert.equal(w.body(b).human.prop, 'book'); assert.equal(w.body(a).human.prop, undefined);
  // b puts it down away from the shelves: it lies there; a sees it and picks it up
  const away = await w.act(b, 'walk:commons-kitchen'); await w.run([{soulId: b.soulId, id: away.receipt.id}], 8000);
  const pd = await w.act(b, 'put it down'); assert.equal(pd.resolved?.to, 'put-down:here');
  await w.run([{soulId: b.soulId, id: pd.receipt.id}], 400);
  const lying = w.ledger.together.placed(); assert.equal(lying.length, 1); assert.equal(lying[0].kind, 'book'); assert.equal(w.body(b).human.prop, undefined);
  const back = await w.act(a, 'walk:commons-kitchen'); await w.run([{soulId: a.soulId, id: back.receipt.id}], 8000);
  const items = (w.ledger.observe(a, new Set()) as any).here.items; assert.equal(items[0]?.id, lying[0].id);
  const again = await w.act(a, 'pick up the book'); assert.equal(again.resolved?.to, 'pick-up:' + lying[0].id);
  await w.run([{soulId: a.soulId, id: again.receipt.id}], 2000); assert.equal(w.phase(a, again).phase, 'completed');
  assert.equal(w.ledger.together.placed().length, 0); assert.equal(w.ledger.together.heldBy(a.soulId)?.id, lying[0].id);
  // b gets something to eat at the kitchen and eats it
  const fd = await w.act(b, 'get something to eat'); assert.equal(fd.resolved?.to, 'pick-up:food', JSON.stringify(fd));
  await w.run([{soulId: b.soulId, id: fd.receipt.id}], 3000); assert.equal(w.phase(b, fd).phase, 'completed');
  const eat = await w.act(b, 'eat it', {seconds: 5}); assert.equal(eat.resolved?.to, 'eat:held');
  let ate = false; await w.run([{soulId: b.soulId, id: eat.receipt.id}], 400, () => {ate ||= w.body(b).human.activity === 'eat' && w.body(b).human.prop === 'food';});
  assert.ok(ate, 'eating with food in hand'); assert.equal(w.ledger.together.heldBy(b.soulId), null); assert.equal(w.body(b).human.prop, undefined);
  // public items endpoint shape
  assert.deepEqual(w.ledger.together.publicItems(), []);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

// Quality lane (cases 27/34): a walk with a partner completed with the two bodies 2.8 m apart; that must not count as arriving together.
test('a shared walk only completes with the guest beside the host', () => {
  assert.equal(TOGETHER_RADIUS, 2.2);
  assert.equal(besideEachOther([0, 0], [1.5, 0]), true, 'follow standoff is beside');
  assert.equal(besideEachOther([0, 0], [2.2, 0]), true);
  assert.equal(besideEachOther([0, 0], [2.8, 0]), false, '2.8 m apart is not together');
});
