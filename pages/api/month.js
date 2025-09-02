// pages/api/month.js
// Unified month endpoint with source priority:
// 1) /api/import-month (spreadsheet upload)  ✅ preferred
// 2) /api/overview + /api/daily-metrics (DB merge)
// 3) /public/data/<month>.json              (static fallback)
//
// It also completes ONLY truly missing calendar days using the
// most-common daily target, and de-duplicates so there is exactly
// one row per day in the selected month.

export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const NO_STORE =
  'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

const isJson = (r) =>
  (r.headers.get('content-type') || '').toLowerCase().includes('application/json');

const fromKey = (key) => {
  const [y, m] = (key || '').split('-').map((x) => parseInt(x, 10));
  return new Date(
    Number.isFinite(y) ? y : new Date().getFullYear(),
    Number.isFinite(m) ? m - 1 : new Date().getMonth(),
    1
  );
};
const pad2 = (n) => String(n).padStart(2, '0');
const dim = (key) => {
  const d = fromKey(key);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};
const num = (v, d = 0) => {
  if (v == null) return d;
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.-]+/g, '');
    if (!cleaned) return d;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : d;
  }
  return d;
};

// Try to find an array of daily rows on common keys or one level down
const pickDailyArray = (raw = {}) => {
  if (!raw || typeof raw !== 'object') return [];
  const c = [];
  for (const k of ['daily', 'dailySeries', 'items', 'rows', 'days', 'data']) {
    if (Array.isArray(raw[k])) c.push(raw[k]);
  }
  if (c.length) return c.sort((a, b) => b.length - a.length)[0];
  // one level down as a fallback
  for (const v of Object.values(raw)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  return [];
};

const mapRow = (row, i) => {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row).reduce((m, k) => ((m[k.toLowerCase()] = k), m), {});
  const get = (names) => {
    for (const n of names) if (keys[n.toLowerCase()]) return row[keys[n.toLowerCase()]];
    for (const n of names) {
      const hit = Object.keys(keys).find((k) => k.includes(n.toLowerCase()));
      if (hit) return row[keys[hit]];
    }
    return undefined;
  };
  const date = get(['date', 'dt', 'daydate']);
  const dayVal = num(get(['day', 'd']), NaN);
  const day = Number.isFinite(dayVal) ? dayVal : (date ? new Date(date).getDate() : i + 1);
  return {
    day,
    date,
    revenue:   num(get(['revenue', 'actual', 'totalrevenue', 'accommodationrevenue', 'rev'])),
    target:    num(get(['target', 'dailytarget', 'budget', 'goal', 'forecast'])),
    occupancy: num(get(['occupancy', 'occrate', 'occupancyrate', 'occ%'])),
    rate:      num(get(['rate', 'arr', 'adr', 'averagerate', 'avgrate'])),
    met:       get(['met','hittarget','mettarget']) === true,
  };
};

const filterAndDedupeToMonth = (rows, monthKey) => {
  const start = fromKey(monthKey);
  const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const last  = dim(monthKey);

  // First, keep only rows inside the target month
  const inMonth = [];
  for (const r of rows || []) {
    if (r.date) {
      const d = new Date(r.date);
      if (d >= start && d < end) inMonth.push(r);
    } else if (r.day >= 1 && r.day <= last) {
      inMonth.push(r);
    }
  }

  // Then, dedupe by picking the best record per day:
  // prefer higher revenue; if tied, prefer higher target.
  const byDay = new Map();
  const better = (a, b) => {
    const ra = num(a.revenue), rb = num(b.revenue);
    if (rb > ra) return b;
    if (rb < ra) return a;
    const ta = num(a.target), tb = num(b.target);
    return tb >= ta ? b : a;
  };
  for (const r of inMonth) {
    const prev = byDay.get(r.day);
    byDay.set(r.day, prev ? better(prev, r) : r);
  }

  return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
};

// Choose the most-common non-zero target to use for filling gaps
const modeTarget = (rows) => {
  const counts = new Map();
  for (const r of rows) {
    const t = num(r.target, 0);
    if (t > 0) counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = 0, bestCnt = 0;
  for (const [t, c] of counts) {
    if (c > bestCnt) { best = t; bestCnt = c; }
  }
  return best || 0;
};

// Ensure exactly one entry per day in the month: add only truly missing days
const completeMonthDaily = (rows, monthKey) => {
  const days = dim(monthKey);
  const baseTarget = modeTarget(rows);
  if (!baseTarget) return rows; // can't infer anything meaningful

  const start = fromKey(monthKey);
  const have = new Set(rows.map(r => r.day));

  // Add placeholders only where completely missing
  for (let d = 1; d <= days; d++) {
    if (!have.has(d)) {
      rows.push({
        day: d,
        date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(d)}T00:00:00.000Z`,
        revenue: 0,
        target: baseTarget,
        occupancy: 0,
        rate: 0,
        met: false,
      });
    }
  }

  // Final pass: ensure exactly one row per day (prefer rows with revenue)
  const byDay = new Map();
  const better = (a, b) => {
    const ra = num(a.revenue), rb = num(b.revenue);
    if (rb > ra) return b;
    if (rb < ra) return a;
    const ta = num(a.target), tb = num(b.target);
    return tb >= ta ? b : a;
  };
  for (const r of rows) {
    const prev = byDay.get(r.day);
    byDay.set(r.day, prev ? better(prev, r) : r);
  }

  return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
};

function buildPayload(overviewJson, dailyJson, monthKey) {
  // Normalize daily & restrict to month, then fill gaps
  const dailyRaw = pickDailyArray(dailyJson || overviewJson || {});
  const mapped   = dailyRaw.map(mapRow).filter(Boolean);
  let daily      = filterAndDedupeToMonth(mapped, monthKey);
  daily          = completeMonthDaily(daily, monthKey);

  // Derive totals from the (now complete) daily series
  const sum = (k) => daily.reduce((a, r) => a + num(r[k]), 0);
  const revenueToDate = sum('revenue');
  const targetToDate  = sum('target');

  // Averages only from days with values
  const occVals  = daily.map(d => num(d.occupancy)).filter(n => Number.isFinite(n) && n > 0);
  const rateVals = daily.map(d => num(d.rate)).filter(n => Number.isFinite(n) && n > 0);
  const occupancyRate   = occVals.length ? (occVals.reduce((a,b)=>a+b,0) / occVals.length) : 0;
  const averageRoomRate = rateVals.length ? Math.round(rateVals.reduce((a,b)=>a+b,0) / rateVals.length) : 0;

  const targetVariance = (targetToDate || 0) - (revenueToDate || 0);

  return {
    revenueToDate,
    targetToDate,
    averageRoomRate,
    occupancyRate,
    targetVariance,
    lastUpdated:
      overviewJson?.lastUpdated || overviewJson?.updatedAt || new Date().toISOString(),
    roomTypes: Array.isArray(overviewJson?.roomTypes) ? overviewJson.roomTypes : [],
    history:   Array.isArray(overviewJson?.history)   ? overviewJson.history   : [],
    daily,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', NO_STORE);

  try {
    const month = String(req.query.month || '').slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
    }

    const origin = `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;
    const ts = Date.now();

    // 1) Prefer spreadsheet /api/import-month
    try {
      const r = await fetch(`${origin}/api/import-month?month=${month}&ts=${ts}`, {
        headers: { 'cache-control': 'no-store' },
      });
      if (r.ok && isJson(r)) {
        const j = await r.json();
        const payload = buildPayload(j?.overview ? j.overview : j, j, month);
        res.setHeader('X-Month-Source', 'import-month');
        return res.status(200).json(payload);
      }
    } catch { /* fall through */ }

    // 2) Merge DB endpoints
    let overviewJson = null, dailyJson = null;
    const [ovRes, dmRes] = await Promise.allSettled([
      fetch(`${origin}/api/overview?month=${month}&ts=${ts}`, { headers: { 'cache-control': 'no-store' } }),
      fetch(`${origin}/api/daily-metrics?month=${month}&ts=${ts}`, { headers: { 'cache-control': 'no-store' } }),
    ]);
    if (ovRes.status === 'fulfilled' && ovRes.value.ok && isJson(ovRes.value)) {
      const j = await ovRes.value.json();
      overviewJson = j?.overview && typeof j.overview === 'object' ? j.overview : j;
    }
    if (dmRes.status === 'fulfilled' && dmRes.value.ok && isJson(dmRes.value)) {
      dailyJson = await dmRes.value.json();
    }
    if (overviewJson || dailyJson) {
      const payload = buildPayload(overviewJson, dailyJson, month);
      res.setHeader('X-Month-Source', 'admin-db (merged)');
      return res.status(200).json(payload);
    }

    // 3) Static fallback
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const file = join(process.cwd(), 'public', 'data', `${month}.json`);
      const txt  = await readFile(file, 'utf8');
      res.setHeader('X-Month-Source', 'static (/public/data)');
      return res.status(200).json(JSON.parse(txt));
    } catch {}

    return res.status(404).json({ error: `No data for ${month}`, tried: ['import-month', 'admin-db', 'static'] });
  } catch (e) {
    return res.status(500).json({ error: 'month endpoint failed', detail: String(e) });
  }
}
