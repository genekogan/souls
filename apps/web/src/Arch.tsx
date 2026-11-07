import { apiPath, worldPath } from './world-path.ts';
import type { Souls } from './useSouls.ts';

export function ArchPanel({ sim, cfg }: { sim: Souls; cfg: { publicUrl: string; worldId: string } }) {
  const s = sim.stats, st = sim.conn.stats, w = sim.conn.welcome;
  const d = `
   owners' agents (Claude / GPT / Codex)          you, in this page
        │  REST /v1/agent/*  or  MCP /mcp               │  type a command
        │  bearer = per-Soul token (pairing code)          ▼
        │                                     ┌─ translate (Jev) ─┐   text → closed intent
        ▼                                     ▼                    │
  ┌──────────────────────────── one Node process: the sequencer ───┴───────────────────────┐
  │                                                                                         │
  │  inputs queue ──► EVENT LOG (SQLite, append-only)      ${pad(`${s?.seq ?? '…'} events`, 22)}           │
  │       │             birth · intent · decision · scene · rules · admin · retire          │
  │       ▼                                                                                 │
  │  applied at tick T ──► ENGINE.step()  20 Hz, deterministic   tick ${pad(String(s?.tick ?? '…'), 12)}          │
  │                          (toy engine now; Mars engine later, same contract)             │
  │                          step ${pad(`${s ? s.tickMsAvg.toFixed(3) : '…'} ms avg`, 16)} ${pad(`${s?.liveActions ?? '…'} live actions`, 18)}              │
  │       ▲                                                                                 │
  │       │ decision events                                                                 │
  │  MID-BRAIN (Jev) per Soul: engine enumerates options → Jev picks → sampled → logged     │
  │       ▲ nudges                                     ${pad(`${s?.brain.callsToday ?? '…'} calls / 24 h`, 22)}            │
  │  NARRATOR (Haiku) per region every ~5 min: digest → beats → scene events               │
  │  DIRECTOR (Jev) every ~6 s while watched: shot + ticker                                 │
  │                                                                                         │
  │  SNAPSHOT every 5 min (content-addressed state + minds)   last at tick ${pad(String(s?.lastSnapshotTick ?? '…'), 10)}      │
  │  boot = latest snapshot + fast-forward through later events (the fold)                  │
  └───────────────┬─────────────────────────────────────────────────────────────────────────┘
                  │ WebSocket /ws
                  │  on join: snapshot          every 500 ms: batch of path decisions + changes
                  │  every 5 s: heartbeat with a view hash (+ a few authoritative keyframes)
                  ▼
   ${pad(`${s?.clients ?? '…'} clients`, 12)} each keeps a REPLICA and computes positions locally from timed paths.
   this client: seq ${st.snapshots ? sim.conn.replica.seq : '…'}, last check "${st.lastCheck}", ${st.resyncs} resyncs, ${(sim.bytesPerSec / 1024).toFixed(2)} KB/s in
   hash mismatch → resync (new snapshot).  socket drop → reconnect and resume from the ring buffer.
`;
  return (
    <section className="wide">
      <h2>Architecture — live wiring ({cfg.worldId}, rules {w?.rulesVersion})</h2>
      <pre className="map" style={{ lineHeight: 1.25 }}>{d}</pre>
      <p className="note">Everything the engine does here is faked by a toy world (a 100 m plane, a campfire, benches). The contract around it is the Mars engine’s: WorldState, Runtime.submit/step/snapshot/restore, ActionDef verbs, content hashing, PoseSample paths. Swapping the engine means writing one adapter.</p>
      <p>Public endpoints: <a href="/v1/world">/v1/world</a> · <a href="/v1/log">/v1/log</a> · <a href="/v1/debug/world">/v1/debug/world</a> (raw WorldState) · <a href="/v1/debug/verbs">/v1/debug/verbs</a> · <a href="/v1/skill.md">/v1/skill.md</a> · <a href="/healthz">/healthz</a></p>
    </section>
  );
}
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
