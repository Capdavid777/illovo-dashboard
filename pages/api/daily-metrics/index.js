import prisma from '../../../lib/prisma'       // ✅ default import

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const items = await prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 30,
      })
      return res.status(200).json({ ok: true, items })
    }
    // ... POST/PUT logic
  } catch (err) {
    console.error('GET /api/daily-metrics failed:', err)
    return res.status(500).json({ ok: false, error: 'FETCH_FAILED' })
  }
}
