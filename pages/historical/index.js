import useSWR from 'swr';
import { useMonthKey } from '../../lib/useMonthKey';

const fetcher = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());

export default function HistoricalPage() {
  const month = useMonthKey();
  const { data, error } = useSWR(`/api/overview?month=${month}`, fetcher);

  if (error) return <div>Failed to load history.</div>;
  if (!data) return <div>Loading…</div>;

  const history = Array.isArray(data.history) ? data.history : [];

  return (
    <div className="container">
      <h1>Historical — {month}</h1>
      <table>
        <thead>
          <tr>
            <th>Year</th><th>Rooms Sold</th><th>Occupancy %</th><th>Revenue</th><th>Rate</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.year}>
              <td>{h.year}</td>
              <td>{Number(h.roomsSold || 0).toLocaleString('en-ZA')}</td>
              <td>{h.occupancy}</td>
              <td>R{Number(h.revenue || 0).toLocaleString('en-ZA')}</td>
              <td>R{h.rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
