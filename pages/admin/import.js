// pages/admin/import.js
import { useState } from 'react';
import Link from 'next/link';

export default function AdminImportPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1..12
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [debug, setDebug] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setOkMsg('');
    setErrMsg('');
    setDebug(null);

    try {
      if (!file) throw new Error('Please choose a file');

      // Send RAW BINARY to the API (no multipart parser headaches)
      const buf = await file.arrayBuffer();
      const res = await fetch(
        `/api/import?year=${encodeURIComponent(year)}&month=${encodeURIComponent(
          month
        )}&filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: buf,
        }
      );

      let data = {};
      try { data = await res.json(); } catch {}

      setDebug(data);
      if (!res.ok) {
        setErrMsg(data?.reason || data?.error || `Upload failed (HTTP ${res.status})`);
      } else {
        setOkMsg(`Imported ${data.rows} rows into ${data.key}${data.note ? ` · ${data.note}` : ''}`);
      }
    } catch (err) {
      setErrMsg(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin · Import Report</h1>
        <Link href="/admin" className="text-blue-500 hover:underline">Back to Admin</Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm text-gray-500">Year</span>
            <input
              type="number"
              min={2000}
              max={2100}
              required
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 w-full rounded border border-gray-300 bg-white/5 p-2"
            />
          </label>

          <label className="block">
            <span className="block text-sm text-gray-500">Month (1–12)</span>
            <input
              type="number"
              min={1}
              max={12}
              required
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 w-full rounded border border-gray-300 bg-white/5 p-2"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-sm text-gray-500">Report file (.xlsx / .xls / .csv)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-1 block w-full text-sm"
            required
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {busy ? 'Uploading…' : 'Upload & Import'}
          </button>
          {okMsg && <span className="text-green-600 text-sm">{okMsg}</span>}
          {errMsg && <span className="text-red-600 text-sm">Error: {errMsg}</span>}
        </div>
      </form>

      {debug && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-gray-500">Response details</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs">
            {JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      )}

      <div className="text-xs text-gray-500">
        <p><b>Template expectations</b> (sheet names are case-insensitive):</p>
        <ul className="list-disc ml-5">
          <li><code>Overview</code> – revenueToDate, targetToDate, averageRoomRate/ARR/ADR, occupancy</li>
          <li><code>Daily</code> – day/date, revenue/actual, target/budget, rate/arr/adr, occupancy/occ</li>
          <li><code>RoomTypes</code> – type, available, sold, revenue, rate/arr/adr, occupancy</li>
          <li><code>History</code> – year, roomsSold, occupancy, revenue, rate</li>
        </ul>
      </div>
    </div>
  );
}
