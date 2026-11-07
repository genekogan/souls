import {ownLiveChunk} from './owned-live-chunks.ts';
import {createApiRequest} from './api-request.ts';
import {matchingMe} from './auth-projection.ts';
import {acceptPrivateAuthority,acceptLivePrivateAuthority,retirePrivateAuthority} from './private-authority.ts';
import { apiPath, worldPath } from './world-path.ts';
import { takeBootSocket } from './snapshot-prefetch.ts';
import { arrivalMark } from './arrival-marks.ts';
import { watchSocket } from './client-errors.ts';
import { useEffect, useRef, useState } from 'react';
import { Connection } from '@souls/client';
import {createStationConnection,type StationConnection} from './score/station-connection.mjs';
import * as stationCodec from '@souls/protocol';
import { PROTO } from '@souls/protocol';
import type { StationLiveContract, BrainCall, CameraLine, KernelView, LogEvent, Me, NarrativeView, PlayView, ServerStats, TalkLine, TickerLine } from '@souls/protocol';

declare const __BUILD__: string;

export type Souls = {
  takes: { serverTick: number; chunks: {fromTick: number; toTick: number; take: unknown}[]; receivedAt: number };
  privateAuthorityGeneration?:number;conn: Connection; station:StationConnection|null;me: Me | null; log: LogEvent[]; brain: BrainCall[]; camera: CameraLine | null; ticker: TickerLine[];
  narratives: Record<string, NarrativeView>; stats: ServerStats | null; bytesPerSec: number;
  /** The meaning layer: things, links, vocabulary, decks (public). */
  kernel: KernelView | null; plays: PlayView[]; talk: TalkLine[];
  /** Edge spectator feed (speech, conversation.*, fade, steward.*) from the viewer socket; newest last, max 300. */
  edge: EdgeMsg[];
};
/** One `{type:'edge', …}` viewer message (EDGE-CONTRACT-v1 §7). Open shape: renderers read only what they know. */
export type EdgeMsg = { type: 'edge'; kind?: string; [k: string]: unknown };

/** This page runs an older bundle than the server's build: reload now if the protocol changed, else the next time the
 *  page has stayed hidden for a minute (a quick tab switch never reloads). Once per build. */
let staleWatch: string | null = null;
export function staleBundle(build: string, incompatible: boolean, hiddenMs = 60_000) {
  const reload = () => { sessionStorage.setItem('sim.reloaded', build); location.reload(); };
  if (incompatible) { reload(); return; }
  if (staleWatch === build) return; staleWatch = build;
  let t: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    if (document.visibilityState === 'hidden') { t ??= setTimeout(reload, hiddenMs); }
    else if (t) { clearTimeout(t); t = null; }
  };
  document.addEventListener('visibilitychange', check); check();
}

/** One connection for the page. Re-renders about 5 times a second while the world runs. */
export function useSouls(getToken: () => Promise<string | null>, authed: boolean,identity:string|null=null,worldId?:string,stationCapabilities?:{stationContracts?:StationLiveContract[]}): Souls {
  const tokenRef = useRef(getToken); tokenRef.current = getToken;
  const identityRef=useRef(identity);identityRef.current=identity;
  const authedRef=useRef(authed);authedRef.current=authed;
  const session=JSON.stringify([authed,identity]);const sessionRef=useRef(session);
  const [, force] = useState(0);
  const s = useRef<Omit<Souls, 'conn'> & { conn: Connection | null; lastBytes: number; lastAt: number; takeEpoch?: string }>({ takes: {serverTick: 0, chunks: [], receivedAt: 0}, conn: null,station:null, privateAuthorityGeneration:0,me: null, log: [], brain: [], camera: null, ticker: [], narratives: {}, stats: null, bytesPerSec: 0, kernel: null, plays: [], talk: [], edge: [], lastBytes: 0, lastAt: Date.now() });
  if(sessionRef.current!==session){sessionRef.current=session;retirePrivateAuthority(s.current);}
  if (!s.current.conn) {
    const st = s.current;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    st.conn = new Connection(`${proto}://${location.host}${worldPath}/ws`, () => tokenRef.current(), {
      onSession: session => {
        retirePrivateAuthority(st);
        if(session&&!st.station)st.station=createStationConnection({worldId:worldId??session.worldId,codec:stationCodec});
        st.station?.onSession(session);
      },
      onMe: (me,scope)=>{
        acceptLivePrivateAuthority(st,authedRef.current,identityRef.current,me,scope,st.conn!,worldId);
        force(n=>n+1);
      },
      onStation: (view,receipt)=>st.station?.onStation(view,receipt),
      onStationV2: (view,receipt)=>st.station?.onStationV2(view,receipt),
      onPong: (pong,receipt)=>st.station?.onPong(pong,receipt),
      onTakes: stream => {
        arrivalMark('ws-takes');
        const old = stream.serverTick < st.takes.serverTick ? [] : st.takes.chunks;
        const merged = new Map(old.map(c => [c.toTick, c]));
        for (const raw of stream.chunks) {const chunk=ownLiveChunk(raw);if(chunk)merged.set(chunk.toTick,chunk);}
        st.takes = {serverTick: stream.serverTick, chunks: [...merged.values()].sort((a,b) => a.toTick-b.toTick).slice(-12), receivedAt: performance.now()};
      },
      onWelcome: (me, w) => {
        arrivalMark('ws-welcome');
        st.station?.onWelcome(w);
        if (w.epoch !== st.takeEpoch) st.takes.chunks = [];
        st.takeEpoch = w.epoch;
        acceptPrivateAuthority(st,authedRef.current,identityRef.current,me);
        // after a deploy, a page still running the old bundle: a new protocol needs the new bundle now (reload once); a
        // compatible release keeps this viewer running (it reconnected and resumed) and swaps the bundle unseen, once the
        // page has been hidden for a minute (lane C4: releases without visible downtime)
        if (w.build && w.build !== 'dev' && __BUILD__ !== 'dev' && w.build !== __BUILD__ && sessionStorage.getItem('sim.reloaded') !== w.build) staleBundle(w.build, w.proto !== undefined && w.proto !== PROTO);
      },
      onLog: (ev) => { const seen = new Set(st.log.map((e) => e.seq)); st.log = [...st.log, ...ev.filter((e) => !seen.has(e.seq))].slice(-400); },
      onBrain: (calls) => { const current=matchingMe(authedRef.current,identityRef.current,st.me);if(!current)return;const own=new Set(current.souls);const seen = new Set(st.brain.map((c) => c.id)); st.brain = [...st.brain, ...calls.filter((c) => !seen.has(c.id)&&(current.role==='admin'||(typeof c.soulId==='string'&&own.has(c.soulId))))].slice(-300); },
      onCamera: (l) => { st.camera = l; },
      onTicker: (l) => { const seen = new Set(st.ticker.map((x) => `${x.tick}:${x.text}`)); st.ticker = [...st.ticker, ...l.filter((x) => !seen.has(`${x.tick}:${x.text}`))].slice(-40); },
      onNarrative: (v) => { st.narratives = { ...st.narratives, [v.region]: v }; },
      onStats: (x) => { const admin=matchingMe(authedRef.current,identityRef.current,st.me)?.role==='admin';st.stats=admin?x:{...x,brain:{mode:x.brain.mode,callsToday:x.brain.callsToday,inflight:x.brain.inflight,jevMsAvg:x.brain.jevMsAvg}}; },
      onKernel: (v) => { st.kernel = v; },
      onPlays: (p) => { const seen = new Set(st.plays.map((x) => x.seq)); st.plays = [...st.plays, ...p.filter((x) => !seen.has(x.seq))].slice(-300); },
      onTalk: (l) => { const seen = new Set(st.talk.map((x) => x.id)); st.talk = [...st.talk, ...l.filter((x) => !seen.has(x.id))].slice(-300); },
      // Spread so this compiles before and after the client declares onEdge; re-render comes from the 200 ms tick.
      ...({ onEdge: (m: EdgeMsg) => { st.edge = [...st.edge, m].slice(-300); } } as { onEdge(m: EdgeMsg): void }),
    }, (u) => watchSocket(new WebSocket(u)) as never,undefined,undefined,stationCapabilities,true);
    // lane W1: the socket index.html opened at page entry (snapshot-prefetch.ts), with what it has received so far
    const boot = takeBootSocket(st.conn.url); if (boot) { watchSocket(boot.ws as unknown as WebSocket); st.conn.adopt(boot as never); }
  }
  useEffect(() => {
    const st = s.current; st.conn!.connect();
    // what happened before this page opened (all public)
    const get = (path: string) => fetch(apiPath(path)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void get('/v1/kernel').then((v) => { if (v && !st.kernel) st.kernel = v; });
    void get('/v1/plays?limit=200').then((v) => { if (v?.plays) { const seen = new Set(st.plays.map((x) => x.seq)); st.plays = [...(v.plays as PlayView[]).filter((x) => !seen.has(x.seq)), ...st.plays].slice(-300); } });
    void get('/v1/talk?limit=120').then((v) => { if (v?.lines) { const seen = new Set(st.talk.map((x) => x.id)); st.talk = [...(v.lines as TalkLine[]).filter((x) => !seen.has(x.id)).sort((a, b) => a.id - b.id), ...st.talk].slice(-300); } });
    let lastProbeAt=-Infinity;
    const t = setInterval(() => {
      const now = Date.now(), b = st.conn!.stats.bytesIn;
      if (now - st.lastAt >= 2000) { st.bytesPerSec = ((b - st.lastBytes) * 1000) / (now - st.lastAt); st.lastBytes = b; st.lastAt = now; }
      const monotonicAt=performance.now();if(monotonicAt-lastProbeAt>=1000){lastProbeAt=monotonicAt;st.station?.probe(st.conn!);}
      force((n) => n + 1);
    }, 200);
    return () => { clearInterval(t); st.conn!.close();st.station?.dispose(); };
  }, []);
  // signing in or out: reconnect so the server re-reads who we are
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } const st=s.current;retirePrivateAuthority(st);st.conn!.rehello(); }, [authed,identity]);
  return s.current as Souls;
}

/** Re-read who we are (the welcome's Me) without a reload: a reconnect, as signing in does. New worlds' hub never pushes
 *  an updated Me (no live private authority), so a Soul just approved in this window is not "own" until this runs. */
export function refreshMe(sim: Souls) { retirePrivateAuthority(sim); sim.conn.rehello(); }

export function makeApi(getToken: () => Promise<string | null>,session?:()=>number) {
  return createApiRequest(getToken,{path:apiPath,session});
}
export type Api = ReturnType<typeof makeApi>;
