// pages/api/month.js
// Merge your admin DB endpoints into one normalized month response.
// No external bucket / env vars required.
export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const NO_STORE = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

// --- small helpers ---
const pad2 = (n) => String(n).padStart(2, '0');
const fromKey = (key) => {
  const [y, m] = (key || '').split('-').map((x) => parseInt(x, 10));
  return new Date(isFinite(y) ? y : new Date().getFullYear(), isFinite(m) ? m - 1 : new Date().getMonth(), 1);
};
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
const isJson = (r) => (r.headers.get('content-type') || '').toLowerCase().includes('application/json');

// unify daily array from any shape
const pickDailyArray = (raw = {}) => {
  if (!raw || typeof raw !== 'object') return [];
  const c = [];
  for (const k of ['daily', 'items', 'rows', 'days', 'data', 'dailySeries']) if (Array.isArray(raw[k])) c.push(raw[k]);
  if (c.length) return c.sort((a, b) => b.length - a.length)[0];
  // look one level down
  for (const v of Object.values(raw)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
};

const mapRow = (row, i) => {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row).reduce((m, k) => (m[k.toLowerCase()] = k, m), {});
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
    revenue: num(get(['revenue','actual','totalrevenue','accommodationrevenue','rev'])),
    target:  num(get(['target','dailytarget','budget','goal','forecast'])),
    occupancy: num(get(['occupancy','occrate','occupancyrate'])),
    rate: num(get(['rate','arr','adr','averagerate','avgrate'])),
    met: get(['met','hittarget','mettarget']) === true,
  };
};

// filter rows to YYYY-MM & dedupe per day (keep the richest)
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
    } else {
      if (!(r.day >= 1 && r.day <= last)) continue;
    }
    const prev = perDay.get(r.day);
    if (!prev || score(r) >= score(prev)) perDay.set(r.day, r);
  }
  return Array.from(perDay.values()).sort((a, b) => a.day - b.day);
};

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

    // Fetch both endpoints in parallel (no env var needed)
    const [ovRes, dmRes] = await Promise.allSettled([
      fetch(`${origin}/api/overview?month=${month}&ts=${ts}`, { headers: { 'cache-control': 'no-store' } }),
      fetch(`${origin}/api/daily-metrics?month=${month}&ts=${ts}`, { headers: { 'cache-control': 'no-store' } }),
    ]);

    let overviewJson = null;
    let dailyJson = null;

    if (ovRes.status === 'fulfilled' && ovRes.value.ok && isJson(ovRes.value)) {
      const j = await ovRes.value.json();
      // Accept either { overview: {...} } or already-flat payload ({ ok, revenueToDate, ... })
      overviewJson = j?.overview && typeof j.overview === 'object' ? j.overview : j;
    }
    if (dmRes.status === 'fulfilled' && dmRes.value.ok && isJson(dmRes.value)) {
      dailyJson = await dmRes.value.json();
    }

    if (overviewJson || dailyJson) {
      const dailyRaw = pickDailyArray(dailyJson || overviewJson || {});
      const mapped = dailyRaw.map(mapRow).filter(Boolean);
      const daily = filterAndDedupe(mapped, month);

      // Totals from overview if present, otherwise derive from daily
      const deriveSum = (key) => daily.reduce((a, r) => a + num(r[key]), 0);
      const payload = {
        // accept fields if present on overviewJson
        revenueToDate: num(overviewJson?.revenueToDate, deriveSum('revenue')),
        targetToDate:  num(overviewJson?.targetToDate,  deriveSum('target')),
        averageRoomRate: num(overviewJson?.averageRoomRate, 0),
        occupancyRate: num(overviewJson?.occupancyRate, 0),
        targetVariance:
          num(overviewJson?.targetVariance,
              num(overviewJson?.targetToDate, deriveSum('target')) - num(overviewJson?.revenueToDate, deriveSum('revenue'))),
        lastUpdated: overviewJson?.lastUpdated || overviewJson?.updatedAt || new Date().toISOString(),
        roomTypes: Array.isArray(overviewJson?.roomTypes) ? overviewJson.roomTypes : [],
        history: Array.isArray(overviewJson?.history) ? overviewJson.history : [],
        daily, // normalized + filtered
      };

      res.setHeader('X-Month-Source', 'admin-db (merged)');
      return res.status(200).json(payload);
    }

    // Fallback: static file in /public/data/<month>.json
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const file = join(process.cwd(), 'public', 'data', `${month}.json`);
      const txt = await readFile(file, 'utf8');
      res.setHeader('X-Month-Source', 'static (/public/data)');
      return res.status(200).json(JSON.parse(txt));
    } catch {
      /* no static file */
    }

    return res.status(404).json({ error: `No data for ${month}`, tried: ['admin-db/overview', 'admin-db/daily', 'static'] });
  } catch (e) {
    return res.status(500).json({ error: 'month endpoint failed', detail: String(e) });
  }
}
