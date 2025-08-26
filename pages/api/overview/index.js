import { PrismaClient } from '@prisma/client';
export const config = { runtime: 'nodejs' };

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const startOfMonth = (d=new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const endOfToday   = (d=new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23,59,59,999));
const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const pct = (x) => {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return v <= 1.5 ? v * 100 : v;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });

  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');

  try {
    const from = startOfMonth();
    const to   = endOfToday();

    const rows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { date:true, revenue:true, target:true, occupancy:true, arr:true, createdAt:true, updatedAt:true },
    });

    let revenueSum=0, targetSum=0, arrSum=0, arrCount=0, occSum=0, occCount=0;
    const dailySeries = rows.map(r => {
      const rev = n(r.revenue), tgt = n(r.target);
      const arr = Number.isFinite(r.arr) ? Number(r.arr) : NaN;
      const occ = Number.isFinite(r.occupancy) ? pct(Number(r.occupancy)) : NaN;
      revenueSum += rev; targetSum += tgt;
      if (Number.isFinite(arr)) { arrSum += arr; arrCount++; }
      if (Number.isFinite(occ)) { occSum += occ; occCount++; }
      return {
        day: new Date(r.date).getUTCDate(),
        date: r.date.toISOString(),
        revenue: rev,
        target: tgt,
        occupancy: Number.isFinite(occ) ? Math.round(occ*10)/10 : 0,
        rate: Number.isFinite(arr) ? Math.round(arr) : 0,
      };
    });

    const averageRoomRate = arrCount ? Math.round(arrSum/arrCount) : 0;
    const occupancyRate   = occCount ? Math.round((occSum/occCount)*10)/10 : 0;
    const targetVariance  = targetSum - revenueSum;
    const latest          = rows.at(-1);
    const lastUpdated     = latest ? (latest.updatedAt || latest.createdAt || latest.date).toISOString() : null;

    // Room types MTD
    const rts = await prisma.roomTypeMetric.findMany({
      where: { date: { gte: from, lte: to } },
      select: { type:true, available:true, sold:true, revenue:true, rate:true, occupancy:true },
    });

    const byType = new Map();
    for (const rt of rts) {
      const key = rt.type || 'Unknown';
      const acc = byType.get(key) || { type:key, available:0, sold:0, revenue:0, rateSum:0, rateCount:0, occSum:0, occCount:0 };
      acc.available += n(rt.available);
      acc.sold      += n(rt.sold);
      acc.revenue   += n(rt.revenue);

      if (Number.isFinite(rt.rate)) { acc.rateSum += Number(rt.rate); acc.rateCount++; }
      const occ = Number.isFinite(rt.occupancy) ? pct(Number(rt.occupancy)) : NaN;
      if (Number.isFinite(occ)) { acc.occSum += occ; acc.occCount++; }

      byType.set(key, acc);
    }
    const roomTypes = Array.from(byType.values()).map(t => {
      const rateAvg = t.rateCount ? t.rateSum / t.rateCount : (t.sold ? t.revenue / t.sold : 0);
      const occAvg  = t.occCount ? (t.occSum / t.occCount) : (t.available ? (t.sold/t.available)*100 : 0);
      return {
        type: t.type,
        available: t.available,
        sold: t.sold,
        revenue: t.revenue,
        rate: Math.round(rateAvg || 0),
        occupancy: Math.round((occAvg || 0)*10)/10,
      };
    });

    res.status(200).json({
      ok:true,
      revenueToDate: revenueSum,
      targetToDate: targetSum,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated,
      dailySeries,
      roomTypes,
      totals:{ revenueToDate: revenueSum, targetToDate: targetSum, averageRoomRate, occupancyRate, targetVariance }
    });
  } catch (e) {
    console.error('GET /api/overview', e);
    res.status(200).json({ ok:false, error:'INTERNAL_ERROR' });
  }
}
