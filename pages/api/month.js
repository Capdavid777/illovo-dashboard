// pages/api/month.js
import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function readFromDb(monthKey) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        key TEXT PRIMARY KEY,
        content JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const { rows } = await client.query(
      'SELECT content FROM reports WHERE key = $1 LIMIT 1',
      [`${monthKey}.json`]
    );
    return rows[0]?.content || null;
  } finally {
    client.release();
  }
}

async function readFromPublic(monthKey) {
  try {
    const file = path.join(process.cwd(), 'public', 'data', `${monthKey}.json`);
    const buf = await fs.readFile(file);
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const month = String(req.query.month || '').trim();
  // support “YYYY-MM” or “YYYY-MM.json”
  const m = month.replace(/\.json$/i, '');
  if (!/^\d{4}-\d{2}$/.test(m)) {
    return res.status(400).json({ error: 'BAD_MONTH', message: 'Use ?month=YYYY-MM' });
  }

  try {
    const fromDb = await readFromDb(m);
    if (fromDb) return res.status(200).json(fromDb);

    const fromFile = await readFromPublic(m);
    if (fromFile) return res.status(200).json(fromFile);

    return res.status(404).json({ error: 'NOT_FOUND', month: m });
  } catch (e) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: String(e?.message || e) });
  }
}
