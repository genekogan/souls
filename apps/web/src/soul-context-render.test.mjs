import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const dir=await mkdtemp(join(tmpdir(),'souls-soul-context-'));
globalThis.location={origin:'https://sim.eden.art',pathname:'/w/eden/',hash:''};
globalThis.sessionStorage={getItem:()=>null};
const outfile=join(dir,'context.cjs');
await build({stdin:{contents:`export {SoulFocus} from './SoulFocus.tsx';export {SoulAccount} from './SoulAccount.tsx';export {connectionSetupPrompt} from './connection-prompt.ts';export {SoulCardView} from './SoulCard.tsx';export {CARD_FIXTURES} from './soul-card-fixtures.ts';export {readLink} from './soul-state.ts';export {pollInbox} from './inbox-poll.ts';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx'},outfile,bundle:true,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const {SoulFocus,SoulAccount,connectionSetupPrompt,SoulCardView,CARD_FIXTURES,readLink,pollInbox,createElement:h,renderToStaticMarkup:render}=require(outfile);
const soul={id:'s_A',entityId:'h_A',name:'Mutable Name',description:'Curious artist',doing:'',energy:'fine'};
const auth=(id=null)=>({authed:!!id,ready:true,label:id,debug:{accountIdentity:id,privyUserId:null},login(){},logout(){}});
const me={userId:'acct_A',souls:['s_A'],role:'user',invited:true};
const sim={me,privateAuthorityGeneration:1,conn:{welcome:{worldId:'eden',epoch:1},replica:{souls:new Map([[soul.id,soul]]),entities:{},tick:0}},plays:[],talk:[]};
let calls=0;const api=async()=>{calls++;throw Error('Rendering must not write');};
const base={sim,api,selected:'s_A',select(){},manage(){},camera:{following:false,follow(){},stop(){}}};
const forbidden=/Give .* direction|Send direction|standing rules|reconsiders in|recent thinking|intent-v2|mandate|public download and setup/;
for(const [name,identity,owner] of [['signed out',null,false],['current owner','acct_A',true],['different account','acct_B',false]])test(`modern context for ${name}`,()=>{
 const html=render(h(SoulFocus,{...base,auth:auth(identity)}));
 assert.match(html,/class="soul-card"/);assert.match(html,/Curious artist/);assert.equal(/>Follow</.test(html),!owner,'LINK: the owner card offers Follow only once its agent is known to be connected');assert.match(html,/class="soul-share" aria-label="Copy a link to Mutable Name"/);assert.doesNotMatch(html,/>Share<|>Pin<|Pin this Soul|Travel to/,'CARD-TRIM: Share is a paperclip by the name; no Pin, no Travel to');assert.doesNotMatch(html,/>Activity|This mind|Agent access/,'LINK: the Activity view, This mind and the Agent access panel are gone');if(owner)assert.match(html,/data-status="checking"/,'LINK: the owner card claims no state before its inbox answers');assert.doesNotMatch(html,forbidden);
});
test('account switching suppresses stale owned roster until matching server identity',()=>{
 const props={sim,api,select(){},pairCode:null,clearPair(){}};
 const owner=render(h(SoulAccount,{...props,auth:auth('acct_A')}));assert.match(owner,/Mutable Name/);assert.match(owner,/New Soul/);assert.doesNotMatch(owner,forbidden);
 const switched=render(h(SoulAccount,{...props,auth:auth('acct_B')}));assert.match(switched,/Checking current account/);assert.doesNotMatch(switched,/Mutable Name|Agent access/);
 const unsigned=render(h(SoulAccount,{...props,auth:auth()}));assert.match(unsigned,/Sign in/);assert.doesNotMatch(unsigned,/Mutable Name/);
});
// LINK (Gene 2026-10-24): the This mind grant panel is gone; the Connected card's link details show the holder from a validated `link.holder` only, and say no more than "listening now".
test('owner mind shows only validated granted access, never claims an active client or server steering',()=>{
 const card=(link,open=true)=>render(h(SoulCardView,{...CARD_FIXTURES.connected,link,open:{details:open}}));
 const valid=card(CARD_FIXTURES.connected.link);
 assert.match(valid,/Held by your agent/);assert.match(valid,/eden-agent 1\.9\.16 · paired [^<]+ · listening now/);assert.match(valid,/>Disconnect</);
 assert.doesNotMatch(valid,/is running|steer|controls? .* now|working through/i);assert.doesNotMatch(valid,forbidden);
 for(const raw of [{state:'connected',reason:'listening',since:1,holder:'PRIVATE_STALE'},{state:'connected',reason:'listening',since:1,holder:['PRIVATE_STALE']},{state:'connected',reason:'listening',since:1,holder:{label:42,since:'invalid'}},{state:'connected',reason:'listening',since:1}]){
  const link=readLink(raw);assert.ok(link&&(link.holder===null||link.holder.label===null),JSON.stringify(raw));
  const html=card(link);assert.doesNotMatch(html,/PRIVATE_STALE|paired/);assert.match(html,/<p class="soul-dim soul-box-line">listening now<\/p>/);
 }
 for(const raw of [null,undefined,'connected',{state:'bogus',holder:{label:'PRIVATE_STALE',since:1}},[]]){
  assert.equal(readLink(raw),null);const html=card(null);assert.match(html,/data-status="checking"/);assert.doesNotMatch(html,/Held by|PRIVATE_STALE|>Connected/);
 }
});
// LINK (Gene 2026-10-24): the one-use code control is removed in every state (the Reconnect prompt pairs instead); the holder line keeps owner terms.
test('MIND-PANEL-COPY: owner terms, never a bare label; the one-use code control only without a live grant',()=>{
 const card=label=>render(h(SoulCardView,{...CARD_FIXTURES.connected,link:{...CARD_FIXTURES.connected.link,holder:{label,since:null}},open:{details:true}}));
 const travel=card('travel');assert.match(travel,/Held by your agent/);assert.match(travel,/from “travel” · listening now/);assert.doesNotMatch(travel,/>travel<|<b>travel<\/b>|travel ·/);
 assert.match(card('eden-agent 1.9.9'),/>eden-agent 1\.9\.9 · listening now</);
 for(const [name,props] of Object.entries(CARD_FIXTURES)){const html=render(h(SoulCardView,{...props,open:{details:true,pair:true}}));assert.doesNotMatch(html,/one-use|Connect a new agent|Request one-use code/,name);}
});
// LINK (Gene 2026-10-24): the grant poll is gone; the card's owner state comes from the owner inbox poll (pollInbox, under useSoulInbox and AgentMessageBox).
test('private polling pauses when hidden and cancels stale in-flight grant reads',async()=>{
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const listeners=new Set(),doc={hidden:true,addEventListener:(_t,fn)=>listeners.add(fn),removeEventListener:(_t,fn)=>listeners.delete(fn)},show=hidden=>{doc.hidden=hidden;for(const fn of listeners)fn();};
 let reads=0,rev=0;const pending=[],values=[],scheduled=[];
 const read=()=>{reads++;return new Promise(resolve=>pending.push(resolve));},schedule=fn=>{scheduled.push(fn);return scheduled.length;},cancel=()=>{};
 const stop=pollInbox(read,v=>values.push(v),()=>rev,{doc,schedule,cancel});
 assert.equal(reads,0,'hidden: no read');show(false);assert.equal(reads,1,'shown: reads at once');
 pending.shift()('first');await flush();assert.deepEqual(values,['first']);assert.equal(scheduled.length,1);
 show(true);scheduled.shift()();await flush();assert.equal(reads,1,'hidden again: the due read is skipped');assert.equal(scheduled.length,0);
 show(false);assert.equal(reads,2);rev++;pending.shift()('STALE');await flush();assert.deepEqual(values,['first'],'an answer older than a newer write is dropped');
 scheduled.shift()();assert.equal(reads,3);pending.shift()('second');await flush();assert.deepEqual(values,['first','second']);
 scheduled.shift()();assert.equal(reads,4);stop();pending.shift()('AFTER_STOP');await flush();assert.deepEqual(values,['first','second']);assert.equal(scheduled.length,0);assert.equal(listeners.size,0);
 show(false);assert.equal(reads,4,'stopped: no resume');
});
test('multiple stable Soul IDs remain selectable despite mutable duplicate names',()=>{
 const s2={...soul,id:'s_B',entityId:'h_B'};const state={...sim,me:{...me,souls:['s_A','s_B']},conn:{...sim.conn,replica:{...sim.conn.replica,souls:new Map([['s_A',soul],['s_B',s2]])}}};
 const html=render(h(SoulAccount,{sim:state,auth:auth('acct_A'),api,select(){},pairCode:null,clearPair(){}}));assert.equal((html.match(/Mutable Name/g)??[]).length,2);assert.equal(calls,0);
});
test('published reconnect prompt preserves exact ID/world and accepts names only as data',()=>{
 const prompt=connectionSetupPrompt('https://sim.eden.art/w/mars','s_A','Changed name');assert.match(prompt,/node eden\.mjs pair/);assert.match(prompt,/start listening/);assert.doesNotMatch(prompt,/pair-soul|approval wait|auto mode/);assert.match(prompt,/instructions.md/);assert.match(prompt,/"soulId":"s_A"/);assert.match(prompt,/"currentName":"Changed name"/);assert.doesNotMatch(prompt,/Start connect|OS store|plaintext|skill.md/);assert.match(prompt,/Do not create another/);
 for(const base of ['https://evil.example/w/unknown','https://sim.eden.art/w/mars?secret=x','https://user:pass@sim.eden.art/w/eden'])assert.equal(connectionSetupPrompt(base,'s_A'),null);
 assert.equal(connectionSetupPrompt('https://sim.eden.art/w/eden','bad ID'),null);
});
test.after(async()=>rm(dir,{recursive:true,force:true}));
