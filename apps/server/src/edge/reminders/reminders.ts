// Personal advisory facts only. No native event/fold, body execution or planner.
import {randomUUID} from 'node:crypto';
import {hashOf} from '@souls/engine-contract';
import {EdgeError} from '../contract.ts';
import {tx,type Sql} from '../comms/store.ts';
import type {EventStreams} from '../comms/stream.ts';
import type {freshBootClock} from '../boot/clock.ts';
export type ReminderClock=ReturnType<typeof freshBootClock>;
export type ReminderAt={clock:'world';worldDayIndex:number;time:string}|{clock:'real';time:string};
export type ReminderRequest={clientRef:string;text:string;at:ReminderAt};
type Row={world_id:string;soul_id:string;id:string;client_ref:string;request_hash:string;request:string;kind:'world'|'real';due_world_minute:number|null;due_real_ms:number|null;state:'active'|'due'|'delivered'|'cancelled';created_at:number;created_tick:number;event_cursor:string|null;delivered_at:number|null};
const ID=/^rm_[a-f0-9-]{36}$/;
const error=(code:string,message:string,status=400)=>new EdgeError(status,code,message);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
export function normalizeReminder(input:unknown):{request:ReminderRequest;dueWorldMinute:number|null;dueRealMs:number|null}{
 if(!record(input)||!keys(input,['clientRef','text','at'])||typeof input.clientRef!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(input.clientRef)||typeof input.text!=='string'||!input.text.trim()||input.text.length>500||Buffer.byteLength(input.text)>2000||!record(input.at))throw error('reminder.invalid','Use {clientRef (stable 1..100), text (1..500), at: explicit world day/time or real ISO offset time}; no recipient or relative time.');
 const at=input.at,text=input.text.replace(/\s+/g,' ').trim();
 if(at.clock==='world'){
  if(!keys(at,['clock','worldDayIndex','time'])||!Number.isSafeInteger(at.worldDayIndex)||(at.worldDayIndex as number)<0||(at.worldDayIndex as number)>1000000||typeof at.time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(at.time))throw error('reminder.time','World time requires {clock:"world", worldDayIndex: nonnegative calendar index, time:"HH:MM"}. Engine day and ambiguous tomorrow are not accepted.');
  const [hour,minute]=at.time.split(':').map(Number),worldDayIndex=at.worldDayIndex as number;
  return {request:{clientRef:input.clientRef,text,at:{clock:'world',worldDayIndex,time:at.time}},dueWorldMinute:worldDayIndex*1440+hour*60+minute,dueRealMs:null};
 }
 if(at.clock==='real'){
  const m=typeof at.time==='string'?/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/.exec(at.time):null;
  if(!keys(at,['clock','time'])||!m)throw error('reminder.time','Real time requires a full ISO timestamp with Z or explicit numeric offset; no local or relative time.');
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),zone=m[8];
  if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59||zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4,6))>59||Number(zone.slice(1,3))===14&&Number(zone.slice(4,6))!==0))throw error('reminder.time','Invalid ISO date or offset.');
  const dueRealMs=Date.parse(at.time as string);if(!Number.isSafeInteger(dueRealMs))throw error('reminder.time','Invalid ISO timestamp.');
  return {request:{clientRef:input.clientRef,text,at:{clock:'real',time:new Date(dueRealMs).toISOString()}},dueWorldMinute:null,dueRealMs};
 }
 throw error('reminder.time','Choose an explicit world or real clock.');
}
export class PersonalReminders{
 private db:Sql;readonly worldId:string;private streams:EventStreams;private clock:()=>ReminderClock;
 constructor(db:Sql,worldId:string,streams:EventStreams,clock:()=>ReminderClock){
  this.db=db;this.worldId=worldId;this.streams=streams;this.clock=clock;
  db.exec(`CREATE TABLE IF NOT EXISTS edge_personal_reminders_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,id TEXT NOT NULL,client_ref TEXT NOT NULL,request_hash TEXT NOT NULL,request TEXT NOT NULL,kind TEXT NOT NULL,due_world_minute INTEGER,due_real_ms INTEGER,state TEXT NOT NULL,created_at INTEGER NOT NULL,created_tick INTEGER NOT NULL,event_cursor TEXT,delivered_at INTEGER,PRIMARY KEY(world_id,id),UNIQUE(world_id,soul_id,client_ref)) WITHOUT ROWID;
   CREATE INDEX IF NOT EXISTS edge_personal_reminders_due ON edge_personal_reminders_v1(world_id,state,kind,due_world_minute,due_real_ms);
   CREATE TABLE IF NOT EXISTS edge_personal_reminder_outbox_v1(world_id TEXT NOT NULL,reminder_id TEXT NOT NULL,soul_id TEXT NOT NULL,body TEXT NOT NULL,event_cursor TEXT,PRIMARY KEY(world_id,reminder_id)) WITHOUT ROWID;`);
 }
 private view(r:Row){return {id:r.id,...JSON.parse(r.request) as ReminderRequest,state:r.state,createdAt:new Date(r.created_at).toISOString(),createdTick:r.created_tick,eventCursor:r.event_cursor,deliveredAt:r.delivered_at===null?null:new Date(r.delivered_at).toISOString()};}
 private own(soulId:string,id:string){return this.db.prepare('SELECT * FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? AND id=?').get(this.worldId,soulId,id) as Row|undefined;}
 create(soulId:string,input:unknown){
  const n=normalizeReminder(input),fingerprint=hashOf(n.request),now=this.clock();
  return tx(this.db,()=>{
   const old=this.db.prepare('SELECT * FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? AND client_ref=?').get(this.worldId,soulId,n.request.clientRef) as Row|undefined;
   if(old){if(old.request_hash!==fingerprint)throw error('reminder.client-ref-conflict','This clientRef already names another request.',409);return {reminder:this.view(old),replayed:true};}
   if(n.dueWorldMinute!==null&&now.absoluteWorldMinutes===null)throw error('clock.unavailable','This world has no authoritative calendar; choose an explicit real timestamp.',503);
   if(n.dueWorldMinute!==null&&n.dueWorldMinute<=now.absoluteWorldMinutes!||n.dueRealMs!==null&&n.dueRealMs<=now.sampledAtRealMs)throw error('reminder.past','The explicit target time must be in the future.');
   const count=this.db.prepare("SELECT COUNT(*) n FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? AND state IN ('active','due')").get(this.worldId,soulId) as {n:number};if(count.n>=64)throw error('reminder.limit','At most64 active personal reminders.',429);
   const worldCount=(this.db.prepare("SELECT COUNT(*) n FROM edge_personal_reminders_v1 WHERE world_id=? AND state IN ('active','due')").get(this.worldId) as {n:number}).n;if(worldCount>=256)throw error('reminder.limit','At most256 active personal reminders per world.',429);
   const id='rm_'+randomUUID();this.db.prepare('INSERT INTO edge_personal_reminders_v1(world_id,soul_id,id,client_ref,request_hash,request,kind,due_world_minute,due_real_ms,state,created_at,created_tick) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(this.worldId,soulId,id,n.request.clientRef,fingerprint,JSON.stringify(n.request),n.request.at.clock,n.dueWorldMinute,n.dueRealMs,'active',now.sampledAtRealMs,now.tick);
   return {reminder:this.view(this.own(soulId,id)!),replayed:false};
  });
 }
 list(soulId:string,state='active',after?:string){
  if(!['active','all'].includes(state)||after&&!ID.test(after))throw error('reminder.list','Use state=active|all and a returned nextCursor.');
  const predicate=state==='active'?"AND state IN ('active','due')":'',args=[this.worldId,soulId];
  const total=(this.db.prepare(`SELECT COUNT(*) n FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? ${predicate}`).get(...args) as {n:number}).n;
  const rows=this.db.prepare(`SELECT * FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? ${predicate} AND id>? ORDER BY id LIMIT 101`).all(...args,after??'') as Row[];
  return {items:rows.slice(0,100).map(r=>this.view(r)),total,nextCursor:rows.length>100?rows[99].id:null,order:'id'};
 }
 /** Durable readback, including delivered/cancelled reminders, without replaying create. */
 byClientRef(soulId:string,clientRef:string){
  if(!/^[A-Za-z0-9._:-]{1,100}$/.test(clientRef))throw error('reminder.invalid','Use the original stable clientRef.');
  const row=this.db.prepare('SELECT * FROM edge_personal_reminders_v1 WHERE world_id=? AND soul_id=? AND client_ref=?').get(this.worldId,soulId,clientRef) as Row|undefined;
  if(!row)throw error('not-found','No retained personal reminder with this clientRef.',404);
  return {reminder:this.view(row)};
 }
 cancel(soulId:string,id:string){
  if(!ID.test(id))throw error('not-found','No such personal reminder.',404);
  return tx(this.db,()=>{const row=this.own(soulId,id);if(!row)throw error('not-found','No such personal reminder.',404);
   if(row.state==='active'||row.state==='due'){this.db.prepare("UPDATE edge_personal_reminders_v1 SET state='cancelled' WHERE world_id=? AND soul_id=? AND id=?").run(this.worldId,soulId,id);this.db.prepare('DELETE FROM edge_personal_reminder_outbox_v1 WHERE world_id=? AND reminder_id=? AND event_cursor IS NULL').run(this.worldId,id);}
   return {reminder:this.view(this.own(soulId,id)!),cancelled:row.state!=='delivered',alreadyDelivered:row.state==='delivered'};
  });
 }
 /** Due marking/outbox retention is separate from atomic stream delivery, so a
  * process crash before draining has a durable pending event to retry. */
 collectDue(){
  const clock=this.clock();
  return tx(this.db,()=>{
   const rows=this.db.prepare("SELECT * FROM edge_personal_reminders_v1 WHERE world_id=? AND state='active' AND ((kind='real' AND due_real_ms<=?) OR(kind='world' AND due_world_minute<=? AND ?=0)) ORDER BY id LIMIT 128").all(this.worldId,clock.sampledAtRealMs,clock.absoluteWorldMinutes??-1,clock.paused?1:0) as Row[];
   for(const row of rows){const request=JSON.parse(row.request) as ReminderRequest;
    const body={text:request.text,untrusted:true,source:'personal-reminder',reminder:{id:row.id,at:request.at,clientRef:request.clientRef},dueClocks:{...clock,realTime:new Date(clock.sampledAtRealMs).toISOString()}};
    this.db.prepare('INSERT OR IGNORE INTO edge_personal_reminder_outbox_v1(world_id,reminder_id,soul_id,body) VALUES(?,?,?,?)').run(this.worldId,row.id,row.soul_id,JSON.stringify(body));
    this.db.prepare("UPDATE edge_personal_reminders_v1 SET state='due' WHERE world_id=? AND id=? AND state='active'").run(this.worldId,row.id);
   }return rows.length;
  });
 }
 drain(){
  const rows=this.db.prepare('SELECT reminder_id,soul_id,body FROM edge_personal_reminder_outbox_v1 WHERE world_id=? AND event_cursor IS NULL ORDER BY reminder_id LIMIT 128').all(this.worldId) as {reminder_id:string;soul_id:string;body:string}[];
  for(const row of rows)tx(this.db,()=>{
   const pending=this.db.prepare('SELECT event_cursor FROM edge_personal_reminder_outbox_v1 WHERE world_id=? AND reminder_id=?').get(this.worldId,row.reminder_id) as {event_cursor:string|null}|undefined;if(!pending||pending.event_cursor!==null)return;
   const now=this.clock(),event=this.streams.deliver(row.soul_id,'reminder.due',now.tick,{...JSON.parse(row.body),clocks:{...now,realTime:new Date(now.sampledAtRealMs).toISOString()}});
   this.db.prepare('UPDATE edge_personal_reminder_outbox_v1 SET event_cursor=? WHERE world_id=? AND reminder_id=?').run(event.id,this.worldId,row.reminder_id);
   this.db.prepare("UPDATE edge_personal_reminders_v1 SET state='delivered',event_cursor=?,delivered_at=? WHERE world_id=? AND id=? AND state='due'").run(event.id,now.sampledAtRealMs,this.worldId,row.reminder_id);
  });return rows.length;
 }
 pump(){while(this.collectDue()===128){/* finish bounded active-world batch */}let delivered=0,n:number;do{n=this.drain();delivered+=n;}while(n===128);return delivered;}
}
