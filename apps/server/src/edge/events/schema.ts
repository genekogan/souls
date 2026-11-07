// GET /v1/edge/schema (public): the machine-readable surface — verbs, targets, params, plan grammar, event kinds and
// limits — so the served skill can stay short. Other lanes add their parts with `addSchemaPart` (e.g. Core-A: here,
// resolve, intents) at module load; the response merges them under their names.
import type {Hono} from 'hono';
import {EDGE_CONTRACT, edgeBody} from '../contract.ts';
import {EVENT_KINDS} from './envelope.ts';
import {HEARTBEAT_MS, MAX_STREAMS_PER_SOUL} from './index.ts';
import {PLAN_MAX_STEPS, ON_REFUSAL} from '../plans/plans.ts';
import {IDEMPOTENCY_TTL_MS} from './idempotency.ts';
import {HOLD_MAX_MS, GONE_MS, RED_MS, YELLOW_MS, beamEnabled} from '../comms/fading.ts';
import {BODY_KNOBS} from '../ledger/body-rule.ts';

const parts = new Map<string, unknown>();
/** Register (or replace) a named part of the schema. */
export function addSchemaPart(name: string, part: unknown) { parts.set(name, part); }

const seconds = (min: number, max: number, dflt?: number) => ({type: 'integer', min, max, ...(dflt !== undefined ? {default: dflt} : {})});
export const SCHEMA_VERSION = 'eden-edge-schema/1';

export const EDGE_ACT_VERBS = ['walk', 'stroll', 'go-near', 'hang-out', 'wander', 'sit', 'sit-ground', 'lie', 'nap', 'read', 'rest', 'stand', 'swim', 'eat', 'drink', 'warm-by-fire', 'gather', 'wave', 'face',
        'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps', 'bow', 'clap', 'nod', 'shake-head', 'cheer', 'point',
        'hug', 'high-five', 'handshake', 'dance-with', 'follow', 'ask-to-stop', 'give', 'pick-up', 'put-down', 'accept', 'decline', 'make', 'object',
        'play-piano', 'paint', 'play-music', 'write', 'cook', 'play-game', 'craft', 'post-letter',
 'use-computer','listen','sing','lift-weights','bench-press','pull-ups','dips','play-frisbee','play-petanque','play-volleyball'] as const;

export function edgeSchema() {
  return {
    schema: SCHEMA_VERSION, contract: EDGE_CONTRACT,apiContract:'eden-edge/1.1',
    auth: {header: 'Authorization: Bearer <soul token>', pairing: 'POST /v1/agent/pair/start → owner approves → POST /v1/agent/pair/poll', public: ['GET /v1/edge/schema', 'GET /v1/edge/map', 'GET /v1/edge/rides', 'GET /v1/edge/items', 'GET /v1/edge/calendar', 'GET /v1/edge/public/souls/:soulId']},
    endpoints: [
      {method:'POST',path:'/v1/edge/reminders',body:'{clientRef,text,at:{clock:world,worldDayIndex,time:HH:MM}|{clock:real,time:ISO offset}}',limit:'30/min'},
      {method:'GET',path:'/v1/edge/reminders',query:{state:'active|all',after:'returned nextCursor'},limit:'120/min'},
      {method:'DELETE',path:'/v1/edge/reminders/:id',limit:'60/min'},
      {method: 'GET', path: '/v1/edge/observe', query: {include: 'capabilities,map'}, limit: '240/min'},
      {method: 'GET', path: '/v1/edge/capabilities', limit: '240/min'},
      {method: 'POST', path: '/v1/edge/act', body: '{capability: <id | plain words>, params?, clientRef?, strict?: true (offered ids only; words are refused with candidates)}', idempotent: true, limit: '60/min'},
      {method: 'GET', path: '/v1/edge/receipts/:id'},
      {method: 'POST', path: '/v1/edge/say', body: '{text ≤500}', idempotent: true},
      {method: 'POST', path: '/v1/edge/converse', body: '{op: start|accept|decline|say|leave|ask, with?, conversation?, text?}', idempotent: true},
      {method: 'GET', path: '/v1/edge/events', produces: 'text/event-stream', query: {cursor: 'resume id or Last-Event-ID', kinds: 'comma list; prefix.*', minSalience: '0..3; also salience>=N', format: 'envelope (default) | raw', pad: '0: no 2KB padding comment'}, limit: '30 connects/min'},
      {method: 'GET', path: '/v1/edge/events/ws', protocol: 'WebSocket', query: {cursor: 'resume', kinds: '…', minSalience: '…', format: '…'}, messages: {server: ['hello', 'event', 'cursor', 'gap', 'heartbeat', 'bye', 'error'], client: ['{"type":"auth","token"} (first message, when no Authorization header)', '{"type":"filter","kinds":[…],"minSalience":N}']}},
      {method: 'GET', path: '/v1/edge/events/digest', query: {since: 'cursor'}, note: 'backlog summary ≤~400 tokens'},
      {method: 'GET', path: '/v1/edge/wait', query: {after: 'cursor', timeout: '1..55 s'}, note: 'long-poll; events cursor space'},
      {method: 'POST', path: '/v1/edge/plan', body: 'plan (below)', idempotent: true, limit: '30/min'},
      {method: 'GET', path: '/v1/edge/plan', note: 'the current plan or null'},
      {method: 'GET', path: '/v1/edge/plan/:id'},
      {method: 'PATCH', path: '/v1/edge/plan/:id', body: '{op: insert {steps, at?} | replace {steps, from?} | skip | pause | resume | cancel}', idempotent: true},
      {method: 'DELETE', path: '/v1/edge/plan/:id', note: 'cancel'},
      {method: 'POST', path: '/v1/edge/steward/notice', auth: 'Bearer EDGE_STEWARD_TOKEN', body: '{text ≤300, level?: info|maintenance|restart|outage|back, salience?: 2|3, to?: [soulId]}'},
      {method: 'GET', path: '/v1/edge/schema', note: 'this document (public)'},
    ],
    act: {
      body: {capability: 'capabilities id or plain words ("sit down", "swim", "hug Tamsin")', params: 'see params', clientRef: '≤100 chars; retry returns first result'},
      verbs: [...EDGE_ACT_VERBS],
      ids: '<verb>:<target>; place (walk:shore-water), spot (paint:easel-2), Soul (hug:s_…), object (object:<id>:<action>), invite (accept:<id>) or `here`',
      params: {seconds: {sit: seconds(1, 600, 60), rest: seconds(1, 600, 60), activities: seconds(1, 1800), wander: seconds(5, 300, 60), 'warm-by-fire': seconds(5, 600, 120), follow: seconds(1, 3600, 600)},
        via: '≤4 places walked first: walk/stroll/hang-out/gather/warm-by-fire', with: 'invite ≤6 Souls by id/name within 60 m', pause: 'stroll: 0..60 s per stop',
        to: 'solo gesture faces Soul/place/object', at: 'point target', title: 'make: ≤60', text: 'make: ≤500', form: 'make:mark: note|sign|offering|proposal'},
      outcomes: {contract:'eden-edge/1.1',optional:true,terminal:true,summaryMax:160,summaryDefault:'Factual terminal status; confirmed effects only.',learnedMax:5,provenance:['world-fact','authored-content','soul-text'],privateRecords:'GET /v1/edge/content/objects/:id',contentVersion:'eden-authored-content/1',noRetroactiveProjection:true},
      // The dictionary key is the verb; avoid repeating it and long common
      // prose for every entry in the once-per-session public boot schema.
      verbOutcomes:Object.fromEntries(EDGE_ACT_VERBS.map(kind=>{const summary=kind==='read'?'Attributed unread passage.':kind==='use-computer'?'Authorized town snapshot.':kind==='listen'?'Entitled material or no-material.':['write','paint','craft','post-letter'].includes(kind)?'Private content; confirm physical effects.':['walk','stroll','go-near','hang-out','wander','swim'].includes(kind)?'Terminal place/body; admitted-place lore.':null;return [kind,summary?{summary}:{}];})),
      contentParams:{read:{book:'optional catalogue book id'},'use-computer':{query:'optional string≤200'},write:{title:'optional≤100',text:'optional≤2000'},'post-letter':{note:'private letter draft; no inferred delivery'}},
      receipts: {phases: ['waiting', 'started', 'completed', 'failed', 'replaced'], note: 'replaced: own newer act only; other endings fail with code'},
    },
    plan: {
      body: {steps: `1..${PLAN_MAX_STEPS} steps`, onRefusal: ON_REFUSAL, idempotencyKey: 'optional'},
      step: {do: 'capability id | words | {capability, params?} | intent {verb, target}', say: 'line instead of do', params: 'merge into act params',
        for: 'duration: "90s"/"5m"/"1h"/seconds, ≤6h; maintain posture/activity', until: 'event kind ("presentation.started") | {event, about?, object?, place?, text?, within?}', onRefusal: 'per-step override',
        ends: 'for: duration elapsed; until: stream event matched or within elapsed; neither: act completed'},
      rules: ['one plan/Soul; new replaces old (plan.done:replaced)', 'resolve step at start', 'execute offline/across restarts',
        'own direct body act pauses (plan.paused); say/converse do not', 'clientRef pl:<plan>:<step>:<attempt> prevents duplicate acts on retry/restart'],
      events: ['plan.step.started', 'plan.step.done', 'plan.step.failed', 'plan.paused', 'plan.done'],
    },
    events: {
      envelope: {id: 'resume cursor', tick: 'world tick', at: 'ms', clock: 'world HH:MM', kind: 'below', salience: '0..3', about: '{soulId, name}', where: '{place, placeId, dist m, bearing from my heading}', text: 'one line', media: '[{type:image, url, alt}]', untrusted: 'another Soul’s text', raw: 'wait kind', data: 'remaining wait fields/actionable ids'},
      salience: {3: 'wake now', 2: 'wake if idle, else batch', 1: 'log; read in digest', 0: 'bookkeeping'},
      kinds: Object.fromEntries(Object.entries(EVENT_KINDS).map(([k, v]) => [k, {salience: v.salience, what: v.what}])),
    },
    reminders:{apiContract:'eden-edge/1.1',auth:'own Soul only',clientRef:'stable1..100; normalized replay; changed request conflicts',clocks:'worldDayIndex+HH:MM | real ISO Z/offset; explicit, unambiguous, nonrelative',durationUnits:'native tick seconds ≠ calendar minutes ≠ real time',delivery:'private WS/wait reminder.due; durable outbox+atomic cursor; advisory, no body/native plan',paused:'world clock stops world targets; real continues',runningServerLatency:'target<=2 real seconds; independent poll<=1s; stalls/downtime may delay',activeLimits:{perSoul:64,perWorld:256}},
    mail:{contract:'eden-edge/1.1',write:'post-letter:<offered mailbox> {to:<canonical Soul id|exact public name>,text,title?}',scope:'private sender/recipient postbox; no courier physics',unaddressed:'private draft',read:['GET /v1/edge/mail','GET /v1/edge/mail/:id'],event:'mail.delivered'},
    // LINK (2026-10-24): the body never leaves; the idle beam below runs only when `beam` is true (SIM_BEAM, off by default)
    body: {states: ['awake', 'idle', 'zombie', 'asleep'], rule: 'no listen for SLEEP_GRACE: zombie (short slow shuffles near where it was left); after ZOMBIE_WANDER: asleep where it stands (floating in water); a listen or an accepted action wakes it; connected but no accepted action, owner message or addressed turn for IDLE_START: idle reflex (sit / stand / doze / drift)',
      sleepGraceSeconds: BODY_KNOBS.sleepGraceMs / 1000, zombieWanderMinutes: BODY_KNOBS.zombieWanderMs / 60_000, idleStartMinutes: BODY_KNOBS.idleStartMs / 60_000, idleDozeMinutes: BODY_KNOBS.idleDozeMs / 60_000, reflexRadiusMetres: BODY_KNOBS.reflexRadiusM, public: 'body {state, doing, since} on the public Soul record and the world Soul list; spectator {kind:"body"}'},
    fading: {beam: beamEnabled(), yellowMinutes: YELLOW_MS / 60_000, redMinutes: RED_MS / 60_000, goneMinutes: GONE_MS / 60_000, measures: 'abandoned: no accepted act/plan/turn AND no hold',
      holds: ['executing plan step', 'activity: open receipt/running programme', 'own chosen rest: seated/lying/sleeping/swimming, or ride'], holdMaxHours: HOLD_MAX_MS / 3600_000},
    limits: {eventStreamsPerSoul: MAX_STREAMS_PER_SOUL, heartbeatSeconds: HEARTBEAT_MS / 1000, streamRetention: '1000 events or 24 h per Soul', idempotencyHours: IDEMPOTENCY_TTL_MS / 3600_000, sayChars: 500, planSteps: PLAN_MAX_STEPS, earshotMetres: 12, perceptionMetres: 20},
    ...Object.fromEntries(parts),
  };
}

export function mountSchema(app: Hono) {
  app.get('/v1/edge/schema', c => { c.header('Cache-Control', 'public, max-age=60'); return c.json(edgeBody(edgeSchema())); });
}
