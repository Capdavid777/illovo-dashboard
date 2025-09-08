// pages/api/admin-bucket/put.js
import { put } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const expected = `Bearer ${process.env.ADMIN_BUCKET_TOKEN || ''}`;
  if (!process.env.ADMIN_BUCKET_TOKEN || (req.headers.authorization || '') !== expected) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Missing key' });

  // read raw request body
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const { url } = await put(`illovo/${key}`, body, {
    access: 'public',
    contentType: 'application/json',
  });

  return res.status(200).json({ ok: true, url });
}
