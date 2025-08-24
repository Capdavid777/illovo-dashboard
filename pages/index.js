// pages/index.js
import { useEffect, useState } from 'react';

// very small helper to format as "R 12,345"
const money = (n) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n || 0);

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr('');
        const r = await fetch('/api/overview', { cache: 'no-store' }); // force fresh
        const j = await r.json();
        if (!cancelled) {
          if (!j.ok) throw new Error(j.error || 'FETCH_FAILED');
          setData(j);
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'ERROR');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ padding: 24 }}>
    <h2>Reserved Suites Illovo</h2>
    <p>Loading latest figures…</p>
  </div>;

  if (err) return <div style={{ padding: 24 }}>
    <h2>Reserved Suites Illovo</h2>
    <p style={{ color: 'crimson' }}>Failed to load: {err}</p>
  </div>;

  const t = data?.totals || {};
  // Safe fallbacks
  const revenueToDate   = Number(t.revenueToDate || 0);
  const targetToDate    = Number(t.targetToDate || 0);
  const averageRoomRate = Number(t.averageRoomRate || 0);
  const occupancyRate   = Number(t.occupancyRate || 0); // already percent (0–100)
  const targetVariance  = Number(t.targetVariance || 0);

  const Card = ({ title, value, sub }) => (
    <div style={{
      border: '1px solid #eee',
      borderRadius: 8,
      padding: 16,
      minWidth: 260,
      marginRight: 16,
      marginBottom: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
    }}>
      <div style={{ opacity: 0.75, fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      {sub ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{sub}</div> : null}
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 20 }}>Reserved Suites Illovo</h2>

      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <Card title="Revenue to Date"  value={money(revenueToDate)} />
        <Card title="Target to Date"   value={money(targetToDate)} />
        <Card title="Average Room Rate" value={money(averageRoomRate)} />
        <Card title="Occupancy Rate"   value={`${occupancyRate}%`} />
        <Card title="Target Variance"  value={money(targetVariance)} sub="Target − Revenue" />
      </div>

      {/* Keep your charts/tables below; they can read `data.items` (daily rows) */}
      {/* Example: console.log(data.items) */}
    </div>
  );
}
