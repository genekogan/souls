import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createTestRunner} from './owned-attempt.mjs';
import {assertImportedAttemptBudget} from './imported-attempt-budget.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const parent=resolve('.e2e/670');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const plan=['baseline','candidate'].flatMap(arm=>[1,2].map(repeat=>({arm,repeat}))),historyFile=join(root,'history.json'),ledgerFile=join(root,'ledger.json');
 const evidence=plan.slice(0,2).map((s,i)=>{const file=join(root,`original-${i}.json`);writeFileSync(file,JSON.stringify({slot:s,unqualified:true}));return{file,hash:digest(readFileSync(file))};});
 const h={schema:'owned-proof-budget/1',owner:'test-implementer',captures:2,plan,evidence,slots:plan.map((s,i)=>({...s,consumed:i<2?1:0,attemptEvidence:i<2?[{hash:evidence[i].hash,hypothesis:'original '+i,endedAt:'2026-01-01T00:00:00Z'}]:[]}))};
 const state={owner:h.owner,historicalCaptures:h.captures,historicalEvidence:evidence,cycles:[],attempts:[]};
 const save=()=>writeFileSync(ledgerFile,JSON.stringify(state));
 const o={historyFile,historyHash:'',ledgerFile,plan,arm:'baseline',repeat:1,currentHeads:{product:'p2',tool:'t2',driver:'d2'}};
 const pin=()=>{writeFileSync(historyFile,JSON.stringify(h));o.historyHash=digest(readFileSync(historyFile));};pin();
 const attempt=(arm,repeat,status)=>{const report=join(root,`new-${state.attempts.length}.json`);writeFileSync(report,JSON.stringify({arm,repeat,status,hypothesis:'new '+state.attempts.length,endedAt:'2026-01-02T00:00:00Z'}));state.attempts.push({report,reportHash:digest(readFileSync(report))});save();};
 return{root,h,state,o,save,pin,attempt};
}
test('frozen baseline slots each retain one consumed try; all new statuses count and third needs evidence-bound review',t=>{
 const f=fixture(t);assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,2);
 f.attempt('baseline',1,'BOOT_ABORT');assert.throws(()=>assertImportedAttemptBudget(f.o),/third-review-required/);
 const previous=f.h.slots[0].attemptEvidence[0];f.o.thirdReview={evidenceOnly:true,reviewer:'fresh-reviewer',decision:'TRY',evidenceHashes:[previous.hash,f.state.attempts[0].reportHash],currentHeads:f.o.currentHeads,hypothesis:'a distinct concrete cause',at:new Date().toISOString(),change:{path:'driver.mjs',line:7}};
 assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,3);f.attempt('baseline',1,'INTERRUPTED');assert.throws(()=>assertImportedAttemptBudget(f.o),/ceiling/);
 f.o.repeat=2;delete f.o.thirdReview;assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,2,'another pinned baseline slot retains its own consumed try');
});
test('candidate has3 total attempts, not3 failures plus an extra; plan and sample ids cannot evade counts',t=>{
 const f=fixture(t);f.o.arm='candidate';assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,1);f.attempt('candidate',1,'PASS');assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,2);f.attempt('candidate',1,'FAIL');
 assert.throws(()=>assertImportedAttemptBudget(f.o),/third-review-required/);f.attempt('candidate',1,'BOOT_ABORT');assert.throws(()=>assertImportedAttemptBudget(f.o),/ceiling/);
 f.o.repeat=9;assert.throws(()=>assertImportedAttemptBudget(f.o),/unknown-slot/);f.o.repeat=1;f.o.plan=[...f.o.plan].reverse();assert.throws(()=>assertImportedAttemptBudget(f.o),/plan-changed/);
});
test('history, original evidence, new reports and in-flight ownership cannot be silently changed',t=>{
 const f=fixture(t);writeFileSync(f.o.historyFile,'{}');assert.throws(()=>assertImportedAttemptBudget(f.o),/evidence-changed/);f.pin();
 writeFileSync(f.h.evidence[0].file,'changed');assert.throws(()=>assertImportedAttemptBudget(f.o),/evidence-changed/);writeFileSync(f.h.evidence[0].file,JSON.stringify({slot:f.h.plan[0],unqualified:true}));
 f.attempt('baseline',1,'INTERRUPTED');writeFileSync(f.state.attempts[0].report,'{}');assert.throws(()=>assertImportedAttemptBudget(f.o),/evidence-changed/);
 f.state.attempts=[];f.state.cycles=[{inFlight:'owned-unfinalized'}];f.save();assert.throws(()=>assertImportedAttemptBudget(f.o),/in-flight/);
 f.state.cycles=[];f.state.historicalCaptures=0;f.save();assert.throws(()=>assertImportedAttemptBudget(f.o),/ledger-history-mismatch/);
});
test('third review binds both prior tries and all current heads and cannot repeat either hypothesis',t=>{
 const f=fixture(t);f.attempt('baseline',1,'FAIL');const prior=f.h.slots[0].attemptEvidence[0],latest=f.state.attempts[0];
 const review={evidenceOnly:true,reviewer:'fresh-reviewer',decision:'TRY',evidenceHashes:[prior.hash,latest.reportHash],currentHeads:f.o.currentHeads,hypothesis:'distinct root cause',at:new Date().toISOString(),change:{path:'driver.mjs',line:7}};f.o.thirdReview=review;
 assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,3);
 for(const hypothesis of [prior.hypothesis,'new 0']){review.hypothesis=hypothesis;assert.throws(()=>assertImportedAttemptBudget(f.o),/third-hypothesis/);}review.hypothesis='distinct root cause';
 review.evidenceHashes=[latest.reportHash];assert.throws(()=>assertImportedAttemptBudget(f.o),/third-review-binding/);review.evidenceHashes=[prior.hash,latest.reportHash];
 const heads=f.o.currentHeads;delete f.o.currentHeads;delete review.currentHeads;assert.throws(()=>assertImportedAttemptBudget(f.o),/third-review-binding/);f.o.currentHeads=heads;review.currentHeads=heads;
 review.at='2025-01-01T00:00:00Z';assert.throws(()=>assertImportedAttemptBudget(f.o),/third-review-stale/);
});

test('the lifecycle rechecks imported counts under its exclusive lock; stale preflight cannot boot a third try',async t=>{
 const f=fixture(t);assert.equal(assertImportedAttemptBudget(f.o).nextTotalAttempt,2);
 // Another finished attempt advances the ledger after the advisory preflight.
 f.attempt('baseline',1,'INTERRUPTED');let boots=0;
 const runner=createTestRunner({source:root=>({root,head:'committed'}),boot:async()=>{boots++;throw Error('must not boot');}});
 const options={owner:f.h.owner,sourceRoot:f.root,toolRoot:f.root,ledger:f.o.ledgerFile,
  arm:'baseline',repeat:1,cycle:{id:'replacement',plan:f.h.plan},history:{count:2,evidence:f.h.evidence},
  importedBudget:{historyFile:f.o.historyFile,historyHash:f.o.historyHash}};
 await assert.rejects(runner(options),/import-budget-third-review-required/);
 assert.equal(boots,0);assert.equal(existsSync(options.ledger+'.lock'),false);
 options.owner='another-agent';await assert.rejects(runner(options),/import-budget-owner-mismatch/);assert.equal(boots,0);
 f.state.attempts=[];f.save();options.owner=f.h.owner;options.history={count:0,evidence:[]};
 await assert.rejects(runner(options),/imported-history-mismatch/);assert.equal(boots,0);
});

test('an imported ledger pins required budget enforcement across later calls',async t=>{
 const f=fixture(t);let boots=0;
 const runner=createTestRunner({source:root=>({root,head:'p1'}),changed:()=>['fix.ts'],portFree:async()=>true,
  boot:async()=>{boots++;throw Error('controlled boot abort');}});
 const options={owner:f.h.owner,sourceRoot:f.root,toolRoot:f.root,ledger:f.o.ledgerFile,
  arm:'baseline',repeat:1,history:{count:2,evidence:f.h.evidence},world:{port:19044,slug:'budget-fixture'},journey:async()=>{},
  cycle:{id:'replacement',plan:f.h.plan,fix:{root:f.root,from:'p0',to:'p1',paths:['fix.ts'],scope:'relevant lifecycle correction'},
   arms:{baseline:{root:f.root,head:'p1'},candidate:{root:f.root,head:'p1'}}},
  importedBudget:{historyFile:f.o.historyFile,historyHash:f.o.historyHash}};
 const report=await runner(options);assert.equal(report.status,'BOOT_ABORT');assert.equal(boots,1);
 assert.deepEqual(JSON.parse(readFileSync(options.ledger)).importedBudget,options.importedBudget);
 const pinned=options.importedBudget;delete options.importedBudget;
 await assert.rejects(runner(options),/imported-budget-required-and-pinned/);assert.equal(boots,1);
 options.importedBudget={...pinned,historyHash:'changed'};
 await assert.rejects(runner(options),/imported-budget-required-and-pinned/);assert.equal(boots,1);
 options.importedBudget=pinned;await assert.rejects(runner(options),/import-budget-third-review-required/);assert.equal(boots,1);
});
