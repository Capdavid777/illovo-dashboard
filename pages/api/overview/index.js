// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

// Prisma on Vercel -> Node runtime
export const config = { runtime: 'nodejs' };

// Reuse Prisma across hot reloads in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfToday   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

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
    const from = startOfMonth();
    const to   = endOfToday();

    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, revenue: true, target: true, occupancy: true, arr: true, createdAt: true, updatedAt: true },
    });

    if (!rows.length) {
      return res.status(200).json({
        ok: true,
        // top-level fields the Dashboard reads
        revenueToDate: 0,
        targetToDate: 0,
        avgRoomRate: 0,
        averageRoomRate: 0,
        occupancyRate: 0,
        targetVariance: 0,
        lastUpdated: null,
        // series for charts
        dailySeries: [],
        items: [],
      });
    }

    let revenueSum = 0;
    let targetSum  = 0;
    let arrSum = 0, arrCount = 0;
    let occSum = 0, occCount = 0;

    for (const r of rows) {
      revenueSum += toNum(r.revenue);
      targetSum  += toNum(r.target);
      if (r.arr != null)       { arrSum += toNum(r.arr);           arrCount++; }
      if (r.occupancy != null) { occSum += toNum(r.occupancy);     occCount++; }
    }

    // If your DB stores occupancy as 0..1, set OCC_AS_FRACTION=1 in Vercel env
    const occAvgRaw    = occCount ? (occSum / occCount) : 0;
    const occupancyRate = Number(process.env.OCC_AS_FRACTION)
      ? +((occAvgRaw * 100)).toFixed(1)
      : +(occAvgRaw).toFixed(1);

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const targetVariance  = targetSum - revenueSum;

    const latest = rows[rows.length - 1];
    const lastUpdated = (latest.updatedAt || latest.createdAt || latest.date);
    const dailySeries = rows.map(r => ({
      day: new Date(r.date).getDate(),
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target:  toNum(r.target),
      occupancy: toNum(r.occupancy),
      rate: toNum(r.arr),
    }));

    // Return BOTH top-level keys and a nested "totals" (for any older code)
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
    // do not crash the page; return a safe object
    return res.status(200).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
