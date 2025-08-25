// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

// Reuse Prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Convert 0..1 to 0..100, pass through >=1 as already-percent
const toPercent = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
};

const startOfMonth = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfToday = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // never cache this response
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const from = startOfMonth();
    const to = endOfToday();

    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        revenue: true,
        target: true,
        occupancy: true, // stored as 0..1 (fraction) or 0..100 (percent)
        arr: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!rows.length) {
      return res.status(200).json({
        ok: true,
        revenueToDate: 0,
        targetToDate: 0,
        avgRoomRate: 0,
        averageRoomRate: 0,
        occupancyRate: 0,       // percent
        targetVariance: 0,
        lastUpdated: null,
        dailySeries: [],
        items: [],
        totals: {
          revenueToDate: 0,
          targetToDate: 0,
          averageRoomRate: 0,
          occupancyRate: 0,
          targetVariance: 0,
        },
      });
    }

    let revenueSum = 0;
    let targetSum = 0;

    // ARR and occupancy are averaged (ARR simple mean; occupancy mean then converted to %)
    let arrSum = 0, arrCount = 0;
    const occVals = []; // collect to average

    for (const r of rows) {
      revenueSum += toNum(r.revenue);
      targetSum  += toNum(r.target);

      if (r.arr != null) { arrSum += toNum(r.arr); arrCount++; }
      if (r.occupancy != null) { occVals.push(toNum(r.occupancy)); }
    }

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;

    // Average in the **stored units**, then convert to percent for output
    const occAvgRaw = occVals.length
      ? occVals.reduce((a, b) => a + b, 0) / occVals.length
      : 0;
    const occupancyRate = +toPercent(occAvgRaw).toFixed(1); // always a percent (e.g. 46.2)

    const targetVariance = targetSum - revenueSum;

    const latest = rows[rows.length - 1];
    const lastUpdated = (latest.updatedAt || latest.createdAt || latest.date);

    const dailySeries = rows.map((r) => ({
      day: new Date(r.date).getDate(),
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target: toNum(r.target),
      // Important: emit percent for charts/tiles
      occupancy: r.occupancy == null ? null : +toPercent(r.occupancy).toFixed(1),
      rate: toNum(r.arr),
    }));

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      avgRoomRate: averageRoomRate,
      averageRoomRate,
      occupancyRate,              // <- percent
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
    return res.status(200).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
