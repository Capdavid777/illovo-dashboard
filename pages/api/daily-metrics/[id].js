// pages/api/daily-metrics/[id].js
import prisma from '../../../lib/prisma'

function toUtcMidnight(dateStr) {
  const norm = String(dateStr || '').replaceAll('/', '-');
  const [y, m, d] = norm.split('-').map(Number);
  if (!y || !m || !d) throw new Error('Invalid date');
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

const toInt = (v)   => (v === '' || v == null ? null : parseInt(v, 10));
const toFloat = (v) => (v === '' || v == null ? null : parseFloat(v));

export default async function handler(req, res) {
  const id = parseInt(req.query.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    if (req.method === 'GET') {
      const row = await prisma.dailyMetric.findUnique({ where: { id } });
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(row);
    }

    if (req.method === 'PUT') {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {};
      const update = {
        revenue:   toInt(revenue),
        target:    toInt(target),
        occupancy: toFloat(occupancy),
        arr:       toInt(arr),
        notes:     notes ?? null,
      };
      if (date) update.date = toUtcMidnight(date); // keep unique(date) valid

      const row = await prisma.dailyMetric.update({ where: { id }, data: update });
      return res.status(200).json(row);
    }

    if (req.method === 'DELETE') {
      await prisma.dailyMetric.delete({ where: { id } });
      return res.status(204).end();
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).end('Method Not Allowed');
  } catch (err) {
    console.error('daily-metrics [id] error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Unknown error' });
  }
}
