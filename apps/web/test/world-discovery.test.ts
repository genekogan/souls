import {test} from 'node:test';import assert from 'node:assert/strict';
import {readWorldBootstrap,WorldBootstrapError} from '../src/world-discovery.ts';
const config=(key:string)=>Response.json({worldKey:key,worldPath:'/w/'+key,worldId:key+'-actual'});
test('world bootstrap still refuses HTML fallback and a different namespace after legacy cards retire',async()=>{
 await assert.rejects(()=>readWorldBootstrap(new Response('<!doctype html>App',{headers:{'content-type':'text/html'}}),'mars'),WorldBootstrapError);
 await assert.rejects(()=>readWorldBootstrap(config('eden'),'mars'),/does not match/);
 await assert.rejects(()=>readWorldBootstrap(new Response('',{status:404}),'eden'),/not connected/);
});
test('existing world namespaces and explicit prefixed bootstrap contracts remain supported',async()=>{
 for(const key of ['eden','mars','littlemartians'])assert.equal((await readWorldBootstrap(config(key),key)).worldId,key+'-actual');
 assert.equal((await readWorldBootstrap(Response.json({worldKey:'hamlet',worldPath:'/worlds/w/hamlet',worldId:'hamlet-actual'}),'hamlet','/worlds/w/hamlet')).worldId,'hamlet-actual');
});
