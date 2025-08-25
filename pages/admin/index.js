'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

// ---------- helpers ----------

// format YYYY-MM-DD for <input type="date">
function isoDate(d = new Date()) {
  const tzOff = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOff * 60_000);
  return local.toISOString().slice(0, 10);
}

// show a readable date (local YYYY-MM-DD) from ISO/Date
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  const tzOff = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOff * 60_000);
  return local.toISOString().slice(0, 10);
}

// show occupancy as a percentage; handle old fractional rows (e.g. 0.57 -> 57%)
function fmtOcc(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const pct = n <= 1 ? n * 100 : n; // old fractional values vs percent values
  return `${Math.round(pct * 10) / 10}%`;
}

// format numbers with thousands separators
function fmtNum(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

export default function AdminPage() {
  const [date, setDate] = useState(isoDate());
  const [revenue, setRevenue] = useState('');
  const [target, setTarget] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [arr, setArr] = useState('');
  const [notes, setNotes] = useState('');

  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const r = await fetch('/api/daily-metrics');
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (err) {
      console.error(err);
      setItems([]);
      setError('Failed to load recent entries');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const payload = {
      date, // YYYY-MM-DD
      revenue: revenue === '' ? null : Number(revenue),
      target: target === '' ? null : Number(target),
      occupancy: occupancy === '' ? null : Number(occupancy), // expected as percent 0..100
      arr: arr === '' ? null : Number(arr),
      notes: notes || null,
    };

    try {
      const r = await fetch('/api/daily-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();

      if (!r.ok || j.ok === false) {
        throw new Error(j.error || 'Save failed');
      }

      // reload table and keep form values as-is (your choice)
      await load();
    } catch (err) {
      console.error(err);
      setError('Save failed');
    }
  };

  return (
    <main>
      <div className="toolbar">
        <h1>Admin — Daily Updates</h1>
        <Link href="/admin/import" className="upload-btn">
          Upload report
        </Link>
      </div>

      <section className="form">
        <form onSubmit={onSubmit}>
          <div className="row">
            <div>
              <label htmlFor="date">Date</label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="revenue">Revenue (R)</label>
              <input
                id="revenue"
                inputMode="numeric"
                type="number"
                placeholder="e.g. 250000"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="target">Target (R)</label>
              <input
                id="target"
                inputMode="numeric"
                type="number"
                placeholder="e.g. 300000"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="occupancy">Occupancy (%)</label>
              <input
                id="occupancy"
                inputMode="numeric"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="e.g. 75"
                value={occupancy}
                onChange={(e) => setOccupancy(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="arr">ARR (R)</label>
              <input
                id="arr"
                inputMode="numeric"
                type="number"
                placeholder="e.g. 1450"
                value={arr}
                onChange={(e) => setArr(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                placeholder="Anything worth noting today?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="actions">
            <button type="submit">Save / Upsert</button>
            {error && <span className="error">{error}</span>}
          </div>
        </form>
      </section>

      <section className="list">
        <header>
          <h2>Recent Entries</h2>
          <a href="#" onClick={(e) => { e.preventDefault(); load(); }}>
            Refresh
          </a>
        </header>

        {items.length === 0 ? (
          <p>No data yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Revenue</th>
                <th>Target</th>
                <th>Occupancy</th>
                <th>ARR</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id ?? row.date}>
                  <td>{fmtDate(row.date)}</td>
                  <td>{fmtNum(row.revenue)}</td>
                  <td>{fmtNum(row.target)}</td>
                  <td>{fmtOcc(row.occupancy)}</td>
                  <td>{fmtNum(row.arr)}</td>
                  <td>{row.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Styles />
    </main>
  );
}

/** styling (CSS-in-JS) */
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

      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .upload-btn {
        background: transparent;
        color: var(--link);
        text-decoration: underline;
        font-size: 14px;
      }

      h1 {
        font-size: 22px;
        margin: 0 0 16px;
      }

      .form { margin-top: 8px; }

      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .row > div { display: flex; flex-direction: column; }

      label {
        font-size: 13px;
        color: var(--muted);
        margin: 0 0 6px;
      }

      input[type='text'],
      input[type='number'],
      input[type='date'],
      textarea {
        background: #0f1115;
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: 8px;
        padding: 10px 12px;
        outline: none;
      }

      textarea { min-height: 90px; resize: vertical; }

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
      button:hover { filter: brightness(1.07); }

      .error { margin-left: 12px; color: #f87171; font-size: 13px; }

      .list {
        margin-top: 28px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--card);
      }

      .list header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .list a { color: var(--link); text-decoration: underline; font-size: 14px; }

      table { width: 100%; border-collapse: collapse; }
      th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }

      @media (max-width: 640px) {
        main { margin: 12px; padding: 16px; }
        .row { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
