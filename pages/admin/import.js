// pages/admin/import.js
'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ImportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!file) {
      setMsg('Please choose a .xlsx or .csv file first.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('year', String(year));
      fd.append('month', String(month));
      fd.append('file', file);

      const resp = await fetch('/api/import-month', {
        method: 'POST',
        body: fd,
      });

      const ct = resp.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await resp.json() : { ok: false, error: await resp.text() };

      if (!resp.ok || data.ok === false) {
        throw new Error(data?.error || `Upload failed (HTTP ${resp.status})`);
      }

      setMsg(`Imported ${data.upserts} day(s). Go back to Admin to add more or refresh the dashboard.`);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 700, margin: '24px auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Admin · Import Report</h1>
        <Link href="/admin" className="text-sm underline">Back to Admin</Link>
      </header>

      <form onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label>Year</label>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label>Month (1–12)</label>
            <input
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="input"
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Report file (.xlsx or .csv)</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <button type="submit" disabled={busy} className="btn">
          {busy ? 'Uploading…' : 'Upload & Import'}
        </button>

        {msg && <p style={{ marginTop: 12, color: msg.startsWith('Error') ? '#dc2626' : '#16a34a' }}>{msg}</p>}
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 8px;
        }
        .btn {
          background: #2563eb;
          color: white;
          border: 0;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
        }
        .btn[disabled] { opacity: .6; cursor: default; }
      `}</style>
    </main>
  );
}
