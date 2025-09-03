// pages/api/import/index.js
import { getSession } from '@auth0/nextjs-auth0';
import formidable from 'formidable';
import xlsx from 'xlsx';
import prisma from '@/lib/prisma'; // use your singleton

export const config = {
  api: { bodyParser: false },     // required for formidable (multipart)
  runtime: 'nodejs',              // ensure Node.js runtime (not edge)
};

/* ------------------------------ helpers ------------------------------ */

const toNum = (v, d = 0) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : d;
};
const toPct = (v, d = 0) => toNum(v, d); // your reports are already 0..100

const pickKey = (row, candidates) => {
  const keys = Object.keys(row || {});
  for (const want of candidates) {
    const hit = keys.find(k => k.trim().toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return null;
};

// Detect sheet “type” by the headers
function classifySheet(rows) {
  if (!rows || !rows.length) return 'unknown';
  const sample = rows[0];
  const keys = Object.keys(sample).map(k => k.toLowerCase());

  const hasDay   = keys.some(k => k.includes('day') || k.includes('date'));
  const hasTgt   = keys.some(k => k.includes('target'));
  const hasRev   = keys.some(k => k.includes('revenue'));
  const hasOcc   = keys.some(k => k.includes('occupancy'));
  const hasRate  = keys.some(k => k.includes('rate'));

  const hasType  = keys.some(k => ['type','room type','roomtype'].includes(k));
  const hasSold  = keys.some(k => k.includes('sold') || k.includes('available'));
  const hasYear  = keys.includes('year');

  if (hasYear && hasRev) return 'yearly';
  if (hasType && (hasRev || hasRate || hasOcc || hasSold)) return 'roomtypes';
  if (hasDay && (hasTgt || hasRev)) return 'daily';
  return 'unknown';
}

/* ------------------------------ importers ------------------------------ */

async function importDaily(rows, year, month) {
  const sample = rows[0];
  const dayKey  = pickKey(sample, ['day', 'date', 'd']);
  const tgtKey  = pickKey(sample, ['daily target', 'target']);
  const revKey  = pickKey(sample, ['daily revenue', 'revenue']);
  const occKey  = pickKey(sample, ['daily occupancy %', 'occupancy %', 'occupancy']);
  const arrKey  = pickKey(sample, ['average daily rate', 'avg daily rate', 'arr', 'rate']);

  if (!dayKey || !revKey || !tgtKey) throw new Error('Missing required columns for daily sheet');

  let upserts = 0;
  for (const r of rows) {
    const rawDay = r[dayKey];
    const day = Number(String(rawDay).replace(/[^\d]/g, ''));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const date = new Date(year, month - 1, day);
    const target    = toNum(r[tgtKey], 0);
    const revenue   = toNum(r[revKey], 0);
    const occupancy = occKey ? toPct(r[occKey], null) : null;
    const arr       = arrKey ? toNum(r[arrKey], null) : null;

    // skip totally blank rows
    if ([target, revenue, occupancy, arr].every(v => v === 0 || v === null)) continue;

    await prisma.dailyMetric.upsert({
      where: { date },
      create: { date, target, revenue, occupancy, arr },
      update: { target, revenue, occupancy, arr },
    });
    upserts++;
  }
  return { kind: 'daily', upserts };
}

async function importRoomTypes(rows, year, month) {
  const sample = rows[0];
  const typeKey  = pickKey(sample, ['type', 'room type']);
  if (!typeKey) throw new Error('Missing "Type/Room Type" column for room types sheet');

  const roomsKey = pickKey(sample, ['rooms', 'total rooms']);
  const availKey = pickKey(sample, ['available', 'availability', 'room nights available']);
  const soldKey  = pickKey(sample, ['sold', 'room nights sold', 'nights sold']);
  const revKey   = pickKey(sample, ['revenue', 'room revenue']);
  const rateKey  = pickKey(sample, ['rate', 'avg rate', 'average rate']);
  const occKey   = pickKey(sample, ['occupancy', 'occupancy %']);

  let upserts = 0;
  for (const r of rows) {
    const type = String(r[typeKey] ?? '').trim();
    if (!type) continue;

    // represent monthly snapshot as last day of month
    const date = new Date(year, month, 0);

    const rooms     = roomsKey ? toNum(r[roomsKey], null) : null;
    const available = availKey ? toNum(r[availKey], null) : null;
    const sold      = soldKey  ? toNum(r[soldKey], null)  : null;
    const revenue   = revKey   ? toNum(r[revKey], null)   : null;
    const rate      = rateKey  ? toNum(r[rateKey], null)  : null;
    const occupancy = occKey   ? toPct(r[occKey], null)   : null;

    await prisma.roomTypeMetric.upsert({
      where: { date_type: { date, type } },
      create: { date, type, rooms, available, sold, revenue, rate, occupancy },
      update: { rooms, available, sold, revenue, rate, occupancy },
    });
    upserts++;
  }
  return { kind: 'roomtypes', upserts };
}

async function importYearly(rows) {
  const sample = rows[0];
  const yearKey = pickKey(sample, ['year']);
  if (!yearKey) throw new Error('Missing "Year" column for yearly sheet');

  const roomsKey = pickKey(sample, ['rooms sold', 'room nights sold', 'roomsold']);
  const occKey   = pickKey(sample, ['occupancy', 'occupancy %']);
  const revKey   = pickKey(sample, ['revenue', 'room revenue', 'total revenue']);
  const rateKey  = pickKey(sample, ['rate', 'avg rate', 'average rate']);

  let upserts = 0;
  for (const r of rows) {
    const year = Number(String(r[yearKey]).replace(/[^\d]/g, ''));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;

    const roomsSold = roomsKey ? toNum(r[roomsKey], null) : null;
    const occupancy = occKey ? toPct(r[occKey], null) : null;
    const revenue   = revKey ? toNum(r[revKey], null) : null;
    const rate      = rateKey ? toNum(r[rateKey], null) : null;

    await prisma.yearlyMetric.upsert({
      where: { year },
      create: { year, roomsSold, occupancy, revenue, rate },
      update: { roomsSold, occupancy, revenue, rate },
    });
    upserts++;
  }
  return { kind: 'yearly', upserts };
}

/* ------------------------------ handler ------------------------------ */

export default async function handler(req, res) {
  // Auth guard
  const session = await getSession(req, res);
  if (!session?.user) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    // Parse multipart form
    const form = formidable({ multiples: false, keepExtensions: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    // Normalize field shapes
    const pickFirst = (v) => Array.isArray(v) ? v[0] : v;
    const year  = Number(pickFirst(fields.year));
    const month = Number(pickFirst(fields.month));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, error: 'Invalid year/month' });
    }

    let upload = pickFirst(files.file);
    if (!upload) return res.status(400).json({ ok: false, error: 'File is required' });

    // Read workbook
    const wb = xlsx.readFile(upload.filepath);
    const summaries = [];

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) {
        summaries.push({ sheet: name, skipped: true, reason: 'empty' });
        continue;
      }

      const kind = classifySheet(rows);

      if (kind === 'daily') {
        const s = await importDaily(rows, year, month);
        summaries.push({ sheet: name, ...s });
      } else if (kind === 'roomtypes') {
        const s = await importRoomTypes(rows, year, month);
        summaries.push({ sheet: name, ...s });
      } else if (kind === 'yearly') {
        const s = await importYearly(rows);
        summaries.push({ sheet: name, ...s });
      } else {
        summaries.push({ sheet: name, skipped: true, reason: 'unrecognized' });
      }
    }

    return res.status(200).json({ ok: true, summaries });
  } catch (err) {
    console.error('import error:', err);
    return res.status(500).json({ ok: false, error: 'IMPORT_FAILED' });
  }
  // NOTE: do not prisma.$disconnect() here; keep singleton open in serverless
}
