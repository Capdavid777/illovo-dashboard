'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function AdminImportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setIsError(false);

    if (!file) {
      setMsg('Please choose a .xlsx or .csv file.');
      setIsError(true);
      return;
    }

    try {
      setIsBusy(true);
      const fd = new FormData();
      fd.append('file', file);                // IMPORTANT: must be 'file'
      fd.append('year', String(year));
      fd.append('month', String(month));

      const r = await fetch('/api/import', { method: 'POST', body: fd });
      const j = await r.json();

      if (!r.ok || j.ok === false) {
        setIsError(true);
        setMsg(`Error: ${j.error || 'UPLOAD_FAILED'}`);
        return;
      }

      setMsg(`Imported ${j.imported || 0} day(s). Go back to Admin to verify.`);
      setIsError(false);
    } catch (err) {
      console.error(err);
      setIsError(true);
      setMsg('Error: upload failed');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <h1>Admin · Import Report</h1>
        <Link href="/admin" className="link">Back to Admin</Link>
      </header>

      <section className="form">
        <form onSubmit={onSubmit}>
          <div className="row">
            <div>
              <label htmlFor="year">Year</label>
              <input
                id="year"
                type="number"
                value={year}
                onChange={(e) => setYear(+e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="month">Month (1–12)</label>
              <input
                id="month"
                type="number"
                min={1}
                max={12}
                value={month}
                onChange={(e) => setMonth(+e.target.value)}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="file">Report file (.xlsx or .csv)</label>
              <input
                id="file"
                name="file"                 // IMPORTANT: must be 'file'
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="actions">
            <button type="submit" disabled={isBusy}>
              {isBusy ? 'Uploading…' : 'Upload & Import'}
            </button>
            {msg && (
              <span className={isError ? 'error' : 'success'}>{msg}</span>
            )}
          </div>
        </form>
      </section>

      <Styles />
    </main>
  );
}

/** same styling block used by your Admin page */
function Styles() {
  return (
    <style jsx global>{`
      :root {
        --bg: #0b0c10;
        --card: #111317;
        --line: #1f2937;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --link: #93c5fd;
        --accent: #6366f1;
        --ok: #10b981;
        --err: #ef4444;
      }

      html, body {
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
          Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji',
          'Segoe UI Emoji';
      }

      main {
        max-width: 980px;
        margin: 40px auto;
        padding: 24px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--card);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      h1 {
        font-size: 22px;
        margin: 0;
      }

      .link {
        color: var(--link);
        text-decoration: underline;
      }

      .form { margin-top: 8px; }

      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .row > div {
        display: flex;
        flex-direction: column;
      }

      label {
        font-size: 13px;
        color: var(--muted);
        margin: 0 0 6px;
      }

      input[type='text'],
      input[type='number'],
      input[type='date'],
      input[type='file'],
      textarea {
        background: #0f1115;
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: 8px;
        padding: 10px 12px;
        outline: none;
      }

      .actions { margin-top: 12px; }

      button {
        background: var(--accent);
        color: #fff;
        border: 0;
        padding: 10px 14px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
      }
      button[disabled] { opacity: 0.75; cursor: default; }
      button:hover:not([disabled]) { filter: brightness(1.07); }

      .error { margin-left: 12px; color: var(--err); font-size: 13px; }
      .success { margin-left: 12px; color: var(--ok); font-size: 13px; }

      @media (max-width: 640px) {
        main { margin: 12px; padding: 16px; }
        .row { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
