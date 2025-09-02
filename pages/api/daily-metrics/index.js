// pages/api/daily-metrics/index.js
import { PrismaClient } from '@prisma/client'
const prisma = global.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') global.prisma = prisma

const parseMonthKey = (key) => {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
}
const monthRangeUTC = (key) => {
  const start = parseMonthKey(key) || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  return { start, end }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const { month } = req.query
      const { start, end } = monthRangeUTC(month)

      const items = await prisma.dailyMetric.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },       // day 1..31
        // no take: return the whole month (<= 31 rows)
      })

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ ok: true, items })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ ok: false, error: 'GET_FAILED' })
    }
  }

  if (req.method === 'POST') {
    try {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {}
      const d = new Date(date) // expect 'YYYY-MM-DD'
      if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, error: 'BAD_DATE' })

      const item = await prisma.dailyMetric.upsert({
        where: { date: d },
        update: {
          revenue: revenue !== '' && revenue != null ? Number(revenue) : null,
          target: target !== '' && target != null ? Number(target) : null,
          occupancy: occupancy !== '' && occupancy != null ? Number(occupancy) : null,
          arr: arr !== '' && arr != null ? Number(arr) : null,
          notes: notes ?? '',
        },
        create: {
          date: d,
          revenue: revenue !== '' && revenue != null ? Number(revenue) : null,
          target: target !== '' && target != null ? Number(target) : null,
          occupancy: occupancy !== '' && occupancy != null ? Number(occupancy) : null,
          arr: arr !== '' && arr != null ? Number(arr) : null,
          notes: notes ?? '',
        },
      })
      return res.status(200).json({ ok: true, item })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ ok: false, error: 'UPSERT_FAILED' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' })
}
export const config = { runtime: 'nodejs' }
