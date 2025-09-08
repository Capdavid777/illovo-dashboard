// pages/api/month.js
export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

const NO_STORE = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
const isJson = (r) => (r.headers.get('content-type') || '').toLowerCase().includes('application/json');
const safeJson = async (res) => (res && res.ok ? await res.json().catch(() => null) : null);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', NO_STORE);

  const month = String(req.query.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
  }

  const origin = `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;
  const base = origin.replace(/\/$/, '');

  try {
    const [ovRes, dmRes] = await Promise.all([
      fetch(`${base}/api/overview?month=${month}`, { cache: 'no-store' }),
      fetch(`${base}/api/daily-metrics?month=${month}`, { cache: 'no-store' }),
    ]);
    const [ov, dm] = await Promise.all([safeJson(ovRes), safeJson(dmRes)]);

    const overview = ov && (ov.overview || ov) || {};
    const top = overview.top || overview || {};
    const daily =
      Array.isArray(dm?.daily) ? dm.daily :
      Array.isArray(overview?.daily) ? overview.daily :
      Array.isArray(dm?.items) ? dm.items :
      Array.isArray(dm?.rows) ? dm.rows :
      [];

    return res.status(200).json({ top, daily, overview, month });
  } catch (e) {
    return res.status(500).json({ error: 'MONTH_ENDPOINT_FAILED', detail: String(e) });
  }
}
