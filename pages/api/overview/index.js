// pages/api/overview/index.js
import prisma from '../../../lib/prisma';

export default async function handler(req, res) {
  try {
    // ----- your existing queries -----
    const daily = await prisma.dailyMetric.findMany({
      orderBy: { date: 'asc' },
    });

    const roomTypes = await prisma.roomTypeMetric.findMany({
      orderBy: { type: 'asc' },
    });

    // ----- NEW: historical (yearly) metrics -----
    const yrs = await prisma.yearMetric.findMany({
      orderBy: { year: 'asc' },
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

    return res.json({
      ok: true,
      revenueToDate,
      targetToDate,
      averageRoomRate,
      occupancyRate,
      targetVariance,
      lastUpdated: new Date().toISOString(),
      dailySeries,
      roomTypes: roomTypesData,
      history, // <<< the Dashboard picks this up
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
