import { withApiAuthRequired, getSession } from '@auth0/nextjs-auth0';
import prisma from '../../../lib/prisma';

export default withApiAuthRequired(async (req, res) => {
  await getSession(req, res);
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  if (req.method === 'DELETE') {
    await prisma.dailyMetric.delete({ where: { id } });
    return res.status(204).end();
  }
  res.setHeader('Allow', ['DELETE']);
  res.status(405).end('Method Not Allowed');
});
