// The camp's activity examples become ordinary, logged cards. They describe available acts;
// neither this pack nor its conditions assigns times or a sequence of daily activities.
import { cardHash, type Card } from '@souls/kernel';
import { hashOf } from '@souls/engine-contract';
import {CAMP_EXPANSION_CAMPUS,CAMP_EIGHT_RESOURCES} from '@souls/engine-mars';
import { edenCampActivities, bindCampActivity } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import type { WorldHost, Mind } from './world.ts';
import {campResourceBindings,LEGACY_CAMP_RESOURCES,type CampResourceSet} from './camp-resources.ts';

export class CampCards {
  host: WorldHost;
  private installed = new Set<string>();
  private dirty = true;
  readonly resourceIssues=new Map<string,string>();
  private resources?:readonly CampResourceSet[];
  constructor(host: WorldHost,resources?:readonly CampResourceSet[]) {
    this.host = host;
    this.resources=resources;
    host.listeners.push({onApplied: e => {
      if (e.payload?.adoptCamp || e.payload?.campExpansion || e.kind === 'birth') this.dirty = true;
    }, afterTick: () => { if (this.dirty) { this.dirty=false; this.install(); } }});
    this.install();
  }
  install() {
    const campus=this.host.engine.world.base.campus;
    if (campus !== 'eden-camp'&&campus!==CAMP_EXPANSION_CAMPUS) return;
    const souls = [...this.host.minds.values()].sort((a,b) => a.name.localeCompare(b.name));
    const resources=this.resources??(campus===CAMP_EXPANSION_CAMPUS?CAMP_EIGHT_RESOURCES:LEGACY_CAMP_RESOURCES);
    const bindings=campResourceBindings(this.host,souls,resources);this.resourceIssues.clear();for(const [id,why] of bindings.issues)this.resourceIssues.set(id,why);
    for (const m of souls) {
      const firstInstall=!this.installed.has(m.soulId);
      this.installed.add(m.soulId);
      const others = souls.filter(s => s !== m);
      const personal=bindings.bySoul.get(m.soulId);
      const cards: Card[] = [];
      for (const a of edenCampActivities()) {
        if (a.id.startsWith('build.')&&a.id!=='build.climb-lookout' || /^kitchen\.(take-|stand-at|serve|eat|return-)/.test(a.id) || ['chess_move','shared_food_break'].includes(a.verb)) continue;
        // Each sleeper keeps an individual mat; a free mat is still an engine precondition.
        if (a.verb === 'sleep' && a.params.mat !== personal?.mat) continue;
        if (a.roles.length > souls.length) continue;
        const roles: Record<string,string> = {};
        a.roles.forEach((r,i) => {roles[r] = i === 0 ? '$actor' : others[i-1].entityId;});
        const params = bindCampActivity(a, roles) as Record<string,unknown>;
        const during: Card['during'] = a.verb === 'sit'
          ? [{verb: 'sit', params: {on: a.params.fixture, seconds: 120}}, {verb: 'stand', params: {}}]
          : [{verb: `mars:${a.verb}`, params}, ...(a.verb === 'campfire_circle' ? [{verb:'rest',params:{seconds:120}}, {verb:'stand',params:{}}] : []),
            ...(a.verb === 'prepare_food' ? [{verb:'mars:put_item',params:{item:'prep-spoon',surfaceSlot:'prep-table#r1c0'}}] : [])];
        cards.push({name: `${a.id.replaceAll('.', ' ').replaceAll('-', ' ')} ${m.name.toLowerCase()}`, summary: a.label.slice(0,160),
          good_when: `${a.tags.join(', ')}. ${a.requires ?? a.label}`.slice(0,160), target:null, when:[],
          then:[{set:['$actor','doing',a.label]}], approach:[], during, takes:a.verb==='sleep'?'long':'minutes'});
      }
      for (const [phase,summary,crew] of [
        ['stage','Carry the six rack parts from the pile to the lookout build site.',1],
        ['frame','Raise the two uprights, seat the four beams and release safe support.',4],
        ['deck','Carry and install the five joists and two sheets as the lookout deck.',2],
        ['stairs','Install the flight and ten stair treads to make the lookout accessible.',2],
      ] as const) cards.push({
        name:`build lookout ${phase} ${m.name.toLowerCase()}`,summary,
        good_when:`Wanting to build something lasting. Needs ${crew} free ground builders and the physical prerequisites.`,
        target:null,when:[],then:[{set:['$actor','doing',`building the lookout ${phase}`]}],approach:[],
        during:[{verb:'build_lookout',params:{phase}}],takes:'minutes',
      });
      if(personal){
      if(personal.sleepReturn)cards.push({name:`bunk sleep ${personal.mat.replaceAll('-',' ')} ${m.name.toLowerCase()}`,summary:'Sleep on my additional ground sleeping area.',
        good_when:'Tired and wanting to rest; native support, free hands and a clear full sleep envelope remain required.',target:null,when:[],
        then:[{set:['$actor','doing',`sleeping on ${personal.mat}`]}],approach:[],during:[{verb:'mars:sleep',params:{mat:personal.mat,duration:600,returnTo:personal.sleepReturn}}],takes:'long'});
      for (const [item,slot] of [[personal.bowl,personal.bowlReturn],[personal.spoon,personal.spoonReturn]]) cards.push({name:`return ${item.replace('-',' ')} ${m.name.toLowerCase()}`,summary:'Put a held utensil back on the table and free the hand.',good_when:'Tidy up after an interrupted meal. Free hands let you eat, work or sleep.',target:null,when:[],then:[{set:['$actor','doing','tidying utensils']}],approach:[],during:[{verb:'mars:put_item',params:{item,surfaceSlot:slot}}],takes:'minute'});
      cards.push(singleMeal(m,personal,personal.stewPot??'stew-pot'));
      cards.push(singleMeal(m,personal,'supper-pot'));
      const left = singleMeal(m,personal,personal.stewPot??'stew-pot');
      cards.push({...left,name:`finish the bowl ${m.name.toLowerCase()}`,summary:'Finish food already in my bowl, then return the utensils.',good_when:'Hunger after an interrupted meal; use the food already served.',approach:[{verb:'mars:take_item',params:{item:personal.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:personal.spoon,hand:'right'}}]});
      }
      cards.push(hostSupper(m, others));
      for (const other of others) cards.push(inviteToSupper(m,other));
      for (const other of others){const peer=bindings.bySoul.get(other.soulId);if(personal&&peer&&personal.id!==peer.id)cards.push(joinSupper(m,personal,other,peer));}
      for (const card of cards) {
        if (this.host.kernel.vocab.cards[card.name]) {
          if (firstInstall&&!this.host.kernel.decks[m.soulId].cards.includes(card.name)) void this.host.enqueue('deck','world',{soulId:m.soulId,add:[card.name]});
        } else void this.host.enqueue('mint','world',{forSoul:m.soulId,card:{...card,hash:cardHash(card),by:'world',mintedAt:this.host.engine.world.tick,origin:'agent'}});
      }
    }
  }
}
function singleMeal(m: Mind, resource:CampResourceSet, pot: string): Card {
  const bowl=resource.bowl,spoon=resource.spoon;
  const slots={bowl:resource.bowlReturn,spoon:resource.spoonReturn};
  const bean=pot==='supper-pot',point=!bean&&resource.stewService?resource.stewService:bean?[-16.15,-16.9]:[-12.5,-13.4];
  return {name:`eat a bowl of ${bean?'bean supper':'stew'} ${m.name.toLowerCase()}`,summary:'Take a bowl, serve stew, eat and return the utensils.',good_when:'Hunger; eat a meal alone when food is ready.',target:null,when:[],
    approach:[{verb:'mars:take_item',params:{item:bowl,hand:'left'}},{verb:'mars:walk_to',params:{x:point[0],z:point[1],face:Math.PI/2}},{verb:'mars:serve',params:{pot,bowl}},{verb:'mars:take_item',params:{item:spoon,hand:'right'}}],
    then:[{set:['$actor','doing','eating a bowl of stew']}],
    during:[{verb:'mars:eat',params:{bowl,spoon,cycles:6}},{verb:'mars:put_item',params:{item:bowl,surfaceSlot:slots.bowl}},{verb:'mars:put_item',params:{item:spoon,surfaceSlot:slots.spoon}}],takes:'minutes'};
}

function utensilReturns(r:CampResourceSet) {
  return [{item:r.bowl,surfaceSlot:r.bowlReturn},{item:r.spoon,surfaceSlot:r.spoonReturn}];
}
function hostSupper(m: Mind, others: Mind[]): Card {
  // Existing small-cast recipes retain their exact hashes. A larger host card
  // creates the gathering; invitations are separately chosen bounded cards.
  const invitations=others.length<=4?others:[];
  return {name:`host supper ${m.name.toLowerCase()}`,summary:'Invite people to share food at the kitchen table.',good_when:'Hungry or wanting company; the supper bell is an invitation, not a command.',target:null,when:[{notState:['$actor','hosting',true]}],
    approach:[{verb:'walk_to',params:{to:'dining-table',standoff:2.5}}],
    then:[{move:['$actor','kitchen']},{appear:{kind:'gathering',name:'$actor.name’s supper',at:'kitchen',states:{meal:true}},linkFromActor:'hosts'},{link:['attends','$actor','$new']},{set:['$actor','hosting',true]},...invitations.map(o=>({say:['$actor',o.soulId,'invite'] as [string,string,string],about:'Would you like to share supper with me?'}))],
    during:[{verb:'rest',params:{seconds:240}}],takes:'minutes'};
}
function inviteToSupper(host:Mind,guest:Mind):Card {
  const word=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,12).trim()||'soul';
  const pair=hashOf({host:host.soulId,guest:guest.soulId}).slice(0,16);
  return {name:`invite ${word(guest.name)} to supper ${word(host.name)} ${pair}`,
    summary:`Invite ${guest.name} to share my supper.`,good_when:'Hosting an open supper and wanting this person to join; the guest chooses whether to attend.',
    target:{kind:'gathering'},when:[{state:['$target','meal',true]},{linked:['hosts','$actor','$target']},
      {state:['$actor','hosting',true]},{is:[guest.soulId,'soul']},{notLinked:['attends',guest.soulId,'$target']},
      {notLinked:['said','$actor',guest.soulId]}],
    then:[{say:['$actor',guest.soulId,'invite'],about:'Would you like to share supper with me?'}],
    approach:[],during:[{verb:'rest',params:{seconds:1}}],takes:'seconds'};
}
function joinSupper(m: Mind, r:CampResourceSet, host: Mind, hr:CampResourceSet): Card {
  return {name:`join ${host.name.toLowerCase()} supper ${m.name.toLowerCase()}`,summary:`Join ${host.name}'s invitation and share a meal.`,good_when:'Wanting food and company; independently choose to join an open supper invitation.',target:{kind:'gathering'},derive:{host:{link:'hosts',to:'$target'}},
    when:[{state:['$target','meal',true]},{linked:['hosts',host.soulId,'$target']},{notLinked:['attends','$actor','$target']},{notState:['$actor','hosting',true]}],approach:[],
    then:[{move:['$actor','kitchen']},{link:['attends','$actor','$target']},{set:['$actor','doing','sharing supper with $host.name']}],
    during:[{verb:'mars:shared_food_break',params:{pot:'stew-pot',participants:[{actor:'$actor',bowl:r.bowl,spoon:r.spoon,service:[-12.05,-13.35],returns:utensilReturns(r)},{actor:'$host',bowl:hr.bowl,spoon:hr.spoon,service:[-12.95,-13.35],returns:utensilReturns(hr)}],at:[-12.5,-15.2]}}],takes:'minutes'};
}
