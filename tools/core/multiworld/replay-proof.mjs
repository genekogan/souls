// T2: make a scripted Little Martians history using the pinned production
// reader, copy SQLite read-only, then assert the edge launcher keeps its exact
// clock/head/hash. Run only against a local checkout and disposable directories.
import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {openWorldServer} from './world-server.mjs';
import {copySqliteReadOnly} from './copy-sqlite.mjs';
export async function proveProductionLmReplay({baseline,input,fixtureScript,output}){
 baseline=resolve(baseline);input=resolve(input);
 const revision=spawnSync('git',['-C',baseline,'rev-parse','HEAD'],{encoding:'utf8'});if(revision.status!==0||!revision.stdout.trim().startsWith('621af256'))throw Error('exact production baseline621af256 required');
 const dir=mkdtempSync(join(tmpdir(),'souls-lm-replay-')),source=join(dir,'source'),copy=join(dir,'copy');mkdirSync(copy);
 try{
  const built=spawnSync(process.execPath,[resolve(fixtureScript),baseline,source],{encoding:'utf8',timeout:60000});if(built.status!==0)throw Error('Production LM fixture failed: '+built.stderr.slice(-1500));
  const expected=JSON.parse(readFileSync(join(source,'expected.json'),'utf8'));
  assert.equal(expected.cast,7);assert.equal(expected.recoveryCount,0);assert.equal(expected.walkReceipt,'completed');assert.equal(expected.conversationReceipt,'completed');
  copySqliteReadOnly(join(source,'sim.db'),join(copy,'sim.db'));
  const actual=await openWorldServer({input,dataDir:copy,worldKey:'littlemartians',worldId:expected.worldId,port:4964,checkOnly:true});
  for(const field of ['tick','head','stateHash','rulesVersion'])assert.equal(actual[field],expected[field],field);
  assert.equal(actual.boot.from,'snapshot');assert.ok(actual.boot.replayed>0,'accepted post-checkpoint suffix must replay');assert.ok(expected.head>expected.checkpointHead);
  const proof={contract:'lm-production-reader-replay-proof/1',baselineCommit:revision.stdout.trim(),qualifiedAtUTC:new Date().toISOString(),worldId:expected.worldId,source:{tick:expected.tick,head:expected.head,stateHash:expected.stateHash,rulesVersion:expected.rulesVersion,cast:7,checkpointTick:expected.checkpointTick,checkpointHead:expected.checkpointHead,conversationReceipt:expected.conversationReceipt,walkReceipt:expected.walkReceipt,level:expected.level,recoveryCount:0},edge:{tick:actual.tick,head:actual.head,stateHash:actual.stateHash,rulesVersion:actual.rulesVersion,boot:actual.boot},scope:'Local synthetic production-reader history on a read-only SQLite VACUUM copy; no remote or production DB read.'};
  if(output){mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(resolve(output),JSON.stringify(proof,null,2)+'\n');}return proof;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [baseline,input,fixtureScript,output]=process.argv.slice(2);console.log(JSON.stringify(await proveProductionLmReplay({baseline,input,fixtureScript,output})));}
