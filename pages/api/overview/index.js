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

  // absolutely no cache (SSR already uses no-store, but belt & braces)
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
        occupancy: true, // may be 0..1 or 0..100
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
        occupancyRate: 0,
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
    let arrSum = 0,
      arrCount = 0;

    // IMPORTANT: normalize **each row's** occupancy to a percent (0–100) before averaging
    let occPctSum = 0,
      occCount = 0;

    const dailySeries = rows.map((r) => {
      // revenue/target/arr aggregates
      revenueSum += toNum(r.revenue);
      targetSum += toNum(r.target);
      if (r.arr != null) {
        arrSum += toNum(r.arr);
        arrCount++;
      }

      // occupancy normalization (fraction -> percent)
      let occPct = null;
      if (r.occupancy != null) {
        const raw = Number(r.occupancy);
        if (Number.isFinite(raw)) {
          occPct = raw <= 1 ? raw * 100 : raw; // 0.57 => 57 ; 57 => 57
          occPctSum += occPct;
          occCount++;
        }
      }

      return {
        day: new Date(r.date).getDate(),
        date: r.date instanceof Date ? r.date.toISOString() : r.date,
        revenue: toNum(r.revenue),
        target: toNum(r.target),
        occupancy: occPct ?? null, // expose percent to charts
        rate: toNum(r.arr),
      };
    });

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const occupancyRate = occCount ? +((occPctSum / occCount).toFixed(1)) : 0; // percent, 1 decimal
    const targetVariance = targetSum - revenueSum;

    const latest = rows[rows.length - 1];
    const lastUpdated = (latest.updatedAt || latest.createdAt || latest.date);

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      avgRoomRate: averageRoomRate,
      averageRoomRate,
      occupancyRate, // <- now a true percent
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
