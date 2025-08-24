// in /pages/api/overview/index.js (example sketch)
const rows = await prisma.dailyMetric.findMany({
  orderBy: { date: 'asc' },
});

const series = rows.map(r => ({
  date: r.date,              // ISO string
  revenue: r.revenue || 0,
  target:  r.target  || 0,
  occupancy: r.occupancy || 0,
  arr: r.arr || 0,
}));

res.status(200).json({
  ok: true,
  revenueToDate,
  occupancyRate,
  averageRoomRate,
  targetVariance,
  lastUpdated,
  series, // <-- add this
});

// pages/api/overview/index.js
export const config = { runtime: 'nodejs' }; // Prisma needs node runtime

import { PrismaClient } from '@prisma/client';

// Reuse a single Prisma instance across hot reloads in dev
let prisma = global.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const now = new Date();
    const from = startOfMonth(now);
    const to = endOfMonth(now);

    // Pull all this month’s entries
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    // Aggregate
    const revenueToDate = rows.reduce((sum, r) => sum + (r.revenue || 0), 0);

    const latest = rows[rows.length - 1] || null;

    // Field names assume your schema:
    // model DailyMetric {
    //   id       Int @id @default(autoincrement())
    //   date     DateTime @unique
    //   revenue  Int?
    //   target   Int?
    //   occupancy Float?
    //   arr      Int?      // Average Room Rate (R)
    //   notes    String?   @db.Text
    //   createdAt DateTime @default(now())
    //   updatedAt DateTime @updatedAt
    // }
    const occupancyRate    = latest?.occupancy ?? 0; // % (0–100)
    const averageRoomRate  = latest?.arr ?? 0;       // R
    const target           = latest?.target ?? 0;    // R
    const targetVariance   = target - revenueToDate; // R
    const lastUpdated      = latest?.date ?? null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      revenueToDate,
      occupancyRate,
      averageRoomRate,
      targetVariance,
      lastUpdated,
    });
  } catch (err) {
    const debug = req.query.debug ? String(req.query.debug) : '';
    console.error('GET /api/overview failed:', err);
    // If you call /api/overview?debug=1 you’ll see the error string to help debug
    return res.status(200).json({
      ok: false,
      error: debug ? String(err?.message || err) : 'FETCH_FAILED',
    });
  }
}
