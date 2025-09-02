// pages/api/rs/index.js
 feat/api-updates
export default function handler(req, res) {
  res.status(200).json({ ok: true, t: req.query.t || 'none' });

export default async function handler(req, res) {
  const API = process.env.RS_API; // set in .env.local and on Vercel
  if (!API) return res.status(500).json({ error: 'RS_API env var not set' });

  const t = (req.query.t || 'summary').toString();
  const month = (req.query.month || '').toString();

  const url = new URL(API);
  url.searchParams.set('t', t);
  if (month) url.searchParams.set('month', month);

  try {
    const r = await fetch(url.toString(), { cache: 'no-store' });
    if (!r.ok) throw new Error(`Upstream ${r.status} ${r.statusText}`);
    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
 main
}
