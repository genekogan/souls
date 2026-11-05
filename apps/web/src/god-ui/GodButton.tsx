// G4 (Gene 2026-10-20): the God button right of Explore, styled like it ("God ⌘G"), on new worlds. It opens the one God
// modal (GodModal, rendered by GodPanel in the world view). Only the world's god has it (U3); nobody else gets a God
// view. #662: a green border says their agent is connected (neutral otherwise; no dot, so the bolt stays centred),
// and a badge counts pairing requests waiting for approval. Replaces GODUI's lightning-bolt popover
// and the separate Constitution chip.
import { useEffect, useRef, useState } from 'react';
import * as G from './god-api.ts';
import { openGod, toggleGod, useGod, watchInbox } from './god-store.ts';

/** ⌘G / Ctrl+G opens God (see team/lanes/t4-g4.md "Key"): browsers let a page take it (it is only find-next), unlike ⌘L. */
export const GOD_KEY = 'g';
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const godKeyLabel = () => (isMac() ? '⌘G' : 'Ctrl+G');
export const isGodKey = (e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'>) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === GOD_KEY;

const BOLT = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2 4.5 11.2h4.6L8 18l7.5-9.6h-4.7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;

export function GodButton() {
  const [status, setStatus] = useState<G.Status | null>(null);
  const { open, inbox } = useGod();
  const owner = status?.you === 'owner' || status?.you === 'god';
  const pendingSeen = useRef(0), ownerNow = useRef(false);
  ownerNow.current = owner;
  useEffect(() => G.watchStatus(setStatus), []);
  useEffect(() => { if (owner) return watchInbox(); }, [owner]);
  // #godpair/<code> (the link a god agent prints) and a new pairing request open God on the agent section
  useEffect(() => { if (location.hash.startsWith('#godpair/')) openGod('agent'); }, []);
  useEffect(() => { const n = status?.pending.length ?? 0; if (owner && n > pendingSeen.current) openGod('agent'); pendingSeen.current = n; }, [status, owner]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!isGodKey(e) || !ownerNow.current) return;
      // another modal (Explore) is open: leave it alone
      if (document.querySelector('dialog[open]:not([data-god-modal]), [role="dialog"][aria-modal="true"]:not([data-god-modal])')) return;
      e.preventDefault(); toggleGod();
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, []);
  // U3 (Gene 2026-10-20b): "god mode button at top should only be there if you are actually god": visitors, signed-out
  // people and a godless world's claimant get no God button (nor ⌘G); claiming stays on the claim card (GodPanel).
  if (!status || !owner) return null;
  const paired = (status.agents ?? 0) > 0;
  // the owner's agent: 'on' (green border) only when the inbox says it is connected; not paired, not connected or not
  // known yet keep the neutral border, so a stale or loading state never looks connected
  const live = !paired ? 'off' : inbox ? (inbox.connected ? 'on' : 'off') : null;
  const state = live === 'on' ? 'agent connected' : live === 'off' ? 'agent not connected' : 'agent status loading';
  const title = `God mode: your agent and this world (${godKeyLabel()})`;
  return (
    <span className="god-control">
      <button type="button" className="explore-open god-open" data-god-open="owner" data-agent={live ?? undefined}
        aria-label={`God mode, ${state}`} data-tooltip={title} aria-haspopup="dialog" aria-expanded={open} title={title} onClick={() => toggleGod()}>
        {BOLT}
        {status.pending.length ? <span className="gp-badge" aria-label={`${status.pending.length} pairing request`}>{status.pending.length}</span> : null}
      </button>
    </span>
  );
}
