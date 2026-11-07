import {humanActivity} from './human-activity.ts';
import type {PublicSoul} from '@souls/protocol';
type Choice=Pick<PublicSoul,'id'|'name'|'description'|'doing'>;
const preview=(value:unknown,max:number)=>typeof value==='string'?(value.length>max?value.slice(0,max)+'…':value):'';
/** Public identity/context only; ownership badges use the parent's current Me. */
export function SoulChoices({souls,ownedIds,select}:{souls:readonly Choice[];ownedIds:readonly string[];select(id:string):void}){
 return <div className="soul-list">{souls.map(s=><button key={s.id} onClick={()=>select(s.id)}>
  <span className="soul-choice-context"><b title={s.name}>{s.name}</b>{preview(s.description,140)&&<span className="soul-choice-character">{preview(s.description,140)}</span>}{preview(humanActivity(s.doing??'',s.id).label,100)&&<span className="soul-choice-doing">Doing · {preview(humanActivity(s.doing??'',s.id).label,100)}</span>}</span>
  <span className="soul-choice-link">{ownedIds.includes(s.id)?'Your Soul':'Meet Soul'} →</span>
 </button>)}</div>;
}
