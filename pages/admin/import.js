// pages/admin/import.js
import { withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import { useState } from 'react';
import Link from 'next/link';

function AdminImport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1); // 1..12
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!file) return;

    const form = new FormData();
    form.set('year', String(year));
    form.set('month', String(month));
    form.set('file', file);

    setBusy(true);
    setErr('');
    setResult(null);

    try {
      const res = await fetch('/api/admin/import-report', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
      // If you use ISR, you can optionally revalidate the home page:
      // await fetch('/api/revalidate?path=/');
    } catch (e) {
      setErr(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* top bar */}
      <div className="bg-gray-800 text-white px-4 py-2 flex justify-between">
        <div>Admin · Import Report</div>
        <Link href="/admin" className="underline">Back to Admin</Link>
      </div>

      <div className="max-w-2xl mx-auto mt-8 bg-white p-6 rounded-lg shadow">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex gap-4">
            <div>
              <label className="block text-sm mb-1">Year</label>
              <input type="number" className="border rounded px-3 py-2 w-32"
                     value={year} onChange={(e) => setYear(+e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm mb-1">Month (1–12)</label>
              <input type="number" className="border rounded px-3 py-2 w-32"
                     value={month} min={1} max={12} onChange={(e) => setMonth(+e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Report file (.xlsx or .csv)</label>
            <input type="file" accept=".xlsx,.csv"
                   onChange={(e) => setFile(e.target.files?.[0] || null)}
                   className="border rounded px-3 py-2 w-full" required />
          </div>

          <button type="submit"
                  disabled={busy || !file}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60">
            {busy ? 'Uploading…' : 'Upload & Import'}
          </button>
        </form>

        {err && <p className="mt-4 text-red-600">Error: {err}</p>}
        {result && (
          <div className="mt-4 text-sm">
            <div className="font-semibold">Import summary</div>
            <pre className="bg-gray-50 border rounded p-3 mt-1 overflow-auto">
{JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default withPageAuthRequired(AdminImport);
