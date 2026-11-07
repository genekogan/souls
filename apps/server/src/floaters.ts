// Place-specific affordances, chosen by minds. No day order or automatic assignments.
import {cardHash,type Card} from '@souls/kernel';
import type {WorldHost} from './world.ts';
export class FloaterCards{
 private dirty=true;
 private host:WorldHost;
 constructor(host:WorldHost){this.host=host;host.listeners.push({onApplied:e=>{if(e.kind==='birth')this.dirty=true;},afterTick:()=>{if(this.dirty){this.dirty=false;this.install();}}});this.install();}
 install(){
  const rooms=Object.values(this.host.engine.world.regions).filter(r=>r.kind==='place');
  for(const m of this.host.minds.values()){
   const cards:Card[]=rooms.map(r=>({name:`glide to ${r.id}`,summary:`Visit ${r.label}.`,good_when:'Curiosity, restlessness, solitude or a meeting. No preferred time.',target:null,when:[],approach:[{verb:'walk_to',params:{to:r.id}}],then:[{move:['$actor',r.id]},{set:['$actor','doing',`visiting ${r.label}`]}],during:[{verb:'rest',params:{seconds:90}}],takes:'minutes'}));
   cards.push({name:'bask and recharge',summary:'Rest and absorb energy in the open garden.',good_when:'Low energy or nourishment; the ceramic head needs no hands.',target:null,when:[],approach:[{verb:'walk_to',params:{to:'garden'}}],then:[{move:['$actor','garden']},{set:['$actor','doing','basking and resting']}],during:[{verb:'rest',params:{seconds:180}}],takes:'minutes'});
   for(const card of cards){const existing=this.host.kernel.vocab.cards[card.name];if(!existing)void this.host.enqueue('mint','world',{forSoul:m.soulId,card:{...card,hash:cardHash(card),by:'world',mintedAt:this.host.engine.world.tick,origin:'agent'}});else if(!this.host.kernel.decks[m.soulId].cards.includes(card.name))void this.host.enqueue('deck','world',{soulId:m.soulId,add:[card.name]});}
  }
 }
}
