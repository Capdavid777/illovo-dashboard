// pages/api/rs.js
export default function handler(req, res) {
  res.status(200).json({ ok: true, t: req.query.t || 'none' });
}
