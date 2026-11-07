/** A finite dependency snapshot for one depicted scene; later optional births are not added. */
export type InitialWorldStage='waiting'|'downloading'|'preparing'|'first-frame'|'ready'|'failed'|'cancelled';
export type InitialWorldProgress={generation:number;stage:InitialWorldStage;required:number;completed:number;failed:string[];bytesLoaded:number;bytesTotal:number|null};
export class InitialWorldReadiness{
 private jobs=new Map<string,{run:()=>Promise<void>;status:'pending'|'ready'|'failed';attempt:number}>();
 private knownDownloads:ReadonlySet<string>|null=null;private downloads=new Map<string,{loaded:number;total:number|null}>();
 private current:InitialWorldProgress|null=null;private prepareFailure:string|null=null;private sealed=false;private prepared=false;private rendered=false;private cancelled=false;
 readonly generation:number;
 private changed:(progress:InitialWorldProgress)=>void;
 constructor(generation:number,changed:(progress:InitialWorldProgress)=>void=()=>{}){this.generation=generation;this.changed=changed;}
 require(id:string,run:()=>Promise<void>){if(this.sealed||this.cancelled)throw Error('Initial dependencies already closed');if(this.jobs.has(id))throw Error('Duplicate initial dependency');this.jobs.set(id,{run,status:'pending',attempt:0});this.current=null;}
 seal(){if(this.sealed||this.cancelled)return;this.sealed=true;this.emit();for(const [id]of this.jobs)this.start(id);}
 private start(id:string){const job=this.jobs.get(id)!;const attempt=++job.attempt;job.status='pending';this.emit();Promise.resolve().then(job.run).then(()=>{if(!this.cancelled&&job.attempt===attempt){job.status='ready';this.emit();}},()=>{if(!this.cancelled&&job.attempt===attempt){job.status='failed';this.emit();}});}
 retry(){if(this.cancelled)return;this.prepareFailure=null;this.prepared=false;this.rendered=false;for(const [id,job]of this.jobs)if(job.status==='failed')this.start(id);this.emit();}
 /** Declare only a complete initial network manifest, never just root GLB headers. */
 declareByteDependencies(ids:readonly string[]){if(this.knownDownloads||this.cancelled)throw Error('Initial byte graph already closed');if(new Set(ids).size!==ids.length||ids.some(id=>!id))throw Error('Invalid initial byte graph');this.knownDownloads=new Set(ids);this.emit();}
 download(id:string,loaded:number,total:number|null){if(this.cancelled||this.rendered)return;if(!Number.isFinite(loaded)||loaded<0)return;this.downloads.set(id,{loaded,total:total!==null&&Number.isFinite(total)&&total>0&&total>=loaded?total:null});this.emit();}
 get attached(){return this.sealed&&!this.cancelled&&(this.current?.completed===this.jobs.size||[...this.jobs.values()].every(job=>job.status==='ready'));}
 preparationComplete(generation:number){if(generation!==this.generation||!this.attached)return false;this.prepared=true;this.emit();return true;}
 preparationFailed(message:string){if(this.cancelled)return;this.prepareFailure=message;this.emit();}
 firstFrame(generation:number){if(generation!==this.generation||!this.attached||!this.prepared)return false;this.rendered=true;this.emit();return true;}
 cancel(){this.cancelled=true;this.emit();}
 snapshot():InitialWorldProgress{if(this.current)return this.current;const jobs=[...this.jobs],rows=[...this.downloads.values()];const byteGraph=this.knownDownloads&&[...this.downloads.keys()].every(id=>this.knownDownloads!.has(id))?[...this.knownDownloads].map(id=>this.downloads.get(id)):null;const total=byteGraph?.length&&byteGraph.every(row=>row?.total!==null&&row?.total!==undefined)?byteGraph.reduce((sum,row)=>sum+row!.total!,0):null;const transferred=total!==null&&byteGraph!.every(row=>row!.loaded>=row!.total!);const failed=jobs.filter(([,j])=>j.status==='failed').map(([id])=>id);if(this.prepareFailure)failed.push(this.prepareFailure);return this.current={generation:this.generation,stage:this.cancelled?'cancelled':failed.length?'failed':!this.sealed?'waiting':!this.attached?(transferred?'preparing':'downloading'):!this.prepared?'preparing':!this.rendered?'first-frame':'ready',required:jobs.length,completed:jobs.filter(([,j])=>j.status==='ready').length,failed,bytesLoaded:rows.reduce((sum,row)=>sum+row.loaded,0),bytesTotal:total};}
 private emit(){this.current=null;this.changed(this.snapshot());}
}

/** Concurrent initial jobs share successful metadata; a failed lookup is retried, never permanently cached. */
export function successfulInitialLookup<T>(load:()=>Promise<T>){let pending:Promise<T>|null=null;return()=>pending??=(load().catch(error=>{pending=null;throw error;}));}

/** 404 is the explicit legacy/default-root case; transient HTTP failures must remain retryable. */
export async function initialAssetRoot(response:Pick<Response,'status'|'ok'|'json'>):Promise<string|undefined>{if(response.status===404)return undefined;if(!response.ok)throw Error('World asset metadata unavailable ('+response.status+').');const metadata=await response.json();if(typeof metadata?.assetRoot!=='string'||!/^\/world-assets\/[a-z0-9][a-z0-9_-]{0,63}$/.test(metadata.assetRoot))throw Error('World asset metadata has an invalid root.');return metadata.assetRoot;}
