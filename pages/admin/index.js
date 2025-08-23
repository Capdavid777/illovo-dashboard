import { useEffect, useState } from 'react';

export async function getServerSideProps() {
  // prevent static pre-render at build
  return { props: {} };
}

export default function AdminPage() {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    revenue: '',
    target: '',
    occupancy: '',
    arr: '',
    notes: '',
  });

  const load = async () => {
    setError('');
    try {
      const r = await fetch('/api/daily-metrics');
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch {
      setItems([]);
      setError('Could not load recent entries.');
    }
  };

  useEffect(() => { load(); }, []);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/daily-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          revenue: Number(form.revenue) || null,
          target: Number(form.target) || null,
          occupancy: Number(form.occupancy) || null,
          arr: Number(form.arr) || null,
          notes: form.notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Save failed');
      await load();
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Admin — Daily Updates</h1>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 680 }}>
        <label>Date <input type="date" name="date" value={form.date} onChange={onChange} required /></label>
        <label>Revenue (R) <input name="revenue" value={form.revenue} onChange={onChange} /></label>
        <label>Target (R) <input name="target" value={form.target} onChange={onChange} /></label>
        <label>Occupancy (%) <input name="occupancy" value={form.occupancy} onChange={onChange} /></label>
        <label>ARR (R) <input name="arr" value={form.arr} onChange={onChange} /></label>
        <label>Notes <textarea name="notes" value={form.notes} onChange={onChange} /></label>
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save / Upsert'}</button>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
      </form>

      <section style={{ marginTop: 28 }}>
        <h2>Recent Entries</h2>
        <button onClick={load} style={{ marginBottom: 8 }}>Refresh</button>
        {items.length === 0 ? (
          <div>No data yet.</div>
        ) : (
          <table cellPadding="8" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Date</th>
                <th align="right">Revenue</th>
                <th align="right">Target</th>
                <th align="right">Occ %</th>
                <th align="right">ARR</th>
                <th align="left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id ?? it.date}>
                  <td>{String(it.date).slice(0, 10)}</td>
                  <td align="right">{it.revenue ?? ''}</td>
                  <td align="right">{it.target ?? ''}</td>
                  <td align="right">{it.occupancy ?? ''}</td>
                  <td align="right">{it.arr ?? ''}</td>
                  <td>{it.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
