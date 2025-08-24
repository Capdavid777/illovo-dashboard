// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

const prisma = new PrismaClient();

function monthWindowUtc() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const to   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return { from, to };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // absolutely no cache
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const { from, to } = monthWindowUtc();

    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      // select only what we aggregate
      select: { date: true, revenue: true, target: true, occupancy: true, arr: true },
    });

    // Sum/average safely (treat null/undefined as 0, and ignore nulls when averaging)
    let revenueSum = 0;
    let targetSum = 0;
    let arrSum = 0, arrCount = 0;
    let occSum = 0, occCount = 0;

    for (const r of rows) {
      const revenue = Number(r.revenue ?? 0);
      const target  = Number(r.target  ?? 0);
      const arr     = r.arr !== null && r.arr !== undefined ? Number(r.arr) : null;
      const occ     = r.occupancy !== null && r.occupancy !== undefined ? Number(r.occupancy) : null;

      revenueSum += isFinite(revenue) ? revenue : 0;
      targetSum  += isFinite(target)  ? target  : 0;

      if (arr !== null && isFinite(arr)) { arrSum += arr; arrCount += 1; }
      if (occ !== null && isFinite(occ)) { occSum += occ; occCount += 1; }
    }

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    // If you store occupancy as a percentage number (e.g. 46 for 46%), this average is correct:
    const occupancyRate = occCount ? +(occSum / occCount).toFixed(1) : 0;

    const targetVariance = targetSum - revenueSum;

    return res.status(200).json({
      ok: true,
      period: { from, to },
      totals: {
        revenueToDate: revenueSum,
        targetToDate: targetSum,
        averageRoomRate,
        occupancyRate,       // already a percent number
        targetVariance,
      },
      items: rows, // handy for tables/charts later
    });
  } catch (err) {
    console.error('overview error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
