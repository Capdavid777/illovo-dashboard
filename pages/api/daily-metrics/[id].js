import prisma from '../../../lib/prisma'       // ✅ default import

export default async function handler(req, res) {
  const { id } = req.query
  try {
    if (req.method === 'DELETE') {
      await prisma.dailyMetric.delete({ where: { id: Number(id) } })
      return res.status(200).json({ ok: true })
    }
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' })
  } catch (err) {
    console.error(`DELETE /api/daily-metrics/${id} failed:`, err)
    return res.status(500).json({ ok: false, error: 'DELETE_FAILED' })
  }
}
