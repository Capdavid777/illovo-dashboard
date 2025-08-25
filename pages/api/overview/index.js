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
const startOfMonth = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfToday = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

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
    const to = endOfToday();

    // -------- Daily metrics (MTD) --------
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        revenue: true,
        target: true,
        occupancy: true,
        arr: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // -------- Room types (latest snapshot this month) --------
    let roomTypesOut = [];
    try {
      if (prisma.roomTypeMetric?.findMany) {
        const roomTypes = await prisma.roomTypeMetric.findMany({
          where: { date: { gte: from, lte: to } },
          orderBy: [{ date: 'desc' }, { type: 'asc' }],
          select: {
            date: true,
            type: true,
            rooms: true,
            available: true,
            sold: true,
            revenue: true,
            rate: true,
            occupancy: true,
          },
        });

        const latestDate = roomTypes[0]?.date || null;
        const latestTime = latestDate ? new Date(latestDate).getTime() : null;

        const latestSet =
          latestTime == null
            ? []
            : roomTypes.filter((rt) => new Date(rt.date).getTime() === latestTime);

        roomTypesOut = latestSet.map((rt) => ({
          type: rt.type,
          rooms: toNum(rt.rooms),
          available: toNum(rt.available),
          sold: toNum(rt.sold),
          revenue: toNum(rt.revenue),
          rate: toNum(rt.rate),
          occupancy: toNum(rt.occupancy),
          // date kept for reference if needed:
          date: rt.date instanceof Date ? rt.date.toISOString() : rt.date,
        }));
      }
    } catch (e) {
      // If the table/model doesn't exist yet, just return empty array
      console.warn('roomTypeMetric fetch skipped:', e?.message || e);
      roomTypesOut = [];
    }

    // -------- Yearly historical --------
    let historyOut = [];
    try {
      if (prisma.yearlyMetric?.findMany) {
        const history = await prisma.yearlyMetric.findMany({
          orderBy: { year: 'asc' },
          select: { year: true, roomsSold: true, occupancy: true, revenue: true, rate: true },
        });
        historyOut = history.map((h) => ({
          year: toNum(h.year),
          roomsSold: toNum(h.roomsSold),
          occupancy: toNum(h.occupancy),
          revenue: toNum(h.revenue),
          rate: toNum(h.rate),
        }));
      }
    } catch (e) {
      console.warn('yearlyMetric fetch skipped:', e?.message || e);
      historyOut = [];
    }

    // If no daily rows, still return roomTypes/history for the dashboard
    if (!rows.length) {
      return res.status(200).json({
        ok: true,
        revenueToDate: 0,
        targetToDate: 0,
        avgRoomRate: 0,
        averageRoomRate: 0,
        occupancyRate: 0,
        targetVariance: 0,
        lastUpdated: null,
        dailySeries: [],
        items: [],
        roomTypes: roomTypesOut,
        history: historyOut,
        totals: {
          revenueToDate: 0,
          targetToDate: 0,
          averageRoomRate: 0,
          occupancyRate: 0,
          targetVariance: 0,
        },
      });
    }

    // Aggregate daily rows
    let revenueSum = 0;
    let targetSum = 0;
    let arrSum = 0,
      arrCount = 0;
    let occSum = 0,
      occCount = 0;

    for (const r of rows) {
      revenueSum += toNum(r.revenue);
      targetSum += toNum(r.target);
      if (r.arr != null) {
        arrSum += toNum(r.arr);
        arrCount++;
      }
      if (r.occupancy != null) {
        occSum += toNum(r.occupancy);
        occCount++;
      }
    }

    // If your DB stores occupancy as 0..1, set OCC_AS_FRACTION=1 (env) to scale to %
    const occAvgRaw = occCount ? occSum / occCount : 0;
    const occupancyRate = Number(process.env.OCC_AS_FRACTION)
      ? +((occAvgRaw * 100).toFixed(1))
      : +(occAvgRaw.toFixed(1));

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const targetVariance = targetSum - revenueSum;

    const latest = rows[rows.length - 1];
    const lastUpdated = latest?.updatedAt || latest?.createdAt || latest?.date;

    const dailySeries = rows.map((r) => ({
      day: new Date(r.date).getDate(),
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target: toNum(r.target),
      occupancy: toNum(r.occupancy),
      rate: toNum(r.arr),
    }));

    // Return BOTH top-level keys and a nested "totals" for backward compatibility
    return res.status(200).json({
      ok: true,

      // top-level fields the Dashboard uses
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      avgRoomRate: averageRoomRate,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated: lastUpdated instanceof Date ? lastUpdated.toISOString() : lastUpdated,

      // charts/series
      dailySeries,
      items: rows,

      // NEW: room types & history
      roomTypes: roomTypesOut,
      history: historyOut,

      // compatibility bundle
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
