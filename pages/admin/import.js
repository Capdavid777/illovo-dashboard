'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function AdminImportPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');

    if (!file) {
      setMsg('Please choose a .xlsx or .csv file.');
      return;
    }

    const fd = new FormData();
    // IMPORTANT: key name must be 'file'
    fd.append('file', file);
    fd.append('year', String(year));
    fd.append('month', String(month));

    const r = await fetch('/api/import', { method: 'POST', body: fd });
    const j = await r.json();

    if (!r.ok || j.ok === false) {
      setMsg(`Error: ${j.error || 'UPLOAD_FAILED'}`);
      return;
    }
    setMsg(`Imported ${j.imported || 0} day(s). Go back to Admin to verify.`);
  };

  return (
    <main style={{ maxWidth: 720, margin: '32px auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>Admin · Import Report</h1>
        <Link href="/admin">Back to Admin</Link>
      </header>

      <form onSubmit={onSubmit}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <label>
            Year
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
          </label>
          <label>
            Month (1–12)
            <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(+e.target.value)} />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>
            Report file (.xlsx or .csv)
            {/* IMPORTANT: name="file" */}
            <input
              type="file"
              name="file"
              accept=".xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <button type="submit" style={{ marginTop: 12 }}>Upload &amp; Import</button>

        {msg && <p style={{ marginTop: 10, color: msg.startsWith('Error') ? '#ef4444' : '#10b981' }}>{msg}</p>}
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