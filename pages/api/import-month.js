// pages/api/import-month.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

export const config = {
  api: { bodyParser: false }, // IMPORTANT for multipart/form-data
  runtime: 'nodejs',
};

const prisma = new PrismaClient();

const toNum = (v) => {
  if (v == null) return null;
  // remove thousand separators / spaces
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const toPercent = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Excel serial -> Date, or pass-through for Date/string
function toDate(value) {
  if (value == null) return null;

  if (value instanceof Date && !isNaN(value)) {
    // normalize to UTC midnight (we store dates as dates in DB)
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  // Excel serial date (e.g. 45513)
  if (typeof value === 'number' && isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch
    const ms = epoch.getTime() + value * 86400000;
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  // ISO / localized string
  const d = new Date(value);
  if (!isNaN(d)) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

async function parseMultipart(req) {
  return await new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, maxFileSize: 20 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // never cache uploads
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const { fields, files } = await parseMultipart(req);

    const year = Number(fields.year);
    const month = Number(fields.month); // 1-12
    if (!year || !month) {
      return res.status(400).json({ ok: false, error: 'MISSING_YEAR_OR_MONTH' });
    }

    const file = files?.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: 'NO_FILE' });
    }

    // Read first sheet as JSON
    const filepath = Array.isArray(file) ? file[0].filepath : file.filepath;
    const wb = XLSX.readFile(filepath, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null });

    let upserts = 0;

    for (const r of rows) {
      // try several possible column names
      const dateVal =
        r.Date ?? r.date ?? r['Posting Date'] ?? r['Day'] ?? r['Transaction Date'] ?? r['DATE'];
      const revenueVal =
        r.Revenue ?? r.revenue ?? r['Revenue (R)'] ?? r['Income'] ?? r['REV'] ?? r['Total'];
      const targetVal =
        r.Target ?? r.target ?? r['Target (R)'] ?? r['Target Revenue'] ?? r['TARGET'];
      const occVal =
        r.Occupancy ?? r.occupancy ?? r['Occupancy (%)'] ?? r['Occ %'] ?? r['OCC'];
      const arrVal =
        r.ARR ?? r.arr ?? r['ARR (R)'] ?? r['Avg Rate'] ?? r['ADR'];

      const dt = toDate(dateVal);
      if (!dt) continue;

      // only import rows for the selected month/year
      if (dt.getUTCFullYear() !== year || (dt.getUTCMonth() + 1) !== month) continue;

      const data = {
        date: dt,
        revenue: toNum(revenueVal),
        target: toNum(targetVal),
        occupancy: toPercent(occVal),
        arr: toNum(arrVal),
      };

      // remove nulls so we don’t overwrite with null accidentally
      Object.keys(data).forEach((k) => data[k] == null && delete data[k]);

      await prisma.dailyMetric.upsert({
        where: { date: dt },
        create: data,
        update: data,
      });
      upserts++;
    }

    return res.status(200).json({ ok: true, upserts });
  } catch (err) {
    console.error('import-month error:', err);
    // Always respond with JSON so the client never crashes on JSON.parse
    return res.status(200).json({ ok: false, error: err.message || 'IMPORT_FAILED' });
  }
}
