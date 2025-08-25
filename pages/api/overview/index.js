// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

// Reuse Prisma during dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const startOfMonthUTC = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
const endOfTodayUTC = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

// normalize a value that might be 0.46 or 46 -> returns percent (e.g., 46.0)
const toPercent = (v, decimals = 1) => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const pct = n <= 1.5 ? n * 100 : n; // treat 0..1.5 as fractional
  return +pct.toFixed(decimals);
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // absolutely no cache
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const from = startOfMonthUTC();
    const to = endOfTodayUTC();

    // DAILY METRICS
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, revenue: true, target: true, occupancy: true, arr: true, createdAt: true, updatedAt: true },
    });

    let revenueSum = 0;
    let targetSum = 0;
    let arrSum = 0, arrCount = 0;
    const occVals = [];

    for (const r of rows) {
      const rev = toNum(r.revenue);
      const tgt = toNum(r.target);
      revenueSum += rev;
      targetSum += tgt;

      if (r.arr != null) { arrSum += toNum(r.arr); arrCount += 1; }

      if (r.occupancy != null) {
        occVals.push(toPercent(r.occupancy, 1)); // normalize each row to a percent
      }
    }

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const occupancyRate = occVals.length
      ? +(occVals.reduce((a, b) => a + b, 0) / occVals.length).toFixed(1)
      : 0;
    const targetVariance = targetSum - revenueSum;

    const latest = rows[rows.length - 1];
    const lastUpdated = latest ? (latest.updatedAt || latest.createdAt || latest.date) : null;

    const dailySeries = rows.map((r) => ({
      day: new Date(r.date).getUTCDate(),
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target: toNum(r.target),
      occupancy: toPercent(r.occupancy, 1),  // keep series in percent too
      rate: toNum(r.arr),
    }));

    // ROOM TYPES (optional; only if you have the table)
    // Model expected: RoomTypeMetric { id, date, type, rooms?, available?, sold?, revenue?, rate?, occupancy? }
    let roomTypes = [];
    try {
      const typeRows = await prisma.roomTypeMetric.findMany({
        where: { date: { gte: from, lte: to } },
        orderBy: [{ type: 'asc' }],
      });

      roomTypes = typeRows.map((t) => ({
        type: t.type,
        rooms: t.rooms ?? null,
        available: t.available ?? null,
        sold: t.sold ?? null,
        revenue: toNum(t.revenue),
        rate: toNum(t.rate),
        occupancy: toPercent(t.occupancy, 0), // display whole number on cards/bars
      }));
    } catch {
      // Table might not exist yet; that’s fine—dashboard will fall back.
      roomTypes = [];
    }

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      avgRoomRate: averageRoomRate,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated: lastUpdated instanceof Date ? lastUpdated.toISOString() : lastUpdated,
      dailySeries,
      items: rows,
      roomTypes,                    // <— Dashboard reads this
      totals: {
        revenueToDate: revenueSum,
        targetToDate: targetSum,
        averageRoomRate,
        occupancyRate,
        targetVariance,
      },
    });
  } catch (err) {
    console.error('GET /api/overview error:', err);
    return res.status(200).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
