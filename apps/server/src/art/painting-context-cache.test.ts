// Painting completion uses the existing context commit listener. Captures are
// fake PNGs here; no browser, sheet renderer, host lease or HTTP listener runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from '../god/god.ts';
import { mountContextViews } from '../god/context-views.ts';
import { afterCommit, tx } from '../edge/comms/store.ts';
import { createPaintingService } from './painting-completion.ts';

test('painting commit invalidates actual context pixels before terminal receipt observers; ordinary engine edits remain silent', async () => {
  const dir=mkdtempSync(join(tmpdir(),'painting-context-cache-')),db=new Db(':memory:'),order:string[]=[];
  const god=new GodMode(db,{worldId:'painting-context-test',ownerId:'dev:owner',tick:()=>1,emit:()=>{order.push('world');},assetDir:dir});
  assert.equal(god.act({ops:[{op:'place',def:coreRef('easel',2),name:'canvas',p:[0,0]}]}).accepted,true);
  const target=god.model.get('canvas')!.id,app=new Hono(),captured:string[]=[];
  app.onError((error,c)=>error instanceof ApiError?c.json({code:error.code},error.status as 400):c.json({error:String(error)},500));
  const context=mountContextViews(app,{god,edge:{beforeMap(){},places:{byId:new Map(),containing:()=>[]},knowledge:{knows:()=>true}} as never,
    contextReady:()=>true,waitForContext:async()=>{},levelAt:()=>0,worldUrl:'http://127.0.0.1:5980',soul:()=>null,limit(){},
    renderer:async input=>{
      const payload=input.payload as {snapshot:{entities:{id:string;state?:{media?:string}}[]}};
      const media=payload.snapshot.entities.find(e=>e.id===target)!.state?.media??'';captured.push(media);
      return {png:new Uint8Array([captured.length])};
    }});
  const service=createPaintingService({model:()=>god.model,dir,basePath:'/w/painting-context',worldId:god.opts.worldId,commit:(ops,note,done,durable)=>god.engineAct(ops,note,done,durable)});
  const soul={soulId:'s_ana',entityId:'h_aaaa',name:'Ana',owner:'dev:ana'};
  const request=()=>app.request('/v1/world/context/views',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refs:[target]})});
  const paint=(receipt:string,background:string,done:()=>void=()=>{})=>{
    const intent=service.prepare(soul,target,{title:receipt,background,shapes:[]});assert.ok(!('ok'in intent),JSON.stringify(intent));
    assert.equal(service.complete(soul,receipt,intent,done).ok,true);
    return god.model.entities.get(target)!.state!.media as string;
  };
  try {
    const firstMedia=paint('r_one','#123456');
    assert.equal((await request()).status,200);await context.cache.settled();
    const first=(await(await request()).json()).views[0];assert.equal(first.status,'ready');assert.deepEqual(captured,[firstMedia]);
    assert.equal((await app.request(first.url)).status,200);
    let commitNotifications=0,receiptNotified=false;
    const unsubscribe=god.onCommit(commit=>{
      commitNotifications++;assert.equal(commit.by,'engine');assert.equal(db.db.isTransaction,false);
      assert.notEqual(god.model.entities.get(target)!.state!.media,firstMedia);assert.equal(receiptNotified,false);
      order.push('context');
    });
    order.length=0;
    const nextMedia=paint('r_two','#abcdef',()=>tx(db.db,()=>afterCommit(db.db,()=>{
      receiptNotified=true;assert.equal(commitNotifications,1);assert.deepEqual(order,['world','context']);
      assert.notEqual(god.model.entities.get(target)!.state!.media,firstMedia);order.push('receipt');
    })));
    assert.deepEqual(order,['world','context','receipt']);
    assert.equal((await app.request(first.url)).status,404,'old cached URL cannot serve the overwritten painting');
    await context.cache.settled();
    const next=(await(await request()).json()).views[0];assert.equal(next.status,'ready');assert.notEqual(next.key,first.key);
    assert.equal((await app.request(next.url)).status,200);assert.deepEqual(captured,[firstMedia,nextMedia]);
    // Native body/movement edits retain their existing no-echo contract.
    assert.equal(god.engineAct([{op:'set',id:target,state:{title:'ordinary engine update'}}],'ordinary engine edit').accepted,true);
    assert.equal(commitNotifications,1);unsubscribe();
  } finally {await context.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
