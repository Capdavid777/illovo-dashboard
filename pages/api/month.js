// pages/api/month.js
// 1) Merge DB endpoints (/api/overview + /api/daily-metrics)
// 2) Static fallback in /public/data/{YYYY-MM}.json
// Completes missing month days using the most common daily target.

export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const NO_STORE = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

const isJson = (r) =>
  (r.headers.get('content-type') || '').toLowerCase().includes('application/json');

const fromKey = (key) => {
  const [y, m] = (key || '').split('-').map((x) => parseInt(x, 10));
  const now = new Date();
  const year = Number.isFinite(y) ? y : now.getFullYear();
  const month = Number.isFinite(m) ? m - 1 : now.getMonth();
  return new Date(year, month, 1, 0, 0, 0, 0); // local start of month
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

const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 1.5 ? n * 100 : n; // normalize 0..1 -> %
};

// locate daily array on common keys or one level down
const pickDailyArray = (raw = {}) => {
  if (!raw || typeof raw !== 'object') return [];
  const candidates = [];
  for (const k of ['daily', 'dailySeries', 'items', 'rows', 'days', 'data']) {
    if (Array.isArray(raw[k])) candidates.push(raw[k]);
  }
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
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
  const rawOcc = get(['occupancy', 'occrate', 'occupancyrate', 'occ%']);
  return {
    day,
    date,
    revenue: num(get(['revenue', 'actual', 'totalrevenue', 'accommodationrevenue', 'rev'])),
    target: num(get(['target', 'dailytarget', 'budget', 'goal', 'forecast'])),
    occupancy: pct(rawOcc),
    rate: num(get(['rate', 'arr', 'adr', 'averagerate', 'avgrate'])),
    met: get(['met', 'hittarget', 'mettarget']) === true,
  };
};

const filterAndDedupe = (rows, monthKey) => {
  const start = fromKey(monthKey);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const last = dim(monthKey);
  const score = (x) => (num(x.revenue) > 0 ? 2 : 0) + (num(x.target) > 0 ? 1 : 0);
  const perDay = new Map();
  for (const r of rows || []) {
    if (r.date) {
      const d = new Date(r.date);
      if (!(d >= start && d < end)) continue;
    } else if (!(r.day >= 1 && r.day <= last)) continue;
    const prev = perDay.get(r.day);
    if (!prev || score(r) >= score(prev)) perDay.set(r.day, r);
  }
  return Array.from(perDay.values()).sort((a, b) => a.day - b.day);
};

// choose the most-common non-zero target to use for missing days
const modeTarget = (rows) => {
  const counts = new Map();
  for (const r of rows) {
    const t = num(r.target, 0);
    if (t > 0) counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = 0,
    bestCnt = 0;
  for (const [t, c] of counts) if (c > bestCnt) (best = t), (bestCnt = c);
  return best || 0;
};

// ensure every day in month exists; synthesize missing days w/ target baseline
const completeMonthDaily = (rows, monthKey) => {
  const days = dim(monthKey);
  const baseTarget = modeTarget(rows);
  if (!baseTarget) return rows; // nothing we can infer
  const have = new Set(rows.map((r) => r.day));
  const start = fromKey(monthKey);
  for (let d = 1; d <= days; d++) {
    if (!have.has(d)) {
      rows.push({
        day: d,
        // ISO string at local midnight, represented as UTC Z (OK for charts/serialization)
        date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(d)}T00:00:00.000Z`,
        revenue: 0,
        target: baseTarget,
        occupancy: 0,
        rate: 0,
        met: false,
      });
    }
  }
  return rows.sort((a, b) => a.day - b.day);
};

function buildPayload(overviewJson, dailyJson, monthKey) {
  // normalize daily + restrict to the month
  const dailyRaw = pickDailyArray(dailyJson || overviewJson || {});
  const mapped = dailyRaw.map(mapRow).filter(Boolean);
  let daily = filterAndDedupe(mapped, monthKey);

  // fill missing days with the mode target so totals reflect the full month
  daily = completeMonthDaily(daily, monthKey);

  // derive totals from daily
  const sum = (k) => daily.reduce((a, r) => a + num(r[k]), 0);
  const revenueToDate = sum('revenue');
  const targetToDate = sum('target');

  // averages from days that actually have values
  const occVals = daily.map((d) => num(d.occupancy)).filter((n) => Number.isFinite(n) && n > 0);
  const rateVals = daily.map((d) => num(d.rate)).filter((n) => Number.isFinite(n) && n > 0);
  const occupancyRate = occVals.length ? occVals.reduce((a, b) => a + b, 0) / occVals.length : 0;
  const averageRoomRate = rateVals.length
    ? Math.round(rateVals.reduce((a, b) => a + b, 0) / rateVals.length)
    : 0;

  const targetVariance = (targetToDate || 0) - (revenueToDate || 0);

  return {
    revenueToDate,
    targetToDate,
    averageRoomRate,
    occupancyRate,
    targetVariance,
    lastUpdated: overviewJson?.lastUpdated || overviewJson?.updatedAt || new Date().toISOString(),
    roomTypes: Array.isArray(overviewJson?.roomTypes) ? overviewJson.roomTypes : [],
    history: Array.isArray(overviewJson?.history) ? overviewJson.history : [],
    daily,
  };
}

// small helper to fetch JSON with timeout & no-store
async function fetchJson(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-store' }, signal: ac.signal });
    if (!r.ok || !isJson(r)) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', NO_STORE);

  try {
    const month = String(req.query.month || '').slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
    }

    const origin = `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;
    const ts = Date.now();

    // Try DB endpoints
    const [overviewJson, dailyJson] = await Promise.all([
      fetchJson(`${origin}/api/overview?month=${month}&ts=${ts}`),
      fetchJson(`${origin}/api/daily-metrics?month=${month}&ts=${ts}`),
    ]);

    if (overviewJson || dailyJson) {
      const payload = buildPayload(overviewJson, dailyJson, month);
      res.setHeader('X-Month-Source', 'admin-db (merged)');
      return res.status(200).json(payload);
    }

    // Static fallback
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const file = join(process.cwd(), 'public', 'data', `${month}.json`);
      const txt = await readFile(file, 'utf8');
      res.setHeader('X-Month-Source', 'static (/public/data)');
      return res.status(200).json(JSON.parse(txt));
    } catch {
      // fall through
    }

    return res
      .status(404)
      .json({ error: `No data for ${month}`, tried: ['admin-db', 'static'] });
  } catch (e) {
    return res.status(500).json({ error: 'month endpoint failed', detail: String(e) });
  }
}
