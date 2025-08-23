// pages/api/daily-metrics/index.js
import prisma from '../../../lib/prisma' // or: import { prisma } from '../../../lib/prisma'

function toUtcMidnight(dateStr) {
  // Accepts "2025-08-22" or "2025/08/22"
  const norm = String(dateStr || '').replaceAll('/', '-');
  const [y, m, d] = norm.split('-').map(Number);
  // guard against bad input
  if (!y || !m || !d) throw new Error('Invalid date');
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

const toInt = (v)   => (v === '' || v == null ? null : parseInt(v, 10));
const toFloat = (v) => (v === '' || v == null ? null : parseFloat(v));

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const rows = await prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 100,
      });
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {};

      const when = toUtcMidnight(date);
      const data = {
        date: when,
        revenue:   toInt(revenue),
        target:    toInt(target),
        occupancy: toFloat(occupancy),
        arr:       toInt(arr),
        // If your schema uses @db.Text on `notes`, sending a JS string is fine
        notes:     notes ?? null,
      };

      // Because `date` is @unique in schema, we can upsert on it
      await prisma.dailyMetric.upsert({
        where: { date: when },
        // never update the unique value itself
        update: { revenue: data.revenue, target: data.target, occupancy: data.occupancy, arr: data.arr, notes: data.notes },
        create: data,
      });

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  } catch (err) {
    console.error('daily-metrics POST error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Unknown error' });
  }
}
