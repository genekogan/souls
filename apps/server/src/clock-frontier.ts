// Private bounded restart destination, not an instruction or physics edit.
import { z } from 'zod';
import { hashOf } from '@souls/engine-contract';
import type { Db } from './db.ts';
const uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const clockFrontierV1Schema=z.object({contract:z.literal('durable-clock-frontier/1'),
  worldId:z.string().min(1).max(200),seedHash:digest,rulesVersion:z.string().min(1).max(500),
  dtSeconds:z.number().finite().positive(),tick:uint,throughSeq:uint,
  headEventHash:digest,engineHash:digest,kernelHash:digest,
}).strict();
export type ClockFrontierV1=z.infer<typeof clockFrontierV1Schema>;
export class ClockFrontiers {
  readonly db:Db;
  constructor(db:Db){this.db=db;}
  read(worldId:string):ClockFrontierV1|undefined {
    const row=this.db.db.prepare('SELECT body,body_hash FROM clock_frontiers_v1 WHERE world_id=?').get(worldId) as {body:string;body_hash:string}|undefined;
    if(!row)return undefined;
    const v=clockFrontierV1Schema.parse(JSON.parse(row.body));
    if(v.worldId!==worldId||hashOf(v)!==row.body_hash)throw new Error('clock-frontier.corrupt');
    this.validatePrefix(v);return v;
  }
  // The head event is written once (append-only log), yet it was re-read, re-parsed and re-hashed up to three times a
  // tick; on a built world it is the multi-MB genesis edit (Eden 2026: ~80% of every idle tick). Keep its hash while
  // the stored row still has the same seq, size, time, tick and kind (a cheap read with no payload parse).
  private heads=new Map<string,{seq:number;stamp:string;hash:string}>();
  headHash(worldId:string,seq:number):string {
    if(seq===0)return hashOf({worldId,throughSeq:0});
    const row=this.db.db.prepare('SELECT length(payload) AS n, at, tick, kind FROM events WHERE world_id = ? AND seq = ?').get(worldId,seq) as {n:number;at:unknown;tick:number;kind:string}|undefined;
    if(!row)throw new Error('clock-frontier.missing-prefix');
    const stamp=`${row.n}:${String(row.at)}:${row.tick}:${row.kind}`,known=this.heads.get(worldId);
    if(known&&known.seq===seq&&known.stamp===stamp)return known.hash;
    const event=this.db.events(worldId,seq-1,1)[0];
    if(event?.seq!==seq)throw new Error('clock-frontier.missing-prefix');
    const hash=hashOf(event);this.heads.set(worldId,{seq,stamp,hash});
    return hash;
  }
  validatePrefix(v:ClockFrontierV1):void {
    const world=this.db.world(v.worldId);
    if(!world||hashOf(world.seed)!==v.seedHash||world.dt!==v.dtSeconds||this.headHash(v.worldId,v.throughSeq)!==v.headEventHash)
      throw new Error('clock-frontier.source-differs');
    const head=this.db.events(v.worldId,v.throughSeq,1)[0];
    if(head&&head.tick<v.tick)throw new Error('clock-frontier.future-prefix');
  }
  write(raw:ClockFrontierV1):ClockFrontierV1 {
    const v=clockFrontierV1Schema.parse(raw);
    this.db.db.exec('BEGIN IMMEDIATE');
    try{
      this.validatePrefix(v);
      if(this.db.lastSeq(v.worldId)!==v.throughSeq||this.db.world(v.worldId)!.rules_version!==v.rulesVersion)
        throw new Error('clock-frontier.writer-moved');
      let old:ClockFrontierV1|undefined;
      try{old=this.read(v.worldId);}catch(error){if(error instanceof Error&&error.message==='clock-frontier.future-prefix')throw new Error('clock-frontier.future-prefix: another process advanced this world\'s durable clock after this process booted (two writers on one data dir). Stop every server on it, back up the DB, delete only the clock_frontiers_v1 row, start one server.');throw error;}
      if(old&&(old.tick>v.tick||old.throughSeq>v.throughSeq))throw new Error('clock-frontier.regression');
      if(old&&old.tick===v.tick&&old.throughSeq===v.throughSeq&&hashOf(old)!==hashOf(v))throw new Error('clock-frontier.changed-same-head');
      if(!old||hashOf(old)!==hashOf(v))this.db.db.prepare(`INSERT INTO clock_frontiers_v1(world_id,body,body_hash) VALUES(?,?,?)
        ON CONFLICT(world_id) DO UPDATE SET body=excluded.body,body_hash=excluded.body_hash`).run(v.worldId,JSON.stringify(v),hashOf(v));
      this.db.db.exec('COMMIT');return v;
    }catch(error){this.db.db.exec('ROLLBACK');throw error;}
  }
}
