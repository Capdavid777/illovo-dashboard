// pages/index.js
import React, { useEffect, useMemo, useState } from 'react';

/**
 * SSR: build a robust absolute base URL and fetch fresh data
 * - works on Vercel and locally
 * - no cache
 * - forwards cookies (useful if your API reads auth/session)
 * - never throws: returns props even on failure
 */
export async function getServerSideProps({ req }) {
  // Prefer an explicit env var if you set one in Vercel:
  // NEXT_PUBLIC_BASE_URL = https://illovo-dashboard.vercel.app
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host =
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    'localhost:3000';

  const base = explicit || `${proto}://${host}`;

  try {
    const res = await fetch(`${base}/api/overview`, {
      cache: 'no-store',
      headers: { cookie: req.headers.cookie || '' },
    });

    if (!res.ok) {
      throw new Error(`API /overview responded ${res.status}`);
    }

    const data = await res.json();

    return {
      props: {
        initialData: data,
        hadServerError: false,
        base,
      },
    };
  } catch (err) {
    console.error('getServerSideProps failed:', err);
    // Keep page alive; client will refetch
    return {
      props: {
        initialData: null,
        hadServerError: true,
        base,
      },
    };
  }
}

/**
 * Optional helper: format numbers nicely if you want to show
 * a minimal fallback while wiring your existing UI to `data`.
 */
function formatCurrencyZAR(n) {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      maximumFractionDigits: 0,
    }).format(Number(n || 0));
  } catch {
    return `R${Number(n || 0).toLocaleString('en-ZA')}`;
  }
}

/**
 * 🔧 Put your existing dashboard JSX here if you’d like to render
 * directly from the fresh `data` that SSR/CSR fetches.
 * If you’d rather keep your current UI logic, you can leave this
 * as-is—the page still works and auto-refreshes data.
 */
function renderExistingDashboard(data) {
  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Reserved Suites Illovo</h1>
        <p>Loading latest figures…</p>
      </div>
    );
  }

  // Example minimal readout (safe if you don’t want to wire your UI yet)
  const overview = data || {};
  return (
    <div style={{ padding: 24 }}>
      <h1>Reserved Suites Illovo</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, maxWidth: 1100 }}>
        <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Revenue to Date</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatCurrencyZAR(overview.revenueToDate)}</div>
        </div>
        <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Occupancy Rate</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {overview.occupancyRate != null ? `${overview.occupancyRate}%` : '—'}
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Average Room Rate</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatCurrencyZAR(overview.averageRoomRate)}</div>
        </div>
        <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Target Variance</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatCurrencyZAR(overview.targetVariance)}</div>
        </div>
      </div>

      {/* 🔽 If you want, render the rest of your existing JSX below using `overview` */}
      {/* Your existing charts/tables/cards… */}
    </div>
  );
}

/**
 * Page component
 * - Seeds state with SSR data
 * - If SSR failed, does a client fetch (no-cache) after mount
 * - You can keep your existing JSX; wire it to `data` if desired
 */
export default function DashboardPage({ initialData, hadServerError }) {
  const [data, setData] = useState(initialData);
  const [pending, setPending] = useState(false);

  // Client refresh (only if SSR failed OR you want to keep it always fresh)
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      // If SSR already provided data and you don’t need a live refresh,
      // skip this block (or keep it to always ensure fresh on each view).
      if (!hadServerError && initialData) return;

      setPending(true);
      try {
        const res = await fetch('/api/overview', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Client GET /api/overview ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setPending(false);
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [hadServerError, initialData]);

  // If you already have a big JSX tree below, you can
  // replace this return with your existing UI and read from `data`.
  return (
    <>
      {renderExistingDashboard(data)}
      {pending && (
        <div style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>
          Refreshing…
        </div>
      )}
    </>
  );
}
