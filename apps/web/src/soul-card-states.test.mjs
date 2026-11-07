// LINK (spec SOUL-LINK r3 §4): the Soul card per state, from fixtures (soul-card-fixtures.ts). Static renders: no effects run,
// so nothing is requested. Invariant: never two of {message box, Reconnect box, Approve} at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const dir=await mkdtemp(join(tmpdir(),'souls-soul-card-states-'));
globalThis.location={origin:'https://sim.eden.art',pathname:'/worlds/w/eden-2026/',search:'',hash:''};
globalThis.sessionStorage={getItem:()=>null};
const outfile=join(dir,'cards.cjs');
await build({stdin:{contents:`export {SoulCardView} from './SoulCard.tsx';export {CARD_FIXTURES,FIXTURE_CLOCK} from './soul-card-fixtures.ts';export {ApprovalCard} from './god-ui/ApprovalDialog.tsx';export {MySouls,chipState} from './MySouls.tsx';export {EdenTour} from './EdenTour.tsx';export {exploreSoulState,truncateNow,orderedExploreSouls} from './explore-data.ts';export * from './soul-state.ts';export {reportAgentPresence} from './agent-presence.ts';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx'},outfile,bundle:true,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.json':'json'},logLevel:'silent'});
const M=require(outfile),{SoulCardView,CARD_FIXTURES:F,FIXTURE_CLOCK:T,createElement:h,renderToStaticMarkup:render}=M;
const card=name=>render(h(SoulCardView,F[name]));
const has={box:html=>html.includes('data-agent-message="soul"'),reconnect:html=>html.includes('data-reconnect="1"'),approve:html=>/data-approve-agent=|data-approval=/.test(html)};
const text=html=>html.replace(/<[^>]+>/g,'').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');

test('invariant: never two of {message box, Reconnect box, Approve} in any state',()=>{
 for(const name of Object.keys(F)){const html=card(name),n=[has.box(html),has.reconnect(html),has.approve(html)].filter(Boolean).length;assert.ok(n<=1,`${name}: ${n} primary elements`);}
});
test('Connected: status button, place, the now line with its age, message box + receipt, Follow; no Reconnect',()=>{
 const html=card('connected'),t=text(html);
 assert.match(html,/data-soul-state="connected"/);assert.match(html,/<button[^>]*class="soul-status soul-link"[^>]*aria-expanded="false"/);
 assert.match(t,/Connected/);assert.match(t,/at the pond/);assert.match(html,/<q>Heading to the pond to see if the koi are up\.<\/q>/);assert.match(t,/· 3 min ago/);
 assert.ok(has.box(html));assert.match(t,/Done · go to the pond · Arrived at the pond\./);assert.match(t,/Follow/);
 assert.doesNotMatch(t,/Reconnect|This mind|Activity|Agent access|one-use|Copy start prompt|Standing around|tired/);
 assert.doesNotMatch(html,/data-link-details/,'details closed by default');
});
test('Connected, details open: holder, Disconnect, Pair another session with the window-code prompt and Copy',()=>{
 const html=card('connected-open'),t=text(html);
 assert.match(html,/aria-expanded="true"/);assert.match(html,/data-caret="up"/);assert.match(t,/Held by your agent/);assert.match(t,/eden-agent 1\.9\.16 · paired \d\d:\d\d · listening now/);
 assert.match(t,/Disconnect/);assert.match(t,/Pair another session/);assert.match(t,/approving it disconnects the current one/);
 assert.match(t,/pair-soul "s_7f3mickey" --for K7QX-M2PA/);assert.match(t,/Copy prompt/);assert.ok(has.box(html),'the message box stays');
});
test('Connected idle: the reflex word in the dim slot, still Connected',()=>{
 const t=text(card('connected-idle'));assert.match(t,/Connected · dozing by the pond/);assert.match(t,/40 min ago/);
});
test('Disconnected: body word + since, the last now dimmed, Reconnect box as the primary element, no message box, no Follow',()=>{
 const z=card('disconnected-zombie'),a=card('disconnected-asleep'),f=card('disconnected-floating');
 assert.match(text(z),/Disconnected · zombie, wandering by the pond since \d\d:\d\d/);
 assert.match(text(a),/Disconnected · asleep by the pond since \d\d:\d\d/);
 assert.match(text(f),/asleep, floating by the pond since/);
 for(const html of [z,a,f]){
  assert.ok(has.reconnect(html));assert.ok(!has.box(html));assert.doesNotMatch(text(html),/Follow/);
  assert.match(html,/class="soul-now soul-now-dim"/);assert.match(text(html),/2 h ago/);
  assert.match(text(html),/The agent stopped listening\.Reconnect to Mickey by prompting your agent:/);
  assert.match(text(html),/Copy prompt/);assert.match(html,/data-sleeping="1"/);
 }
});
test('Disconnected reasons each have their own sentence',()=>{
 assert.match(text(card('disconnected-replaced')),/Another session took over at \d\d:\d\d, then stopped\./);
 assert.match(text(card('disconnected-revoked')),/You disconnected the agent at \d\d:\d\d\./);
 const never=text(card('disconnected-never'));assert.match(never,/No agent has connected yet\./);assert.doesNotMatch(never,/“|”/,'no now line when the agent never set one');
});
// C1 (Gene 2026-10-26): every Reconnect box is the dim reason, then exactly "Reconnect to {name} by prompting your agent:", then the prompt.
const box=html=>{const i=html.indexOf('data-reconnect="1"');assert.ok(i>=0,'a Reconnect box');return html.slice(i);};
const BOXES={'disconnected-asleep':'The agent stopped listening.','disconnected-zombie':'The agent stopped listening.','disconnected-replaced':/^Another session took over at \d\d:\d\d, then stopped\.$/,
 'disconnected-revoked':/^You disconnected the agent at \d\d:\d\d\.$/,'disconnected-never':'No agent has connected yet.','approved-waiting-asleep':'The agent never started listening.'};
test('Reconnect copy: dim reason line, then the same ask for every reason that renders a box',()=>{
 const seen=new Set();
 for(const [name,why] of Object.entries(BOXES)){
  const b=box(card(name)),m=/<p class="soul-dim soul-box-line" data-reconnect-why="1">([^<]*)<\/p><p class="soul-box-text">([^<]*)<\/p>/.exec(b);
  assert.ok(m,`${name}: why line then ask line`);seen.add(F[name].link.reason);
  if(typeof why==='string')assert.equal(m[1],why,name);else assert.match(m[1],why,name);
  assert.equal(m[2],'Reconnect to Mickey by prompting your agent:',name);
  assert.match(b,/Copy prompt/,name);assert.doesNotMatch(text(b),/Give it this prompt|wakes up|shows up here/,name);
  assert.doesNotMatch(b,/soul-box-title/,`${name}: no separate title, the ask says Reconnect`);
 }
 assert.deepEqual([...seen].sort(),['approved-waiting','never','replaced','revoked','stopped-listening']);
});
test('reconnectSentence: {why, ask} for all seven reasons; ask never varies',()=>{
 const reasons=['listening','pending-approval','approved-waiting','stopped-listening','replaced','revoked','never'];
 const whys=new Map();
 for(const reason of reasons){
  const r=M.reconnectSentence('Wren',{state:'disconnected',reason,since:T-60_000,holder:null},T);
  assert.deepEqual(Object.keys(r).sort(),['ask','why']);assert.equal(r.ask,'Reconnect to Wren by prompting your agent:');
  assert.ok(r.why.length>0&&!/Reconnect/.test(r.why),reason);whys.set(reason,r.why);
 }
 assert.equal(whys.get('approved-waiting'),'The agent never started listening.');
 assert.equal(M.reconnectSentence('Wren',{state:'disconnected',reason:'replaced',since:null,holder:null},T).why,'Another session took over, then stopped.');
 // the two reasons that never reach a disconnected card fall back to the plain line
 assert.equal(whys.get('listening'),'The agent stopped listening.');assert.equal(whys.get('pending-approval'),'The agent stopped listening.');
 for(const name of ['connected','pairing'])assert.ok(!card(name).includes('data-reconnect="1"'),`${name}: no Reconnect box`);
});
test('Just approved: standing at the place, waiting for the agent; the prompt only after a minute; never the Reconnect box',()=>{
 const fresh=card('approved-waiting'),late=card('approved-waiting-late');
 assert.match(text(fresh),/Disconnected · approved just now/);assert.match(text(fresh),/Mickey is standing at the commons\. Waiting for the agent to start listening…/);
 assert.doesNotMatch(text(fresh),/copy the prompt|Copy prompt/);assert.ok(!has.reconnect(fresh));assert.ok(!has.box(fresh));
 assert.match(text(late),/Still here after a minute\? Tell the agent to continue, or copy the prompt again\./);assert.ok(!has.reconnect(late));
 // the body went to sleep without a listen: the Reconnect box takes over
 const slept=render(h(SoulCardView,{...F['approved-waiting-late'],body:{state:'asleep',doing:null,since:T-1000}}));
 assert.ok(has.reconnect(slept));assert.match(text(slept),/The agent never started listening\.Reconnect to Mickey by prompting your agent:/);
});
test('Pairing: the card is the approval, nothing else on it',()=>{
 const html=card('pairing');assert.match(html,/data-soul-state="pairing"/);assert.match(html,/data-approval="ap_0123456789abcdef0123456789abcdef"/);
 assert.doesNotMatch(html,/data-approval-close/,'inside the card: the panel × closes it, the card draws no second ×');
 assert.ok(!has.box(html));assert.ok(!has.reconnect(html));assert.doesNotMatch(text(html),/Follow|Connected|Disconnected/);
});
test('Visitor: Awake / Zombie / Asleep + place + now + Follow; no owner controls',()=>{
 const awake=text(card('visitor-awake')),idle=text(card('visitor-idle')),zombie=text(card('visitor-zombie')),asleep=text(card('visitor-asleep'));
 assert.match(awake,/Awake · at the pond/);assert.match(idle,/Awake · sitting by the pond/);
 assert.match(zombie,/Zombie · wandering by the commons since \d\d:\d\d/);assert.match(asleep,/Asleep · by the commons since Oct 23, \d\d:\d\d/);
 for(const name of ['visitor-awake','visitor-idle','visitor-zombie','visitor-asleep']){const html=card(name),t=text(html);
  assert.match(t,/Follow/);assert.match(html,/<q>/);assert.ok(!has.box(html)&&!has.reconnect(html)&&!has.approve(html));
  assert.doesNotMatch(t,/Connected|Disconnected|Reconnect|Disconnect|Pair another|Message your agent/);}
 assert.match(card('visitor-asleep'),/class="soul-now soul-now-dim"/);
});
test('readers: malformed server fields are ignored, now is clipped and stripped',()=>{
 assert.equal(M.readLink({state:'zombie'}),null);assert.equal(M.readLink(null),null);
 assert.deepEqual(M.readLink({state:'connected',reason:'bogus',since:'x',holder:{label:' a ',since:5}}),{state:'connected',reason:'listening',since:null,holder:{label:'a',since:5}});
 assert.equal(M.readLink({state:'pairing',reason:'pending-approval',approvalId:'../x'}).approvalId,undefined);
 assert.equal(M.readBody({state:'asleep',doing:'flying',since:1}).doing,null);assert.equal(M.readBody({state:'dead'}),null);
 const now=M.readNow({text:'  hi\u0007 there '+'x'.repeat(300),at:3});assert.equal(now.text.length,140);assert.match(now.text,/^hi there x/);
 assert.equal(M.readNow({text:'   '}),null);
 // presence fallback without `link`: listening = connected; away = disconnected (never / stopped-listening)
 assert.equal(M.ownerLink(null,{away:false,state:'listening',since:1}).state,'connected');
 assert.equal(M.ownerLink(null,{away:true,state:'away',since:null}).reason,'never');assert.equal(M.ownerLink(null,null),null);
 assert.equal(M.newest({state:'awake',since:1},{state:'asleep',since:5},null).state,'asleep');
 assert.deepEqual([...M.bodiesFromEvents([{kind:'body',soulId:'a',state:'zombie',doing:null,since:9},{kind:'fade',soulId:'a'},{kind:'body',soulId:'a',state:'asleep',doing:'floating',since:10}])],[['a',{state:'asleep',doing:'floating',since:10}]]);
});
test('chips: green ring connected, amber ! pairing, zz asleep, ≈ zombie, dimmed disconnected; nothing claimed before an answer',()=>{
 const off={state:'disconnected',reason:'stopped-listening',since:1,holder:null};
 assert.equal(M.chipState(null,null),null);assert.equal(M.chipState({state:'connected'},null),'connected');assert.equal(M.chipState({state:'pairing'},null),'pairing');
 assert.equal(M.chipState(off,{state:'zombie'}),'zombie');assert.equal(M.chipState(off,{state:'asleep'}),'asleep');assert.equal(M.chipState(off,null),'disconnected');
 const souls=new Map([['s_a',{id:'s_a',entityId:'h_a',name:'Ana',description:''}],['s_b',{id:'s_b',entityId:'h_b',name:'Bo',description:'',body:{state:'asleep',doing:null,since:2}}],['s_c',{id:'s_c',entityId:'h_c',name:'Cy',description:''}]]);
 M.reportAgentPresence('s_a',{connected:true,lastSeenAt:1,presence:'listening',link:{state:'connected',reason:'listening',since:1,holder:null}});
 M.reportAgentPresence('s_b',{connected:false,lastSeenAt:1,presence:'away'});
 M.reportAgentPresence('s_c',{connected:false,lastSeenAt:1,presence:'away',link:{state:'pairing',reason:'pending-approval',since:1,holder:null,approvalId:'ap_x'}});
 const html=render(h(M.MySouls,{ids:['s_a','s_b','s_c'],souls,select(){},present:new Set(['s_a','s_b','s_c'])}));
 assert.match(html,/data-link-state="connected"[^>]*aria-label="Open Ana \(connected\)"/);
 assert.match(html,/class="my-souls-away" data-link-state="asleep"[\s\S]*?my-souls-zz[^>]*>zz</);
 assert.match(html,/data-link-state="pairing"[\s\S]*?my-souls-pair[^>]*>!</);
 for(const id of ['s_a','s_b','s_c'])M.reportAgentPresence(id,null);
});
test('Explore rows: Awake / Zombie / Asleep + truncated now, awake first',()=>{
 assert.equal(M.truncateNow('Heading to the pond to see if the koi are up.'),'Heading to the pond to see if the…');
 const souls=new Map([['s_z',{id:'s_z',name:'Zed',description:'',body:{state:'asleep',doing:null,since:1}}],['s_a',{id:'s_a',name:'Ada',description:'',body:{state:'awake',doing:null,since:1},now:{text:'Looking for someone to row with',at:1}}],['s_w',{id:'s_w',name:'Wren',description:'',body:{state:'zombie',doing:null,since:1}}]]);
 assert.deepEqual(M.orderedExploreSouls(souls,new Map()).map(s=>s.id),['s_a','s_w','s_z']);
 const st=M.exploreSoulState(souls.get('s_w'),new Map([['s_w',{state:'asleep',doing:null,since:5}]]));assert.equal(st.body.state,'asleep','a newer stream event wins over the replica');
});
test.after(async()=>rm(dir,{recursive:true,force:true}));
