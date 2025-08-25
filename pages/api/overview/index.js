// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
const endOfToday   = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const from = startOfMonth();
    const to   = endOfToday();

    // --------- Daily totals (existing) ---------
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, revenue: true, target: true, occupancy: true, arr: true, createdAt: true, updatedAt: true },
    });

    let revenueSum = 0, targetSum = 0, arrSum = 0, arrCount = 0, occSum = 0, occCount = 0;
    for (const r of rows) {
      revenueSum += toNum(r.revenue);
      targetSum  += toNum(r.target);
      if (r.arr != null)       { arrSum += toNum(r.arr);       arrCount++; }
      if (r.occupancy != null) { occSum += toNum(r.occupancy); occCount++; }
    }

    const occupancyRate    = occCount ? +(occSum / occCount).toFixed(1) : 0; // already in percent
    const averageRoomRate  = arrCount ? Math.round(arrSum / arrCount) : 0;
    const targetVariance   = targetSum - revenueSum;
    const latest           = rows[rows.length - 1];
    const lastUpdated      = latest?.updatedAt || latest?.createdAt || latest?.date || null;

    const dailySeries = rows.map(r => ({
      day: new Date(r.date).getUTCDate(),
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      revenue: toNum(r.revenue),
      target:  toNum(r.target),
      occupancy: toNum(r.occupancy),
      rate: toNum(r.arr),
    }));

    // --------- Room types (new) ---------
    const rt = await prisma.roomTypeMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ type: 'asc' }, { date: 'asc' }],
    });

    // group by type for month-to-date
    const byType = new Map();
    for (const r of rt) {
      const key = r.type;
      const acc = byType.get(key) || {
        type: key, rooms: 0, available: 0, sold: 0, revenue: 0, rateSum: 0, rateCount: 0, occSum: 0, occCount: 0,
      };
      acc.rooms     = Math.max(acc.rooms, toNum(r.rooms)); // keep max rooms (static count)
      acc.available += toNum(r.available);
      acc.sold      += toNum(r.sold);
      acc.revenue   += toNum(r.revenue);
      if (r.rate != null)      { acc.rateSum += toNum(r.rate);      acc.rateCount++; }
      if (r.occupancy != null) { acc.occSum  += toNum(r.occupancy); acc.occCount++; }
      byType.set(key, acc);
    }

    const roomTypes = Array.from(byType.values()).map(x => ({
      type: x.type,
      rooms: x.rooms || null,
      available: x.available || null,
      sold: x.sold || null,
      revenue: x.revenue || 0,
      rate: x.rateCount ? Math.round(x.rateSum / x.rateCount) : (x.sold ? Math.round(x.revenue / x.sold) : 0),
      occupancy: x.occCount ? +(x.occSum / x.occCount).toFixed(1) :
                  (x.available ? +((x.sold / x.available) * 100).toFixed(1) : 0),
    }));

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      avgRoomRate: averageRoomRate,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
      dailySeries,
      items: rows,

      // for backward-compat
      totals: { revenueToDate: revenueSum, targetToDate: targetSum, averageRoomRate, occupancyRate, targetVariance },

      // NEW
      roomTypes,
    });
  } catch (err) {
    console.error('GET /api/overview error:', err);
    return res.status(200).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
