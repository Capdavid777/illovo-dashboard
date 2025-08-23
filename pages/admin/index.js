import { withPageAuthRequired } from '@auth0/nextjs-auth0';
import { useEffect, useState } from 'react';

export const getServerSideProps = withPageAuthRequired();

export default function Admin() {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0,10),
    revenue:'', targetRevenue:'', occupancy:'', arr:'', notes:''
  });
  const [rows, setRows] = useState([]); const [saving,setSaving]=useState(false);
  const [loading,setLoading]=useState(true); const [err,setErr]=useState('');

  async function load(){ setLoading(true);
    const r = await fetch('/api/daily-metrics'); setRows(await r.json()); setLoading(false); }
  useEffect(()=>{ load(); },[]);
  const onChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e){ e.preventDefault(); setSaving(true); setErr('');
    const r = await fetch('/api/daily-metrics',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    if(!r.ok) setErr('Save failed'); setSaving(false); load(); }

  async function del(id){ if(!confirm('Delete this row?')) return;
    await fetch('/api/daily-metrics/'+id,{method:'DELETE'}); load(); }

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-4">Admin — Daily Updates</h1>
      <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-6 bg-white p-4 rounded-xl shadow border mb-8">
        <div className="md:col-span-2"><label className="block text-sm mb-1">Date</label>
          <input type="date" name="date" value={form.date} onChange={onChange} className="w-full border rounded p-2" required/>
        </div>
        <div><label className="block text-sm mb-1">Revenue (R)</label>
          <input type="number" name="revenue" value={form.revenue} onChange={onChange} className="w-full border rounded p-2" required/></div>
        <div><label className="block text-sm mb-1">Target (R)</label>
          <input type="number" name="targetRevenue" value={form.targetRevenue} onChange={onChange} className="w-full border rounded p-2" required/></div>
        <div><label className="block text-sm mb-1">Occupancy (%)</label>
          <input type="number" step="0.1" name="occupancy" value={form.occupancy} onChange={onChange} className="w-full border rounded p-2" required/></div>
        <div><label className="block text-sm mb-1">ARR (R)</label>
          <input type="number" name="arr" value={form.arr} onChange={onChange} className="w-full border rounded p-2" required/></div>
        <div className="md:col-span-6"><label className="block text-sm mb-1">Notes</label>
          <textarea name="notes" value={form.notes} onChange={onChange} className="w-full border rounded p-2" rows={2}/></div>
        <div className="md:col-span-6">
          <button className="px-4 py-2 rounded bg-black text-white" disabled={saving}>{saving?'Saving…':'Save / Upsert'}</button>
          {err && <span className="ml-3 text-red-600">{err}</span>}
        </div>
      </form>

      <section className="bg-white p-4 rounded-xl shadow border">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Recent Entries</h2>
          <button onClick={load} className="text-sm underline">Refresh</button>
        </div>
        {loading ? <p>Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left border-b">
                {['Date','Revenue','Target','Occupancy','ARR','Notes',''].map(h=> <th key={h} className="py-2 pr-4">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.id} className="border-b">
                    <td className="py-2 pr-4">{new Date(r.date).toISOString().slice(0,10)}</td>
                    <td className="py-2 pr-4">R {Number(r.revenue).toLocaleString()}</td>
                    <td className="py-2 pr-4">R {Number(r.targetRevenue).toLocaleString()}</td>
                    <td className="py-2 pr-4">{r.occupancy}%</td>
                    <td className="py-2 pr-4">R {Number(r.arr).toLocaleString()}</td>
                    <td className="py-2 pr-4">{r.notes||''}</td>
                    <td className="py-2 pr-4"><button className="text-red-600 underline" onClick={()=>del(r.id)}>Delete</button></td>
                  </tr>
                ))}
                {rows.length===0 && <tr><td className="py-4 italic" colSpan={7}>No data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
