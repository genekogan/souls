// MCP (Streamable HTTP, stateless): the same soul tools as the REST agent API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { GOALS, intentRequestV2Schema,intentHistoryQueryV1Schema } from '@souls/protocol';
import type { SoulRow } from './db.ts';
import { ApiError, type Souls } from './souls.ts';
import { checkAcceptanceGuard,type AcceptanceGuard } from './world.ts';
import { intentTransportError,intentLookupError,intentHistoryReadError,type IntentControlV2 } from './intent-control.ts';
import type { IntentRequestScope } from './intent-requests.ts';

const text = (v: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }], isError });

// SDK1.31 advertises a union root as an empty object. Give discovery the actual
// object fields derived from the authoritative union, then delegate conditional
// validation to that same contract before the SDK and inside the shared service.
// This object is an adapter for discovery, never a second request grammar.
const upsert=intentRequestV2Schema.options[0].shape;
const intentToolInput=z.strictObject({contract:upsert.contract,requestId:upsert.requestId,op:z.enum(['upsert','withdraw']),
  words:upsert.words.optional(),strict:upsert.strict.removeDefault().optional(),importance:upsert.importance.removeDefault().optional(),edit:upsert.edit});
const intentLookupInput=z.strictObject({requestId:upsert.requestId});

export type EdgeMcpCall=(method:'GET'|'POST',path:string,token:string,body?:unknown)=>Promise<unknown>;
function serverFor(souls: Souls, soul: SoulRow,guard?:AcceptanceGuard,candidate?:{service:IntentControlV2;scope:IntentRequestScope},edge?:{call:EdgeMcpCall;token:string}) {
  const s = new McpServer({ name: 'sim', version: '0.1.0' });
  if(edge){
    // EDGE-CONTRACT-v1 verbs over MCP: thin wrappers over the same /v1/edge routes (same token, same bodies).
    const e=(method:'GET'|'POST',path:string,body?:unknown)=>edge.call(method,path,edge.token,body).then(r=>text(r));
    const q=(o:Record<string,unknown>)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries(o))if(v!==undefined)p.set(k,String(v));const t=p.toString();return t?'?'+t:'';};
    s.registerTool('eden_observe',{description:`Tier 1 view for your Soul (${soul.name}): place path, state, open receipts, who/what is here, stream cursor. include: capabilities,map.`,inputSchema:{include:z.string().max(100).optional()},annotations:{readOnlyHint:true}},async({include})=>e('GET','/v1/edge/observe'+q({include})));
    s.registerTool('eden_capabilities',{description:'Everything legal for your Soul right now (ids to pass to eden_act), with blocked entries and why.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>e('GET','/v1/edge/capabilities'));
    s.registerTool('eden_act',{description:'Do one thing now: a capability id or plain words ({capability}), or an intent the world resolves ({verb:"sit",target:{nearest:"seat",near:"<soul>"}} · {verb:"sit",target:{in:"<room>",row:"front"}} · {verb:"go",target:{place}} · {verb:"swim",target:{place,seconds}} · {verb:"approach",target,distance} · {verb:"turn",heading|face|target} · {verb:"look",target}). Returns accepted+receipt (+chosen) or a refusal code. A body act replaces your current one; look/turn/face (attention) never do.',inputSchema:{capability:z.string().min(1).max(200).optional(),verb:z.string().min(1).max(40).optional(),target:z.union([z.string().max(200),z.record(z.string(),z.unknown())]).optional(),distance:z.number().optional(),heading:z.number().optional(),face:z.string().max(100).optional(),params:z.record(z.string(),z.unknown()).optional(),clientRef:z.string().max(100).optional()}},async(a)=>e('POST','/v1/edge/act',a));
    s.registerTool('eden_here',{description:'A compact first-person frame of what your Soul perceives right now (clock, light, weather; where you are and how; Souls, things, conversations and exits in sight, with bearings relative to your heading). Describe surroundings only from this.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>e('GET','/v1/edge/here'));
    s.registerTool('eden_explore',{description:'Look around (knowledge/1): more of what is near than eden_here — places close by with what they are and whether your Soul has been there, people and things a little farther off — and finds secret places close enough to notice. Use when exploring; eden_here stays short.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>e('GET','/v1/edge/around'));
    s.registerTool('eden_resolve',{description:'Dry run of eden_act (same body): what the world would choose (seat, place, path, ETA) or why not. No side effects.',inputSchema:{capability:z.string().min(1).max(200).optional(),verb:z.string().min(1).max(40).optional(),target:z.union([z.string().max(200),z.record(z.string(),z.unknown())]).optional(),distance:z.number().optional(),heading:z.number().optional(),face:z.string().max(100).optional(),params:z.record(z.string(),z.unknown()).optional()},annotations:{readOnlyHint:true}},async(a)=>e('POST','/v1/edge/resolve',a));
    s.registerTool('eden_receipt',{description:'One receipt: waiting/started/completed/failed/replaced.',inputSchema:{id:z.string().min(1).max(100)},annotations:{readOnlyHint:true}},async({id})=>e('GET','/v1/edge/receipts/'+encodeURIComponent(id)));
    s.registerTool('eden_wait',{description:'Long-poll your event stream (receipts, arrivals, speech you can hear, conversation turns, objects, world). Pass the last cursor.',inputSchema:{after:z.string().max(100).optional(),timeout:z.number().int().min(1).max(55).optional()},annotations:{readOnlyHint:true}},async(a)=>e('GET','/v1/edge/wait'+q(a)));
    s.registerTool('eden_say',{description:'Speak aloud: everyone in your enclosure, or within earshot outdoors, hears it. Untrusted text to them.',inputSchema:{text:z.string().min(1).max(500)}},async(a)=>e('POST','/v1/edge/say',a));
    s.registerTool('eden_converse',{description:'Private conversation: {op:start,with:[soulId],text?} | {op:accept|decline,conversation} | {op:say,conversation,text} | {op:leave|ask,conversation}.',inputSchema:{op:z.enum(['start','accept','decline','say','leave','ask']),with:z.array(z.string()).max(8).optional(),conversation:z.string().max(100).optional(),soul:z.string().max(100).optional(),text:z.string().max(500).optional()}},async(a)=>e('POST','/v1/edge/converse',a));
    s.registerTool('eden_object',{description:'Read an object (no action) or act on it ({action, params}). Object actions also appear in capabilities as object:<id>:<action>.',inputSchema:{id:z.string().min(1).max(100),action:z.string().max(100).optional(),params:z.record(z.string(),z.unknown()).optional(),clientRef:z.string().max(100).optional()}},async({id,...rest})=>rest.action?e('POST','/v1/edge/objects/'+encodeURIComponent(id)+'/act',rest):e('GET','/v1/edge/objects/'+encodeURIComponent(id)));
    s.registerTool('eden_digest',{description:'The latest public digest written by the world steward.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>e('GET','/v1/edge/digest'));
    s.registerTool('eden_map',{description:'Every place: names, kinds, enclosed, capacity, schedule; and the named flags (name, walk, position). Never occupants.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>e('GET','/v1/edge/map'));
  }
  const reply=async(run:()=>unknown)=>{
    try{
      if(guard)checkAcceptanceGuard(guard);
      const result=await run();if(guard)checkAcceptanceGuard(guard);return text(result);
    }catch(error){if(error instanceof ApiError)return text({ok:false,code:error.code,message:error.message,...error.extra},true);throw error;}
  };
  s.registerTool('world_query', { description: 'The world: regions, places, every Soul and what it is doing. Free and instant.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.worldSummary()));
  s.registerTool('soul_perceive', { description: `What your Soul (${soul.name}) perceives right now: surroundings, energy, mood, nearby souls and places, and what it could do. Start here.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(async()=>{
    const perception=await souls.perceive(soul);
    return candidate?.service.historyEnabled?{...perception,intentHistory:candidate.service.historyCapability(candidate.scope)}:perception;
  }));
  s.registerTool('soul_wait', { description: 'Block until something happens to your Soul (an activity ends, a new one starts, an intent lands) or the timeout passes. Use instead of polling.', inputSchema: { seconds: z.number().int().min(1).max(55).optional() }, annotations: { readOnlyHint: true } }, async ({ seconds }) => reply(()=>souls.wait(soul,seconds??30)));
  s.registerTool('soul_command', { description: 'Say what you want your Soul to do in plain words. The world compiles the wish into a plan of cards, minting any card it needs, and returns the plan it understood. The simplest way to steer.', inputSchema: { text: z.string().min(1).max(280) } }, async ({ text: t }) => reply(()=>souls.command(soul,t,'mcp',guard)));
  s.registerTool('soul_mandate',{description:'Read your Soul’s private owner rules, understanding, triggers and done/blocked reports.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>reply(()=>({rules:souls.rules(soul)})));
  s.registerTool('soul_steer',{description:'Add or edit one owner mandate rule. One alignment explains its effect. Triggers wake thought; only an explicit NOW instruction runs directly.',inputSchema:{words:z.string().min(1).max(2000),strict:z.boolean().optional(),id:z.string().optional()}},async input=>reply(()=>souls.steer(soul,input,'mcp',guard)));
  s.registerTool('soul_remove_rule',{description:'Remove an owner rule. The Soul continues its day with its character, needs and journal.',inputSchema:{id:z.string()}},async({id})=>reply(()=>souls.removeRule(soul,id,guard)));
  s.registerTool('soul_deck', { description: 'The cards your Soul holds, which can be played now and on what, its manners, and its agenda. Read /cards.md for how cards work.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.deck(soul)));
  s.registerTool('soul_propose_cards', { description: 'Propose new cards for your Soul’s deck (see /cards.md for the format). Each is validated; valid ones are minted and dealt to your Soul.', inputSchema: { cards: z.array(z.any()).min(1).max(4), links: z.record(z.string(), z.object({ summary: z.string(), control: z.boolean().optional() })).optional().describe('new link kinds the cards use'), kinds: z.record(z.string(), z.object({ summary: z.string() })).optional().describe('new kinds of thing the cards make') } }, async (input) => reply(()=>souls.proposeCards(soul,input,guard)));
  s.registerTool('soul_status', { description: `Status of your Soul (${soul.name}): position, activity, mood, intent, what is nearby, and what it could do now.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.status(soul)));
  s.registerTool('soul_log', { description: 'Recent history of your Soul.', inputSchema: { limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } }, async ({ limit }) => reply(()=>souls.soulLog(soul,limit??30)));
  s.registerTool('soul_set_intent', {
    description: 'Set the standing intent of your Soul. Returns once the world has accepted it at the next tick. The Soul pursues it on its own until you replace it.',
    inputSchema: {
      goal: z.enum(GOALS).optional().describe('a simple goal; or give an agenda instead'),
      target: z.string().max(80).nullable().optional().describe('thing id or name from world_query / soul_perceive'),
      agenda: z.array(z.object({ card: z.string(), target: z.string().nullable().optional(), of: z.string().nullable().optional() })).max(8).optional().describe('ordered cards to favour (from soul_deck), each optionally on a `target`, or `of` someone for a thing that may not exist yet: {card:"join", of:"Rob"} means whatever gathering is Rob’s'),
      note: z.string().max(160).optional().describe('colour for the Soul’s mind; context, not a command'),
    },
  }, async (input) => reply(async()=>{const r=await souls.setIntent(soul,input,'mcp',guard);return {ok:true,accepted_at_tick:r.event.tick,intent:r.intent,text:r.text,status:souls.status(soul)};}));
  if(candidate) {
    const {service,scope}=candidate;
    const intentReply=async(run:()=>unknown,lookup=false)=>{
      try {if(guard)checkAcceptanceGuard(guard);const result=await run();if(guard)checkAcceptanceGuard(guard);return text(result);}
      catch(error){const safe=lookup?intentLookupError(error):intentTransportError(error);return text({ok:false,code:safe.code,message:safe.message,...safe.extra},true);}
    };
    s.registerTool('soul_intent_v2',{
      description:'soul-intent/2: submit one retained direction with a durable requestId, or edit/withdraw an exact purpose version. Upsert requires words; withdrawal requires edit and forbids words/strict/importance. Returns a received, understood, refused or withdrawn receipt. Understanding is not physical completion. Retry only this same request identity; no legacy fallback.',
      inputSchema:intentToolInput,annotations:{readOnlyHint:false,idempotentHint:true,destructiveHint:false},
    },async input=>intentReply(()=>service.submit(scope,input)));
    s.registerTool('soul_intent_request_v2',{
      description:'Read the receipt for this scoped credential generation and requestId. Received may still be awaiting interpretation; no repeated mutation or completion is inferred. Unknown/inaccessible requests are not-found.',
      inputSchema:intentLookupInput,annotations:{readOnlyHint:true,idempotentHint:true},
    },async({requestId})=>intentReply(()=>service.lookup(scope,requestId),true));
    if(service.historyEnabled)s.registerTool('soul_intent_history_v1',{
      description:'Read private accepted intention revisions and actual admitted/controller outcomes through a fixed canonical frontier. Follow nextCursor; resumeCursor opens a new frontier after a complete page. A completed attempt does not fulfill its purpose. Missing source returns an explicit gap; opaque scoped cursors expire after30minutes or eviction. No interpretation or mutation fallback.',
      inputSchema:intentHistoryQueryV1Schema,annotations:{readOnlyHint:true,idempotentHint:true},
    },async input=>{
      try{if(guard)checkAcceptanceGuard(guard);const page=service.historyPage(scope,input);if(guard)checkAcceptanceGuard(guard);return text(page);}
      catch(error){const safe=intentHistoryReadError(error);return text({ok:false,code:safe.code,message:safe.message},true);}
    });
  }
  return s;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, souls: Souls,intentV2?:IntentControlV2,edgeCall?:EdgeMcpCall) {
  if(intentV2&&(intentV2.souls!==souls||intentV2.host!==souls.host))throw new Error('MCP intent candidate must belong to selected Souls host');
  if(souls.lifecycle||intentV2)res.setHeader('Cache-Control','no-store');
  // bearer header, or /mcp/<token> for connector apps that only accept a URL
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.url?.match(/^\/mcp\/(sim_[A-Za-z0-9_-]+)/)?.[1];
  const soul = souls.soulFromToken(token);
  if (!soul) { res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'missing or invalid soul token' }, id: null })); return; }
  let candidate:{service:IntentControlV2;scope:IntentRequestScope}|undefined;
  if(intentV2) {
    try {candidate={service:intentV2,scope:intentV2.agentScope(token,'mcp')};}
    catch {res.writeHead(401,{'content-type':'application/json','www-authenticate':'Bearer'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'missing or invalid soul token'},id:null}));return;}
  }
  const legacyGuard=souls.agentControlGuard(soul,token);
  const guard:AcceptanceGuard|undefined=candidate?()=>{if(legacyGuard)checkAcceptanceGuard(legacyGuard);return candidate!.service.guard(candidate!.scope);}:legacyGuard;
  if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed (stateless server: POST only)' }, id: null })); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) { res.writeHead(413).end(); return; } chunks.push(c as Buffer); }
  // Credential authority can disappear while the transport reads a slow body.
  // Recheck before parsing/registering tools, then retain it through each tool.
  try{if(guard)checkAcceptanceGuard(guard);}catch(error){
    if(!(error instanceof ApiError)&&!candidate)throw error;
    res.writeHead(401,{'content-type':'application/json','www-authenticate':'Bearer'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'missing or invalid soul token'},id:null}));return;
  }
  let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
  if(candidate&&body&&typeof body==='object'&&!Array.isArray(body)) {
    const rpc=body as {method?:unknown;id?:unknown;params?:{name?:unknown;arguments?:unknown}};
    if(rpc.method==='tools/call'&&typeof rpc.params?.name==='string'&&['soul_intent_v2','soul_intent_request_v2',...(candidate.service.historyEnabled?['soul_intent_history_v1']:[])].includes(rpc.params.name)) {
      const schema=rpc.params!.name==='soul_intent_v2'?intentRequestV2Schema:rpc.params!.name==='soul_intent_history_v1'?intentHistoryQueryV1Schema:intentLookupInput;
      if(!schema.safeParse(rpc.params?.arguments).success) {
        // SDK validation diagnostics can echo arbitrary unknown property names.
        // Keep malformed private arguments/credential-shaped keys out of errors.
        res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:rpc.id??null,
          result:text({ok:false,code:'invalid',message:'invalid soul-intent/2 tool arguments'},true)}));return;
      }
    }
  }
  const server = serverFor(souls, soul,guard,candidate,edgeCall&&token?{call:edgeCall,token}:undefined);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
