// pages/api/month.js
export const config = { runtime: 'nodejs' }; // ensure Node runtime (ok on Vercel)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const month = String(req.query.month || '').trim(); // e.g. "2025-08"
  if (!month) return res.status(400).json({ error: 'month required' });

  // 1) Try the admin portal bucket/CDN
  const base = process.env.ADMIN_DATA_BASE_URL; // e.g. https://files.example.com/illovo
  if (base) {
    try {
      const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(month)}.json`;
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j === 'object' && !Array.isArray(j)) j.__source = 'admin';
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(j);
      }
    } catch (_) {}
  }

  // 2) Fallback to the built static file under /public/data
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers.host;
    const origin = `${proto}://${host}`;
    const url = `${origin}/data/${encodeURIComponent(month)}.json`;
    const r = await fetch(url, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j === 'object' && !Array.isArray(j)) j.__source = 'public';
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(j);
    }
  } catch (_) {}

  return res.status(404).json({ error: 'not found' });
}
