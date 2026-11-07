import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {setImmediate} from 'node:timers/promises';
import {openWorldServer} from './world-server.mjs';import {openWorldProxy,worldForPath} from './proxy.mjs';
const input=resolve(new URL('../../../',import.meta.url).pathname);
async function accept(host,p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}return p;}
async function finish(app,soul,cap,limit=9000){const out=await accept(app.host,app.edge.act(soul,{capability:cap,...(app.edge.capabilities(soul).find(c=>c.id===cap)?.params?.seconds?{params:{seconds:Math.max(1,app.edge.capabilities(soul).find(c=>c.id===cap).params.seconds.min)}}:{})}));assert.equal(out.accepted,true,JSON.stringify(out));for(let i=0;i<limit;i++){app.host.tickOnce();if(i%20===0)await setImmediate();const r=app.edge.receipt(soul.soulId,out.receipt.id);if(!['started','waiting'].includes(r.phase)){assert.equal(r.phase,'completed',JSON.stringify(r));return r;}}assert.fail(`${cap} did not finish`);}
test('selected-world routing preserves API/query identity and legacy year routes',()=>{
 assert.equal(worldForPath('/world-assets/littlemartians/characters/verdelis.glb'),'littlemartians');assert.equal(worldForPath('/world-assets/mars/buildings/x.glb'),'mars');assert.equal(worldForPath('/world-assets/unknown/x.glb'),null);
 assert.equal(worldForPath('/w/mars/v1/config?x=1'),'mars');assert.equal(worldForPath('/w/littlemartians/ws?after=123'),'littlemartians');assert.equal(worldForPath('/w/eden/v1/config'),'eden');assert.equal(worldForPath('/browser/campus.glb?v=1'),'mars');assert.equal(worldForPath('/w/mars/2026'),'eden');assert.equal(worldForPath('/w/mars/2026/v1/scene'),'eden');assert.equal(worldForPath('/w/else/v1/config'),null);
});
test('LM launcher offers rigid motion, reaches tower and resumes exactly on its own disposable DB',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-lm-launch-'));let app;
 try{
  const options={input,dataDir:dir,worldKey:'littlemartians',worldId:'littlemartians-1',port:4964,nativeCast:false};
  app=await openWorldServer(options);app.host.stop();
  const config=await (await fetch('http://127.0.0.1:4964/w/littlemartians/v1/config')).json();assert.equal(config.worldKey,'littlemartians');assert.equal(app.host.minds.size,7);
  const soul=app.host.minds.values().next().value,caps=app.edge.capabilities(soul);
  for(const verb of ['sit','lie','dance','pushups','read','hug','handshake','pick-up'])assert.equal(caps.some(c=>c.verb===verb),false,verb);
  assert.ok(caps.some(c=>c.id==='hover:here'));assert.ok(caps.find(c=>c.id==='walk:tower-L1').label.includes('Glide'));
  await finish(app,soul,'hover:here');await finish(app,soul,'walk:tower-L1');assert.equal(app.host.engine.world.entities[soul.entityId].human.level,app.host.engine.world.regions['tower-L1'].level);
  const tick=app.host.engine.world.tick,head=app.host.seq,hash=app.host.engine.stateHash();await app.close();app=null;
  const check=await openWorldServer({...options,checkOnly:true});assert.equal(check.tick,tick);assert.equal(check.head,head);assert.equal(check.stateHash,hash);assert.equal(check.boot.recovered,undefined);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('Mars camp profile exposes native construction, take-down, meals and work on campus map',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-mars-launch-'));let app;
 try{
  app=await openWorldServer({input,dataDir:dir,worldKey:'mars',worldId:'mars-2026-1',port:4963,nativeCast:false});app.host.stop();
  const soul=app.host.minds.values().next().value,caps=app.edge.capabilities(soul);
  for(const id of ['build:lookout-stage','take-down:lookout-stage','eat:stew-pot','cook:supper','water:planter-1','sow:planter-3','read:camp-book','use-computer:computer-1','draw:sketch-pad'])assert.ok(caps.some(c=>c.id===id),id);
  assert.ok(caps.find(c=>c.id==='build:lookout-stage').available);assert.equal(caps.find(c=>c.id==='take-down:lookout-stage').available,false);
  const scene=app.host.engine.renderScene().scene;assert.equal(scene.backdrop.contract,'mars-campus-backdrop/1');assert.ok(app.host.engine.rulesVersion.includes('mars-2026-map/1'));
  assert.equal(app.host.extra.continuousDayV1,undefined);assert.equal(app.brain.budget,0);assert.equal(app.db.paidCost(),0);
  for(const phase of ['stage','frame','deck','stairs'])await finish(app,soul,'build:lookout-'+phase,45000);
  assert.ok(app.edge.capabilities(soul).find(c=>c.id==='take-down:lookout-stairs').available);
  for(const phase of ['stairs','deck','frame','stage'])await finish(app,soul,'take-down:lookout-'+phase,45000);
  assert.ok(app.edge.capabilities(soul).find(c=>c.id==='build:lookout-stage').available);
  assert.deepEqual(app.host.engine.runtime.violations,[]);assert.equal(app.db.events(app.host.worldId).filter(e=>e.kind==='rules'&&e.payload?.recovery).length,0);
  assert.equal(app.db.events(app.host.worldId).filter(e=>e.kind==='decision'&&e.payload?.trigger==='edge-ambient').length,0,'no second world-side driver commandeers borrowed cast');
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('local proxy streams selected HTTP/SSE and preserves WebSocket upgrade bytes',async()=>{
 const {createServer}=await import('node:http'),{createRequire}=await import('node:module');
 const {WebSocket,WebSocketServer}=createRequire(join(input,'apps/server/package.json'))('ws');
 const servers=[],wss=[];let proxy;
 try{
  for(const port of [4963,4964]){
   const server=createServer((req,res)=>{
    if(req.url.includes('/events')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: notice\ndata: first\n\n');setTimeout(()=>res.end('data: second\n\n'),5);return;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({port,path:req.url}));
   });servers.push(server);const ws=new WebSocketServer({server});wss.push(ws);ws.on('connection',socket=>socket.on('message',message=>socket.send(message.toString())));
   await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  }
  proxy=await openWorldProxy({port:4966,worlds:{eden:4963,mars:4963,littlemartians:4964}});
  const body=await (await fetch(proxy.url+'/w/littlemartians/v1/config?selected=1')).json();assert.deepEqual(body,{port:4964,path:'/w/littlemartians/v1/config?selected=1'});
  const manifest=await (await fetch(proxy.url+'/__sim/worlds.json')).json();assert.equal(manifest.contract,'local-worlds/1');assert.deepEqual(manifest.worlds.map(w=>w.key),['eden','mars','littlemartians']);
  assert.equal((await fetch(proxy.url+'/w/unknown/v1/config')).status,404);
  const events=await fetch(proxy.url+'/w/mars/events?since=12');assert.match(events.headers.get('content-type'),/text\/event-stream/);assert.equal(await events.text(),'event: notice\ndata: first\n\ndata: second\n\n');
  const socket=new WebSocket(proxy.url.replace('http:','ws:')+'/w/littlemartians/ws?cursor=21');
  const echo=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('WS timeout')),3000);socket.on('open',()=>socket.send('selected-world-echo'));socket.on('message',m=>{clearTimeout(timer);yes(m.toString());socket.close();});socket.on('error',no);});assert.equal(echo,'selected-world-echo');
 }finally{if(proxy)await proxy.close();for(const ws of wss)for(const socket of ws.clients)socket.terminate();for(const ws of wss)await new Promise(r=>ws.close(r));for(const server of servers)await new Promise(r=>server.close(r));}
});
