// OWNER-DAY: "what my Soul did today", read from the Soul's own receipts (GET /v1/souls/:id/day, owner only).
// What it did, what it said, and what the world refused, with the world's own reason. Each entry with a place
// moves the world camera there. Lazy chunk: loaded only on the Soul's home view.
import { useEffect, useState } from 'react';
import type { Api } from './useSouls.ts';
import { requestLookAt } from './look-at-request.ts';
import './SoulDay.css';

export type DayEntry = { at: number; kind: 'did' | 'doing' | 'stopped' | 'refused' | 'said'; text: string; reason?: string; code?: string; cut?: true; where: { x: number; z: number } | null; place?: string | null };

const TAG: Record<DayEntry['kind'], { label: string; cls: string }> = {
  did: { label: 'done', cls: 'mid' }, doing: { label: 'doing now', cls: 'translate' }, said: { label: 'said', cls: 'narrator' },
  refused: { label: 'refused', cls: 'day-refused' }, stopped: { label: 'stopped', cls: 'day-refused' },
};
/** An act begun and then cut short by the Soul's own next act: not "done". */
const CUT = { label: 'cut short', cls: 'translate' };
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** One plain sentence a stranger could repeat: counts by kind. */
export function daySummary(name: string, entries: readonly DayEntry[]): string {
  const n = (k: DayEntry['kind']) => entries.filter((e) => e.kind === k).length;
  const did = n('did') + n('doing'), said = n('said'), refused = n('refused');
  if (!entries.length) return `${name} has not done anything yet today.`;
  const parts = [`${did} thing${did === 1 ? '' : 's'} done`, `${said} thing${said === 1 ? '' : 's'} said`];
  if (refused) parts.push(`${refused} refused by the world`);
  return `Today ${name}: ${parts.join(' · ')}.`;
}

export function DayList({ name, entries, look = requestLookAt }: { name: string; entries: readonly DayEntry[]; look?: typeof requestLookAt }) {
  return <>
    <p className="day-summary">{daySummary(name, entries)}</p>
    <ol className="day-list">
      {entries.slice().reverse().map((e, i) => {
        const t = e.cut ? CUT : TAG[e.kind];
        const body = <>
          <span className="dim day-time">{clock(e.at)}</span>
          <span className={`tag ${t.cls}`}>{t.label}</span>
          <span className="day-text">{e.kind === 'said' ? <>“{e.text}”</> : e.text}{e.place && e.kind !== 'said' && <span className="dim"> · at {e.place}</span>}
            {e.reason && <span className="day-reason">{e.kind === 'refused' ? 'The world said: ' : 'Why: '}{e.reason}</span>}</span>
        </>;
        return <li key={`${e.at}:${i}`} className={`day-row day-${e.kind}`}>
          {e.where ? <button type="button" className="day-go" title="Show where this happened" aria-label={`${clock(e.at)} ${t.label}: ${e.text}. Show where this happened`} onClick={() => look(e.where!)}>{body}</button> : <div className="day-go">{body}</div>}
        </li>;
      })}
    </ol>
  </>;
}

export function SoulDay({ api, soulId, name }: { api: Api; soulId: string; name: string }) {
  const [entries, setEntries] = useState<DayEntry[] | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await api(`/v1/souls/${soulId}/day?since=${midnight()}`);
      if (!live) return;
      if (r.status === 200 && Array.isArray(r.data?.entries)) { setEntries(r.data.entries); setFailed(false); } else setFailed(true);
    };
    void load(); const t = setInterval(load, 5000); return () => { live = false; clearInterval(t); };
  }, [api, soulId]);
  return <section className="wide soul-day">
    <h2>{name} today</h2>
    {entries ? <><div className="scroll" style={{ maxHeight: 380 }}><DayList name={name} entries={entries} /></div>
      {entries.some((e) => e.where) && <p className="dim">Tap an entry to move the camera to where it happened.</p>}</>
      : <p className="dim" role="status">{failed ? 'Today’s record is unavailable right now. We’ll check again shortly.' : 'Reading today’s record…'}</p>}
  </section>;
}
