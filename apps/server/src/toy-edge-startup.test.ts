import test from 'node:test';import assert from 'node:assert/strict';import {spawn}from'node:child_process';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{setTimeout as delay}from'node:timers/promises';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
test('actual default Edge TOY main advances without installing unsupported native runtime policy',async t=>{
 const data=mkdtempSync(join(tmpdir(),'toy-edge-policy-')),base=`http://127.0.0.1:${TEST_PORT}`,logs:string[]=[];
 const child=spawn(process.execPath,[new URL('./main.ts',import.meta.url).pathname],{env:{PATH:process.env.PATH,DATA_DIR:data,WORLD_ID:'toy-edge-policy-fixture',WORLD_KEY:'eden',ENGINE:'toy',SEED_NATIVES:'0',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',ARCHIVE_TAKES:'0',PORT:String(TEST_PORT),HOST:'127.0.0.1',PUBLIC_URL:base},stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',d=>logs.push(String(d)));child.stderr!.on('data',d=>logs.push(String(d)));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await delay(20);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}rmSync(data,{recursive:true,force:true});});
 let before:number|undefined;for(let i=0;i<200;i++){if(child.exitCode!==null||child.signalCode!==null)throw Error('default TOY startup failed: '+logs.join(''));try{const r=await fetch(base+'/healthz');if(r.ok){before=(await r.json() as {tick:number}).tick;break;}}catch{}await delay(20);}assert.notEqual(before,undefined);
 await delay(500);assert.equal(child.exitCode,null,logs.join(''));assert.equal(child.signalCode,null);const health=await(await fetch(base+'/healthz')).json() as {tick:number};assert.ok(health.tick>before!,'default TOY clock advances');const schema=await fetch(base+'/v1/edge/map');assert.equal(schema.status,200,'default main actually installs the Edge service');assert.ok(!logs.some(s=>s.includes('runtime-policy.unsupported')));
});
