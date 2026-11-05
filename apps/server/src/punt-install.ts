// Install finite two-seat rowing rides from the engine's admitted water, never from scenery labels.
// A native rules fact goes first; the ordinary `ride` object is only offered after the carrier really exists.
import type {WorldHost} from './world.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';

type SearchResult={state:'pending'}|{state:'cancelled'}|{state:'done';candidates:CarrierInstallSpec[]};
type SearchJob={advance(budgetMs:number):SearchResult;cancel():unknown};
const SEARCH_SLICE_MS=8;
/** Load lane L4: one `[l4] punt search …` line a minute (ms spent, slices, searches finished, misses). */
const STATS=process.env.SIM_L4_STATS==='1';

/** `onInstalled` runs after an install run that added at least one punt (and published its ride). */
/** F8 (#958): the engine labels a punt by its water's id (`e_00caa734 rowing punt`); a Soul reads `Rowing punt`. */
export const puntName=(label:string)=>{const t=label.replace(/^e_[0-9a-f]{8}\s+/,'');return t.charAt(0).toUpperCase()+t.slice(1);};
export function installPuntActivities(host:WorldHost,edge:EdgeLedger,log:(text:string)=>void=()=>{},onInstalled?:()=>void){
  const current=()=>host.engine as typeof host.engine&{puntCandidatesV1?():CarrierInstallSpec[];puntCandidatesJobV1?():SearchJob;carriers?():{id:string;def:string;label:string;state:{bank?:{door:number[]}}}[];staticEpochV1?():number};
  if(!current().puntCandidatesV1)return {close(){}};
  /** What a finished search depends on: the water source, the static epoch and which punts exist. */
  const keyOf=(engine:ReturnType<typeof current>)=>{const w=engine.world as typeof engine.world&{groundV1?:{recipeHash:string}};
    return `${w.groundV1?.recipeHash??w.base.staticHash}|${engine.staticEpochV1?.()??'-'}|${(engine.carriers?.()??[]).filter(c=>c.def==='rowing-punt').map(c=>c.id).join(',')}`;};
  let busy=false,closed=false,lastSource='',retryAt=0,settled='',holdUntil=0,cancels=0,refusals=0;
  let lastEngine=host.engine;
  let pending:{engine:typeof host.engine;job:SearchJob;source:string;started:number}|null=null,restart=false;
  const publish=()=>{
    if(closed||!edge.comms)return;
    for(const c of current().carriers?.()??[]){if(c.def!=='rowing-punt')continue;
      const door=c.state.bank?.door,place=door?edge.places.containing(door[0],door[2],0)[0]:null;
      const parent=place?.id??[...edge.places.byId.values()].find(p=>p.parent===null)?.id;
      // S1: create() keeps an existing object, so an existing ride is skipped by its id alone (no transaction, no parse)
      if(parent&&!edge.comms.objects.has?.(`ride-${c.id}`))edge.comms.objects.create({id:`ride-${c.id}`,kind:'ride',name:puntName(c.label),placeId:parent,params:{carrier:c.id,vehicle:'punt'}});
    }
  };
  const install=(candidates:CarrierInstallSpec[],engine:typeof host.engine)=>{
    const missing=candidates.filter(s=>!(engine.world.entities[s.id] as {carrier?:unknown}|undefined)?.carrier);
    if(!missing.length){settled=keyOf(engine);refusals=0;return;}
    busy=true;
    // Host owns sequencing and durable publication. Never mutate engine entities from a presentation hook.
    // Both host preview and engine fold still validate against live geometry after this speculative search.
    let refused=false;
    void (async()=>{let added=0;for(const spec of missing){if(closed||host.engine!==engine)break;try{await host.installCarrierV1(spec);added++;log(`rowing punt installed: ${spec.id}`);}catch(error){refused=true;log(`rowing punt refused: ${error instanceof Error?error.message:String(error)}`);}}if(host.engine===engine)publish();
      // a refused install is retried later and later (1, 2, 4 … 20 min) while the statics stay the same; none refused: settled
      if(refused){refusals++;retryAt=engine.world.tick+Math.min(20*60*20,20*60*2**(refusals-1));}else{settled=keyOf(engine);refusals=0;}if(added&&!closed)onInstalled?.();})()
      .finally(()=>{busy=false;});
  };
  const reconcile=()=>{
    if(closed||busy||!edge.comms)return;
    const engine=current(),tick=engine.world.tick;
    if(engine!==lastEngine){pending?.job.cancel();pending=null;lastEngine=engine;lastSource="";retryAt=0;restart=true;settled="";holdUntil=0;cancels=0;refusals=0;}
    const w=engine.world as typeof engine.world&{groundV1?:{recipeHash:string}};
    const source=w.groundV1?.recipeHash??w.base.staticHash;
    try{
      if(!pending){
        if(tick<holdUntil&&!restart)return;
        // L4 negative cache: a finished search whose every candidate exists (or none was found) is not repeated until the
        // static world (its epoch), the water source or the set of punts changes.
        // (the key costs a spatial sync: a settled search looks again every 10 s, not every second)
        if(!restart&&settled&&(tick%200!==0||settled===keyOf(engine)))return;
        if(!restart&&!settled&&source===lastSource&&tick<retryAt)return;
        restart=false;settled='';
        if(!engine.puntCandidatesJobV1){
          // Older adapters retain their synchronous API; Mars always takes the resumable path.
          lastSource=source;retryAt=tick+20*60;install(engine.puntCandidatesV1!(),engine);return;
        }
        pending={engine,job:engine.puntCandidatesJobV1(),source,started:tick};
      }
      const work=pending,result=work.job.advance(SEARCH_SLICE_MS);
      if(result.state==='pending')return;
      pending=null;
      // the geometry moved under the search: start over, but back off (5 s, 10 s … 2 min) so a world whose geometry keeps
      // moving (under load) does not spend every tick restarting a search that never finishes
      if(result.state==='cancelled'){cancels++;holdUntil=tick+Math.min(20*120,100*2**(cancels-1));return;}
      cancels=0;
      lastSource=work.source;retryAt=work.started+20*60;stats.searches++;if(!result.candidates.length)stats.misses++;
      install(result.candidates,work.engine);
    }catch(error){
      pending?.job.cancel();pending=null;restart=false;lastSource=source;retryAt=tick+20;
      log(`rowing punt search failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  // In a served world the first look (a lattice search of each water without a punt, ~0.25 s on Eden 2026, memoised after)
  // waits 10 s of world time after boot (lane P5). Once started, each completed tick advances one short slice: a
  // once-a-second slice would turn a bounded search into a minute-long wait. Manually stepped worlds start at once.
  let first=-1;
  const stats={n:0,ms:0,max:0,searches:0,misses:0,at:performance.now()};
  const listener={afterTick:(tick:number)=>{
    if(first<0)first=host.running?tick:-Infinity;
    if(closed)return;
    if(tick%20===0)publish();
    if(pending||restart||host.engine!==lastEngine||tick%20===0&&tick-first>=200){
      if(!STATS){reconcile();return;}
      const t0=performance.now();reconcile();const ms=performance.now()-t0;stats.n++;stats.ms+=ms;if(ms>stats.max)stats.max=ms;
    }
    if(STATS&&performance.now()-stats.at>=60_000){stats.at=performance.now();log(`[l4] punt search ${Math.round(stats.ms)} ms in ${stats.n} slices (max ${Math.round(stats.max)} ms), searches ${stats.searches}, misses ${stats.misses}`);stats.n=0;stats.ms=0;stats.max=0;}
  }};
  host.listeners.push(listener);
  return {close(){closed=true;pending?.job.cancel();pending=null;const at=host.listeners.indexOf(listener);if(at>=0)host.listeners.splice(at,1);}};
}
