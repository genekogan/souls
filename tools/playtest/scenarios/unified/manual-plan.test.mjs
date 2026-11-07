import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{sha256}from'../../lib/hash.mjs';import{verifyRetained,validateScopeDiff}from'./manual-plan.mjs';
test('retained controls fail closed on stale scorer, changed conditions, source head or infrastructure invalidity',t=>{
 const d=mkdtempSync(join(tmpdir(),'souls-retained-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const run=join(d,'run'),rescore=join(d,'rescore');mkdirSync(join(run,'evidence'),{recursive:true});mkdirSync(rescore);
 const write=(p,x)=>writeFileSync(p,typeof x==='string'?x:JSON.stringify(x));
 const s={freeze:{physicalSha256:'p',physicalPoseSha256:'poses'},world:{genesis:'g'},director:{script:[{id:'a',text:'Sit',budgetSec:180,expect:{journey:{phases:[]}}}]}};
 const scenario=join(d,'frozen.json');write(scenario,s);write(join(run,'scenario.json'),s);write(join(rescore,'scenario.json'),s);write(join(run,'oracles.jsonl'),'{}\n');write(join(run,'close.json'),{});write(join(run,'preflight.json'),{ok:true});write(join(run,'evidence/sol-001.json'),{sentAt:'s',cutoffAt:'c',samples:[{}]});
 const ref={world:'mars',arm:'control',repeat:2,runDir:run,rescoreDir:rescore,reason:'reviewed valid'},planned={...ref,scenario};
 const sourceManifest=join(d,'manifest.json'),heads={control:'db68679b747911f2546fc054345e96aa703090ea',treatment:'old-candidate'};write(sourceManifest,{heads,plan:[{...ref,out:run}]});
 const annotation={schema:'qualified-rescore/1',runDir:run,rawEvidenceModified:false,deadlineChange:0,originalScenarioSha256:sha256(readFileSync(join(run,'scenario.json'))),originalOraclesSha256:sha256(readFileSync(join(run,'oracles.jsonl'))),correctedScenarioSha256:sha256(readFileSync(scenario)),scorerFiles:Object.fromEntries(['journey-oracles.mjs','oracles.mjs','../lib/destination-choice.mjs'].map(f=>[f,sha256(readFileSync(new URL('../../review/'+f,import.meta.url)))])),sourceManifest,sourceHeads:heads};write(join(rescore,'annotation.json'),annotation);
 assert.doesNotThrow(()=>verifyRetained(ref,planned));assert.throws(()=>verifyRetained({...ref,arm:'treatment'},planned));
 for(const edit of[a=>a.scorerFiles['oracles.mjs']='old',a=>a.deadlineChange=1,a=>a.originalOraclesSha256='modified',a=>a.correctedScenarioSha256='different',a=>a.sourceHeads={control:'different'}]){const bad=structuredClone(annotation);edit(bad);write(join(rescore,'annotation.json'),bad);assert.throws(()=>verifyRetained(ref,planned));}write(join(rescore,'annotation.json'),annotation);
 write(join(run,'infrastructure-invalid.jsonl'),'invalid\n');assert.throws(()=>verifyRetained(ref,planned));
});

test('scoped retention rejects runtime, skill, provider or fixture changes outside exact reviewed repair',()=>{
 const runtime='apps/server/src/edge/boot/world-places.ts',changed=[runtime,'tools/playtest/review/journey-oracles.mjs'];
 const diff='reviewed full patch',runtimeDiff='reviewed admission hunk',proof={changedFiles:changed,fullDiffSha256:sha256(diff),runtimeDiffSha256:sha256(runtimeDiff)};
 assert.doesNotThrow(()=>validateScopeDiff(proof,{changed,diff,runtimeDiff}));
 for(const path of ['packages/engine-mars/src/ground.ts','apps/server/src/edge/engine.ts','tools/agent/eden.mjs','skills/soul/SKILL.md','worlds/templates/mars-two.json','tools/playtest/lib/codex.mjs']){
  const bad=[...changed,path].sort();assert.throws(()=>validateScopeDiff({...proof,changedFiles:bad},{changed:bad,diff,runtimeDiff}));
 }
 for(const value of [{changed,diff:diff+'extra',runtimeDiff},{changed,diff,runtimeDiff:runtimeDiff+'extra'},{changed:changed.slice(1),diff,runtimeDiff},{changed,diff,runtimeDiff:''}])assert.throws(()=>validateScopeDiff(proof,value));
});
