// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

// Next.js API route config
export const config = {
  api: { bodyParser: false },   // we'll parse with formidable
  runtime: 'nodejs',
};

// Reuse Prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ---- helpers ----
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Excel often stores 57% as 0.57. We want 57 for the DB.
const normalizeOccupancyToPercent = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return Math.round(n * 100 * 10) / 10; // keep 1 decimal if you like
  return Math.round(n * 10) / 10; // already looks like percent
};

// Accept either an ISO date, a JS Date, or an Excel serial number.
// Fallback: build from (year, month, day).
function toUtcMidnightDate(cell, year, month) {
  if (cell == null || cell === '') return null;

  // Excel serial number?
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0));
  }
  // Try a straight date/ISO
  const asDate = new Date(cell);
  if (!isNaN(asDate)) {
    return new Date(Date.UTC(asDate.getUTCFullYear(), asDate.getUTCMonth(), asDate.getUTCDate(), 0, 0, 0, 0));
  }

  // Try short day (if sheet only has the 'day' number)
  const dayNum = Number(String(cell).trim());
  if (Number.isFinite(dayNum)) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, dayNum, 0, 0, 0, 0));
  }

  return null;
}

// ---- main handler ----
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Parse form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const year  = Number(Array.isArray(fields.year)  ? fields.year[0]  : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    // Read workbook and first sheet
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    // Get objects with headers. defval ensures trailing rows (even with blanks) are kept.
    const rawRows = XLSX.utils.sheet_to_json(ws, {
      raw: true,
      defval: null,       // keep empty cells as null
      blankrows: false,   // ignore rows that are completely empty
    });

    // Header normalization (case-insensitive, tolerate similar names)
    const pick = (obj, keys) => {
      for (const k of keys) {
        if (obj[k] != null) return obj[k];
      }
      // try case-insensitively
      const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), v]));
      for (const k of keys.map(String).map((s) => s.toLowerCase())) {
        if (lower[k] != null) return lower[k];
      }
      return null;
    };

    // Map rows -> records
    const records = [];
    for (const r of rawRows) {
      const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
      const date = toUtcMidnightDate(dateCell, year, month);
      if (!date) continue; // skip rows with no identifiable date

      const revenue   = toNum(pick(r, ['Revenue', 'revenue']));
      const target    = toNum(pick(r, ['Target', 'target']));
      const arr       = toNum(pick(r, ['ARR', 'arr', 'Rate', 'rate']));
      const occRaw    = pick(r, ['Occupancy', 'occupancy', 'Occ', 'occ', 'Occ %', 'Occupancy %']);
      const occupancy = normalizeOccupancyToPercent(occRaw);

      // You can optionally skip days that have absolutely no numbers:
      // if (revenue == null && target == null && arr == null && occupancy == null) continue;

      records.push({ date, revenue, target, arr, occupancy });
    }

    // Upsert all
    const results = await Promise.all(
      records.map((row) =>
        prisma.dailyMetric.upsert({
          where: { date: row.date },
          update: {
            revenue: row.revenue,
            target: row.target,
            arr: row.arr,
            occupancy: row.occupancy,
          },
          create: {
            date: row.date,
            revenue: row.revenue,
            target: row.target,
            arr: row.arr,
            occupancy: row.occupancy,
          },
        })
      )
    );

    return res.status(200).json({
      ok: true,
      imported: results.length,
    });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
