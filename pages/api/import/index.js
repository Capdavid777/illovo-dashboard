// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

// Reuse Prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

/* ----------------------- helpers ----------------------- */

// Parse a numeric cell or string like "12,345", "46%", " 1 234 "
const toNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[%\s,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// Normalize occupancy to a percent number (0..100) from either 0..1 or 0..100 (and accept "46%")
const toPercent = (v) => {
  const n = toNum(v);
  if (n == null) return null;
  // If it's clearly a fraction (≤ 1.5) treat as 0..1 and convert to %.
  return n <= 1.5 ? Math.round(n * 100 * 10) / 10 : Math.round(n * 10) / 10;
};

// Convert any of: Excel serial, ISO date, date-like string, or day number → UTC midnight date
function toUtcMidnightDate(cell, year, month) {
  if (cell == null || cell === '') return null;

  // Excel serial number?
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0));
  }

  // Parse-able date?
  const dt = new Date(cell);
  if (!isNaN(dt)) {
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0));
  }

  // Day-of-month only (e.g. "22")
  const dayNum = Number(String(cell).trim());
  if (Number.isFinite(dayNum)) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, dayNum, 0, 0, 0, 0));
  }

  return null;
}

// Case/space-insensitive header pick
const pick = (row, candidates) => {
  const map = new Map(Object.entries(row).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
  for (const c of candidates) {
    const key = String(c).trim().toLowerCase();
    if (map.has(key)) return map.get(key);
  }
  return null;
};

// Find a sheet whose name contains both "room" and "type"
function findRoomTypesSheetName(wb) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (n.includes('room') && n.includes('type')) return name; // "RoomTypes" / "Room Types"
  }
  return null;
}

/* ----------------------- handler ----------------------- */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Parse multipart form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, f, fl) => (err ? reject(err) : resolve({ fields: f, files: fl })));
    });

    const year  = Number(Array.isArray(fields.year)  ? fields.year[0]  : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    const wb = XLSX.readFile(filePath);

    /* -------- DAILY (first sheet) -------- */
    const dailySheetName = wb.SheetNames[0];
    const dailyWS = wb.Sheets[dailySheetName];
    const dailyRaw = XLSX.utils.sheet_to_json(dailyWS, {
      raw: true,
      defval: null,
      blankrows: false,
    });

    const dailyRecords = [];
    for (const r of dailyRaw) {
      const dateCell = pick(r, ['date', 'day', 'dayofmonth']);
      const date = toUtcMidnightDate(dateCell, year, month);
      if (!date) continue;

      const revenue   = toNum(pick(r, ['revenue', 'rev']));
      const target    = toNum(pick(r, ['target', 'tgt']));
      const arr       = toNum(pick(r, ['arr', 'rate', 'avg rate', 'average rate']));
      const occRaw    = pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %']);
      const occupancy = toPercent(occRaw);

      dailyRecords.push({ date, revenue, target, arr, occupancy });
    }

    let dailyCount = 0;
    if (dailyRecords.length) {
      await prisma.$transaction(
        dailyRecords.map((row) =>
          prisma.dailyMetric.upsert({
            where: { date: row.date },
            update: { revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
            create: { date: row.date, revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
          })
        )
      );
      dailyCount = dailyRecords.length;
    }

    /* -------- ROOM TYPES (optional) -------- */
    const rtSheetName = findRoomTypesSheetName(wb);
    let rtCount = 0;

    if (rtSheetName) {
      const rtWS = wb.Sheets[rtSheetName];
      const rtRaw = XLSX.utils.sheet_to_json(rtWS, { raw: true, defval: null, blankrows: false });

      const rows = [];
      for (const r of rtRaw) {
        const dateCell  = pick(r, ['date', 'day', 'dayofmonth']);
        const date      = toUtcMidnightDate(dateCell, year, month);
        if (!date) continue;

        const type      = String(pick(r, ['type', 'roomtype', 'room type']) || '').trim();
        if (!type) continue;

        const available = toNum(pick(r, ['available', 'avail', 'room-nights available', 'room nights available']));
        const sold      = toNum(pick(r, ['sold', 'rooms sold', 'roomnights', 'room nights', 'nights sold']));
        const revenue   = toNum(pick(r, ['revenue', 'rev']));
        const rate      = toNum(pick(r, ['rate', 'arr']));

        // If occupancy provided, normalize; else derive from sold/available
        let occupancy = toPercent(pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %']));
        if (occupancy == null && sold != null && available) {
          occupancy = Math.round((sold / available) * 1000) / 10; // one decimal
        }

        rows.push({ date, type, available, sold, revenue, rate, occupancy });
      }

      if (rows.length) {
        await prisma.$transaction(
          rows.map((row) =>
            prisma.roomTypeMetric.upsert({
              where: { date_type: { date: row.date, type: row.type } }, // requires @@unique([date, type], name: "date_type")
              update: {
                available: row.available,
                sold: row.sold,
                revenue: row.revenue,
                rate: row.rate,
                occupancy: row.occupancy,
              },
              create: {
                date: row.date,
                type: row.type,
                available: row.available,
                sold: row.sold,
                revenue: row.revenue,
                rate: row.rate,
                occupancy: row.occupancy,
              },
            })
          )
        );
        rtCount = rows.length;
      }
    }

    return res.status(200).json({
      ok: true,
      importedDays: dailyCount,
      importedRoomTypeRows: rtCount,
      note: rtSheetName ? `RoomTypes sheet: "${rtSheetName}"` : 'RoomTypes sheet not found',
    });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
