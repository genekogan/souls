// #509: seeded populated-commons regression for the stair-top landing collision. The cohort's random ids come from
// node:crypto; forcing them from a seed (before any server module loads) makes a run deterministic, so the seeds
// below replay the captured faults: without stair-landing-clearance/1, a climber on the commons deck's front flight
// lands within the separation of a deck body (`collision.human-human` near (9, 0.24, -1.4), level 1) and the host has
// to recover. With the policy no recovery is needed. Under node --test the cohort runs central minds (config.ts), as
// the CI failures did. The before arm: STAIR_LANDING_V1=0 node --test src/commons-stair-landing.test.ts (it fails).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire,syncBuiltinESMExports} from 'node:module';

const crypto=createRequire(import.meta.url)('node:crypto') as typeof import('node:crypto');
let seed='',counter=0;
function bytes(n:number){const parts:Buffer[]=[];let have=0;while(have<n){const h=createHash('sha256').update(seed+':'+(counter++)).digest();parts.push(h);have+=h.length;}return Buffer.concat(parts).subarray(0,n);}
(crypto as any).randomBytes=(n:number,cb?:(e:Error|null,b:Buffer)=>void)=>{const b=bytes(n);if(cb){process.nextTick(cb,null,b);return;}return b;};
(crypto as any).randomUUID=()=>{const b=bytes(16);b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
syncBuiltinESMExports();
const {WorldHost}=await import('./world.ts');
const {generateCommonsCohort}=await import('../test/fixtures/commons-cohort/generate.ts');

const policy=process.env.STAIR_LANDING_V1!=='0';
const faults:{tick:number;error:string}[]=[];
// test-only: recoverFault is private; observing it is how a recovered fault is told apart from a clean run.
const host=WorldHost.prototype as unknown as {recoverFault:(this:InstanceType<typeof WorldHost>,...args:unknown[])=>void};
const recoverFault=host.recoverFault;
host.recoverFault=function(...args){
  faults.push({tick:this.engine.world.tick,error:String((args[0] as Error)?.message??args[0]).slice(0,300)});
  return recoverFault.apply(this,args);
};

// Captured on main df69a3ca without the policy: [seed, cohort, measured ticks, tick of the initiating fault].
const SEEDS=[['walk-1','walk',5100,5012],['retry-8','retry',400,301],['retry-2','retry',400,330],['retry-15','retry',800,715]] as const;
for(const [name,cohort,ticks,faultTick] of SEEDS)test(`seed ${name}: no stair-landing collision through tick ${ticks} (captured fault at ${faultTick})`,async()=>{
  seed=name;counter=0;faults.length=0;
  const trace=await generateCommonsCohort(ticks,true,cohort==='walk',cohort==='walk',policy);
  assert.deepEqual(faults,[],'the host had to recover from an engine violation');
  assert.deepEqual(trace.nativeViolations,[]);
  assert.equal(trace.reconstruction,'exact');assert.equal(trace.genesisReconstruction,'exact');
  assert.equal(trace.rulesVersion.includes('+walk-block/1'),cohort==='walk');
});
