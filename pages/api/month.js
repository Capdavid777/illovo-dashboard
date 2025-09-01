// pages/api/month.js
export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const NO_STORE = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', NO_STORE);

  try {
    const month = String(req.query.month || '').slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
    }

    const ts = Date.now();
    const origin = `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;

    // 1) Optional: admin bucket if you ever add one later
    const base = (process.env.ADMIN_DATA_BASE_URL || '').replace(/\/+$/, '');
    const candidates = [];
    if (base) {
      candidates.push({ url: `${base}/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket' });
      candidates.push({ url: `${base}/data/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket (data/)' });
      candidates.push({ url: `${base}/months/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket (months/)' });
    }

    // 2) Always try your own API (no env var required)
    candidates.push({ url: `${origin}/api/overview?month=${month}&ts=${ts}`, tag: 'admin-db/overview', jsonPath: 'overview' });
    candidates.push({ url: `${origin}/api/daily-metrics?month=${month}&ts=${ts}`, tag: 'admin-db/daily', jsonPath: 'daily' });

    // Try each candidate
    for (const c of candidates) {
      try {
        const r = await fetch(c.url, { headers: { 'cache-control': 'no-store' } });
        if (!r.ok) continue;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) continue;
        const j = await r.json();
        const payload = c.jsonPath ? (j?.[c.jsonPath] ?? j) : j;
        res.setHeader('X-Month-Source', c.tag);
        res.setHeader('Cache-Control', NO_STORE);
        return res.status(200).json(payload);
      } catch { /* next */ }
    }

    // 3) Fallback to static file in /public/data
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const file = join(process.cwd(), 'public', 'data', `${month}.json`);
      const txt = await readFile(file, 'utf8');
      res.setHeader('X-Month-Source', 'static (/public/data)');
      res.setHeader('Cache-Control', NO_STORE);
      return res.status(200).json(JSON.parse(txt));
    } catch { /* not found */ }

    return res.status(404).json({ error: `No data for ${month}`, tried: candidates.map(c => c.tag) });
  } catch (e) {
    return res.status(500).json({ error: 'month endpoint failed', detail: String(e) });
  }
}
