// pages/room-types/index.js
import useSWR from 'swr';
import { useMonthKey } from '../../lib/useMonthKey';

const fetcher = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());

export default function RoomTypesPage() {
  // either default or named will exist thanks to the barrel above
  const month = (useMonthKey || useMonthKeyNamed)();

  const { data, error } = useSWR(`/api/overview?month=${month}`, fetcher);
  if (error) return <div>Failed to load room types.</div>;
  if (!data) return <div>Loading…</div>;

  const roomTypes = Array.isArray(data.roomTypes) ? data.roomTypes : [];

  return (
    <div className="container" style={{ padding: 24 }}>
      <h1>Room Types — {month}</h1>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {roomTypes.map((rt) => (
          <div key={rt.type} style={{ border: '1px solid #eee', borderRadius: 12, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>{rt.type}</h3>
            <div>Available: {rt.available}</div>
            <div>Sold: {rt.sold}</div>
            <div>Revenue: R{Number(rt.revenue || 0).toLocaleString('en-ZA')}</div>
            <div>Rate: R{rt.rate}</div>
            <div>Occupancy: {rt.occupancy}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
