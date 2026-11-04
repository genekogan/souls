// Resource-free budget check for an explicitly frozen, interrupted proof history. Never repairs or edits a ledger.
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error('proof.import-budget-'+why);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function readPinned(file,expected){const bytes=readFileSync(file);need(hash(bytes)===expected,'evidence-changed');return JSON.parse(bytes);}
const key=s=>`${s.arm}:${s.repeat}`;

/** Runs under runOwnedAttempt's exclusive lock before resource creation; may also be used as an advisory preflight. All attempted statuses consume budget, including aborts.
 * historyFile/historyHash pin a reviewed import with its original evidence, fixed plan and consumed per-slot counts.
 * A third total try also requires a fresh independent evidence/current-head declaration; agent identity is procedural. */
export function assertImportedAttemptBudget({historyFile,historyHash,ledgerFile,plan,arm,repeat,owner,currentHeads,thirdReview}){
 const h=readPinned(historyFile,historyHash);
 need(h.schema==='owned-proof-budget/1'&&typeof h.owner==='string'&&h.owner&&Number.isSafeInteger(h.captures)&&h.captures>=0,'history-invalid');
 need(Array.isArray(h.plan)&&h.plan.every(s=>typeof s.arm==='string'&&s.arm&&Number.isSafeInteger(s.repeat)&&s.repeat>0)&&same(plan,h.plan)&&new Set(h.plan.map(key)).size===h.plan.length,'plan-changed');
 need(Array.isArray(h.slots)&&h.slots.length===h.plan.length&&same(h.slots.map(key),h.plan.map(key)),'slots-changed');
 need(h.slots.every(s=>Number.isSafeInteger(s.consumed)&&s.consumed>=0&&s.consumed<=3&&Array.isArray(s.attemptEvidence)&&s.attemptEvidence.length===s.consumed),'counts-invalid');
 need(h.captures<=h.slots.reduce((n,s)=>n+s.consumed,0),'capture-count-invalid');
 need(h.evidence?.length&&h.evidence.every(e=>e.file&&/^[a-f0-9]{64}$/.test(e.hash)),'evidence-required');
 for(const e of h.evidence)need(hash(readFileSync(e.file))===e.hash,'evidence-changed');
 const known=new Set(h.evidence.map(e=>e.hash));need(h.slots.every(s=>s.attemptEvidence.every(e=>known.has(e.hash)&&e.hypothesis&&e.endedAt)),'attempt-provenance-missing');
 if(owner!==undefined)need(owner===h.owner,'owner-mismatch');
 const selected=h.slots.find(s=>s.arm===arm&&s.repeat===repeat);need(selected,'unknown-slot');
 let rows=[];
 if(existsSync(ledgerFile)){
  const state=JSON.parse(readFileSync(ledgerFile,'utf8'));
  need(state.owner===h.owner&&state.historicalCaptures===h.captures&&same(state.historicalEvidence,h.evidence),'ledger-history-mismatch');
  need(!state.cycles?.some(c=>c.inFlight),'in-flight');
  rows=state.attempts.map(a=>({hash:a.reportHash,report:readPinned(a.report,a.reportHash)}));
  need(rows.every(a=>h.plan.some(s=>key(s)===key(a.report))),'unknown-recorded-slot');
 }
 const attempts=rows.filter(a=>a.report.arm===arm&&a.report.repeat===repeat),total=selected.consumed+attempts.length;
 need(total<3,'ceiling');
 if(total===2){
  const previous=[...selected.attemptEvidence,...attempts.map(a=>({hash:a.hash,hypothesis:a.report.hypothesis,endedAt:a.report.endedAt}))];
  need(thirdReview?.evidenceOnly===true&&thirdReview.reviewer&&thirdReview.reviewer!==h.owner&&thirdReview.decision==='TRY','third-review-required');
  need(currentHeads&&['product','tool','driver'].every(k=>typeof currentHeads[k]==='string'&&currentHeads[k])&&same(thirdReview.evidenceHashes,previous.map(a=>a.hash))&&same(thirdReview.currentHeads,currentHeads),'third-review-binding');
  need(thirdReview.hypothesis?.trim()&&previous.every(a=>a.hypothesis!==thirdReview.hypothesis),'third-hypothesis');
  need(Date.parse(thirdReview.at)>Math.max(...previous.map(a=>Date.parse(a.endedAt)))&&Date.parse(thirdReview.at)<=Date.now()+1000,'third-review-stale');
  need(thirdReview.change?.path&&Number.isSafeInteger(thirdReview.change.line)&&thirdReview.change.line>0,'third-file-line');
 }
 return {priorAttempts:selected.consumed,newAttempts:attempts.length,nextTotalAttempt:total+1,remaining:3-total,
  history:{count:h.captures,evidence:h.evidence}};
}
