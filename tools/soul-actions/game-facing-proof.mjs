// A tracked whole-game journey for the independently pinned owned-attempt proof helper.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),exec=promisify(execFile);
const save=(paths,name,value)=>writeFileSync(join(paths.dir,name),JSON.stringify(value,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(base,path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(`${path}: ${r.status} ${JSON.stringify(d)}`);return d;}
async function cli(paths,name,...args){const cwd=join(paths.dir,name.toLowerCase());mkdirSync(cwd,{recursive:true});const {stdout}=await exec(process.execPath,[join(ROOT,'tools/edge-skill/eden-agent.mjs'),...args],{cwd,env:{...process.env,EDEN_AGENT_NO_DASHBOARD:'1'},timeout:15000});return JSON.parse(stdout);}
const allEntities=s=>Array.isArray(s.entities)?s.entities:Object.values(s.entities??{});
const pageErrors=new WeakMap();
export const MOVES=[['Ana','centre'],['Ben','top left'],['Ana','top right'],['Ben','middle left'],['Ana','bottom left']];

/** Shared actual journey control flow, exercised by both the browser adapter and a native admitted-route fixture. */
export async function playWholeGame({act,receipt,poll,displayed,stage,wait,signal}){
 const waiting=new Set(),out=[];
 for(const [name,square] of MOVES){
  signal.throwIfAborted();waiting.delete(name);await stage(`${name} marks ${square}`);
  const admission=await act(name,square);if(admission.accepted!==true||!admission.receipt?.id)throw Error('game mark admission refused: '+JSON.stringify(admission));
  let completed;
  for(let i=0;i<120;i++){
   signal.throwIfAborted();await poll([...waiting]);const r=await receipt(name,admission.receipt.id);
   if(['failed','cancelled','replaced'].includes(r.phase))throw Error('game mark did not complete: '+JSON.stringify(r));
   if(r.phase==='completed'){completed=r;break;}await wait(250);
  }
  if(!completed)throw Error('whole-game native mark timed out');
  await displayed(completed);waiting.add(name);await poll([...waiting]);
  await stage(`${name} waits facing the board`);out.push({name,square,admission,completed});await wait(700);await poll([...waiting]);
 }
 return out;
}

export async function prepare({base,paths,signal}){
 const owner=await api(base,'/v1/god/mint','dev:game-proof',{label:'game-proof'});
 const env=await api(base,'/v1/god/env',owner.token,{timeOfDay:'12:00',timeScale:0,weather:{kind:'clear',wind:0}});if(!env.accepted)throw Error('fixture lighting refused');
 const souls={};for(const [name,preset] of [['Ana','casual'],['Ben','punk']]){
  signal.throwIfAborted();await cli(paths,name,'register',base);await cli(paths,name,'create-soul',name,'An isolated native noughts-and-crosses player.');
  await cli(paths,name,'body','look','--set','frame=masc',`preset=${preset}`,'height=1.75','build=1.0');
  const agent=JSON.parse(readFileSync(join(paths.dir,name.toLowerCase(),'.eden-agent.json'),'utf8'));souls[name]={token:agent.token};
 }
 let bodies;for(let i=0;i<60;i++){
  signal.throwIfAborted();const w=await api(base,'/v1/debug/world');bodies=Object.values(w.entities).filter(e=>e.human&&['Ana','Ben'].includes(e.label));if(bodies.length===2)break;await pause(100);
 }
 if(bodies.length!==2)throw Error('both native players not ready');
 for(const body of bodies)souls[body.label].actorId=body.id;
 const ana=bodies.find(e=>e.label==='Ana'),[x,,z]=ana.pose.p,board=[x,z+2.6];
 const placed=await api(base,'/v1/god/act',owner.token,{ops:[{op:'place',def:'core/tictactoe-board@1',tmp:'$board',name:'game',p:board,r:Math.PI}]});
 if(!placed.accepted||!placed.ids?.$board)throw Error('board fixture refused: '+JSON.stringify(placed));
 for(let i=0;i<60;i++){signal.throwIfAborted();const here=await api(base,'/v1/edge/here?include=doHere',souls.Ana.token);if(JSON.stringify(here).includes('game'))break;await pause(100);}
 const fixture={base,souls,board,boardId:placed.ids.$board,ownerToken:owner.token};save(paths,'setup.json',fixture);return fixture;
}

export async function beforeNavigation({page}){
 const errors=[];pageErrors.set(page,errors);page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));
 // Existing camera-only shot mode. The simulation has no second movement or facing path.
 await page.addInitScript(()=>{const u=new URL(location.href);if(u.pathname.includes('/w/')){u.searchParams.set('shot','1');history.replaceState(null,'',u);}});
}
export default async function journey({page,paths,fixture:s,check,signal}){
 const errors=pageErrors.get(page)??[],observations=[],stages=[];
 await page.locator('[data-viewer-ready="true"]').waitFor({timeout:30000});await page.waitForFunction(()=>document.title==='ready');
 await page.evaluate(([x,z])=>globalThis.__simEntity.shotCamera([x+4.3,3.4,z-5.8],[x,.85,z-.6]),s.board);
 await page.evaluate(()=>{const e=document.createElement('div');e.id='game-proof-caption';e.style.cssText='position:fixed;left:18px;bottom:40px;z-index:2147483647;background:rgba(0,0,0,.8);color:white;padding:10px 14px;font:18px monospace;pointer-events:none';e.textContent='Whole game · native marks and supported retreats · waiting heading ≤5°';document.body.append(e);});
 const stage=async text=>{stages.push({text,epochMs:Date.now()});save(paths,'stages.json',stages);await page.evaluate(text=>{document.getElementById('game-proof-caption').textContent=text+' · waiting heading ≤5°';},text);};
 const poll=async waiting=>{
  signal.throwIfAborted();const f=await page.evaluate(({souls,boardId})=>{
   const d=globalThis.__simEntity,frame=d.transportFrame(),out={tick:frame.tick,players:{},board:null,stats:d.stats()};
   const ndc=(p,dy)=>{const v=new d.camera.position.constructor(...p);v.y+=dy;return v.project(d.camera).toArray();};
   for(const [name,soul] of Object.entries(souls)){const e=frame.entities[soul.actorId];if(e)out.players[name]={p:e.p,yaw:e.yaw,activity:e.activity,ndc:ndc(e.p,.85),top:ndc(e.p,1.7),bottom:ndc(e.p,0)};}
   const root=d.layer.drawn.get(boardId)?.obj;if(root){const p=new d.camera.position.constructor();root.getWorldPosition(p);out.board=ndc(p.toArray(),.8);}return out;
  },s);observations.push({epochMs:Date.now(),waiting,...f});save(paths,'observations.json',observations);
  check('whole-game-both-players-and-board-in-frame',Object.keys(f.players).length===2&&[...Object.values(f.players).map(p=>p.ndc),f.board].every(p=>p&&Math.abs(p[0])<.92&&Math.abs(p[1])<.92&&p[2]>-1&&p[2]<1));
  for(const name of waiting){const e=f.players[name],want=Math.atan2(s.board[1]-e.p[2],s.board[0]-e.p[0]),degrees=Math.abs(Math.atan2(Math.sin(e.yaw-want),Math.cos(e.yaw-want)))*180/Math.PI;check('rendered-waiting-heading',degrees<=5,JSON.stringify({name,degrees}));}
  return f;
 };
 const first=await poll([]);check('native-close-framing',Object.values(first.players).every(e=>Math.abs(e.top[1]-e.bottom[1])*540>=140));await page.screenshot({path:join(paths.dir,'whole-game-start.png')});
 await page.evaluate(()=>{window.__gameFrames=[];let last;const f=t=>{if(last!==undefined)window.__gameFrames.push(t-last);last=t;window.__gameRaf=requestAnimationFrame(f);};window.__gameRaf=requestAnimationFrame(f);});
 const moves=await playWholeGame({signal,stage,poll,wait:ms=>page.waitForTimeout(ms),
  act:(name,square)=>api(s.base,'/v1/edge/act',s.souls[name].token,{capability:'mark a square on the game board',params:{square}}),
  receipt:async(name,id)=>(await api(s.base,`/v1/edge/receipts/${encodeURIComponent(id)}`,s.souls[name].token)).receipt,
  displayed:r=>page.waitForFunction(t=>globalThis.__simEntity?.depictedTick>=t,r.endedTick,{timeout:6000})});
 const snapshot=await api(s.base,'/v1/god/snapshot',s.ownerToken),board=allEntities(snapshot).find(e=>e.id===s.boardId);
 check('whole-five-mark-game-completed',moves.length===5&&board?.state.text==='O.XOX.X..'&&board.state.players==='Ana,Ben');
 await stage('Ana wins · both players completed supported retreats and face the board');await page.waitForTimeout(1500);await poll(['Ana','Ben']);await page.screenshot({path:join(paths.dir,'whole-game-complete.png')});
 const intervals=await page.evaluate(()=>{cancelAnimationFrame(window.__gameRaf);return window.__gameFrames;});
 save(paths,'measurements.json',{moves,stages,observations,frameIntervalsMs:intervals,consoleErrors:errors,audio:'Video-only motion/facing proof; no audible-action or listening claim.'});check('console-clean',errors.length===0,JSON.stringify(errors));
}
