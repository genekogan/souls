// Opt-in soul-trace/1 host boundaries for the managed runtime (#733 S2). With SOUL_TRACE_FILE set, the runtime
// writes the same `host.turn` / `host.tool` records the thin-CLI chat host writes (tools/soul-trace/host.mjs), so
// readout.mjs and inspect.mjs split a managed episode the same way. Load tools/soul-trace/tap.mjs with --import on
// the same process to also record its world requests. Without SOUL_TRACE_FILE nothing is installed.
//
// Mapping: a turn starts at its `begin` request (named by the turn id `begin` returns) and is linked to the first
// owner message the supervisor delivered with it; it ends at `turn/completed`. A tool item (`item/started` /
// `item/completed` of a tool type) is a tool call of its turn. Only opaque ids are recorded: no prompt, text,
// arguments, output or paths. Writes use soul-trace's bounded asynchronous queue and never throw into the host.
import {hostRecorder} from '../soul-trace/host.mjs';

export const TOOL_ITEMS = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView', 'collabAgentToolCall']);

export function createHostTrace(rec) {
  const begun = new Map(), started = new Set(), detach = [];
  const safe = fn => (...args) => { try { fn(...args); } catch {} };
  return {
    rec,
    bindHost(host) {
      const begin = host.begin;
      if (typeof begin === 'function') {
        host.begin = async function (...args) {
          const when = rec.mark(), result = await Reflect.apply(begin, this, args);
          try { if (typeof result?.turnId === 'string' && !started.has(result.turnId)) begun.set(result.turnId, when); } catch {}
          return result;
        };
        detach.push(() => { host.begin = begin; });
      }
      const event = safe(e => {
        const p = e?.params ?? {};
        if (e?.method === 'turn/completed') { rec.turn('end', {turn: p.turn?.id ?? p.turnId}); return; }
        if ((e?.method === 'item/started' || e?.method === 'item/completed') && TOOL_ITEMS.has(p.item?.type)) {
          rec.tool(e.method === 'item/started' ? 'start' : 'end', {turn: p.turnId, tool: p.item?.id, exitCode: e.method === 'item/completed' ? p.item?.exitCode : undefined});
        }
      });
      host.on('event', event);
      detach.push(() => host.off('event', event));
      return host;
    },
    /** Fed the supervisor's states: a started turn is named with the owner message it answers. */
    state: safe(s => {
      if (s?.state !== 'host-notified' || s.mode !== 'start' || typeof s.turnId !== 'string' || started.has(s.turnId)) return;
      started.add(s.turnId);
      const owner = Array.isArray(s.events) ? s.events.find(f => f?.source === 'owner') : undefined;
      rec.turn('start', {turn: s.turnId, for: owner?.id, when: begun.get(s.turnId)});
      begun.delete(s.turnId);
    }),
    async close() { for (const stop of detach.splice(0)) stop(); await rec.drain(); rec.close(); },
  };
}

/** The managed runtime's host trace when SOUL_TRACE_FILE names a usable file; otherwise null. */
export function openHostTrace(env = process.env, options = {}) {
  const file = env.SOUL_TRACE_FILE;
  if (typeof file !== 'string' || !file) return null;
  const rec = hostRecorder({file, queued: true, ...options});
  return rec.enabled ? createHostTrace(rec) : null;
}
