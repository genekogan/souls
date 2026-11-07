import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Connection} from '../../../packages/client/src/index.ts';
import {meLiveMessageV1Schema,type Me,type ServerMsg} from '@souls/protocol';
class Socket{readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;sent:string[]=[];closes=0;send(s:string){this.sent.push(s);}close(){this.closes++;}message(m:unknown){this.onmessage({data:JSON.stringify(m)});}}
const alice:Me={userId:'alice',short:'alice',email:null,wallet:null,role:'user',souls:[],invited:false};
const welcome=(connectionId:string,user=alice,worldId='world',epoch='epoch')=>({t:'welcome' as const,proto:1,build:'fixture',worldId,epoch,rulesVersion:'rules',schema:'schema',dt:.05,clockRate:1,serverTick:0,serverTime:0,you:user,privateMe:{contract:'me-live/1' as const,connectionId,userId:user.userId,revision:1 as const}});
function setup(){const sockets:Socket[]=[],updates:any[]=[],errors:string[]=[],c=new Connection('ws://fixture',async()=>null,{onMe:(me,scope)=>updates.push({me,scope}),onError:code=>errors.push(code)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100);c.connect();const s=sockets[0],id=randomUUID();s.message(welcome(id));const view={contract:'me-live/1' as const,worldId:'world',epoch:'epoch',connectionId:id,userId:'alice',revision:2,me:{...alice,invited:true}};return {c,s,sockets,updates,errors,view};}
test('SDK scoped current Me changes no public replica, clock anchor, station or transport generation',()=>{
  const f=setup(),session=f.c.session,replica=f.c.replica,anchor={...f.c.anchor},welcomeBefore=f.c.welcome;f.s.message({t:'me',view:f.view});assert.equal(f.c.me!.invited,true);assert.equal(f.c.meSession!.revision,2);assert.equal(f.updates.length,1);assert.equal(f.c.replica,replica);assert.deepEqual(f.c.anchor,anchor);assert.deepEqual(f.c.session,session);assert.equal(f.c.stats.snapshots,0);assert.equal(f.c.welcome!.serverTick,welcomeBefore!.serverTick);
  f.updates[0].me.souls.push('not-authority');f.updates[0].scope.revision=99;assert.equal(f.c.me!.souls.length,0);assert.equal(f.c.meSession!.revision,2);f.c.close();
});
test('SDK foreign world/epoch/connection/subject and duplicate/older Me cannot overwrite current authority',()=>{
  const f=setup();for(const patch of [{worldId:'foreign'},{epoch:'other'},{connectionId:randomUUID()},{userId:'bob',me:{...alice,userId:'bob'}}])f.s.message({t:'me',view:{...f.view,...patch}});
  assert.equal(f.updates.length,0);assert.equal(f.c.me!.invited,false);f.s.message({t:'me',view:f.view});f.s.message({t:'me',view:{...f.view,me:{...alice,role:'admin'}}});f.s.message({t:'me',view:{...f.view,revision:1,me:alice}});assert.equal(f.updates.length,1);assert.equal(f.c.me!.role,'user');assert.equal(f.c.me!.invited,true);f.c.close();
});
test('SDK invalid/gapped private current view clears authority immediately and queued private messages cannot regrant before fresh welcome',()=>{
  const f=setup();f.s.message({t:'me',view:{...f.view,revision:3}});assert.equal(f.c.me,null);assert.equal(f.c.meSession,null);assert.ok(f.s.closes);f.s.message({t:'me',view:f.view});assert.equal(f.c.me,null);assert.equal(f.errors.at(-1),'me.invalid');f.c.close();
  const malformed=setup();malformed.s.message({t:'me',view:{...malformed.view,me:{...alice,userId:'foreign'}}});assert.equal(malformed.c.me,null);assert.equal(malformed.c.meSession,null);malformed.c.close();
});
test('SDK obsolete socket callbacks and same-socket old hello scope do not touch the current subject',()=>{
  const f=setup(),old=f.s;f.c.connect();const next=f.sockets[1],id=randomUUID(),bob={...alice,userId:'bob',short:'bob'};next.message(welcome(id,bob));old.message({t:'me',view:f.view});assert.equal(f.c.me!.userId,'bob');next.message({t:'me',view:f.view});assert.equal(f.c.me!.userId,'bob');assert.equal(f.updates.filter(x=>x.me?.invited).length,0);f.c.close();
});
test('strict private Me wire rejects extra secrets/invalid scope/foreign identity, and legacy welcome keeps original behavior',()=>{
  const f=setup();for(const patch of [{revision:Infinity},{connectionId:'not-a-scope'},{me:{...alice,userId:'foreign'}},{token:'not-a-field'}])assert.equal(meLiveMessageV1Schema.safeParse({t:'me',view:{...f.view,...patch}}).success,false);f.c.close();
  const legacy=setup(),w=welcome(randomUUID());const {privateMe,...old}=w;legacy.s.message(old);assert.equal(legacy.c.me!.userId,'alice');assert.equal(legacy.c.meSession,null);legacy.s.message({t:'me',view:legacy.view});assert.equal(legacy.c.me!.invited,false);legacy.c.close();
});
