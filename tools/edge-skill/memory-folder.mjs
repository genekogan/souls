/** W5 local memory preparation. No HTTP, identity, model, CLI or queue runner. */
import {appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';

const VERSION = 'eden-memory-folder/1';
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const MAX_RECORD = 64 * 1024;
const source = value => typeof value === 'string' && value.length>0&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value) ? value : fail('invalid source ID');
const publicId=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value)?value:fail('invalid public reference');
const canonical = value => JSON.stringify(value, function (_key, item) {return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;});
const uniqueIDs = values => {if (new Set(values.map(v => v.id ?? v)).size !== values.length) fail('duplicate snapshot ID');};
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => {throw new Error(`memory: ${message}`);};
const id = value => typeof value === 'string' && ID.test(value) ? value : fail('invalid stable ID');
const text = (value, max = 1000) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value) ? value : fail('invalid bounded text');
const keys = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('unknown record field');
};
const list = (value, max) => Array.isArray(value) && value.length <= max ? value : fail('invalid bounded list');
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : fail('invalid UTC instant');
const md = value => String(value).replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()#|~]/g, '\\$&');
const personFile = value => `person-${createHash('sha256').update(id(value)).digest('hex')}.md`;
const sorted = map => [...map.values()].sort((a, b) => lexical(a.id, b.id));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : fail('invalid count');

// The Souls home adds these to every record (docs/design/soul-context.md section 2). All optional: a 1.9 log has none.
const CONTEXT = ['world', 'when', 'seen'];
function validateContext(e) {
  if (e.world !== undefined) id(e.world);
  if (e.when !== undefined) {
    keys(e.when, ['real', 'tick', 'worldDay', 'time']); instant(e.when.real);
    for (const k of ['tick', 'worldDay']) if (e.when[k] !== null && !(Number.isSafeInteger(e.when[k]) && e.when[k] >= 0)) fail('invalid world clock');
    if (e.when.time !== null && !/^\d\d:\d\d$/.test(e.when.time ?? '')) fail('invalid world clock');
  }
  if (e.seen !== undefined) {
    if (!e.seen || typeof e.seen !== 'object' || Array.isArray(e.seen) || Object.keys(e.seen).length > 160) fail('invalid seen names');
    for (const [k, name] of Object.entries(e.seen)) {publicId(k); text(name, 200);}
  }
}

function validateEvent(input) {
  // Reject credentials/raw transport fields instead of retaining arbitrary state.
  const fields = {gazetteer: ['places'], 'public.references':['references'], 'place.observed':['place'], conversation:['conversationId','personId'], 'idle.sample':['milliseconds'], scorecard:['clock','period','from','to','metrics'], arrival: ['placeId'], 'act.accepted': ['receiptId', 'act'], meet: ['person', 'placeId'], communication:['person','channel','recipientPlace','conversationId'], speech: ['personId', 'text', 'untrusted', 'channel', 'conversationId', 'placeId'], outcome: ['receiptId', 'act', 'phase', 'summary', 'learned', 'produced', 'met', 'placeId', 'untrusted', 'messageId'], refusal: ['act', 'code'], lesson: ['attempt', 'fix', 'refusalId', 'successId'], cost: ['usd', 'modelCalls'], ledger: ['holding', 'marks'], queue: ['steps']};
  if (!input || !Object.hasOwn(fields, input.type)) fail('unknown public event type');
  keys(input, ['type', 'id', 'at', ...CONTEXT, ...fields[input.type]]);
  id(input.id); instant(input.at); validateContext(input); const e = structuredClone(input);
  switch (e.type) {
    case 'gazetteer':
      list(e.places, 1000).forEach(p => {keys(p, ['id', 'name', 'goodFor','admittedDestination']); id(p.id); text(p.name, 100);if(p.admittedDestination!==undefined&&typeof p.admittedDestination!=='boolean')fail('invalid admission label'); list(p.goodFor, 12).forEach(s => text(s, 160));}); break;
    case 'public.references':list(e.references,1000).forEach(r=>{keys(r,['id','kind','name','source']);publicId(r.id);if(!['world','place','book','object','soul','public'].includes(r.kind))fail('invalid reference kind');text(r.name,200);source(r.source);});break;
    case 'place.observed':keys(e.place,['id','name']);id(e.place.id);text(e.place.name,200);break;
    case 'conversation':id(e.conversationId);id(e.personId);break;
    case 'idle.sample':if(!Number.isFinite(e.milliseconds)||e.milliseconds<0||e.milliseconds>120000)fail('invalid idle sample');break;
    case 'scorecard':if(!['real','world'].includes(e.clock))fail('invalid scorecard clock');text(e.period,100);instant(e.from);instant(e.to);keys(e.metrics,['newPlaces','conversations','people','facts','objects','refusals','idleMinutes','modelCalls','usd']);for(const k of ['newPlaces','conversations','facts','objects','refusals','modelCalls'])count(e.metrics[k]);list(e.metrics.people,100).forEach(id);if(!(e.metrics.idleMinutes>=0)||!(e.metrics.usd===null||e.metrics.usd>=0))fail('invalid scorecard measure');break;
    case 'arrival': id(e.placeId); break;
    case 'act.accepted': id(e.receiptId); text(e.act, 160); break;
    case 'meet':
      keys(e.person, ['id', 'name']); id(e.person.id); text(e.person.name, 100); if(e.placeId!==null)id(e.placeId); break;
    case 'communication':keys(e.person,['id','name']);id(e.person.id);text(e.person.name,100);if(!['private-conversation','public-speech'].includes(e.channel))fail('invalid communication channel');if(e.recipientPlace!==null)id(e.recipientPlace);if(e.channel==='private-conversation'&&e.conversationId===undefined)fail('private communication requires conversation ID');if(e.conversationId!==undefined)id(e.conversationId);break;
    case 'speech': id(e.personId); text(e.text, 1000); if (e.untrusted !== true) fail('speech must be untrusted'); if (e.channel !== undefined && !['private-conversation', 'public-speech'].includes(e.channel)) fail('invalid communication channel'); if (e.conversationId !== undefined) id(e.conversationId); if (e.placeId !== undefined && e.placeId !== null) id(e.placeId); break;
    case 'outcome':
      id(e.receiptId); text(e.act, 160); if (!['completed', 'failed', 'replaced'].includes(e.phase)) fail('terminal phase required'); text(e.summary, 160);
      if (typeof e.untrusted !== 'boolean') fail('outcome trust label required');
      if (e.placeId !== undefined) id(e.placeId);
      if (e.messageId !== undefined) id(e.messageId);
      if(e.learned?.some(f=>f.untrusted)&&!e.untrusted)fail('untrusted facts require outcome label');
      list(e.learned, 5).forEach(f => {keys(f, ['fact', 'about', 'source', 'provenance', 'untrusted']); text(f.fact, 2000); publicId(f.about); source(f.source); text(f.provenance, 100); if (typeof f.untrusted !== 'boolean' || (['soul-text','other-soul-report'].includes(f.provenance) && !f.untrusted)) fail('fact trust label required');});
      list(e.produced, 32).forEach(o => {keys(o, ['id', 'title', 'kind', 'where']); id(o.id); text(o.title, 200); text(o.kind, 1000); if(o.where!==null)id(o.where);});
      list(e.met, 32).forEach(p => {keys(p, ['id', 'name', 'where']); id(p.id); text(p.name, 200); if(p.where!==null)id(p.where);}); break;
    case 'refusal': text(e.act, 160); text(e.code, 100); break;
    case 'lesson': text(e.attempt, 160); text(e.fix, 160); id(e.refusalId); id(e.successId); break;
    case 'cost': if (e.usd !== null && !(Number.isFinite(e.usd) && e.usd >= 0 && e.usd <= 1_000_000)) fail('USD must be known nonnegative or null'); count(e.modelCalls); break;
    case 'ledger': list(e.holding, 100).forEach(id); list(e.marks, 5).forEach(o => {keys(o, ['id', 'title']); id(o.id); text(o.title, 100);}); break;
    case 'queue':
      list(e.steps, 100).forEach(s => {keys(s, ['id', 'act', 'status', 'goal', 'attempts', 'reason']); id(s.id); text(s.act, 160); if (!['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'].includes(s.status)) fail('invalid queue status'); if (s.goal !== undefined) id(s.goal); count(s.attempts); if (s.reason !== undefined) text(s.reason, 300);}); break;
    default: fail('unknown public event type');
  }
  if (e.type === 'outcome') {uniqueIDs(e.met); uniqueIDs(e.produced);}
  if (e.type === 'gazetteer') uniqueIDs(e.places);
  if (e.type === 'queue') uniqueIDs(e.steps);
  if (e.type === 'ledger') {uniqueIDs(e.holding); uniqueIDs(e.marks);}
  if (Buffer.byteLength(JSON.stringify(e)) > MAX_RECORD) fail('record too large');
  return e;
}

function validateRemember(input) {
  keys(input, ['id', 'at', ...CONTEXT, 'person', 'place', 'goal', 'self', 'note', 'horizon', 'metric', 'next']);
  id(input.id); instant(input.at); validateContext(input);
  const selectors = ['person', 'place', 'goal', 'self'].filter(k => input[k] !== undefined);
  if (selectors.length !== 1) fail('exactly one remember selector required');
  const selector = selectors[0];
  keys(input, ['id', 'at', ...CONTEXT, selector, ...(selector === 'self' ? [] : selector === 'goal' ? ['note', 'horizon', 'metric', 'next'] : ['note'])]);
  if (selector === 'self') {list(input.self, 20).forEach(line => {text(line, 200); if (/[\r\n]/.test(line)) fail('self entries must be single lines');});}
  else {id(input[selector]); text(input.note, 300);}
  if (selector !== 'goal' && ['horizon', 'metric', 'next'].some(k => input[k] !== undefined)) fail('goal fields require goal selector');
  if (selector === 'goal') {
    if (!['today', 'week', 'month'].includes(input.horizon)) fail('goal horizon required');
    text(input.metric, 160); text(input.next, 160);
  }
  return structuredClone(input);
}

/** Open only an explicitly supplied local agent folder. Names are fixed or ID hashes.
 * Existing projection symlinks are rejected. JSONL records contain normalized facts
 * and explicit judgments, never raw responses or authentication state.
 */
export function openMemoryFolder(directory, {logs: logFolder = 'log'} = {}) {
  const root = resolve(directory), memory = join(root, 'memory'), logs = join(root, logFolder);
  const safe = path => {
    // Check every existing ancestor, including root, before any read or write.
    let p = path;
    while (true) {
      try {const stat = lstatSync(p); if (stat.isSymbolicLink()) fail('symlink path refused'); if (stat.isFile() && stat.nlink > 1) fail('hard-linked file refused');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      const parent = resolve(p, '..'); if (parent === p) break; p = parent;
    }
    return path;
  };
  safe(root); mkdirSync(root, {recursive: true, mode: 0o700});
  for (const p of [memory, logs, join(memory, 'people'), join(memory, 'journal')]) {safe(p); mkdirSync(p, {recursive: true, mode: 0o700});}
  const log = safe(join(logs, 'memory-events.jsonl'));
  let logBytes = existsSync(log) ? lstatSync(log).size : 0;
  const fresh = () => {safe(log); if ((existsSync(log) ? lstatSync(log).size : 0) !== logBytes) fail('another writer changed the machine log; reopen');};
  const seen = new Map(), places = new Map(), people = new Map(), references = new Map(), knowledge = new Map(), objects = new Map(), goals = new Map(), impressions = new Map(), refusals = new Map(), successes = new Map(), terminals = new Map(), lessons = [];
  const scoreEvents=[],scorecards=[];
  let self = [], queue = [], holding = [], marks = [], recentOutcomes = [];
  const journals = new Map(), costs = new Map();
  const stamp = e => e.world === undefined ? '' : ` (${e.world}${dayOf(e) === null ? '' : `, day ${dayOf(e)}`}${e.when?.time ? ` ${e.when.time}` : ''})`;
  const journal = (at, message) => {const day = at.slice(0, 10); const lines = journals.get(day) ?? []; lines.push(`${at.slice(11, 19)}Z ${message}`); journals.set(day, lines);};
  // A record that names what it saw stands on its own: the name as seen makes the place known, and a later name is a rename.
  const seenAs = (e, value) => e?.seen && Object.hasOwn(e.seen, value) ? e.seen[value] : undefined;
  const knownPlace = (value, e) => places.has(value) || seenAs(e, value) !== undefined || fail('place absent from normalized gazetteer');
  const asSeen = (where, e) => where === null || where === undefined ? null : seenAs(e, where) ?? places.get(where)?.name ?? where;
  const dayOf = e => e.when?.worldDay === undefined || e.when.worldDay === null ? null : e.when.worldDay;
  const notePlace = (value, e) => {
    const name = seenAs(e, value); if (value === null || value === undefined || name === undefined) return;
    const old = places.get(value);
    if (!old) {places.set(value, {id: value, name, goodFor: [], visits: 0, last: null, admittedDestination: false, formerly: []}); return;}
    if (old.name === name) return;
    // An id standing in for a name until a name turned up is not a rename; nor does a name go back to an id.
    const bare = n => n === value || value.endsWith(`:${n}`);
    if (bare(name)) return;
    if (!bare(old.name)) old.formerly = [...(old.formerly ?? []), {name: old.name, day: dayOf(e), at: e.at}].slice(-8);
    old.name = name;
  };
  const meet = (p, at, where, together = false, e = null) => {
    if(where!==null)knownPlace(where, e);
    const row = people.get(p.id) ?? {id: p.id, name: p.name, meetings: [], communications:[], words: [], impressions: []};
    row.name = p.name; row.meetings.push({at, where, together, ...(e?.seen ? {seenAs: asSeen(where, e), world: e.world ?? null, day: dayOf(e)} : {})}); people.set(p.id, row);
  };
  const communicate=(p,at,recipientPlace,channel,legacy=false,e=null)=>{if(recipientPlace!==null)knownPlace(recipientPlace,e);const row=people.get(p.id)??{id:p.id,name:p.name,meetings:[],communications:[],words:[],impressions:[]};row.name=p.name;row.communications.push({at,recipientPlace,channel,legacy,...(e?.seen?{seenAs:asSeen(recipientPlace,e)}:{})});people.set(p.id,row);};
  const communicationLine=c=>`${c.at}: ${c.legacy?'legacy communication-derived encounter; physical attribution unqualified':c.channel}; recipient place (last observed) ${c.seenAs??c.recipientPlace??'unknown'}; other-party location and co-location unknown`;
  // Validate all references/conflicts before logging or mutating state.
  const admit = record => {
    if (record.kind === 'remember') {
      const r = record.value;
      if (r.person && !people.has(r.person)) fail('cannot remember an unmet person');
      if (r.place&&!places.has(r.place)&&references.get(r.place)?.kind!=='place')fail('place absent from public references');
      return;
    }
    const e = record.value;
    if (e.type === 'arrival' || e.type === 'meet'&&e.placeId!==null) knownPlace(e.placeId, e);
    if(e.type==='communication'&&e.recipientPlace!==null)knownPlace(e.recipientPlace, e);
    if (e.type === 'speech' && !people.has(e.personId) && seenAs(e, e.personId) === undefined) fail('speaker has no observed communication or confirmed meeting');
    if (e.type === 'speech' && e.placeId) knownPlace(e.placeId, e);
    if (e.type === 'outcome') {
      if (e.placeId) knownPlace(e.placeId, e);
      for (const p of e.met) if(p.where!==null)knownPlace(p.where, e);
      for (const o of e.produced) if(o.where!==null)knownPlace(o.where, e);
      for (const f of e.learned) {
        if (seenAs(e, f.about) === undefined && !places.has(f.about) && !people.has(f.about) && !e.met.some(p => p.id === f.about)&&!objects.has(f.about)&&!e.produced.some(o=>o.id===f.about)&&!references.has(f.about)) fail('fact about unknown public ID');
        const existing = knowledge.get(f.source);
        if (existing && canonical(existing) !== canonical(f)) fail('conflicting learned source; supply a versioned source');
      }
      const prior = terminals.get(e.receiptId);
      if (prior && terminalValue(prior) !== terminalValue(e)) fail('conflicting terminal receipt');
      const incoming = new Map();
      for (const f of e.learned) {if (incoming.has(f.source) && canonical(incoming.get(f.source)) !== canonical(f)) fail('conflicting learned source within outcome'); incoming.set(f.source, f);}
    }
    if (e.type === 'lesson') {
      const refusal = refusals.get(e.refusalId), success = successes.get(e.successId);
      if (!refusal || !success || refusal.act !== e.attempt || success.act !== e.fix || success.phase !== 'completed' || refusal.at > success.at || success.at > e.at) fail('lesson needs matching refusal and completed fix evidence');
    }
  };
  const terminalValue = e => {const {id: _id, at: _at, ...value} = e; return canonical(value);};
  const apply = record => {
    const e = record.value;
    if (record.kind === 'remember') {
      if (e.self) self = e.self;
      if (e.goal) goals.set(e.goal, {id: e.goal, note: e.note, horizon: e.horizon, metric: e.metric, next: e.next});
      if (e.place) impressions.set(e.place, e.note);
      if (e.person) people.get(e.person).impressions.push(e.note);
      return;
    }
    if (e.seen) for (const where of [e.placeId, e.recipientPlace, ...(e.met ?? []).map(p => p.where), ...(e.produced ?? []).map(o => o.where)]) notePlace(where, e);
    switch (e.type) {
      case 'public.references':for(const r of e.references){const old=references.get(r.id);if(!old||old.kind==='public'||r.kind!=='public')references.set(r.id,r);}break;
      case 'place.observed':if(!places.has(e.place.id))places.set(e.place.id,{...e.place,goodFor:[],visits:0,last:null,admittedDestination:false});else if(e.seen&&places.get(e.place.id).name!==e.place.name)notePlace(e.place.id,{...e,seen:{[e.place.id]:e.place.name}});break;
      case 'gazetteer': for (const p of e.places) {const old = places.get(p.id); places.set(p.id, {...p,admittedDestination:p.admittedDestination===true, visits: old?.visits ?? 0, last: old?.last ?? null});} break;
      case 'arrival': {const p = places.get(e.placeId); scoreEvents.push({at:e.at,newPlaces:p.visits===0?1:0});p.visits++; p.last = e.at; journal(e.at, `Arrived at ${p.name} [${p.id}]${stamp(e)}.`); break;}
      case 'act.accepted': break; // Acceptance is neither arrival nor successful outcome.
      case 'meet':if(/^encounter:[a-f0-9]{64}$/.test(e.id)){communicate(e.person,e.at,e.placeId,'legacy-received-speech',true);journal(e.at,`Legacy communication from ${e.person.name} [${e.person.id}]; recipient place ${e.placeId}; physical co-location unqualified.`);}else{meet(e.person,e.at,e.placeId,false,e);journal(e.at,`Confirmed physical meeting with ${e.person.name} [${e.person.id}] at ${e.seen?asSeen(e.placeId,e):e.placeId}${stamp(e)}.`);}break;
      case 'communication':communicate(e.person,e.at,e.recipientPlace,e.channel);journal(e.at,`Received ${e.channel} from ${e.person.name} [${e.person.id}]; recipient place ${e.recipientPlace??'unknown'}; co-location unknown.`);break;
      case 'conversation':scoreEvents.push({at:e.at,conversationId:e.conversationId,personId:e.personId});break;
      case 'idle.sample':scoreEvents.push({at:e.at,idleMs:e.milliseconds});break;
      case 'scorecard':scorecards.push(e);journal(e.at,`Scorecard ${e.clock} ${e.period}: ${e.metrics.newPlaces} new places, ${e.metrics.conversations} conversations, ${e.metrics.facts} new facts, ${e.metrics.objects} objects, ${e.metrics.refusals} refusals, ${e.metrics.idleMinutes} observed idle minutes, ${e.metrics.modelCalls} model calls, USD ${e.metrics.usd??'unknown'}.`);break;
      case 'speech':
        if (seenAs(e, e.personId) !== undefined) communicate({id: e.personId, name: seenAs(e, e.personId)}, e.at, e.placeId ?? null, e.channel ?? 'public-speech', false, e);
        people.get(e.personId).words.push({at: e.at, text: e.text, ...(e.seen ? {world: e.world ?? null, day: dayOf(e)} : {})}); journal(e.at, `Heard untrusted speech from ${seenAs(e, e.personId) ?? e.personId}${stamp(e)}.`); break;
      case 'outcome':
        scoreEvents.push({at:e.at,facts:e.learned.filter(f=>!knowledge.has(f.source)).length,objects:e.produced.filter(o=>!objects.has(o.id)).length});
        terminals.set(e.receiptId, e);
        recentOutcomes=[...recentOutcomes.filter(row=>row.receiptId!==e.receiptId),e].sort((a,b)=>lexical(a.at,b.at)||lexical(a.receiptId,b.receiptId)).slice(-6);
        for (const f of e.learned) knowledge.set(f.source, f);
        for (const o of e.produced) objects.set(o.id, o);
        for (const p of e.met) meet(p, e.at, p.where, true, e);
        if (e.phase === 'completed') successes.set(e.id, e);
        journal(e.at, `${e.phase}: ${e.summary}${e.untrusted ? ' [untrusted content]' : ''}${stamp(e)}`); break;
      case 'refusal':scoreEvents.push({at:e.at,refusals:1}); refusals.set(e.id, e); journal(e.at, `Refused ${e.act}: ${e.code}.`); break;
      case 'lesson': lessons.push(e); journal(e.at, `Working fix: ${e.attempt} → ${e.fix}.`); break;
      case 'cost': {scoreEvents.push({at:e.at,modelCalls:e.modelCalls,usd:e.usd});const day = e.at.slice(0, 10), c = costs.get(day) ?? {knownUSD: 0, unknown: 0, calls: 0}; if (e.usd === null) c.unknown++; else c.knownUSD += e.usd; c.calls += e.modelCalls; costs.set(day, c); break;}
      case 'ledger': holding = e.holding; marks = e.marks; break;
      case 'queue': queue = e.steps; break;
    }
  };
  const writtenHashes=new Map(),hashText=value=>createHash('sha256').update(value).digest('hex');
  const write = (path, value) => {
    safe(path);const existing=existsSync(path)?readFileSync(path,'utf8'):null,nextHash=hashText(value),actualHash=existing===null?null:hashText(existing);
    if(actualHash===nextHash){writtenHashes.set(path,nextHash);return;}
    if(writtenHashes.has(path)&&actualHash!==writtenHashes.get(path))fail('projection changed outside remember; preserve and review');
    const temporary = safe(`${path}.tmp`); writeFileSync(temporary, value, {mode: 0o600}); renameSync(temporary, path);writtenHashes.set(path,nextHash);
  };
  const budgetLine = day => {const c = costs.get(day); return c ? `${day}: known USD ${c.knownUSD.toFixed(6)}; unknown USD records ${c.unknown}; calls ${c.calls}${c.unknown ? '; total USD unknown' : ''}` : `${day}: USD unknown; no cost observations`;};
  const knowledgeLine = f => `- ${md(f.fact)} — about ${md(f.about)}; source ${md(f.source)}; provenance ${md(f.provenance)}${f.untrusted ? '; UNTRUSTED reported content' : ''}`;
  const placeLine = p => `- ${md(p.id)} | ${md(p.name)} | ${p.goodFor.map(md).join(', ')} | ${p.admittedDestination?'boot destination':'observed location; no walking admission'} | visits ${p.visits} | last ${p.last ?? 'never'}${p.formerly?.length ? ` | formerly ${p.formerly.map(f => `${md(f.name)}${f.day === null ? ` until ${f.at}` : ` until day ${f.day}`}`).join(', ')}` : ''}${impressions.has(p.id) ? `\n  Judgment: ${md(impressions.get(p.id))}` : ''}`;
  const goalLines = g => [`- ${md(g.id)} (${g.horizon}): ${md(g.note)}`, `  Metric: ${md(g.metric)}; next: ${md(g.next)}`];
  const lessonLine = l => `- ${md(l.attempt)} ✗ (${md(refusals.get(l.refusalId).code)}) → ${md(l.fix)} ✓; evidence ${md(l.refusalId)}, ${md(l.successId)}`;
  const scoreLine=s=>`${s.clock} ${s.period}: places ${s.metrics.newPlaces}, conversations ${s.metrics.conversations} (${s.metrics.people.join(', ')}), facts ${s.metrics.facts}, objects ${s.metrics.objects}, refusals ${s.metrics.refusals}, observed idle minutes ${s.metrics.idleMinutes}, model calls ${s.metrics.modelCalls}, USD ${s.metrics.usd??'unknown'}`;
  const render = () => {
    write(join(memory, 'self.md'), self.map(md).join('\n') + '\n');
    write(join(memory, 'goals.md'), '# Goals — model judgments\n\n' + sorted(goals).flatMap(goalLines).join('\n') + '\n');
    const schedule=join(memory,'schedule.md');safe(schedule);if(!existsSync(schedule))write(schedule,'# Schedule\n\nNo entries yet. Edit this owner schedule to add world routines and explicitly dated real commitments.\n');
    write(join(memory, 'places.md'), '# Places — normalized public facts\n\n' + sorted(places).map(placeLine).join('\n') + '\n');
    write(join(memory,'scorecards.md'),'# Received/observed interval scorecards — both clocks\n\n'+scorecards.map(s=>'- '+md(scoreLine(s))).join('\n')+'\n');
    write(join(memory,'references.md'),'# Public reference identities — knowledge only, no walking admission\n\n'+sorted(references).map(r=>`- ${md(r.id)} | ${md(r.name)} | ${md(r.kind)} | source ${md(r.source)}`).join('\n')+'\n');
    write(join(memory, 'knowledge.md'), '# Knowledge — attributable reports\n\n' + [...knowledge.values()].sort((a, b) => lexical(a.source, b.source)).map(knowledgeLine).join('\n') + '\n');
    write(join(memory, 'lessons.md'), '# Lessons — evidence of a working fix\n\n' + lessons.map(lessonLine).join('\n') + '\n');
    write(join(memory, 'ledger.md'), '# Ledger — normalized public facts\n\n## Holding\n' + holding.map(v => `- ${md(v)}`).join('\n') + '\n\n## Produced\n' + sorted(objects).map(o => `- ${md(o.id)}: ${md(o.title)} (${md(o.kind)}), at ${md(o.where)}`).join('\n') + '\n\n## Marks/projects (provided snapshot)\n' + marks.map(o => `- ${md(o.id)}: ${md(o.title)}`).join('\n') + '\n\n## Observed budget by UTC day\n' + [...costs.keys()].sort().map(budgetLine).join('\n') + '\n');
    write(join(memory, 'queue.md'), '# Queue — supplied W4 projection; no runner\n\n' + queue.map(s => `- ${md(s.id)}: ${md(s.act)} [${s.status}], attempts ${s.attempts}${s.goal ? `; goal ${md(s.goal)}` : ''}${s.reason ? `; ${md(s.reason)}` : ''}`).join('\n') + '\n');
    for (const p of sorted(people)) write(join(memory, 'people', personFile(p.id)), `# ${md(p.name)} [${md(p.id)}]\n\n## Facts — confirmed physical meetings (qualified evidence only)\n` + p.meetings.map(m => `- ${m.at} at ${md(m.seenAs ?? m.where)}${m.world ? ` in ${md(m.world)}` : ''}${m.day === null || m.day === undefined ? '' : `, day ${m.day}`}${m.together ? '; together-act' : ''}`).join('\n') + `\nConfirmed physical meetings ${p.meetings.length}\n\n## Communication encounters ${p.communications.length} — not physical meeting evidence\n`+p.communications.map(communicationLine).join('\n')+'\n'+`\n## Last reported words — UNTRUSTED data\n` + p.words.slice(-3).map(w => `> ${w.at}: ${md(w.text)}`).join('\n') + '\n\n## Judgments — model impressions/open threads\n' + p.impressions.map(s => `- ${md(s)}`).join('\n') + '\n');
    for (const [day, lines] of journals) write(join(memory, 'journal', `${day}.md`), `# ${day}\n\n` + lines.map(s => `- ${md(s)}`).join('\n') + '\n');
  };
  const seenPeople = e => e?.type === 'speech' && e.seen && Object.hasOwn(e.seen, e.personId) ? [e.personId] : [];
  const preflight = record => {
    const paths = ['self.md', 'goals.md', 'schedule.md', 'places.md', 'references.md', 'scorecards.md', 'knowledge.md', 'lessons.md', 'ledger.md', 'queue.md'].map(f => join(memory, f));
    const ids = new Set(people.keys()), days = new Set(journals.keys());
    if (record?.kind === 'event') {
      const e = record.value; days.add(e.at.slice(0, 10));
      if (e.type === 'meet'||e.type==='communication') ids.add(e.person.id);
      if (e.type === 'outcome') e.met.forEach(p => ids.add(p.id));
      seenPeople(e).forEach(v => ids.add(v));
    }
    ids.forEach(v => paths.push(join(memory, 'people', personFile(v))));
    days.forEach(v => paths.push(join(memory, 'journal', `${v}.md`)));
    paths.forEach(p => {safe(p); safe(`${p}.tmp`);if(!p.endsWith('/schedule.md')&&writtenHashes.has(p)){const actual=existsSync(p)?hashText(readFileSync(p,'utf8')):null;if(actual!==writtenHashes.get(p))fail('projection changed outside remember; preserve and review');}});
  };
  const append = record => {
    fresh();
    const key = record.value.id, encoded = canonical(record), existing = seen.get(key);
    if (existing) {if (existing !== encoded) fail('event ID reused with different content'); return {applied: false};}
    admit(record);
    if (record.kind === 'event' && record.value.type === 'outcome' && terminals.has(record.value.receiptId)) return {applied: false};
    preflight(record);
    appendFileSync(safe(log), encoded + '\n', {mode: 0o600});
    logBytes += Buffer.byteLength(encoded + '\n');
    seen.set(key, encoded); apply(record); render(); return {applied: true};
  };
  if (existsSync(log)) {
    const raw = readFileSync(safe(log), 'utf8');
    // A torn last record must be reviewed, never silently discarded or repaired.
    if (raw && !raw.endsWith('\n')) fail('incomplete machine log; preserve for review');
    for (const line of raw.split('\n').filter(Boolean)) {
      if (Buffer.byteLength(line) > MAX_RECORD + 100) fail('machine log record too large');
      const r = JSON.parse(line); keys(r, ['version', 'kind', 'value']); if (r.version !== VERSION || !['event', 'remember'].includes(r.kind)) fail('unsupported machine log');
      const normalized = r.kind === 'event' ? validateEvent(r.value) : validateRemember(r.value);
      const record = {version: VERSION, kind: r.kind, value: normalized}, encoded = canonical(record);
      if (seen.has(normalized.id)) {if (seen.get(normalized.id) !== encoded) fail('conflicting machine log ID'); continue;}
      admit(record); seen.set(normalized.id, encoded); apply(record);
    }
  }
  preflight(); render();
  const recentReceiptEvidence=()=>recentOutcomes.map(e=>({receiptId:e.receiptId,at:e.at,act:e.act,phase:e.phase,summary:e.summary,placeId:e.placeId??null,untrusted:e.untrusted,confirmedEncounters:e.met.map(p=>({id:p.id,name:p.name,where:p.where})),producedIds:e.produced.map(p=>p.id),learnedSources:e.learned.map(f=>({source:f.source,provenance:f.provenance,untrusted:f.untrusted}))}));
  const readingRecallEvidence=()=>{
    const lines=['## Requested reading recall — canonical completed own receipts, max2 / 2400 bytes'];
    const reading=[...terminals.values()].filter(e=>e.phase==='completed'&&/^read(?::|\s|$)/i.test(e.act)).sort((a,b)=>lexical(b.at,a.at)||lexical(b.receiptId,a.receiptId));
    let used=Buffer.byteLength(lines[0]),kept=0;
    for(const e of reading){
      if(kept===2)break;
      const line=JSON.stringify({receiptId:e.receiptId,at:e.at,capability:e.act,phase:e.phase,summary:e.summary,placeId:e.placeId??null,untrusted:e.untrusted,learnedSources:e.learned.slice(0,2).map(f=>({source:f.source,provenance:f.provenance,untrusted:f.untrusted,factExcerpt:f.fact.length>300?f.fact.slice(0,299)+'…':f.fact}))});
      if(used+Buffer.byteLength(line)+1>2400)continue;
      lines.push(line);used+=Buffer.byteLength(line)+1;kept++;
    }
    if(!kept)lines.push('No completed reading receipt fits this compact view. This is not proof no reading exists.');
    return lines;
  };

  return {
    /** What a memory on the shipping line looks things up by: known ids and the names they went by. */
    placeName(placeId){return places.get(placeId)?.name??null;},
    /** The little the brief needs, looked up rather than scanned: its size never follows the log's. */
    digest({place,near=[]}){
      fresh();
      const p=place?places.get(place):null;
      return {
        place:p?{name:p.name,visits:p.visits,note:impressions.get(p.id)??null}:null,
        people:near.flatMap(personId=>{const row=people.get(personId);if(!row)return [];const m=row.meetings.at(-1);return [{id:row.id,name:row.name,met:row.meetings.length,last:m?{world:m.world??null,worldDay:m.day??null,place:m.seenAs??null}:null,note:row.impressions.at(-1)??null}];}),
        goals:sorted(goals).sort((a,b)=>['today','week','month'].indexOf(a.horizon)-['today','week','month'].indexOf(b.horizon)).slice(0,4).map(g=>({note:g.note,next:g.next})),
        recent:recentOutcomes.slice(-2).map(e=>({summary:e.summary,untrusted:e.untrusted})),
        self:self.slice(0,8),
      };
    },
    known(){fresh();return {people:sorted(people).map(p=>({id:p.id,name:p.name,met:p.meetings.length})),places:sorted(places).map(p=>({id:p.id,name:p.name,formerly:(p.formerly??[]).map(f=>f.name)})),self:[...self]};},
    eventValue(eventId){fresh();id(eventId);const value=seen.get(eventId);if(!value)return null;const record=JSON.parse(value);return record.kind==='event'?structuredClone(record.value):null;},
    fold: input => append({version: VERSION, kind: 'event', value: validateEvent(input)}),
    scorecard({id:cardId,at,clock,period,from,to}){instant(from);instant(to);const events=scoreEvents.filter(e=>e.at>=from&&e.at<to),sum=k=>events.reduce((n,e)=>n+(e[k]??0),0),cost=events.filter(e=>e.modelCalls!==undefined),metrics={newPlaces:sum('newPlaces'),conversations:new Set(events.filter(e=>e.conversationId).map(e=>e.conversationId)).size,people:[...new Set(events.filter(e=>e.personId).map(e=>e.personId))].slice(0,100),facts:sum('facts'),objects:sum('objects'),refusals:sum('refusals'),idleMinutes:Math.round(sum('idleMs')/600)/100,modelCalls:sum('modelCalls'),usd:!cost.length||cost.some(e=>e.usd===null)?null:cost.reduce((n,e)=>n+e.usd,0)};append({version:VERSION,kind:'event',value:validateEvent({type:'scorecard',id:cardId,at,clock,period,from,to,metrics})});return metrics;},
    remember: input => append({version: VERSION, kind: 'remember', value: validateRemember(input)}),
    factualOutcomes() {
      fresh();
      return recentReceiptEvidence();
    },
    retrieve(input) {
      fresh();
      keys(input, ['day', 'place', 'people', 'attempt','recall','readingRecall']);
      if (!/^\d{4}-\d\d-\d\d$/.test(input.day ?? '') || new Date(`${input.day}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.day) fail('retrieval day required');
      const near = list(input.people ?? [], 8); near.forEach(id);
      if (input.place !== undefined) {id(input.place); knownPlace(input.place);}
      if(input.recall!==undefined&&typeof input.recall!=='boolean')fail('invalid recall selector');
      if(input.readingRecall!==undefined&&typeof input.readingRecall!=='boolean')fail('invalid reading recall selector');
      if (input.attempt !== undefined) text(input.attempt, 160);
      const p = input.place ? places.get(input.place) : null;
      return [
        ...(input.readingRecall?readingRecallEvidence():[]),
        '## Receipt evidence — recent own terminal outcomes, max 6',
        ...recentReceiptEvidence().map(e=>JSON.stringify(e)),
        'These receipts verify your own recorded actions only. A confirmed encounter is not proof of a shared journey or another Soul completing a read. Conversation membership, invitations, speech, and scorecard counts do not establish peer physical completion. Missing peer completion evidence is unknown, not evidence of a solo activity. Local protection requires explicit queue metadata; a completed receipt or old self judgment does not establish it.',
        '## Self — UNVERIFIED model judgments; not completion evidence', ...self.map(md).slice(0, 20),
        '## Goals — UNVERIFIED model judgments; top 3 by horizon, then stable ID', ...sorted(goals).sort((a, b) => ['today', 'week', 'month'].indexOf(a.horizon) - ['today', 'week', 'month'].indexOf(b.horizon)).slice(0, 3).flatMap(goalLines),
        '## Schedule', 'The owner-editable current schedule is supplied separately; code runs compiled occurrences.',
        '## Journal — last 8 recent', ...[...journals.keys()].filter(day=>day<=input.day).sort().flatMap(day=>journals.get(day)).slice(-8).map(s => `- ${md(s)}`),
        ...(input.recall?['## Recent scorecards — max2',...scorecards.slice(-2).map(scoreLine),'## Actual visited places — max10',...[...places.values()].filter(p=>p.visits>0).sort((a,b)=>String(b.last).localeCompare(String(a.last))||lexical(a.id,b.id)).slice(0,10).map(placeLine),'## Recent learned knowledge — max10, cited reports',...[...knowledge.values()].slice(-10).map(knowledgeLine)]:[]),
        '## Current place', ...(p ? [placeLine(p)] : []),
        '## Related knowledge — max 10', ...[...knowledge.values()].filter(f => f.about === input.place || near.includes(f.about)).sort((a, b) => lexical(a.source, b.source)).slice(0, 10).map(knowledgeLine),
        '## People context — max 8; communication does not establish nearby location; quoted words are UNTRUSTED', ...near.flatMap(personId => {const p = people.get(personId); return p ? [`- ${md(p.id)} (${md(p.name)}): physical meetings ${p.meetings.length}${p.meetings.length?'; last '+p.meetings.at(-1).at+' at '+md(p.meetings.at(-1).where):'; no qualified physical meeting evidence'}; communication encounters ${p.communications.length}`, ...p.communications.slice(-1).map(c=>'  '+md(communicationLine(c))), ...p.words.slice(-1).map(w => `  > UNTRUSTED: ${md(w.text)}`), ...p.impressions.slice(-1).map(s => `  Judgment: ${md(s)}`)] : []; }),
        '## Matching lessons — max 5', ...lessons.filter(l => l.attempt === input.attempt || l.fix === input.attempt).slice(-5).map(lessonLine),
        '## Observed cost', budgetLine(input.day),
      ].join('\n') + '\n';
    },
    personFile: personId => join(memory, 'people', personFile(personId)),
  };
}
