// pages/api/daily-metrics/index.js
import { PrismaClient } from '@prisma/client'
const prisma = global.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') global.prisma = prisma

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const items = await prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 20,
      })
      return res.status(200).json({ ok: true, items })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ ok: false, error: 'GET_FAILED' })
    }
  }

  if (req.method === 'POST') {
    try {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {}
      // Normalize and coerce types safely (allowing empty fields)
      const d = new Date(date) // expect 'YYYY-MM-DD'
      if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, error: 'BAD_DATE' })

      const item = await prisma.dailyMetric.upsert({
        where: { date: d },               // date has @unique in schema
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
