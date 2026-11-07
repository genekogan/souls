import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { cardHash } from '@souls/kernel';
import { Db } from './db.ts';
import { optionsFor } from './deck.ts';
import { WorldHost } from './world.ts';

test('a failed plan option is excluded before ranking and waiting retains its intent signal',()=>{
  const db=new Db(':memory:');
  try {
    const host=new WorldHost(db,toyFactory,'avoid-target-drift',1e9);host.boot();
    for(const name of ['Rob','Rowan','Wren'])void host.enqueue('birth','fixture',{
      soulId:`s_${name}`,entityId:`h_${name}`,name,description:'fixture',owner:'human-owner'});
    host.drainInputs();
    for(const soulId of ['s_Rob','s_Rowan'])void host.enqueue('play','fixture',{
      soulId,card:'host a gathering',hash:host.kernel.vocab.cards['host a gathering'].hash,target:'campfire'});
    const card={name:'ask to be the dj',summary:'Ask the gathering host to play music',target:{kind:'gathering'},derive:{host:{link:'hosts',to:'$target'}},
      when:[],then:[{say:['$actor','$host','ask']}],approach:[],during:[{verb:'wave',params:{at:'$host',seconds:2}}],takes:'seconds'};
    void host.enqueue('mint','fixture',{card:{...card,hash:cardHash(card as any),by:'s_Wren',mintedAt:0,origin:'agent'},forSoul:'s_Wren'});
    void host.enqueue('intent','fixture',{soulId:'s_Wren',intent:{agenda:[{card:'ask to be the dj',of:'s_Rob'}]}});host.drainInputs();
    const mind=host.minds.get('s_Wren')!,initial=optionsFor(host,mind);
    const requested=initial.find(o=>o.card==='ask to be the dj' && o.servesIntent)!;assert.ok(requested);
    const other=initial.find(o=>o.card==='ask to be the dj' && !o.servesIntent)!;assert.ok(other,'another host is a feasible spontaneous target');
    mind.avoid={id:requested.id,untilTick:1000};
    const choices=optionsFor(host,mind).filter(o=>o.id!==mind.avoid!.id);
    assert.ok(!choices.some(o=>o.id===requested.id),'runtime cooldown removes failed target');
    assert.equal(choices.find(o=>o.card==='wait')?.servesIntent,true,
      'removing the only serving option must not leave Jev an unmarked random choice among other hosts');
    host.engine.world.tick=1000;
    assert.ok(optionsFor(host,mind).some(o=>o.id===requested.id && o.servesIntent),'exact target becomes available when cooldown expires');
  } finally {db.close();}
});
