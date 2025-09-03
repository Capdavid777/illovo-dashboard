// pages/api/rs/index.js
export const config = { runtime: 'nodejs' };

const ALLOWED_T = new Set(['summary', 'detail', 'rooms', 'month']); // adjust if needed

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const API = process.env.RS_API; // e.g. https://your-upstream.example/api
  if (!API) return res.status(500).json({ ok: false, error: 'RS_API env var not set' });

  const t = String(req.query.t ?? 'summary');
  const month = req.query.month ? String(req.query.month) : '';

  // Optional: basic validation
  if (t && !ALLOWED_T.has(t)) {
    return res.status(400).json({ ok: false, error: 'INVALID_T' });
  }
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'INVALID_MONTH' });
  }

  // Build upstream URL
  let upstream;
  try {
    upstream = new URL(API);
  } catch {
    return res.status(500).json({ ok: false, error: 'RS_API is not a valid URL' });
  }
  upstream.searchParams.set('t', t);
  if (month) upstream.searchParams.set('month', month);

  // Optional: timeout guard
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 15_000);

  try {
    const r = await fetch(upstream.toString(), {
      cache: 'no-store',
      signal: ac.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res
        .status(502)
        .json({ ok: false, error: `Upstream ${r.status} ${r.statusText}`, body: text.slice(0, 500) });
    }

    const data = await r.json().catch(() => ({}));

    // No caching; allow simple cross-origin GET usage
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json(data);
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : (err?.message || String(err));
    return res.status(502).json({ ok: false, error: msg });
  } finally {
    clearTimeout(timeout);
  }
}
