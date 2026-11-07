import {admissionAccount,type AdmissionAccount} from './admission-account.ts';
import type {SoulLifecycle} from '@souls/protocol';
export type ArrivalResume={kind:'unavailable'}|{kind:'incomplete'}|{kind:'clear'}|{kind:'resume';request:SoulLifecycle}|{kind:'choose';requests:SoulLifecycle[]};
/** A cold form must not infer no previous pending birth from a capped page.
 * Only an authenticated current-owner capability/page can supply candidates.
 * This projection neither retries a write nor selects/authorizes a Soul. */
export function arrivalResume(body:unknown,worldId:string,identity:string):ArrivalResume{
 return arrivalResumeAccount(admissionAccount(body,worldId,identity));
}
export function arrivalResumeAccount(account:AdmissionAccount|null):ArrivalResume{
 if(!account)return {kind:'unavailable'};
 if(account.page.nextCursor!==null)return {kind:'incomplete'};
 const requests=account.page.requests.filter(r=>r.operation==='create'&&r.allocation.countsTowardLimit&&r.reason!=='retirement-accepted'&&(r.state==='pending'||r.state==='admitted'&&!r.ready));
 return requests.length===0?{kind:'clear'}:requests.length===1?{kind:'resume',request:requests[0]}:{kind:'choose',requests};
}
