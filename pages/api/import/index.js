// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ---- helpers ----
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Excel often stores 57% as 0.57. We want 57.0 in DB.
const normalizeOccupancyToPercent = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? +(n * 100).toFixed(1) : +n.toFixed(1);
};

// Accept ISO/Date/Excel-serial or day number (with given year/month)
function toUtcMidnightDate(cell, year, month) {
  if (cell == null || cell === '') return null;

  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0));
  }
  const asDate = new Date(cell);
  if (!isNaN(asDate)) {
    return new Date(Date.UTC(asDate.getUTCFullYear(), asDate.getUTCMonth(), asDate.getUTCDate(), 0, 0, 0, 0));
  }
  const dayNum = Number(String(cell).trim());
  if (Number.isFinite(dayNum)) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, dayNum, 0, 0, 0, 0));
  }
  return null;
}

// case-insensitive header pick
const pick = (obj, keys) => {
  for (const k of keys) if (obj[k] != null) return obj[k];
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), v]));
  for (const k of keys.map(String).map((s) => s.toLowerCase())) {
    if (lower[k] != null) return lower[k];
  }
  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Parse multipart form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const year  = Number(Array.isArray(fields.year)  ? fields.year[0]  : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);
    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    // Read workbook
    const wb = XLSX.readFile(filePath);

    // ---------- SHEET 1: Daily totals (DailyMetric) ----------
    {
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null, blankrows: false });

      const records = [];
      for (const r of rawRows) {
        const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
        const date = toUtcMidnightDate(dateCell, year, month);
        if (!date) continue;

        const revenue   = toNum(pick(r, ['Revenue', 'revenue']));
        const target    = toNum(pick(r, ['Target', 'target']));
        const arr       = toNum(pick(r, ['ARR', 'arr', 'Rate', 'rate']));
        const occRaw    = pick(r, ['Occupancy', 'occupancy', 'Occ', 'occ', 'Occ %', 'Occupancy %']);
        const occupancy = normalizeOccupancyToPercent(occRaw);

        records.push({ date, revenue, target, arr, occupancy });
      }

      await Promise.all(
        records.map((row) =>
          prisma.dailyMetric.upsert({
            where: { date: row.date },
            update: { revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
            create: { date: row.date, revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
          })
        )
      );
    }

    // ---------- SHEET 2 (optional): Room Types ----------
    // We’ll look for a sheet whose name contains “type” OR use the second sheet if present.
    const roomTypeSheetName =
      wb.SheetNames.find((n) => /type/i.test(n)) || (wb.SheetNames.length > 1 ? wb.SheetNames[1] : null);

    if (roomTypeSheetName) {
      const ws2 = wb.Sheets[roomTypeSheetName];
      const rows = XLSX.utils.sheet_to_json(ws2, { raw: true, defval: null, blankrows: false });

      const rtRecords = [];
      for (const r of rows) {
        const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
        const date = toUtcMidnightDate(dateCell, year, month);
        if (!date) continue;

        const type      = (pick(r, ['Type', 'type', 'Room Type', 'Room']) || '').toString().trim();
        if (!type) continue;

        const rooms     = toNum(pick(r, ['Rooms', 'rooms']));
        const available = toNum(pick(r, ['Available', 'available']));
        const sold      = toNum(pick(r, ['Sold', 'sold']));
        const revenue   = toNum(pick(r, ['Revenue', 'revenue']));
        const rate      = toNum(pick(r, ['Rate', 'rate', 'ARR', 'arr']));
        const occRaw    = pick(r, ['Occupancy', 'occupancy', 'Occ %', 'Occupancy %', 'Occ']);
        const occupancy = normalizeOccupancyToPercent(occRaw);

        rtRecords.push({ date, type, rooms, available, sold, revenue, rate, occupancy });
      }

      await Promise.all(
        rtRecords.map((row) =>
          prisma.roomTypeMetric.upsert({
            where: { date_type: { date: row.date, type: row.type } }, // Prisma will create this from @@unique([date, type])
            update: {
              rooms: row.rooms, available: row.available, sold: row.sold,
              revenue: row.revenue, rate: row.rate, occupancy: row.occupancy,
            },
            create: {
              date: row.date, type: row.type,
              rooms: row.rooms, available: row.available, sold: row.sold,
              revenue: row.revenue, rate: row.rate, occupancy: row.occupancy,
            },
          })
        )
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
