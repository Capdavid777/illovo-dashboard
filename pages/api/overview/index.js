// pages/api/overview/index.js
export const config = { runtime: 'nodejs' };

import { PrismaClient } from '@prisma/client';

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

export default async function handler(req, res) {
  // make sure nothing is cached anywhere
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Pull this month's rows (adjust if you want a different window)
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: startOfMonth, lte: now } },
      orderBy: { date: 'asc' },
    });

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        ok: true,
        revenueToDate: 0,
        occupancyRate: 0,
        averageRoomRate: 0,
        targetVariance: 0,
        lastUpdated: null,
        series: [],
      });
    }

    // Aggregate
    let revenueSum = 0;
    let targetSum = 0;

    let occSum = 0;
    let occCount = 0;

    let arrSum = 0;
    let arrCount = 0;

    for (const r of rows) {
      revenueSum += toNum(r.revenue);
      targetSum += toNum(r.target);

      if (r.occupancy != null) {
        occSum += toNum(r.occupancy);
        occCount += 1;
      }
      if (r.arr != null) {
        arrSum += toNum(r.arr);
        arrCount += 1;
      }
    }

    const occupancyRate = occCount ? occSum / occCount : 0;
    const averageRoomRate = arrCount ? arrSum / arrCount : 0;
    const targetVariance = targetSum - revenueSum;

    const last = rows[rows.length - 1];
    const lastUpdated = (last.updatedAt || last.createdAt || last.date)?.toISOString?.() || null;

    const series = rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target: toNum(r.target),
      occupancy: toNum(r.occupancy),
      arr: toNum(r.arr),
    }));

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      occupancyRate,       // 0–100 expected by the UI
      averageRoomRate,
      targetVariance,      // target - revenue
      lastUpdated,
      series,
    });
  } catch (err) {
    // Never leak internals; always return a safe object
    console.error('overview API error:', err);
    return res.status(200).json({
      ok: false,
      error: 'INTERNAL_ERROR',
    });
  }
}
