import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeCapability,EdgeSoul} from '../contract.ts';
import type {Place} from '../ledger/places.ts';
import type {MeaningPart} from '../../god/meaning.ts';
import {parseCapability,tokens,type VocabResult} from '../ledger/vocabulary.ts';
import {knownPart} from './resolved-parts.ts';

type Candidate={capability:string;name:string;place:string;target?:MeaningPart['target'];available:boolean;reason?:string;what?:string;matched?:string[];unverified?:string[]};
const names=(p:Place)=>[p.name,...(p.aliases??[]),...(p.ref?[p.ref]:[])];
const words=(xs:string[])=>new Set(xs.flatMap(tokens));
const covers=(q:string[],set:Set<string>)=>q.every(w=>set.has(w));
/** A bound object seat's own names: its label's name, the id after the verb, the target id, the label's words after the verb. */
const seatNames=(c:EdgeCapability)=>[c.label.split(/\s*[([]|,\s*by\s/)[0]!,c.id.slice(c.id.indexOf(':')+1),c.target!.id,parseCapability(c.label,new Set(['sit'])).rest];
const GENERIC_SEAT=new Set(['down','here','nearby','nearest','closest','somewhere','seat','chair','bench']);
export const PURPOSE=/^(?:(?:find|show|suggest|choose|take me to|go to|head to)\s+)?(?:somewhere|(?:a|the|any)\s+(?:place|venue|spot))\s+(?:to|for)\s+(.+)$|^where\s+(?:can|could|should)\s+(?:i|we)\s+(.+)$/i;
const stem=(w:string)=>w.length>5&&w.endsWith('ing')?w.slice(0,-3):w.length>4&&w.endsWith('ed')?w.slice(0,-2):w.length>3&&w.endsWith('s')?w.slice(0,-1):w;
const purposeWords=(xs:string[])=>new Set(xs.flatMap(tokens).map(stem));
const PURPOSE_FILLER=new Set(['do','doing','have','having','get','go','going','find','somewhere','place','venue','spot']);

/** Scope names are identities, not descriptions; purpose descriptions are explicitly weaker discovery evidence. */
function contexts(L:EdgeLedger,p:Place,soul:EdgeSoul):string[]{
 const out=names(p),seen=new Set([p.id]);
 for(let id=p.semanticParent??p.parent,n=0;id&&n<12;n++){
  const a=L.places.byId.get(id);if(!a||seen.has(id))break;seen.add(id);
  if(a.parent!==null&&L.knowledge.knows(soul.soulId,a.id))out.push(...names(a));id=a.semanticParent??a.parent;
 }return out;
}
function candidate(L:EdgeLedger,soul:EdgeSoul,capability:string,p:Place,name:string,target:MeaningPart['target'],caps:EdgeCapability[],plans:Parameters<EdgeLedger['resolveOnDemand']>[3]):Candidate{
 const r=L.resolveOnDemand(soul,capability,caps,plans).v;
 if(r.kind==='unknown'||r.cap.id!==capability)return {capability,name,place:p.id,...(target?{target}:{}),available:false,reason:r.kind==='unknown'?r.reason:'The exact action is not offered now.'};
 return {capability,name,place:p.id,...(target?{target}:{}),available:r.cap.available,...(r.cap.blocked?{reason:r.cap.blocked.reason}:{})};
}
function choice(kind:string,requested:string,candidates:Candidate[],reason:string,extra:Record<string,unknown>={}):VocabResult{
 return {kind:'unknown',code:candidates.length?'capability.choose':'capability.unavailable',reason,didYouMean:candidates.map(c=>({id:c.capability,label:c.name,...c})),discovery:{kind,requested,candidates,...extra}};
}

/** Return options only. Never choose a fixture, invent an action, or reinterpret an interaction as travel. */
export function semanticDiscovery(L:EdgeLedger,soul:EdgeSoul,text:string,caps:EdgeCapability[],plans:Parameters<EdgeLedger['resolveOnDemand']>[3]):VocabResult|null{
 if(text.includes(':'))return null;
 const all=[...L.places.byId.values()],known=all.filter(p=>L.knowledge.knows(soul.soulId,p.id));
 const purpose=PURPOSE.exec(text.trim());
 if(purpose){
  // Preserve established untargeted activity commands (read a book, take a nap).
  // Venue discovery is a fallback, not a conversion of an executable activity to travel.
  const existing=parseCapability(text,new Set(caps.map(c=>c.verb)));
  if(!tokens(existing.rest).length&&!['walk','sit'].includes(existing.verb)&&caps.some(c=>c.verb===existing.verb))return null;
  const requested=(purpose[1]??purpose[2]).trim();
  if(parseCapability(requested,new Set([...caps.map(c=>c.verb),'sit'])).verb==='sit')return semanticDiscovery(L,soul,requested,caps,plans);
  const scope=/\s+(?:in|at)\s+(.+)$/i.exec(requested),activity=scope?requested.slice(0,scope.index):requested;
  const q=tokens(activity).filter(w=>!PURPOSE_FILLER.has(w));if(!q.length)return choice('purpose',requested,[],'Name the activity or purpose you want a place for.');
  const scoped=scope?known.filter(p=>covers(tokens(scope[1]),words(names(p)))):[];
  if(scope&&!scoped.length)return choice('purpose',requested,[],'The named location is not known; no other location was substituted.');
  const within=(p:Place)=>{if(!scope)return true;const allowed=new Set(scoped.map(a=>a.id)),seen=new Set<string>();for(let at:Place|undefined=p;at&&!seen.has(at.id);at=L.places.byId.get(at.semanticParent??at.parent??'')){if(allowed.has(at.id))return true;seen.add(at.id);}return false;};
  const ranked=known.filter(p=>p.parent!==null&&within(p)).map(p=>{
   const own=purposeWords([...names(p),p.semanticKind??'',p.semanticRole??'']),facts=purposeWords([p.description??'']);
   const matched=q.filter(w=>own.has(stem(w))||facts.has(stem(w))),score=matched.reduce((n,w)=>n+(own.has(stem(w))?3:1),0);
   return {p,matched,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.matched.length-a.matched.length||b.score-a.score||(b.p.salience??0)-(a.p.salience??0)||a.p.id.localeCompare(b.p.id)).slice(0,8);
  const candidates=ranked.map(({p,matched})=>({...candidate(L,soul,`walk:${p.ref??p.id}`,p,p.name,undefined,caps,plans),...(p.description?{what:p.description}:{}),matched,unverified:q.filter(w=>!matched.includes(w))}));
  return choice('purpose',requested,candidates,candidates.length?'Choose a destination by its exact capability ID; these are places whose authored purpose matches your request.':'No public place purpose matched; no destination was chosen.',{note:'Purpose describes a suitable place; it does not confirm the activity is happening now.'});
 }
 const parsed=parseCapability(text,new Set([...caps.map(c=>c.verb),'sit']));if(parsed.verb!=='sit')return null;
 // An infinitive/so-clause after a named seat states why to sit, not a second seat identity.
 const target=parsed.rest.split(/\s+(?:so(?:\s+that)?|in\s+order\s+to|to)\s+/i)[0],q=tokens(target).filter(w=>w!=='down');
 if(!q.length||q.every(w=>GENERIC_SEAT.has(w)))return null;
 // Existing exact fixture identities retain the normal vocabulary/admission path. A shared
 // word in a semantic part must not intercept a fully named ordinary object.
 const identity=q.join(' ');
 if(caps.some(c=>c.verb==='sit'&&c.target?.kind==='object'&&seatNames(c).some(n=>tokens(n).join(' ')===identity)))return null;
 const entries=known.flatMap(p=>(p.parts??[]).filter(part=>knownPart(L,soul,p,part)).map(part=>({p,part,scope:words(contexts(L,p,soul)),own:words([part.title,...(part.aliases??[])])})))
  .filter(x=>covers(q,new Set([...x.scope,...x.own])));
 // Do not relax an explicit target to a nearby fixture if a named part/place is missing or unsupported.
 const relevant=entries.length||known.some(p=>p.parts?.length&&q.some(w=>words([...contexts(L,p,soul),...p.parts!.filter(part=>knownPart(L,soul,p,part)).flatMap(x=>[x.title,...(x.aliases??[])])]).has(w)));
 if(!relevant)return null;
 const ranked=entries.sort((a,b)=>q.filter(w=>b.own.has(w)).length-q.filter(w=>a.own.has(w)).length||a.p.id.localeCompare(b.p.id)||a.part.id.localeCompare(b.part.id));
 const candidates=ranked.filter(x=>x.part.sit).slice(0,8).map(({p,part})=>({...candidate(L,soul,part.sit!,p,`${part.title} — ${p.name}`,part.target,caps,plans),...(part.what?{what:part.what}:{})}));
 // F5 (#376): no part matches, but bound seats hold every word in their own name ("presenter box" names presenter-timber-box):
 // one seat (or numbered copies of one, which the vocabulary already reads as the nearest) keeps the normal path; seats
 // of different names are ambiguous and are named, never chosen.
 if(!candidates.length){
  const own=caps.filter(c=>c.verb==='sit'&&c.target?.kind==='object'&&covers(q,words(seatNames(c))));
  const bases=new Set(own.map(c=>seatNames(c)[0]!.replace(/[-\s]+\d+$/,'')));
  if(bases.size===1)return null;
  if(bases.size>1){const named=own.slice(0,8).map(c=>({capability:c.id,name:seatNames(c)[0]!,place:c.target!.id,available:c.available,...(c.blocked?{reason:c.blocked.reason}:{})}));return choice('interaction','sit',named,`Several seats are named that way (${[...bases].slice(0,8).join(', ')}); choose one by its exact sit capability ID. No seat has been selected.`);}
 }
 return choice('interaction','sit',candidates,candidates.length?'Choose a bound seat by its exact sit capability ID. No seat has been selected.':'No bound sit action matches that named target; no nearby seat or walk was substituted.');
}

/** Explore accepts bare purpose words as well as sentences. Bare words must all be
 * supported by one candidate's authored facts; never discard a missing name/qualifier. */
export function exploreDiscovery(L:EdgeLedger,soul:EdgeSoul,query:string,caps:EdgeCapability[],plans:Parameters<EdgeLedger['resolveOnDemand']>[3]):VocabResult|null{
 const direct=semanticDiscovery(L,soul,query,caps,plans);if(direct)return direct;
 if(query.includes(':'))return null;
 const result=semanticDiscovery(L,soul,`a place for ${query}`,caps,plans);
 if(!result||result.kind!=='unknown'||result.discovery?.kind!=='purpose')return null;
 const candidates=(result.discovery.candidates as Candidate[]).filter(c=>!c.unverified?.length);
 return candidates.length?choice('purpose',query,candidates,result.reason,{note:result.discovery.note}):null;
}
