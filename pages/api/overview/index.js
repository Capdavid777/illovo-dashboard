// pages/api/overview/index.js
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

// keep one Prisma instance in dev
const prisma = globalThis.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// ---------- helpers ----------
const isYYYYMM = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);

function monthRangeUTC(key /* 'YYYY-MM' | undefined */) {
  let start;
  if (isYYYYMM(key)) {
    const [y, m] = key.split('-').map(Number);
    start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

const toNum0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // allow 0..1 or 0..100 inputs
  return n <= 1.5 ? n * 100 : n;
};

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // disable caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const { month } = req.query;
    const { start, end } = monthRangeUTC(month);

    // ---- daily series for month ----
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        revenue: true,
        target: true,
        occupancy: true,
        arr: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    let revSum = 0,
      tgtSum = 0,
      arrSum = 0,
      arrCnt = 0,
      occSum = 0,
      occCnt = 0;

    const dailySeries = rows.map((r) => {
      const rev = toNum0(r.revenue);
      const tgt = toNum0(r.target);
      const arr = Number.isFinite(r.arr) ? Number(r.arr) : NaN;
      const occ = Number.isFinite(r.occupancy) ? pct(Number(r.occupancy)) : NaN;

      revSum += rev;
      tgtSum += tgt;
      if (Number.isFinite(arr)) {
        arrSum += arr;
        arrCnt++;
      }
      if (Number.isFinite(occ)) {
        occSum += occ;
        occCnt++;
      }

      return {
        day: new Date(r.date).getUTCDate(),
        date: r.date.toISOString(),
        revenue: rev,
        target: tgt,
        occupancy: Number.isFinite(occ) ? Math.round(occ * 10) / 10 : 0,
        rate: Number.isFinite(arr) ? Math.round(arr) : 0,
      };
    });

    const averageRoomRate = arrCnt ? Math.round(arrSum / arrCnt) : 0;
    const occupancyRate = occCnt ? Math.round((occSum / occCnt) * 10) / 10 : 0;
    const targetVariance = tgtSum - revSum;
    const lastRow = rows[rows.length - 1];
    const lastUpdated = lastRow
      ? (lastRow.updatedAt || lastRow.createdAt || lastRow.date).toISOString()
      : null;

    // ---- room types for month (optional) ----
    const byType = new Map();
    const typeRows = await prisma.roomTypeMetric.findMany({
      where: { date: { gte: start, lt: end } },
      select: {
        type: true,
        available: true,
        sold: true,
        revenue: true,
        rate: true,
        occupancy: true,
      },
    });

    for (const rt of typeRows) {
      const key = rt.type || 'Unknown';
      const acc =
        byType.get(key) ||
        {
          type: key,
          available: 0,
          sold: 0,
          revenue: 0,
          rateSum: 0,
          rateCount: 0,
          occSum: 0,
          occCount: 0,
        };

      acc.available += toNum0(rt.available);
      acc.sold += toNum0(rt.sold);
      acc.revenue += toNum0(rt.revenue);
      if (Number.isFinite(rt.rate)) {
        acc.rateSum += Number(rt.rate);
        acc.rateCount++;
      }
      if (Number.isFinite(rt.occupancy)) {
        acc.occSum += pct(Number(rt.occupancy));
        acc.occCount++;
      }
      byType.set(key, acc);
    }

    const roomTypes = Array.from(byType.values()).map((t) => {
      const rateFromAvg = t.rateCount ? t.rateSum / t.rateCount : 0;
      const rateFromRev = t.sold ? t.revenue / t.sold : 0;
      const avgRate = Math.round((rateFromAvg || rateFromRev) || 0);

      const occFromAvg = t.occCount ? t.occSum / t.occCount : NaN;
      const occFromCalc = t.available ? (t.sold / t.available) * 100 : NaN;
      const occPct = Number.isFinite(occFromAvg)
        ? occFromAvg
        : Number.isFinite(occFromCalc)
        ? occFromCalc
        : 0;

      return {
        type: t.type,
        available: t.available,
        sold: t.sold,
        revenue: t.revenue,
        rate: avgRate,
        occupancy: Math.round(occPct * 10) / 10,
      };
    });

    // ---- year history (doesn't depend on month) ----
    const history = await prisma.yearMetric
      .findMany({
        orderBy: { year: 'asc' },
        select: { year: true, roomsSold: true, occupancy: true, revenue: true, rate: true },
      })
      .then((ys) =>
        ys.map((y) => ({
          year: y.year,
          roomsSold: toNum0(y.roomsSold),
          occupancy: Math.round(pct(y.occupancy) * 10) / 10,
          revenue: toNum0(y.revenue),
          rate: toNum0(y.rate),
        })),
      );

    return res.status(200).json({
      ok: true,
      revenueToDate: revSum,
      targetToDate: tgtSum,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated,
      dailySeries,
      roomTypes,
      history,
      totals: {
        revenueToDate: revSum,
        targetToDate: tgtSum,
        averageRoomRate,
        occupancyRate,
        targetVariance,
      },
    });
  } catch (err) {
    console.error('GET /api/overview error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
