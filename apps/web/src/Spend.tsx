import { useEffect, useState } from 'react';
import type { Api } from './useSouls.ts';

type Agg = { total: number; calls: number; byTier: Record<string, { calls: number; cost: number }> };
type Report = {
  at: number; budgetPerDay: number; mode: string; hardCapHit: boolean; capSpent: number; capSince: number;
  actual: Record<'last15m' | 'last1h' | 'last24h' | 'today' | 'last7d' | 'thisMonth' | 'allTime', Agg>;
  projected: { basis: string; perHour: number; perDayTrend: number; perDayGoverned: number; perWeek: number; perMonth: number; perYear: number; endOfToday: number; endOfMonth: number; byTierPerDay: Record<string, number> };
  governor: { tier: string; share: number; perDay: number; level: number; capacity: number; estCost: number; denied: number }[];
  hourly: { hour: number; tier: string; cost: number; calls: number }[];
  byModel: { model: string; calls: number; cost: number; input: number; output: number; cached: number }[];
  since: number | null; pricing: Record<string, string>;
};
const TIERS = ['mid', 'narrator', 'director', 'user'] as const;
const TIER_LABEL: Record<string, string> = { mid: 'mid-brain (Jev)', narrator: 'narrator (Haiku)', director: 'director + ticker (Jev)', user: 'your commands + shots' };
export const $ = (n: number) => (n === 0 ? '$0' : n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export function SpendPanel({ api, authed, isAdmin }: { api: Api; authed: boolean; isAdmin: boolean }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [budget, setBudget] = useState('');
  useEffect(() => {
    if (!authed) return;
    const load = async () => { const x = await api('/v1/spend'); if (x.status === 200) { setR(x.data); setErr(''); } else setErr(x.data?.message ?? String(x.status)); };
    void load(); const t = setInterval(load, 10_000); return () => clearInterval(t);
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!authed) return <section className="wide"><h2>Spend</h2><p className="dim">Sign in to see model spend.</p></section>;
  if (!r) return <section className="wide"><h2>Spend</h2><p className="dim">{err || 'loading…'}</p></section>;
  const windows: [keyof Report['actual'], string][] = [['last15m', 'last 15 min'], ['last1h', 'last hour'], ['today', 'today (UTC)'], ['last24h', 'last 24 h'], ['last7d', 'last 7 days'], ['thisMonth', 'this month'], ['allTime', 'all time']];
  const hours = Array.from({ length: 24 }, (_, i) => Math.floor(r.at / 3600_000) - 23 + i);
  const perHour = hours.map((h) => ({ h, cost: r.hourly.filter((x) => x.hour === h).reduce((a, b) => a + b.cost, 0), byTier: Object.fromEntries(TIERS.map((t) => [t, r.hourly.filter((x) => x.hour === h && x.tier === t).reduce((a, b) => a + b.cost, 0)])) }));
  const hourBudget = r.budgetPerDay / 24;
  const maxH = Math.max(hourBudget, ...perHour.map((x) => x.cost));
  const usedToday = r.actual.today.total / r.budgetPerDay;
  return (
    <section className="wide">
      <h2>Spend — model API cost, actual and projected</h2>
      <div className="kv" style={{ marginBottom: 10 }}>
        <span>daily budget</span><span><b>{$(r.budgetPerDay)}</b> · spread evenly across the day by the governor · brain mode {r.mode}{r.hardCapHit && <b className="bad"> · 24 h hard cap reached: free defaults only</b>}</span>
        <span>hard cap</span><span>{$(r.capSpent)} of {$(r.budgetPerDay)} spent under the current budget (since {new Date(r.capSince).toISOString().slice(11, 16)} UTC, rolling 24 h)</span>
        <span>today so far</span><span><span className="bar" style={{ width: Math.min(300, usedToday * 300) }} />{$(r.actual.today.total)} of {$(r.budgetPerDay)} ({(usedToday * 100).toFixed(0)}%)</span>
        <span>projected</span><span>end of today ≈ <b>{$(r.projected.endOfToday)}</b> · end of month ≈ <b>{$(r.projected.endOfMonth)}</b></span>
        <span>run rate</span><span>{$(r.projected.perHour)}/h ({r.projected.basis}) → {$(r.projected.perDayTrend)}/day trend, {$(r.projected.perDayGoverned)}/day allowed · {$(r.projected.perWeek)}/week · {$(r.projected.perMonth)}/month · {$(r.projected.perYear)}/year</span>
        {r.since && <><span>tracking since</span><span>{new Date(r.since).toISOString().slice(0, 16).replace('T', ' ')} UTC</span></>}
      </div>

      <div className="scrollx"><table>
        <thead><tr><th>actual</th>{TIERS.map((t) => <th key={t}>{TIER_LABEL[t]}</th>)}<th>total</th><th>calls</th></tr></thead>
        <tbody>{windows.map(([k, label]) => { const a = r.actual[k]; return (
          <tr key={k}><td className="dim">{label}</td>{TIERS.map((t) => <td key={t}>{a.byTier[t] ? `${$(a.byTier[t].cost)} · ${a.byTier[t].calls}` : <span className="dim">—</span>}</td>)}<td><b>{$(a.total)}</b></td><td>{a.calls}</td></tr>); })}
          <tr><td className="dim">projected / day</td>{TIERS.map((t) => <td key={t} className="dim">{$(r.projected.byTierPerDay[t] ?? 0)}</td>)}<td className="dim">{$(r.projected.perDayGoverned)}</td><td /></tr>
        </tbody>
      </table></div>

      <h2 style={{ marginTop: 14 }}>Governor — each tier gets a share of the daily budget, refilled continuously</h2>
      <table><thead><tr><th>tier</th><th>share</th><th>per day</th><th>bucket now (max = one hour of refill)</th><th>typical call</th><th>≈ calls/day it allows</th><th>held back</th></tr></thead>
        <tbody>{r.governor.map((g) => (
          <tr key={g.tier}><td>{TIER_LABEL[g.tier]}</td><td>{(g.share * 100).toFixed(0)}%</td><td>{$(g.perDay)}</td>
            <td><span className="bar" style={{ width: Math.max(1, Math.round((Math.max(0, g.level) / (g.capacity || 1)) * 160)) }} />{$(Math.max(0, g.level))} / {$(g.capacity)}</td>
            <td>{$(g.estCost)}</td><td>{g.estCost > 0 ? Math.floor(g.perDay / g.estCost).toLocaleString() : '—'}</td><td>{g.denied}</td></tr>))}
        </tbody></table>
      <p className="note">When a tier’s bucket is empty: a busy Soul keeps doing what it is doing and rethinks later; an idle Soul takes a free built-in choice; the narrator waits for its next affordable plan; the broadcast camera holds its shot; typed commands say “try again in a few minutes”. A hard cap on the rolling 24 h total is the backstop.</p>

      <h2 style={{ marginTop: 14 }}>Last 24 hours, per hour (| marks the even-spread budget of {$(hourBudget)}/h)</h2>
      <pre className="map" style={{ lineHeight: 1.3 }}>{perHour.map(({ h, cost, byTier }) => {
        const w = 50, n = maxH > 0 ? Math.round((cost / maxH) * w) : 0, mark = Math.round((hourBudget / (maxH || 1)) * w);
        let bar = ''; let used = 0;
        for (const t of TIERS) { const k = cost > 0 ? Math.round((byTier[t] / cost) * n) : 0; bar += { mid: 'm', narrator: 'n', director: 'd', user: 'u' }[t].repeat(Math.max(0, Math.min(k, n - used))); used = bar.length; }
        bar = bar.padEnd(w + 1, ' ').split('').map((c, i) => (i === mark && c === ' ' ? '|' : c)).join('');
        return `${String(new Date(h * 3600_000).getUTCHours()).padStart(2, '0')}:00  ${bar} ${$(cost)}\n`;
      }).join('')}</pre>
      <p className="dim">m mid-brain · n narrator · d director · u your commands</p>

      <h2 style={{ marginTop: 14 }}>By model (all time)</h2>
      <table><thead><tr><th>model</th><th>calls</th><th>input tokens</th><th>cached</th><th>output tokens</th><th>cost</th></tr></thead>
        <tbody>{r.byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.calls}</td><td>{m.input.toLocaleString()}</td><td>{m.cached.toLocaleString()}</td><td>{m.output.toLocaleString()}</td><td>{$(m.cost)}</td></tr>)}</tbody></table>
      <p className="dim">Pricing used: Jev {r.pricing.jev}. Haiku 4.5 {r.pricing.haiku}. Costs are computed from the token counts each API returns.</p>
      {isAdmin && <div className="row"><span>set daily budget $</span><input style={{ width: 80, flex: 'none' }} placeholder={String(r.budgetPerDay)} value={budget} onChange={(e) => setBudget(e.target.value)} />
        <button onClick={async () => { const v = Number(budget); if (v >= 0) { await api('/v1/admin', { action: 'budget', usdPerDay: v }); setBudget(''); } }}>set</button><span className="dim">(until restart; the service default is BRAIN_BUDGET_USD_PER_DAY)</span></div>}
    </section>
  );
}
