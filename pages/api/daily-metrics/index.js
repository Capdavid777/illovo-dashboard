// pages/api/daily-metrics/index.js
import { PrismaClient } from '@prisma/client'
export const config = { runtime: 'nodejs' }

const prisma = global.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') global.prisma = prisma

// ---------- Helpers ----------
const isYYYYMM = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s)

const monthRangeUTC = (key /* YYYY-MM or null */) => {
  let start
  if (isYYYYMM(key)) {
    const [y, m] = key.split('-').map(Number)
    start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  } else {
    const now = new Date()
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  return { start, end }
}

// Accept ISO strings, 2025/09/01, 2025-09-01, and Excel serial numbers.
function coerceToUTCDate(v) {
  if (v == null || v === '') return null

  // Excel serial number (days since 1899-12-30)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + v * 86400000)
  }

  if (typeof v === 'string') {
    const norm = v.trim().replace(/\//g, '-')
    const d = new Date(norm)
    if (!Number.isNaN(d.getTime())) return d
  }

  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const toNum = (x) =>
  x === '' || x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null

// ---------- Handler ----------
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  // GET: return *all* rows for requested month (ascending), no cross-month bleed.
  if (req.method === 'GET') {
    try {
      const { month } = req.query
      const { start, end } = monthRangeUTC(month)

      const items = await prisma.dailyMetric.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
      })

      return res.status(200).json({ ok: true, items })
    } catch (err) {
      console.error('GET /api/daily-metrics error:', err)
      return res.status(500).json({ ok: false, error: 'GET_FAILED' })
    }
  }

  // POST: upsert one day (used by your admin importer)
  if (req.method === 'POST') {
    try {
      const { date, revenue, target, occupancy, arr, notes } = req.body || {}

      const d = coerceToUTCDate(date)
      if (!d) return res.status(400).json({ ok: false, error: 'BAD_DATE' })
      d.setUTCHours(0, 0, 0, 0)

      const data = {
        date: d,
        revenue: toNum(revenue),
        target: toNum(target),
        occupancy: toNum(occupancy),
        arr: toNum(arr),
        notes: notes ?? '',
      }

      const item = await prisma.dailyMetric.upsert({
        where: { date: d },
        update: data,
        create: data,
      })

      return res.status(200).json({ ok: true, item })
    } catch (err) {
      console.error('POST /api/daily-metrics error:', err)
      return res.status(500).json({ ok: false, error: 'UPSERT_FAILED' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' })
}
