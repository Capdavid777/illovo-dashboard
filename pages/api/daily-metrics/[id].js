// pages/api/daily-metrics/[id].js
import prisma from '../../../lib/prisma';
import { getSession } from '@auth0/nextjs-auth0'; // optional: auth-guard

export default async function handler(req, res) {
  // OPTIONAL: require login
  // const session = await getSession(req, res);
  // if (!session?.user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

  const { id: rawId } = req.query;

  // Normalize id (can be "123" or ["123"])
  const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
  const id = Number.parseInt(idStr, 10);

  if (!Number.isFinite(id)) {
    res.status(400).json({ ok: false, error: 'INVALID_ID' });
    return;
  }

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    await prisma.dailyMetric.delete({ where: { id } });
    // 204 is conventional for successful DELETE with no body:
    res.status(204).end();
  } catch (err) {
    // Not found (Prisma upsert/delete error)
    if (err?.code === 'P2025') {
      res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      return;
    }
    console.error(`DELETE /api/daily-metrics/${id} failed:`, err);
    res.status(500).json({ ok: false, error: 'DELETE_FAILED' });
  }
}
