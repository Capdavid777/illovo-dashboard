// pages/api/rs/index.js
export default function handler(req, res) {
  res.status(200).json({ ok: true, t: req.query.t || 'none' });
}
