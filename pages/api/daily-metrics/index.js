// pages/api/daily-metrics/index.js
import prisma from '../../../lib/prisma'; // use the singleton
// import { getSession } from '@auth0/nextjs-auth0'; // optional: auth-guard

// Parse "YYYY-MM" (local)
const parseMonthKeyLocal = (key) => {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [y, m] = key.split('-').map(Number);
  // Local-time month start
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
};

// Local month range [start, nextMonth)
const monthRangeLocal = (key) => {
  const now = new Date();
  const start =
    parseMonthKeyLocal(key) ?? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
};

export default async function handler(req, res) {
  // OPTIONAL: require login for writes/reads
  // const session = await getSession(req, res);
  // if (!session?.user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

  if (req.method === 'GET') {
    try {
      const { month } = req.query;
      const { start, end } = monthRangeLocal(month);

      const items = await prisma.dailyMetric.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
      });

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, items });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'GET_FAILED' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {};
      const d = new Date(date); // expect 'YYYY-MM-DD'
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ ok: false, error: 'BAD_DATE' });
      }

      const toNumOrNull = (v) =>
        v !== '' && v != null ? Number(v) : null;

      const item = await prisma.dailyMetric.upsert({
        where: { date: d },
        update: {
          revenue: toNumOrNull(revenue),
          target: toNumOrNull(target),
          occupancy: toNumOrNull(occupancy), // percent 0..100
          arr: toNumOrNull(arr),
          notes: notes ?? '',
        },
        create: {
          date: d,
          revenue: toNumOrNull(revenue),
          target: toNumOrNull(target),
          occupancy: toNumOrNull(occupancy),
          arr: toNumOrNull(arr),
          notes: notes ?? '',
        },
      });

      // no-store for dynamic data
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, item });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'UPSERT_FAILED' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
}

export const config = { runtime: 'nodejs' };
