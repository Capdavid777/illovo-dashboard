import { withApiAuthRequired, getSession } from '@auth0/nextjs-auth0';
import prisma from '../../../lib/prisma';

function allowed(email) {
  const list = (process.env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !list.length || (email && list.includes(email.toLowerCase()));
}

export default withApiAuthRequired(async (req, res) => {
  const { user } = await getSession(req, res);
  if (!allowed(user?.email)) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'GET') {
    const items = await prisma.dailyMetric.findMany({ orderBy: { date: 'desc' }, take: 60 });
    return res.json(items);
  }
  if (req.method === 'POST') {
    const { date, revenue, targetRevenue, occupancy, arr, notes } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date required' });
    const item = await prisma.dailyMetric.upsert({
      where: { date: new Date(date) },
      update: { revenue:+revenue||0, targetRevenue:+targetRevenue||0, occupancy:+occupancy||0, arr:+arr||0, notes:notes||null },
      create: { date:new Date(date), revenue:+revenue||0, targetRevenue:+targetRevenue||0, occupancy:+occupancy||0, arr:+arr||0, notes:notes||null },
    });
    return res.status(201).json(item);
  }
  res.setHeader('Allow', ['GET','POST']); res.status(405).end('Method Not Allowed');
});
