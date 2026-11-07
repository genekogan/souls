import {ownerLifecycleCapabilitySchema,ownerLifecycleListSchema,type OwnerLifecycleCapability,type OwnerLifecycleList} from '@souls/protocol';
export type AdmissionAccount={capability:OwnerLifecycleCapability;page:OwnerLifecycleList;owned:string[]};
/** Use only a fresh authenticated Me reply. A protocol capability does not grant
 * permission, capacity or readiness; the server still owns every write check. */
export function admissionAccount(body:unknown,worldId:string,identity:string):AdmissionAccount|null{
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const data=body as Record<string,any>,me=data.me;
 if(!me||me.userId!==identity||me.invited!==true||!Array.isArray(data.souls))return null;
 const cap=ownerLifecycleCapabilitySchema.safeParse(data.lifecycleCapability),page=ownerLifecycleListSchema.safeParse(data.lifecycleRequests);
 if(!cap.success||!page.success||cap.data.worldId!==worldId||page.data.worldId!==worldId||cap.data.userId!==identity)return null;
 if(data.souls.some((s:unknown)=>!s||typeof s!=='object'||typeof(s as {id?:unknown}).id!=='string'||!(s as {id:string}).id.length||(s as {id:string}).id.length>128))return null;
 const owned:string[]=data.souls.map((s:{id:string})=>s.id);if(new Set(owned).size!==owned.length)return null;
 return {capability:cap.data,page:page.data,owned};
}
