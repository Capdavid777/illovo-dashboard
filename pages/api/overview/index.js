// pages/api/overview/index.js
<<<<<<< HEAD
import prisma from '../../../lib/prisma';
=======
import { PrismaClient } from '@prisma/client';

export const config = { runtime: 'nodejs' };

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
const endOfToday   = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
const normalizePct = (n) => (!Number.isFinite(n) ? 0 : (n <= 1.5 ? n * 100 : n));
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb

export default async function handler(req, res) {
  try {
<<<<<<< HEAD
    // ----- your existing queries -----
    const daily = await prisma.dailyMetric.findMany({
=======
    const from = startOfMonth();
    const to   = endOfToday();

    /* ----- Overview (DailyMetric) ----- */
    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
      orderBy: { date: 'asc' },
    });

    const roomTypes = await prisma.roomTypeMetric.findMany({
      orderBy: { type: 'asc' },
    });

<<<<<<< HEAD
    // ----- NEW: historical (yearly) metrics -----
    const yrs = await prisma.yearMetric.findMany({
      orderBy: { year: 'asc' },
=======
    const averageRoomRate = arrCount ? Math.round(arrSum / arrCount) : 0;
    const occupancyRate   = occCount ? Math.round((occSum / occCount) * 10) / 10 : 0;
    const targetVariance  = targetSum - revenueSum;
    const latest          = rows[rows.length - 1];
    const lastUpdated     = latest ? (latest.updatedAt || latest.createdAt || latest.date).toISOString() : null;

    /* ----- Room Types (aggregate month-to-date) ----- */
    const rts = await prisma.roomTypeMetric.findMany({
      where: { date: { gte: from, lte: to } },
      select: { type: true, available: true, sold: true, revenue: true, rate: true, occupancy: true },
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
    });

    const history = yrs.map((y) => ({
      year: String(y.year),
      roomsSold: y.roomsSold,
      occupancy: y.occupancy, // already 0..100 in DB
      revenue: y.revenue,
      rate: y.rate,
    }));

    // shape your daily + roomTypes as before
    const dailySeries = daily.map((d) => ({
      id: d.id,
      day: new Date(d.date).getUTCDate(),
      date: d.date.toISOString(),
      revenue: d.revenue,
      target: d.target,
      occupancy: d.occupancy,      // whatever you store
      rate: d.rate,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    const roomTypesData = roomTypes.map((r) => ({
      type: r.type,
      available: r.available,
      sold: r.sold,
      revenue: r.revenue,
      rate: r.rate,
      occupancy: r.occupancy,      // 0..100 expected by Dashboard
    }));

    // ----- totals/topline as you do today -----
    const revenueToDate   = daily.reduce((a, b) => a + (b.revenue || 0), 0);
    const targetToDate    = daily.reduce((a, b) => a + (b.target  || 0), 0);
    const averageRoomRate = Math.round(
      daily.reduce((a, b) => a + (b.rate || 0), 0) / (daily.length || 1)
    );
    const occupancyRate = Math.round(
      daily.reduce((a, b) => a + (b.occupancy || 0), 0) / (daily.length || 1)
    );
    const targetVariance = targetToDate - revenueToDate;

<<<<<<< HEAD
    return res.json({
      ok: true,
      revenueToDate,
      targetToDate,
=======
    const roomTypes = Array.from(byType.values()).map((t) => {
      const rateFromAvg = t.rateCount ? t.rateSum / t.rateCount : 0;
      const rateFromRev = t.sold ? t.revenue / t.sold : 0;
      const avgRate     = Math.round((rateFromAvg || rateFromRev) || 0);

      const occFromAvg  = t.occCount ? (t.occSum / t.occCount) : NaN;
      const occFromCalc = t.available ? (t.sold / t.available) * 100 : NaN;
      const occPct      = Number.isFinite(occFromAvg) ? occFromAvg : (Number.isFinite(occFromCalc) ? occFromCalc : 0);

      return {
        type: t.type,
        available: t.available,
        sold: t.sold,
        revenue: t.revenue,
        rate: avgRate,
        occupancy: Math.round(occPct * 10) / 10,
      };
    });

    /* ----- Historical (YearMetric) ----- */
    const years = await prisma.yearMetric.findMany({
      orderBy: { year: 'asc' },
      select: { year: true, roomsSold: true, occupancy: true, revenue: true, rate: true },
    });

    const history = years.map((y) => ({
      year: y.year,
      roomsSold: toNum(y.roomsSold),
      occupancy: Math.round(normalizePct(Number(y.occupancy)) * 10) / 10,
      revenue: toNum(y.revenue),
      rate: toNum(y.rate),
    }));

    return res.status(200).json({
      ok: true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated: new Date().toISOString(),
      dailySeries,
<<<<<<< HEAD
      roomTypes: roomTypesData,
      history, // <<< the Dashboard picks this up
=======
      roomTypes,
      history,
      totals: {
        revenueToDate: revenueSum,
        targetToDate: targetSum,
        averageRoomRate,
        occupancyRate,
        targetVariance,
      },
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
