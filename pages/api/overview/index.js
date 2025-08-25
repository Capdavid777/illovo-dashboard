// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

// Node runtime on Vercel
export const config = { runtime: 'nodejs' };

// Reuse Prisma client in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ---- helpers ---------------------------------------------------------------

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const startOfMonthUTC = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));

const endOfTodayUTC = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

// Convert 0..1 style to percent if needed
const normalizePct = (n) => {
  if (!Number.isFinite(n)) return 0;
  return n <= 1.5 ? n * 100 : n;
};

// Round to 1 decimal place
const r1 = (n) => Math.round(n * 10) / 10;

// ---- handler ---------------------------------------------------------------

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
    const to   = endOfTodayUTC();

    /* -------------------- DAILY (Overview) -------------------- */
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { date: true, revenue: true, target: true, occupancy: true, arr: true, createdAt: true, updatedAt: true },
    });

    let revenueSum = 0, targetSum = 0, arrSum = 0, arrCount = 0, occSum = 0, occCount = 0;

    const dailySeries = rows.map((r) => {
      const rev = toNum(r.revenue);
      const tgt = toNum(r.target);
      const arr = Number.isFinite(r.arr) ? Number(r.arr) : NaN;
      const occ = Number.isFinite(r.occupancy) ? normalizePct(Number(r.occupancy)) : NaN;

      revenueSum += rev;
      targetSum  += tgt;
      if (Number.isFinite(arr)) { arrSum += arr; arrCount++; }
      if (Number.isFinite(occ)) { occSum += occ; occCount++; }

      return {
        day: new Date(r.date).getUTCDate(),
        date: r.date.toISOString(),
        revenue: rev,
        target: tgt,
        occupancy: Number.isFinite(occ) ? r1(occ) : 0,
        rate: Number.isFinite(arr) ? Math.round(arr) : 0,
      };
    });

    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const occupancyRate   = occCount ? r1(occSum / occCount) : 0;
    const targetVariance  = targetSum - revenueSum;
    const latest          = rows[rows.length - 1];
    const lastUpdated     = latest ? (latest.updatedAt || latest.createdAt || latest.date).toISOString() : null;

    /* -------------------- ROOM TYPES (month-to-date) -------------------- */
    const rts = await prisma.roomTypeMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ type: 'asc' }, { date: 'asc' }],
      select: { type: true, available: true, sold: true, revenue: true, rate: true, occupancy: true },
    });

    const byType = new Map();
    for (const rt of rts) {
      const key = rt.type || 'Unknown';
      const acc = byType.get(key) || {
        type: key, available: 0, sold: 0, revenue: 0,
        rateSum: 0, rateCount: 0, occSum: 0, occCount: 0,
      };

      acc.available += toNum(rt.available);
      acc.sold      += toNum(rt.sold);
      acc.revenue   += toNum(rt.revenue);

      const rate = Number.isFinite(rt.rate) ? Number(rt.rate) : NaN;
      if (Number.isFinite(rate)) { acc.rateSum += rate; acc.rateCount++; }

      const occ = Number.isFinite(rt.occupancy) ? normalizePct(Number(rt.occupancy)) : NaN;
      if (Number.isFinite(occ)) { acc.occSum += occ; acc.occCount++; }

      byType.set(key, acc);
    }

    const roomTypes = Array.from(byType.values()).map((t) => {
      const rateFromAvg = t.rateCount ? t.rateSum / t.rateCount : NaN;
      const rateFromRev = t.sold ? t.revenue / t.sold : NaN;
      const avgRate     = Math.round(Number.isFinite(rateFromAvg) ? rateFromAvg : (Number.isFinite(rateFromRev) ? rateFromRev : 0));

      const occFromAvg  = t.occCount ? (t.occSum / t.occCount) : NaN;
      const occFromCalc = t.available ? (t.sold / t.available) * 100 : NaN;
      const occPct      = Number.isFinite(occFromAvg) ? occFromAvg : (Number.isFinite(occFromCalc) ? occFromCalc : 0);

      return {
        type: t.type,
        available: t.available,
        sold: t.sold,
        revenue: t.revenue,
        rate: avgRate,
        occupancy: r1(occPct),
      };
    });

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated,
      dailySeries,
      roomTypes,
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
