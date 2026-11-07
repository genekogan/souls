// Owned stdio Codex session. It exposes lifecycle facts; no Soul decisions or
// world writes occur here. A turn finishing is not completion of a Soul goal.
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';

const fault=(code,message)=>Object.assign(Error(message),{code});
const input=text=>[{type:'text',text}];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const GROUP_REAP_POLLS=200,GROUP_REAP_POLL_MS=25;
const probeErrorCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value)?value:'UNKNOWN';
const threadName=value=>{if(value===null)return null;if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw fault('HOST_INVALID_NAME','Thread name must be readable text of1..200characters');return value.trim();};
const booleanOption=(name,value)=>{if(typeof value!=='boolean')throw fault('HOST_INVALID_OPTION',name+' must be boolean');return value;};
// Soul transport: the built-in OpenAI transport (same backend, websockets,
// default retries and org/project headers) with a short stream idle timeout, so
// Codex's own retry fires on a silent stream within the same turn. Built-in IDs
// cannot be overridden, so it is a distinct provider entry. Applied only when the
// effective provider is the built-in one and the auth class is determinable.
// Opt-in only (managed Soul connect): a default host sends no account/config
// queries and its thread/start|resume params are unchanged.
export const SOUL_STREAM_IDLE_TIMEOUT_MS=10000;
export const SOUL_PROVIDER_ID='sim_soul_openai';
const OPENAI_BASE_URLS={chatgpt:'https://chatgpt.com/backend-api/codex',apiKey:'https://api.openai.com/v1'};
export const soulProvider=authMode=>({name:'OpenAI',base_url:OPENAI_BASE_URLS[authMode],wire_api:'responses',requires_openai_auth:true,supports_websockets:true,env_http_headers:{'OpenAI-Organization':'OPENAI_ORGANIZATION','OpenAI-Project':'OPENAI_PROJECT'},stream_idle_timeout_ms:SOUL_STREAM_IDLE_TIMEOUT_MS});
// Keys that can select or redirect a provider. Any of them in caller or effective
// config means the built-in transport is not provable: fail closed.
const providerKey=key=>['model_provider','model_providers','profile','profiles','chatgpt_base_url','openai_base_url'].includes(key)||/^(model_providers|profiles)\./.test(key);
// Effective config/read reports this built-in default even with no user setting.
const CHATGPT_DEFAULT_BASE='https://chatgpt.com/backend-api';
const STEER_ID=/^[A-Za-z0-9_-]{8,64}$/;
// A steer input is one text element whose JSON carries a top-level steerId.
// Only that identifier is retained; item text is never stored or emitted.
const steerIdOf=content=>{
  const texts=Array.isArray(content)?content.filter(c=>c?.type==='text'):[];if(texts.length!==1||typeof texts[0].text!=='string')return null;
  try{const v=JSON.parse(texts[0].text);return v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.steerId==='string'&&STEER_ID.test(v.steerId)?v.steerId:null;}catch{return null;}
};
// Diagnostic notices for otherwise dropped notifications: method name and
// receipt time only, never params. Bounded per turn per method and per host.
const FORWARDED=['turn/started','turn/completed','item/started','item/completed','thread/tokenUsage/updated','thread/name/updated','thread/archived','error'];
const NOTICE_LIMIT=2000,NOTICE_TURN_METHOD_LIMIT=5;
export class CodexHost extends EventEmitter {
  constructor({cwd,model=null,effort='low',command='codex',args=['app-server','--listen','stdio://'],requestTimeoutMs=30000,spawnProcess=spawn,killProcess=process.kill,ephemeral=false,name=null,internalProbe=false,soulTransport=false,env=process.env}={}) {
    super();this.cwd=cwd;this.model=model;this.effort=effort;this.requestTimeoutMs=requestTimeoutMs;
    this.ephemeral=booleanOption('ephemeral',ephemeral);this.name=threadName(name);this.internalProbe=booleanOption('internalProbe',internalProbe);this.soulTransport=booleanOption('soulTransport',soulTransport);this.killProcess=killProcess;this.env=env;
    this.connected=false;this.connecting=false;this.archiving=null;this.archived=false;
    this.pending=new Map();this.turns=new Map();this.sequence=0;this.threadId=null;this.activeTurnId=null;this.closed=false;this.closing=false;this.buffer='';
    this.transport={providerId:null,idleTimeoutMs:null,authMode:null,reason:'not-connected'};this.notices={emitted:0,methods:new Map()};
    this.child=spawnProcess(command,args,{cwd,stdio:['pipe','pipe','pipe'],detached:true});
    this.pid=this.child.pid;this.exit=new Promise(resolve=>{
      this.child.once('exit',(code,signal)=>{this.exitStatus={code,signal};this.fail(fault('HOST_EXITED','Codex host exited'));resolve(this.exitStatus)});
      this.child.once('error',e=>{this.exitStatus={code:null,signal:null,startFailed:true};this.fail(fault('HOST_START_FAILED',e.message));resolve(this.exitStatus);});
    });
    this.child.stdin.on('error',e=>this.fail(fault('HOST_INPUT_FAILED',e.message)));
    // Never copy arbitrary host stderr (which can contain config/auth details)
    // into Soul context or diagnostic artifacts.
    this.child.stderr.on('data',()=>{});
    this.child.stdout.on('data',data=>{
      this.buffer+=data.toString();
      if(Buffer.byteLength(this.buffer)>8*1024*1024){this.fail(fault('HOST_PROTOCOL','Host line exceeded bound'));return;}
      let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(line.trim())this.receive(line);}
    });
  }
  fail(error){
    if(this.closed)return;this.closed=true;this.failure=error;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
    for(const t of this.turns.values())if(!t.terminal){t.terminal=true;t.reject(error);}
    this.emit('fault',error);
  }
  send(message){if(this.closed)throw this.failure??fault('HOST_CLOSED','Host is closed');this.child.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params){
    if(this.closed)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{
        // Timeout is ambiguous: do not replay turn/start or steer into a host
        // that may already have accepted it. Caller must close and reconcile.
        this.fail(fault('HOST_REQUEST_TIMEOUT',`Host request timed out: ${method}`));
      },this.requestTimeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  // Read-only metadata query: a refusal or timeout is "unknown", never a host
  // failure; a late answer finds no pending entry and is ignored.
  query(method,params,timeoutMs=Math.min(this.requestTimeoutMs,5000)){
    if(this.closed)return Promise.resolve(null);
    return new Promise(resolve=>{
      const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);resolve(null);},timeoutMs);
      this.pending.set(id,{resolve,reject:()=>resolve(null),timer});
      try{this.send({id,method,params});}catch{clearTimeout(timer);this.pending.delete(id);resolve(null);}
    });
  }
  async selectTransport(config,enabled,threadId=null,checkpointed=null){
    const off=(reason,cause)=>({providerId:null,idleTimeoutMs:null,authMode:null,reason,...(cause?{cause}:{})});
    if(!enabled)return off('disabled');
    if(Object.keys(config??{}).some(providerKey))return off('caller-provider');
    // One parallel metadata budget (each query is capped at 5s).
    const [settings,account,thread]=await Promise.all([this.query('config/read',{cwd:this.cwd??null}),this.query('account/read',{}),threadId===null?null:this.query('thread/read',{threadId,includeTurns:false})]);
    const c=settings?.config,type=account?.account?.type,routing=account?.workspaceRouting;
    const blocked=this.env?.OPENAI_BASE_URL?'base-url-environment':!c||typeof c!=='object'?'config-unknown':c.profile!=null?'configured-profile':(c.model_provider??'openai')!=='openai'?'configured-provider':c.chatgpt_base_url!=null&&String(c.chatgpt_base_url).replace(/\/+$/,'')!==CHATGPT_DEFAULT_BASE||c.openai_base_url!=null?'configured-base-url'
      :account?.requiresOpenaiAuth!==true||!Object.hasOwn(OPENAI_BASE_URLS,type??'')?'auth-unknown'
      // Workspace/regional routing selects another backend origin; never guess it.
      :type==='chatgpt'&&routing!=null&&(routing.backendOrigin!=='https://chatgpt.com'||routing.accountRoutingOverride!=='NO_CONSTRAINT')?'routed-backend':null;
    // Resuming under another provider rewrites the thread's recorded provider
    // (probed on 0.163), so a retained thread keeps the transport it was created
    // with. A Soul thread that cannot provably keep it is disclosed, never hidden.
    if(threadId!==null){
      // #488: the checkpoint answers when the host can't, so an unanswered read doesn't flip a Soul thread to the default.
      const recorded=thread?.thread?.modelProvider??checkpointed;
      if(recorded!==SOUL_PROVIDER_ID)return off(typeof recorded==='string'?'retained-thread-provider':'thread-provider-unknown',blocked??undefined);
      if(blocked)return off('retained-soul-thread-fallback',blocked);
    }
    if(blocked)return off(blocked);
    return {providerId:SOUL_PROVIDER_ID,idleTimeoutMs:SOUL_STREAM_IDLE_TIMEOUT_MS,authMode:type,reason:'applied'};
  }
  turnRecord(id){
    let t=this.turns.get(id);if(t)return t;
    let resolve,reject;const completed=new Promise((a,b)=>{resolve=a;reject=b});completed.catch(()=>{});
    // inputs lists recorded userMessage items in order (steerId or null). Each
    // agentMessage start notes how many inputs preceded it; final is the last.
    t={id,text:[],characters:0,terminal:false,completed,resolve,reject,inputs:[],started:new Map(),final:null,unmatched:false};this.turns.set(id,t);return t;
  }
  notice(method){
    // Streaming deltas say nothing about stalls; keep the lifetime budget for the rest.
    if(/(\/delta|Delta)$/.test(method))return;
    const n=this.notices,count=n.methods.get(method)??0;
    if(n.emitted>=NOTICE_LIMIT||count>=NOTICE_TURN_METHOD_LIMIT)return;
    n.methods.set(method,count+1);n.emitted++;this.emit('notice',{method,receivedAt:Date.now()});
  }
  receive(line){
    let m;try{m=JSON.parse(line)}catch{this.fail(fault('HOST_PROTOCOL','Malformed host JSON'));return;}
    if(m.id!==undefined&&this.pending.has(m.id)){
      const p=this.pending.get(m.id);clearTimeout(p.timer);this.pending.delete(m.id);
      if(m.error)p.reject(Object.assign(Error(m.error.message??'Host request refused'),{code:m.error.code,data:m.error.data}));else p.resolve(m.result);return;
    }
    if(m.id!==undefined&&m.method){
      // This adapter doesn't grant tools/permissions or wait for a human.
      try{this.send({id:m.id,error:{code:-32601,message:'No tool or approval handler in Soul decision adapter'}})}catch{}
      this.emit('unsupportedRequest',{method:m.method});return;
    }
    const p=m.params??{};
    if(p.threadId&&this.threadId&&p.threadId!==this.threadId)return;
    if(m.method==='turn/started'){
      const id=p.turn?.id;if(!id)return;
      if(this.activeTurnId&&this.activeTurnId!==id){this.fail(fault('HOST_OVERLAPPING_TURNS','Host started a second decision turn'));return;}
      this.activeTurnId=id;this.turnRecord(id);this.notices.methods.clear();
    }else if(m.method==='item/started'&&p.item?.type==='agentMessage'&&p.turnId){
      const t=this.turnRecord(p.turnId);if(typeof p.item.id==='string'&&!t.started.has(p.item.id))t.started.set(p.item.id,t.inputs.length);else t.unmatched=true;
    }else if(m.method==='item/completed'&&p.item?.type==='userMessage'&&p.turnId){
      this.turnRecord(p.turnId).inputs.push(steerIdOf(p.item.content));
    }else if(m.method==='item/completed'&&p.item?.type==='agentMessage'&&p.turnId){
      const t=this.turnRecord(p.turnId),text=p.item.text??'';t.characters+=text.length;
      if(t.characters>512*1024){this.fail(fault('HOST_OUTPUT_LIMIT','Decision output exceeded bound'));return;}
      t.text.push(text);
      if(t.started.has(p.item.id))t.final={id:p.item.id,after:t.started.get(p.item.id),text};else t.unmatched=true;
    }else if(m.method==='turn/completed'&&p.turn?.id){
      const t=this.turnRecord(p.turn.id);t.terminal=true;
      // finalAfter is null when the final message's start is unknown or another
      // agentMessage began after it: callers then keep their ordinary rule.
      const last=[...t.started.keys()].at(-1),finalAfter=!t.unmatched&&t.final&&t.final.id===last?t.final.after:null;
      t.result={turnId:t.id,status:p.turn.status,error:p.turn.error??null,text:t.text.join('\n'),finalText:t.final?.text??null,inputs:{userMessages:t.inputs.length,agentMessages:t.text.length,finalAfter,steerIds:[...t.inputs]}};
      if(this.activeTurnId===t.id)this.activeTurnId=null;t.resolve(t.result);
      // Keep a small recent window for acknowledgement/completion races.
      for(const [id,old] of this.turns){if(this.turns.size<=32)break;if(old.terminal&&id!==t.id)this.turns.delete(id);}
    }
    if(FORWARDED.includes(m.method))this.emit('event',{method:m.method,params:p,receivedAt:Date.now()});
    else if(typeof m.method==='string')this.notice(/^[A-Za-z0-9_./-]{1,100}$/.test(m.method)?m.method:'unknown');
  }
  async connect({threadId=null,instructions='',baseInstructions=null,config={},ephemeral=this.ephemeral,name=this.name,soulTransport=this.soulTransport,threadProvider=null}={}){
    ephemeral=booleanOption('ephemeral',ephemeral);name=threadName(name);soulTransport=booleanOption('soulTransport',soulTransport);
    if(threadId!==null&&(typeof threadId!=='string'||!threadId))throw fault('HOST_INVALID_THREAD','Resume needs a nonempty thread ID');
    // Ephemeral work has no persistent history to resume. Never reinterpret a
    // retained durable thread ID as permission to drop or replace its history.
    if(ephemeral&&threadId!==null)throw fault('HOST_EPHEMERAL_RESUME','Ephemeral mode cannot resume a retained thread');
    if(this.connecting||this.connected||this.threadId)throw fault('HOST_ALREADY_CONNECTED','Host already has a thread connection');
    this.connecting=true;this.ephemeral=ephemeral;this.name=name;
    try{
    this.emit('lifecycle',{state:'host-started',hostPid:this.pid??null,cwd:this.cwd});
    await this.request('initialize',{clientInfo:{name:'sim_soul_continuity',version:'0.1.0'}});this.send({method:'initialized',params:{}});
    if(!this.model){
      const listed=await this.request('model/list',{});
      this.model=listed.data?.find(m=>m.isDefault)?.model;
      if(!this.model)throw fault('HOST_MODEL_UNAVAILABLE','Host did not advertise a default model');
    }
    const transport=await this.selectTransport(config,soulTransport,threadId,threadProvider);
    const effective=transport.providerId?{...config,model_provider:transport.providerId,['model_providers.'+transport.providerId]:soulProvider(transport.authMode)}:config;
    const params={cwd:this.cwd,model:this.model,approvalPolicy:'never',sandbox:'read-only',developerInstructions:instructions,...(baseInstructions?{baseInstructions}:{}),config:effective};
    const r=await this.request(threadId?'thread/resume':'thread/start',threadId?{...params,threadId}:{...params,ephemeral});
    this.threadId=r.thread.id;
    // The host's reported provider is the applied fact; a mismatch is disclosed, never assumed.
    this.transport=transport.providerId&&r.modelProvider!==undefined&&r.modelProvider!==transport.providerId?{...transport,reason:'host-provider-mismatch'}:transport;
    // Publish ownership as soon as the authoritative ID exists, even if naming
    // or the supervisor's first world observation subsequently fails.
    this.emit('lifecycle',{state:'session-created',threadId:this.threadId,hostPid:this.pid??null,cwd:this.cwd,ephemeral,resumed:threadId!==null,transport:{...this.transport}});
    // Installed app-server refuses metadata updates for ephemeral threads. Keep
    // their readable name in local lifecycle evidence, without a persistence fallback.
    if(name!==null&&!ephemeral)await this.request('thread/name/set',{threadId:this.threadId,name});
    this.connected=true;return {threadId:this.threadId,model:r.model??this.model,ephemeral,name,transport:{...this.transport}};
    }finally{this.connecting=false;}
  }
  async begin(text,{outputSchema}={}){
    if(this.archiving||this.archived)throw fault('HOST_ARCHIVED','Thread is being archived or already archived');
    if(!this.connected)throw fault('HOST_NOT_CONNECTED','Await thread connection and naming before starting a turn');
    if(this.activeTurnId||this.starting)throw fault('HOST_BUSY','A decision turn is already active');
    this.starting=true;
    try{
      const r=await this.request('turn/start',{threadId:this.threadId,input:input(text),effort:this.effort,...(outputSchema?{outputSchema}:{})});
      const t=this.turnRecord(r.turn.id);if(!t.terminal)this.activeTurnId=t.id;
      return {turnId:t.id,completed:t.completed};
    }finally{this.starting=false;}
  }
  async steer(text,expectedTurnId=this.activeTurnId){
    if(!expectedTurnId)throw fault('HOST_IDLE','No active turn to steer');
    return this.request('turn/steer',{threadId:this.threadId,expectedTurnId,input:input(text)});
  }
  async interrupt(expectedTurnId=this.activeTurnId){
    const turnId=expectedTurnId;if(!turnId)return {status:'idle'};
    if(turnId!==this.activeTurnId)throw fault('HOST_TURN_MISMATCH','Interrupt target differs from the active turn');
    const turn=this.turnRecord(turnId);
    await this.request('turn/interrupt',{threadId:this.threadId,turnId});
    return turn.completed;
  }
  // Caller must establish terminal *run* completion and ownership separately;
  // model-turn completion, routine close, and recovery never trigger archival.
  async archiveCompleted({expectedThreadId=this.threadId}={}){
    if(!this.internalProbe)throw fault('HOST_ARCHIVE_NOT_OWNED','Archival requires an explicitly owned internal probe host');
    if(!this.connected||!this.threadId)throw fault('HOST_NOT_CONNECTED','No connected thread to archive');
    if(expectedThreadId!==this.threadId)throw fault('HOST_THREAD_MISMATCH','Archive target differs from this host thread');
    if(this.activeTurnId||this.starting)throw fault('HOST_BUSY','Cannot archive an active or starting turn');
    if(this.archived)return {threadId:this.threadId,archived:true,alreadyArchived:true};
    if(this.ephemeral)return {threadId:this.threadId,archived:false,ephemeral:true};
    if(this.archiving)return this.archiving;
    this.archiving=this.request('thread/archive',{threadId:this.threadId}).then(()=>{this.archived=true;return {threadId:this.threadId,archived:true};}).finally(()=>{this.archiving=null;});
    return this.archiving;
  }
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      this.child.stdin.end();
      await Promise.race([this.exit,delay(1000)]);
      // Owned process group can outlive its parent; always clean the group.
      if(this.pid){
        try{this.killProcess(-this.pid,'SIGTERM')}catch{}
        await Promise.race([this.exit,delay(1000)]);
        try{this.killProcess(-this.pid,'SIGKILL')}catch{}
        await Promise.race([this.exit,delay(1000)]);
      }
      let groupClosed=this.exitStatus?.startFailed===true&&!this.pid;
      let groupProbeCount=0,groupProbeFirstErrorCode=null,groupProbeLastErrorCode=null;
      const groupProbeStarted=performance.now();
      // A leader's exit can precede descendant reaping. Keep the existing
      // bounded probe budget after cleanup signals. A transient probe error
      // remains unknown and may recover; only actual ESRCH establishes absence.
      if(this.pid)for(let n=0;n<GROUP_REAP_POLLS;n++){
        groupProbeCount++;
        try{this.killProcess(-this.pid,0);}catch(e){
          const code=probeErrorCode(e?.code);
          groupProbeFirstErrorCode??=code;groupProbeLastErrorCode=code;
          if(e?.code==='ESRCH'){groupClosed=true;break;}
        }
        await delay(GROUP_REAP_POLL_MS);
      }
      // Codes include the expected ESRCH absence result; never retain arbitrary
      // error messages or error properties in lifecycle/cleanup evidence.
      const groupProbeElapsedMs=Math.round(performance.now()-groupProbeStarted);
      this.closeProof={...this.exitStatus,hostPid:this.pid??null,threadId:this.threadId,groupClosed,groupVerification:groupClosed?'absent':'unverified',groupProbeCount,groupProbeElapsedMs,groupProbeFirstErrorCode,groupProbeLastErrorCode};
      this.emit('lifecycle',{state:'host-closed',...this.closeProof});
      return this.closeProof;
    })();return this.closing;
  }
}
