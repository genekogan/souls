import {WorldMotionHistory} from '../src/WorldMotionHistory.ts';
import {RecordedGaitContinuity} from '../../../mars/viewer/app/engine-view/recorded-gait-continuity.ts';
import {ACTUATOR_IDLE_RETURN_SECONDS} from '../../../mars/viewer/app/engine-view/idle-reach-handoff.ts';
import {handReachSeconds,handSwingSeconds,handReleaseSeconds,type HandActuatorMotion} from '../../../mars/viewer/engine/social/hand-actuator.ts';
import {poseV1} from '../../../mars/viewer/engine/social/pose.ts';
// M05 partial correction: actual native recorder/replay clocks, not manually supplied rest ages.
// Initial raised-phase motion cases are bounded; expanded phases/custom fast reaches retain known A1 failures.
// Endpoint/seek cases certify clock/replay agreement only, and print their unqualified motion maxima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { templateFromGltf, type Template } from '../../../mars/viewer/app/engine-view/people.ts';
import { HumanoidKit } from '../src/humanoid/compose.ts';
import { hashId } from '../../../mars/viewer/app/engine-view/people-light.ts';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../../../mars/viewer/engine/api/registry.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { emptyWorld, human } from '../../../mars/viewer/engine/world/factory.ts';
import { openGround } from '../../../mars/viewer/engine/test/frame-fixtures.ts';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { heading } from '../../../mars/viewer/engine/core/math.ts';
const DT = .05, ID = 'h_m04gesture', TARGET_UP = Number(process.env.IDLE_TARGET_UP ?? 1.3), RIG = process.env.IDLE_RIG ?? 'casual', OFFSET = Number(process.env.IDLE_PHASE_OFFSET ?? 0);
async function template(rig = RIG) { if (rig.startsWith('kit-')) {
    const kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async (url) => { const b = readFileSync(new URL('../../../mars/viewer/public' + url, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; });
    return kit.template({ frame: rig.slice(4), preset: rig === 'kit-fem' ? 'woman' : 'casual' } as never);
} const source = readFileSync(new URL('../../../mars/viewer/public/modular/environment/animated-' + rig + '.glb', import.meta.url)), len = source.readUInt32LE(12), j = JSON.parse(source.subarray(20, 20 + len).toString()), bin = source.subarray(20 + len); j.materials = j.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [.5, .5, .5, 1] } })); delete j.textures; delete j.images; delete j.samplers; let json = Buffer.from(JSON.stringify(j)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]); const h = Buffer.from(source.subarray(0, 20)); h.writeUInt32LE(20 + json.length + bin.length, 8); h.writeUInt32LE(json.length, 12); const b = Buffer.concat([h, json, bin]), g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); return templateFromGltf('idle-reach-canonical', g); }
const tpl = template();
function clock(offset = 0) { const h = hashId(ID), ph = ((h >>> 7) % 991) / 991; let n = 1; while ((n + h) % 2 !== 1)
    n++; return Math.round(37 * (n + 2 / 37 - ph) / DT) + offset; }
function run(cancel: number | undefined, offset = OFFSET, noAction = false, withChunks = false, stroke = false, params: Record<string, unknown> = {}, ownerAfter?:string,recordTicks=320) { const scene = openGround(), w = emptyWorld('idle-reach', scene), at: [
    number,
    number,
    number
] = stroke ? [.45, 1.3, 0] : [.5, TARGET_UP, -.22], e = human(ID, 0, 0, { yaw: heading([at[0], at[2]]) }); w.entities[e.id] = e; const rt = new Runtime(w, new Map([...createRegistry(),[poseV1.verb,poseV1]]), { spatial: new Spatial(scene) }, ENGINE_INVARIANTS), rec = new TakeRecorder(rt, { rulesVersion: 'idle-reach-intake' }), start = clock(offset); const chunkers = new Map<number, {
    rec: TakeRecorder;
    takes: ReturnType<TakeRecorder['finish']>[];
}>(withChunks ? [7, 20, 61].map(n => [n, { rec: new TakeRecorder(rt, { rulesVersion: 'idle-reach-intake' }), takes: [] }]) : []); let endTick = -1; let a: ReturnType<Runtime['submit']> | undefined; for (let k = 0; k < start + recordTicks; k++) {
    if (k === start && !noAction) {
        a = rt.submit('hand_actuator_v1', { actor: ID, target: 'real-control', at, ...(stroke ? { stroke: { kind: 'write', yaw: -Math.PI / 2, stand: .45, width: .2, height: .05, lines: 1, seconds: 1.8, release: 1.1, handoff: .1 } } : {}), ...params });
        assert.equal(a.status, 'executing', JSON.stringify(a));
    }
    if (cancel !== undefined && !noAction && k === start + cancel)
        rt.cancel(a!.id);
    if(ownerAfter&&endTick>=0&&rt.tick===endTick+2){const next=ownerAfter==='reach'?rt.submit('hand_actuator_v1',{actor:ID,target:'second-control',at}):ownerAfter==='walk'?rt.submit('walk_to',{actor:ID,x:2,z:0}):rt.submit('pose_v1',{actor:ID,activity:ownerAfter,seconds:.5});assert.equal(next.status,'executing',JSON.stringify(next));}
    rt.step();
    for (const [n, c] of chunkers)
        if (rt.tick % n === 0) {
            c.takes.push(c.rec.finish());
            c.rec = new TakeRecorder(rt, { rulesVersion: 'idle-reach-intake' });
        }
    if (a && endTick < 0 && !rt.isActive(a.id))
        endTick = rt.tick;
} assert.deepEqual(rt.violations, []); for (const c of chunkers.values())
    c.takes.push(c.rec.finish()); return { chunks: new Map([...chunkers].map(([n, c]) => [n, c.takes])), take: rec.finish(), start, endTick, terminal: a?.status ?? 'idle' }; }
function visualEnd(r:ReturnType<typeof run>){const m=r.take.changes.filter(c=>c[1]===ID&&c[2]==='handActuator'&&c[3]).at(-1)?.[3] as HandActuatorMotion|undefined;return m?Math.max(r.endTick,Math.ceil(m.startTick+((m.abortedAt??handReachSeconds(m)+handSwingSeconds(m))+(m.stroke?.release??handReleaseSeconds(m))+ACTUATOR_IDLE_RETURN_SECONDS)/DT)):r.endTick;}
for (const cancel of [undefined, 1, 3, 5, 8, 12])
    test(`actual native idle reach full path cancel ${cancel}`, async () => { const r = run(cancel), p = new TakePeople(r.take, { idleReachHandoff: true }); p.setTemplates([await tpl]); let previous: number[][] | undefined, max = 0, at = 0, phase = '', beforeVariety = 0, worst: unknown = null, boundaryMax = 0, boundaryAt = 0; for (let k = r.start - 20; k <= r.start + 150; k++) {
        p.show(k * DT, k * DT);
        const b = p.bones(ID)[ID], f = p.frame!.entities[ID], local = b.arms.map(a => { const q = a.palm.map((x, i) => x - f.p[i]); return [q[0] * Math.cos(f.yaw) + q[2] * Math.sin(f.yaw), q[1], -q[0] * Math.sin(f.yaw) + q[2] * Math.cos(f.yaw)]; });
        if (k === r.start)
            beforeVariety = b.variety;
        if (previous)
            for (let i = 0; i < 2; i++) {
                const d = Math.hypot(...local[i].map((x, j) => x - previous![i][j]));
                if (k <= visualEnd(r) + 1 && d > boundaryMax) {
                    boundaryMax = d;
                    boundaryAt = k - r.start;
                }
                if (d > max) {
                    max = d;
                    at = k - r.start;
                    phase = f.activity ?? '';
                    worst = { hand: i, previous: previous[i], next: local[i], variety: b.variety, handActuator: f.state.handActuator };
                }
            }
        previous = local;
    } console.log(JSON.stringify({ rig: RIG, offset: OFFSET, cancel, start: r.start, terminal: r.terminal, beforeVariety, maxPalmStepM: max, atSeconds: at * DT, activity: phase, worst, boundaryMaxM: boundaryMax, boundaryAtSeconds: boundaryAt * DT, handoffEndSeconds: (r.endTick - r.start) * DT })); if(OFFSET===0) assert.ok(beforeVariety > .5, 'actual recorded raised idle variety before reach'); assert.ok(boundaryMax <= .08, 'unchanged M04 through complete native idle handoff80mm/50ms, actual ' + boundaryMax + ' at ' + boundaryAt * DT); });
test('matched natural standalone idle reports its own clip speed after the handoff', async () => { const r = run(undefined, OFFSET, true), p = new TakePeople(r.take, { idleReachHandoff: true }); p.setTemplates([await tpl]); let prev: number[][] | undefined, max = 0, at = 0; for (let k = r.start - 20; k <= r.start + 150; k++) {
    p.show(k * DT, k * DT);
    const palms = p.bones(ID)[ID].arms.map(a => a.palm);
    if (prev)
        for (let i = 0; i < 2; i++) {
            const d = Math.hypot(...palms[i].map((x, j) => x - prev![i][j]));
            if (d > max) {
                max = d;
                at = k - r.start;
            }
        }
    prev = palms;
} console.log(JSON.stringify({ standaloneIdleMaxM: max, atSeconds: at * DT })); });
test('actual short handoff history diagnosis: fresh/current chunks versus full replay', async () => { const r = run(undefined, 0, false, true, true), full = new TakePeople(r.take, { idleReachHandoff: true }); full.setTemplates([await tpl]); const rows = []; for (const [size, chunks] of r.chunks) {
    let max = 0, worst = 0;
    for (let k = r.endTick - 10; k <= r.endTick + 30; k++) {
        full.show(k * DT, k * DT);
        const chunk = chunks.find(c => k >= c.startTick && k <= c.startTick + c.ticks)!;
        const fresh = new TakePeople(chunk, { idleReachHandoff: true });
        fresh.setTemplates([await tpl]);
        fresh.setWaterHistory(chunks);
        fresh.show((k - chunk.startTick) * DT, k * DT);
        const a = full.bones(ID)[ID].arms, b = fresh.bones(ID)[ID].arms;
        for (let i = 0; i < 2; i++) {
            const d = Math.hypot(...a[i].palm.map((x, j) => x - b[i].palm[j]));
            if (d > max) {
                max = d;
                worst = k - r.endTick;
            }
        }
    }
    rows.push({ chunkTicks: size, maxFreshPalmDeltaM: max, atTicksAfterHandoff: worst });
} console.log(JSON.stringify({ shortHandoffEnd: r.endTick - r.start, history: rows })); assert.ok(rows.every(r => r.maxFreshPalmDeltaM === 0), 'same recorded short handoff gives identical palms after removal, independent of viewer history'); });
for (const config of [{ reach: .3, release: 1 }, { reach: 1.2, release: 1.1, hold: 2 }, { reach: 2, release: 1.6 }, { hand: 'left', release: 1.1 }, { reach:2, stroke: { kind: 'write', yaw: -Math.PI / 2, stand: .45, width: .2, height: .05, lines: 1, seconds: 6, release: 1.6, handoff: .1 } }])
    test('recorded reach/release endpoints and arbitrary chunks ' + JSON.stringify(config), async () => {
        const stroke = 'stroke' in config, r = run(undefined, 0, false, true, stroke, config), full = new TakePeople(r.take, { idleReachHandoff: true });
        full.setTemplates([await tpl]);
        let maxDelta = 0, worst = 0;
        for (const [size, chunks] of r.chunks) {
            for (const k of [r.start, r.start + 1, r.start + 6, r.endTick - 1, r.endTick, r.endTick + 1, r.endTick + 8, r.endTick + 20,visualEnd(r)-1,visualEnd(r),visualEnd(r)+1]) {
                full.show(k * DT);
                const chunk = chunks.find(c => k >= c.startTick && k <= c.startTick + c.ticks)!, fresh = new TakePeople(chunk, { idleReachHandoff: true });
                fresh.setTemplates([await tpl]);
                fresh.setWaterHistory(chunks);
                const local = (k - chunk.startTick) * DT;
                fresh.show(local, k * DT);
                const a = full.bones(ID)[ID].arms, b = fresh.bones(ID)[ID].arms;
                for (let i = 0; i < 2; i++) {
                    const d = Math.hypot(...a[i].palm.map((x, j) => x - b[i].palm[j]));
                    if (d > maxDelta) {
                        maxDelta = d;
                        worst = k - r.start;
                    }
                }
            }
        }
        let palmStep = 0, stepAt = 0, previous: number[][] | undefined;
        for (let k = r.start - 1; k <= visualEnd(r) + 1; k++) {
            full.show(k * DT);
            const e = full.frame!.entities[ID], palms = full.bones(ID)[ID].arms.map(a => { const q = a.palm.map((x, i) => x - e.p[i]); return [q[0] * Math.cos(e.yaw) + q[2] * Math.sin(e.yaw), q[1], -q[0] * Math.sin(e.yaw) + q[2] * Math.cos(e.yaw)]; });
            if (previous)
                for (let i = 0; i < 2; i++) {
                    const d = Math.hypot(...palms[i].map((x, j) => x - previous![i][j]));
                    if (d > palmStep) {
                        palmStep = d;
                        stepAt = k - r.start;
                    }
                }
            previous = palms;
        }
        console.log(JSON.stringify({ config, terminal: r.terminal, endSeconds: (r.endTick - r.start) * DT, arbitrarySeekDeltaM: maxDelta, atSeconds: worst * DT, fullHandoffStepM: palmStep, stepAtSeconds: stepAt * DT }));
        assert.equal(maxDelta, 0, 'recorded actuator state/phase drives deterministic selected fresh seeks'); // Endpoint/seek checks do not waive the retained expanded motion failures; A1 remains unmet.
    });
test('explicit off retains the exact stacked legacy abort depiction', async () => { const r = run(5,0), p = new TakePeople(r.take, { idleReachHandoff: false }); p.setTemplates([await template('casual')]); let previous: number[][] | undefined, max = 0; for (let k = r.start - 1; k <= visualEnd(r) + 1; k++) {
    p.show(k * DT);
    const a = p.bones(ID)[ID].arms.map(a => a.palm);
    if (previous)
        for (let i = 0; i < 2; i++)
            max = Math.max(max, Math.hypot(...a[i].map((x, j) => x - previous![i][j])));
    previous = a;
} assert.ok(Math.abs(max - .7484448276259247) < 1e-8, 'off path preserves stacked baseline, including known legacy abort pop'); });

for(const boundary of ['version','gap','ambiguous'])test('recorded actuator rejects '+boundary+' predecessor',()=>{const r=run(undefined,0,false,true,true),chunks=r.chunks.get(7)!,tick=r.endTick+8,own=chunks.find(c=>tick>=c.startTick&&tick<c.startTick+c.ticks)!,prev=chunks.find(c=>c.startTick+c.ticks===own.startTick)!;const changed=structuredClone(prev);if(boundary==='version')changed.rulesVersion+='-foreign';if(boundary==='gap')changed.startTick--;const history=boundary==='ambiguous'?[...chunks,{...changed,id:changed.id+'-duplicate'}]:chunks.map(c=>c===prev?changed:c);const p=new TakePeople(own,{idleReachHandoff:true});p.setWaterHistory(history);const h=p as unknown as{priorActuator(id:string,tick:number,current:unknown):unknown};assert.equal(h.priorActuator(ID,tick-own.startTick,null),null,'a missing/foreign/ambiguous predecessor cannot create a recovery tail');});
test('a real native wave owner cancels old actuator recovery after the wave ends',()=>{const r=run(undefined,0,false,true,true,{},'wave'),p=new TakePeople(r.take,{idleReachHandoff:true}),h=p as unknown as{priorActuator(id:string,tick:number,current:unknown):unknown};assert.ok(h.priorActuator(ID,r.endTick+1,null),'tail exists before next native owner');assert.equal(h.priorActuator(ID,r.endTick+15,null),null,'old tail does not resume after actual owner returns idle');});

for(const next of ['reach','walk'])test('a native '+next+' after interruption does not resurrect the cancelled gesture',async()=>{
 const r=run(undefined,0,false,true,false,{},next),full=new TakePeople(r.take,{idleReachHandoff:true});full.setTemplates([await tpl]);
 let max=0,transitionMax=0,delta=0,previous:number[][]|undefined,previousWalk=0;
 for(let k=r.endTick;k<=r.endTick+65;k++){
  full.show(k*DT,k*DT);const e=full.frame!.entities[ID],b=full.bones(ID)[ID],palms=b.arms.map(a=>{const q=a.palm.map((x,i)=>x-e.p[i]);return[q[0]*Math.cos(e.yaw)+q[2]*Math.sin(e.yaw),q[1],-q[0]*Math.sin(e.yaw)+q[2]*Math.cos(e.yaw)];});
  if(previous)for(let i=0;i<2;i++){const d=Math.hypot(...palms[i].map((x,j)=>x-previous![i][j]));max=Math.max(max,d);if(next!=='walk'||b.walkW<.98||previousWalk<.98)transitionMax=Math.max(transitionMax,d);}previous=palms;previousWalk=b.walkW;if(next==='walk'){const view=(full as any).humans.views.get(ID);const activeVariant=[...view.rig.lib.entries()].filter(([name,action]:any)=>/Idle_(FoldArms|LookAround)/.test(name)&&view.libOn.has(action));assert.equal(activeVariant.length,0,'walk overlay does not resurrect the interrupted variant; a next scheduled neutral occurrence is allowed');}
  for(const chunks of r.chunks.values()){const c=chunks.find(c=>k>=c.startTick&&k<c.startTick+c.ticks);if(!c)continue;const fresh=new TakePeople(c,{idleReachHandoff:true});fresh.setTemplates([await tpl]);const cs=chunks.map(take=>({fromTick:take.startTick,toTick:take.startTick+take.ticks,take}));fresh.setTake(c,new RecordedGaitContinuity().offsets(cs,cs.find(x=>x.take===c)!));fresh.setWaterHistory(chunks);fresh.show((k-c.startTick)*DT,k*DT);const a=fresh.bones(ID)[ID].arms;for(let i=0;i<2;i++)delta=Math.max(delta,Math.hypot(...b.arms[i].palm.map((x,j)=>x-a[i].palm[j])));}
 }
 console.log(JSON.stringify({next,maxBodyFrameStepM:max,transitionMaxM:transitionMax,maxFreshDeltaM:delta}));assert.ok(transitionMax<=.08,'unchanged80mm bound at re-entry/walk handoff');assert.ok(delta<.0055,'recorded native-hand precision across selected fresh windows');
});

test('initial real hot-buffer supplement restores short-join eligibility and rolls observed chunks beyond12s',async()=>{
 const r=run(undefined,0,false,true,false,{},undefined,500),all=r.chunks.get(20)!.map(take=>({fromTick:take.startTick,toTick:take.startTick+take.ticks,take})),at=(tick:number)=>all.find(c=>tick>=c.fromTick&&tick<c.toTick)!,hot=(server:number)=>all.filter(c=>c.toTick<=server).slice(-12),socket=(server:number)=>hot(server).filter(c=>c.toTick>server-40),ctl=new AbortController();
 const depicted=r.endTick+60,server=depicted+30,ws=socket(server);let requests=0,bytes=0,resolve!:()=>void;
 const wait=new Promise<void>(r=>resolve=r),gate=new WorldMotionHistory(async(from,to,limit)=>{requests++;await wait;const got=hot(server+20).filter(c=>c.toTick>from&&c.fromTick<to).slice(0,limit);bytes=JSON.stringify({chunks:got,next:null}).length;return got;},ctl.signal,10.2);
 const first=gate.start(ws,server,30,'world/epoch',()=> 'world/epoch');assert.equal(gate.start(ws,server,30,'world/epoch',()=> 'world/epoch'),first);assert.equal(gate.loading,true);resolve();await first;
 let error=0,maxChunks=0;const full=new TakePeople(r.take,{idleReachHandoff:true});full.setTemplates([await tpl]);
 for(let k=depicted+20;k<=depicted+280;k+=10){const c=at(k),history=gate.history(socket(k+30),c,k);maxChunks=Math.max(maxChunks,history.length);assert.equal(gate.enabled,true,'rolling observed live history stays eligible after initial chunks expire');full.show(k*DT,k*DT);const fresh=new TakePeople(c.take,{idleReachHandoff:true});fresh.setTemplates([await tpl]);fresh.setWaterHistory(history.map(c=>c.take));fresh.show((k-c.fromTick)*DT,k*DT);const a=full.bones(ID)[ID].arms,b=fresh.bones(ID)[ID].arms;for(let i=0;i<2;i++)error=Math.max(error,Math.hypot(...a[i].palm.map((x,j)=>x-b[i].palm[j])));}
 console.log(JSON.stringify({initialHistoryRequests:requests,historyResponseBytes:bytes,maxHistoryChunks:maxChunks,rollingFreshErrorM:error,delayedResponseTicks:20,continuedTicks:280}));assert.equal(requests,1);assert.ok(maxChunks<=14);assert.equal(error,0);
});
test('initial supplement fails to legacy on owner change, abort, failed fetch or incompatible prefix',async()=>{
 const r=run(undefined,0,false,true),cs=r.chunks.get(20)!.map(take=>({fromTick:take.startTick,toTick:take.startTick+take.ticks,take})),tick=r.endTick+60,live=cs.filter(c=>c.toTick<=tick+30&&c.toTick>tick-10),selected=cs.find(c=>tick>=c.fromTick&&tick<c.toTick)!;
 let owner='old',done!:(v:typeof cs)=>void;const ctl=new AbortController(),gate=new WorldMotionHistory(()=>new Promise(r=>done=r),ctl.signal,10.2),pending=gate.start(live,tick+30,30,owner,()=>owner);owner='new';done(cs.slice(0,12));await pending;assert.equal(gate.loading,false);assert.equal(gate.enabled,false);
 const fail=new WorldMotionHistory(async()=>{throw Error('offline');},ctl.signal,10.2);await fail.start(live,tick+30,30,'same',()=> 'same');assert.equal(fail.loading,false);assert.equal(fail.enabled,false);
 const foreign=structuredClone(cs.filter(c=>c.toTick<=tick+30).slice(-12));foreign[0].take.rulesVersion+='foreign';const bad=new WorldMotionHistory(async()=>foreign,ctl.signal,10.2);await bad.start(live,tick+30,30,'same',()=> 'same');assert.equal(bad.enabled,false);
 const short=new WorldMotionHistory(async()=>live,ctl.signal,10.2);await short.start(live,tick+30,30,'same',()=> 'same');short.history(live,selected,tick);assert.equal(short.enabled,false,'insufficient prefix cannot silently qualify new depiction');
 const aborted=new AbortController(),abortGate=new WorldMotionHistory((_f,_t,_l,signal)=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),aborted.signal,10.2),aborting=abortGate.start(live,tick+30,30,'same',()=> 'same');aborted.abort();await aborting;assert.equal(abortGate.enabled,false);
});
