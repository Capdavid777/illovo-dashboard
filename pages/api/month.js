// pages/api/month.js
// Node runtime so we can read /public files on fallback.
export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const noStore = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', noStore);

  try {
    const month = String(req.query.month || '').slice(0, 7); // e.g. 2025-08
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
      return;
    }

    const base = (process.env.ADMIN_DATA_BASE_URL || '').replace(/\/+$/, '');
    const apiBase = (process.env.ADMIN_API_BASE_URL || '').replace(/\/+$/, '');
    const ts = Date.now();

    // Try admin bucket first (where the admin portal should write monthly JSONs)
    const candidates = [];
    if (base) {
      candidates.push({ url: `${base}/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket' });
      // common alternative foldering
      candidates.push({ url: `${base}/data/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket (data/)' });
      candidates.push({ url: `${base}/months/${encodeURIComponent(month)}.json?ts=${ts}`, tag: 'admin-bucket (months/)' });
    }
    // Optional: admin DB endpoints (if you have them)
    if (apiBase) {
      candidates.push({ url: `${apiBase}/overview?month=${month}&ts=${ts}`, tag: 'admin-db/overview', jsonPath: 'overview' });
      candidates.push({ url: `${apiBase}/daily-metrics?month=${month}&ts=${ts}`, tag: 'admin-db/daily', jsonPath: 'daily' });
    }

    for (const c of candidates) {
      try {
        const r = await fetch(c.url, { headers: { 'cache-control': 'no-store' } });
        if (!r.ok) continue;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) continue;
        const j = await r.json();
        const payload = c.jsonPath ? (j?.[c.jsonPath] ?? j) : j;
        res.setHeader('X-Month-Source', c.tag);
        res.setHeader('Cache-Control', noStore);
        return res.status(200).json(payload);
      } catch {
        // try next candidate
      }
    }

    // Final fallback: static file in /public/data
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const file = join(process.cwd(), 'public', 'data', `${month}.json`);
      const txt = await readFile(file, 'utf8');
      res.setHeader('X-Month-Source', 'static (/public/data)');
      res.setHeader('Cache-Control', noStore);
      return res.status(200).json(JSON.parse(txt));
    } catch {
      // not found
    }

    res.status(404).json({ error: `No data for ${month}`, tried: candidates.map(c => c.tag) });
  } catch (e) {
    res.status(500).json({ error: 'month endpoint failed', detail: String(e) });
  }
}
