// pages/api/admin-bucket/put.js
import { Pool } from 'pg';

export const config = { api: { bodyParser: false } };

// Reuse a single pool across invocations
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon-friendly
    });
  }
  return pool;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS reports (
      key TEXT PRIMARY KEY,
      content JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // Simple bearer auth
  const expected = `Bearer ${process.env.ADMIN_BUCKET_TOKEN || ''}`;
  if (!process.env.ADMIN_BUCKET_TOKEN || (req.headers.authorization || '') !== expected) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const key = String(req.query.key || '').trim();
  if (!/^\d{4}-\d{2}\.json$/.test(key)) {
    return res.status(400).json({ error: 'BAD_KEY', message: 'Expected key like 2025-08.json' });
  }

  // collect raw body
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let json;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'BAD_JSON', message: String(e?.message || e) });
  }

  try {
    const db = getPool();
    const client = await db.connect();
    try {
      await ensureTable(client);
      await client.query(
        `INSERT INTO reports (key, content)
         VALUES ($1, $2)
         ON CONFLICT (key)
         DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
        [key, json]
      );
    } finally {
      client.release();
    }
    return res.status(200).json({ ok: true, key });
  } catch (e) {
    return res.status(500).json({ error: 'DB_ERROR', message: String(e?.message || e) });
  }
}
