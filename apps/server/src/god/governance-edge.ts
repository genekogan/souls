// GOVERN (lane C17): the residents' side of governance on the edge contract (governance.ts holds the data).
//   - capabilities: `propose-amendment` {text, title?}, `support:<id>`, `unsupport:<id>`, `withdraw-amendment:<id>`
//     (completed receipts at once, like `pray`); the read offer says when the constitution changed since the Soul read it;
//   - arrival: a Soul that walks somewhere after the constitution changed since it last saw it is told so once
//     (outcome detail.constitutionChanged {from, to, text}); first-visit lore (world-lore.ts) and reading mark it seen;
//   - who counts as an active resident: a Soul living here now (host.minds) that has not faded.
// Installed by main.ts on god worlds, after the engine bridge (so it wraps world-lore's hooks).
import type { WorldHost } from '../world.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import { config, KNOWN_WORLD_KEYS } from '../config.ts';
import type { GodMode } from './god.ts';
import { governanceOf, MAX_CLAUSE, type Governance } from './governance.ts';
import { godFeature } from '../../../../tools/god-skill/lib/features.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const WALKS = ['walk', 'stroll', 'go', 'go-near', 'hang-out', 'wander', 'swim'];
const VERBS = /^(propose-amendment|support|unsupport|withdraw-amendment)(:|$)/;
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export function installGovernance(god: GodMode, o: { host: WorldHost; edge?: EdgeLedger; edgeHooks?: boolean }): Governance {
  const { host, edge } = o;
  const gov = governanceOf(god, {
    residents: () => [...host.minds.values()].filter((m) => !edge?.faded.has(m.soulId)).map((m) => ({ id: m.soulId, name: m.name })),
    deliver: (soulId, kind, body) => { (edge?.comms as any)?.streams?.deliver?.(soulId, kind, host.engine.world.tick, body); },
  });
  // G5: the Constitution is switched off (tools/god-skill/lib/features.mjs): Souls are not offered amendments; the data stays
  if (edge && (o.edgeHooks ?? (godFeature('constitution') && !(KNOWN_WORLD_KEYS as readonly string[]).includes(config.worldKey)))) hookEdge(edge, gov);
  return gov;
}

function hookEdge(L: EdgeLedger, gov: Governance) {
  const resident = (s: EdgeSoul) => ({ id: s.soulId, name: s.name });

  // ---- capabilities
  const prevProfile = L.worldProfile;
  L.worldProfile = (soul, caps, plans) => {
    prevProfile?.(soul, caps, plans);
    try { capabilities(gov, soul, caps); } catch (e) { console.error('[governance] capabilities', (e as Error).message); }
  };

  // Governance adds amendment offers, never modifies an existing walk binding.
  L.registerExactWalkProfile(L.worldProfile!,prevProfile);

  // ---- acts
  const act = L.act.bind(L);
  (L as any).act = async function (soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
    const cap = typeof input?.capability === 'string' ? input.capability : '';
    if (!VERBS.test(cap)) return act(soul, input as never);
    const [verb, id = ''] = [cap.split(':')[0], cap.slice(cap.indexOf(':') + 1)];
    const params = (input.params ?? {}) as Record<string, unknown>;
    try {
      const result = verb === 'propose-amendment' ? { amendment: gov.propose(resident(soul), { text: params.text ?? (cap.includes(':') ? id : undefined), title: params.title, full: params.full }) }
        : verb === 'withdraw-amendment' ? { amendment: gov.withdraw(resident(soul), id) }
        : { amendment: gov.support(resident(soul), id, verb === 'support') };
      const r = (L as any).insert(soul, verb, 'completed', typeof input.clientRef === 'string' ? input.clientRef : undefined, true, { amendment: result.amendment.id });
      return { accepted: true as const, receipt: (L as any).receipt(soul.soulId, r.id), result };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { accepted: false as const, capability: cap, code: err.code ?? 'governance.refused', reason: err.message ?? 'refused' };
    }
  };

  // ---- arrival and reading: "changed since your last visit"
  const out = L.outcomes as any;
  if (!out?.terminal) return;
  const terminal = out.terminal.bind(out);
  out.terminal = (receipt: any, snapshot: any, effects: any = {}) => {
    const kind = String(receipt.capability ?? '').split(':')[0];
    const arrival = receipt.phase === 'completed' && WALKS.includes(kind) && snapshot?.pos && !out.read(receipt.id);
    const ctx = arrival ? out.context(receipt.id) : null;
    let eff = effects;
    if (ctx) {
      const s = gov.seenBy(ctx.soulId, false);
      if (s.changed) {
        const cur = gov.current(), v = gov.latest();
        eff = { ...effects, detail: { ...(effects?.detail ?? {}), constitutionChanged: { from: s.lastSeen, to: s.version, ...(v?.note ? { why: v.note } : {}), text: clip(cur.text, 2000) || "(the god cleared this world's constitution)", source: 'world-constitution', provenance: 'god-authored', untrusted: true } } };
        gov.markSeen(ctx.soulId, s.version);
      }
    }
    const r = terminal(receipt, snapshot, eff);
    // world-lore told the constitution (or that there is none yet) as first-visit lore: that is reading it
    if (ctx && told(out, ctx.soulId) && gov.seenBy(ctx.soulId, false).firstTime) gov.markSeen(ctx.soulId);
    return r;
  };
  if (typeof out.readPassage === 'function') {
    const read = out.readPassage.bind(out);
    out.readPassage = (context: any, o2: any) => {
      read(context, o2);
      if (o2?.detail?.book?.id === 'world-constitution' && context?.soulId) { const c = gov.current(); gov.markSeen(context.soulId, c.version); o2.detail = { ...o2.detail, constitutionVersion: c.version }; }
    };
  }
}

/** Did world-lore tell this Soul its first-visit lore? (its own table; absent on worlds without it) */
function told(out: any, soulId: string): boolean {
  try { return !!out.db.prepare('SELECT 1 FROM god_lore_visits_v1 WHERE world_id=? AND soul_id=?').get(out.worldId, soulId); } catch { return false; }
}

export function capabilities(gov: Governance, soul: EdgeSoul, caps: EdgeCapability[]) {
  const seen = gov.seenBy(soul.soulId, false);
  // the read offer (world-lore's "this world's constitution"): which version, and whether it changed for this Soul
  if (seen.version > 0) for (const c of caps) if (c.verb === 'read' && /constitution/i.test(c.label)) c.label = `${c.label} (version ${seen.version}${seen.changed ? ', changed since you last read it' : ''})`;
  const decide = gov.residentsDecide, q = decide ? gov.quorum() : null;
  caps.push({ id: 'propose-amendment', verb: 'propose-amendment', label: `Propose an amendment to this world's constitution (params: {"text": "…", "title"?: "…"}); other residents can support it and ${decide ? 'a majority of residents, or the god, decides' : 'the god decides'}`, available: true, params: { text: { type: 'string', required: true, maxLength: MAX_CLAUSE }, title: { type: 'string', maxLength: 80, optional: true } } });
  const open = gov.amendments({ status: 'open', soulId: soul.soulId, limit: 12 });
  for (const a of open.filter((x) => !x.yours && !x.supporting).slice(0, 5)) {
    caps.push({ id: `support:${a.id}`, verb: 'support', label: `Support the amendment “${a.title}” proposed by ${a.by.name}: ${clip(a.text, 160)} (${a.support} support${q ? `; ${q.needed} active residents decide it` : ''})`, available: true, target: { id: a.id, kind: 'amendment' } });
  }
  for (const a of open.filter((x) => !x.yours && x.supporting).slice(0, 3)) caps.push({ id: `unsupport:${a.id}`, verb: 'unsupport', label: `Withdraw your support for the amendment “${a.title}” (${a.support} support)`, available: true, target: { id: a.id, kind: 'amendment' } });
  for (const a of open.filter((x) => x.yours).slice(0, 3)) caps.push({ id: `withdraw-amendment:${a.id}`, verb: 'withdraw-amendment', label: `Withdraw your amendment “${a.title}” (${a.support} support, waiting for ${decide ? 'the residents or the god' : 'the god'})`, available: true, target: { id: a.id, kind: 'amendment' } });
}
