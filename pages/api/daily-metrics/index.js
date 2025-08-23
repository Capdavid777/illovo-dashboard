import prisma from '../../../lib/prisma'; // note .js file

export default async function handler(req, res) {
  const debug = req.query.debug === '1';
  try {
    if (req.method === 'GET') {
      const items = await prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 30,
      });
      return res.status(200).json({ ok: true, items });
    }

    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (err) {
    console.error('GET /api/daily-metrics failed:', err);
    const body = { ok: false, error: 'FETCH_FAILED' };
    if (debug) body.message = err.message, body.code = err.code;
    return res.status(500).json(body);
  }
}
