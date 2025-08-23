// pages/api/daily-metrics/index.js
import { prisma } from '../../../lib/prisma';

function parseIntOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeDateToUTC(dateStr) {
  // Accepts 'YYYY-MM-DD' or locale strings; normalize to 00:00:00 UTC
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { date, revenue, target, occupancy, arr, notes } = req.body;

      const start = normalizeDateToUTC(date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);

      const data = {
        date: start,
        revenue: parseIntOrNull(revenue),
        target: parseIntOrNull(target),
        occupancy: parseIntOrNull(occupancy),
        arr: parseIntOrNull(arr),
        notes: notes ?? null,
      };

      // Find an existing row for that day (since date isn't unique yet)
      const existing = await prisma.dailyMetric.findFirst({
        where: { date: { gte: start, lt: end } },
        select: { id: true },
      });

      if (existing) {
        await prisma.dailyMetric.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.dailyMetric.create({ data });
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('POST /api/daily-metrics failed:', err);
      return res.status(500).json({ ok: false, error: 'SAVE_FAILED' });
    }
  }

  if (req.method === 'GET') {
    try {
      const items = await prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 30,
      });
      return res.status(200).json({ items });
    } catch (err) {
      console.error('GET /api/daily-metrics failed:', err);
      return res.status(500).json({ ok: false, error: 'FETCH_FAILED' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
