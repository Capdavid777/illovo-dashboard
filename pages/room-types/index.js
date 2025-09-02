import useSWR from 'swr';
import { useMonthKey } from '../../lib/useMonthKey';

const fetcher = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());

export default function RoomTypesPage() {
  const month = useMonthKey();
  const { data, error } = useSWR(`/api/overview?month=${month}`, fetcher);

  if (error) return <div>Failed to load room types.</div>;
  if (!data) return <div>Loading…</div>;

  const roomTypes = Array.isArray(data.roomTypes) ? data.roomTypes : [];

  return (
    <div className="container">
      <h1>Room Types — {month}</h1>
      <div className="grid">
        {roomTypes.map((rt) => (
          <div key={rt.type} className="card">
            <h3>{rt.type}</h3>
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
