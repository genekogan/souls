import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';
import {isConnectionRefusal} from './connection-response.ts';
import {countPairing} from './visitor-counts.ts';
export function PairApprove({ api, code, souls, allowCreate, done }: { api: Api; code: string; souls: {id:string;name:string;hasToken?:boolean}[]; allowCreate: boolean; done(): void }) {
  const [info, setInfo] = useState<any>(null); const [err, setErr] = useState(''); const [soulId, setSoulId] = useState(''); const [ok, setOk] = useState(false); const [approving,setApproving]=useState(false); const approvingRef=useRef(false);
  useEffect(() => { void api(`/v1/pair/${encodeURIComponent(code)}`).then((r) => (r.status === 200 ? setInfo(r.data) : setErr(r.data.message ?? 'invalid'))); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="wide" style={{ borderColor: 'var(--accent)' }}>
      <h2>An agent is asking to steer one of your Souls</h2>
      {err ? <p className="warn">{err} <button onClick={done}>dismiss</button></p> : !info ? <p className="dim">checking…</p> : ok ? <p className="ok">Approval accepted. Your assistant must finish connecting; check its response. <button onClick={done}>close</button></p> : souls.length === 0 ? <p>{allowCreate ? 'Create a Soul first (below), then come back to this link.' : 'Create a Soul with your agent first, then return to this link.'}</p> : <>
        <p>An agent calling itself “{String(info.agent ?? 'unnamed').slice(0, 60)}” is asking for permission to see through and steer one of your Souls. <b>Approve only if you started this yourself, just now, with your own assistant</b>, and it showed you the code <b>{String(info.code ?? '')}</b>. Anyone can send a link like this one; the name above is whatever they chose to type.</p>
        <div className="row"><span>Soul:</span><select value={soulId} onChange={(e) => setSoulId(e.target.value)}><option value="">choose…</option>{souls.map((s) => <option key={s.id} value={s.id}>{s.name}{s.hasToken ? ' (has an agent now; it will be disconnected)' : ''}</option>)}</select>
          <button className="primary" disabled={!soulId||approving} onClick={async () => { if(approvingRef.current)return;approvingRef.current=true;setApproving(true);try{const r = await api('/v1/pair/approve', { code, soulId }); if (r.status === 200&&r.data?.ok===true) { setOk(true); countPairing('pair:'+code); } else setErr(isConnectionRefusal(r.status) ? 'Approval refused. Check that this request and Soul are still yours.' : 'Approval response unconfirmed. Check your assistant and current connection before trying again.');}finally{approvingRef.current=false;setApproving(false);} }}>approve</button><button onClick={done}>not now</button></div>
        <p className="dim">This replaces any agent already attached to that Soul. You can revoke it at any time.</p></>}
    </section>
  );
}
