import { useState } from 'react';
import type { Api, Souls } from './useSouls.ts';

export function AdminPanel({ sim, api }: { sim: Souls; api: Api }) {
  const [rate, setRate] = useState('1'); const [budget, setBudget] = useState('0.5'); const [out, setOut] = useState(''); const [clients, setClients] = useState<any>(null);
  const [uses, setUses] = useState('5'); const [inote, setInote] = useState(''); const [invites, setInvites] = useState<any>(null);
  const loadInvites = async () => { const r = await api('/v1/admin/invites'); if (r.status === 200) setInvites(r.data); else setOut(JSON.stringify(r.data)); };
  const act = async (body: unknown) => { const r = await api('/v1/admin', body); setOut(JSON.stringify(r.data)); };
  return (
    <section>
      <h2>Admin — world dials</h2>
      <div className="row"><button onClick={() => void act({ action: 'pause' })}>pause</button><button onClick={() => void act({ action: 'resume' })}>resume</button><button onClick={() => void act({ action: 'snapshot' })}>snapshot now</button></div>
      <div className="row"><span>clock rate ×</span><input style={{ width: 70, flex: 'none' }} value={rate} onChange={(e) => setRate(e.target.value)} /><button onClick={() => void act({ action: 'clock_rate', rate: Number(rate) })}>set</button><span className="dim">now ×{sim.conn.heartbeat?.clockRate ?? 1}</span></div>
      <div className="row"><span>brain</span><button onClick={() => void act({ action: 'brain_mode', mode: 'live' })}>live</button><button onClick={() => void act({ action: 'brain_mode', mode: 'fake' })}>fake</button><span>budget $/day</span><input style={{ width: 70, flex: 'none' }} value={budget} onChange={(e) => setBudget(e.target.value)} /><button onClick={() => void act({ action: 'budget', usdPerDay: Number(budget) })}>set</button></div>
      <div className="row"><span>narrate now:</span>{Object.keys(sim.conn.replica.regions).map((r) => <button key={r} onClick={() => void act({ action: 'narrate', region: r })}>{r}</button>)}</div>
      <h2 style={{ marginTop: 12 }}>Invites</h2>
      <div className="row"><span>new code, uses</span><input style={{ width: 60, flex: 'none' }} value={uses} onChange={(e) => setUses(e.target.value)} /><input placeholder="note (who is it for)" value={inote} onChange={(e) => setInote(e.target.value)} />
        <button onClick={async () => { await act({ action: 'invite', uses: Number(uses), ...(inote ? { note: inote } : {}) }); void loadInvites(); }}>create</button><button onClick={() => void loadInvites()}>list</button></div>
      {invites && <table><tbody>{(invites.invites ?? []).map((i: any) => <tr key={i.code}><td><b>{i.code}</b></td><td>{i.uses}/{i.max_uses} used</td><td className="dim">{i.note}</td></tr>)}{invites.invites.length === 0 && <tr><td className="dim">no codes yet{invites.required ? '' : ' (invites are not required on this server)'}</td></tr>}</tbody></table>}
      <div className="row"><button onClick={async () => setClients((await api('/v1/admin/clients')).data)}>list connected clients</button></div>
      {clients && <pre className="json">{JSON.stringify(clients, null, 2)}</pre>}
      <pre className="dim">{out}</pre>
    </section>
  );
}
