// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ---------- helpers ----------
const toInt = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

// Convert 0.46 / 46 / "46%" -> 46.0
const toPercent = (v, decimals = 1) => {
  if (v == null || v === '') return null;
  const cleaned = String(v).trim().replace('%', '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1.5 ? n * 100 : n;
  return +pct.toFixed(decimals);
};

// Excel serial or text → UTC midnight date; fallback to (year,month,day)
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

const firstOfMonthUTC = (y, m) => new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));

const sheetToJson = (ws) =>
  XLSX.utils.sheet_to_json(ws, { raw: true, defval: null, blankrows: false });

const pick = (obj, names) => {
  for (const k of names) if (obj[k] != null) return obj[k];
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), v]));
  for (const k of names.map((x) => String(x).toLowerCase())) if (lower[k] != null) return lower[k];
  return null;
};

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const year = Number(Array.isArray(fields.year) ? fields.year[0] : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    const wb = XLSX.readFile(filePath);

    // ---- DAILY SHEET (first sheet) ----
    const dailySheetName = wb.SheetNames[0];
    const daily = sheetToJson(wb.Sheets[dailySheetName]);

    const dailyRecords = [];
    for (const r of daily) {
      const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
      const date = toUtcMidnightDate(dateCell, year, month);
      if (!date) continue;

      const revenue = toInt(pick(r, ['Revenue', 'revenue']));
      const target = toInt(pick(r, ['Target', 'target']));
      const arr = toInt(pick(r, ['ARR', 'arr', 'Rate', 'rate']));
      const occRaw = pick(r, ['Occupancy', 'occupancy', 'Occ', 'occ', 'Occ %', 'Occupancy %']);
      const occupancy = toPercent(occRaw, 1);

      dailyRecords.push({ date, revenue, target, arr, occupancy });
    }

    // Upsert daily rows
    const dailyResults = await Promise.all(
      dailyRecords.map((row) =>
        prisma.dailyMetric.upsert({
          where: { date: row.date },
          update: { revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
          create: { date: row.date, revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
        })
      )
    );

    // ---- ROOM TYPES SHEET (named "RoomTypes" or any sheet containing both "room" and "type") ----
    const roomTypesSheetName =
      wb.SheetNames.find((n) => /room/i.test(n) && /type/i.test(n)) ||
      wb.SheetNames.find((n) => /types/i.test(n)) ||
      null;

    let roomTypeResults = [];
    if (roomTypesSheetName) {
      const ws = wb.Sheets[roomTypesSheetName];
      const rows = sheetToJson(ws);
      const monthDate = firstOfMonthUTC(year, month);

      const typeRecords = [];
      for (const r of rows) {
        const type = String(pick(r, ['Type', 'type', 'Room Type', 'RoomType'] || '')).trim();
        if (!type) continue;

        const available = toInt(pick(r, ['Available', 'available']));
        const sold = toInt(pick(r, ['Sold', 'sold']));
        const revenue = toInt(pick(r, ['Revenue', 'revenue']));
        const rate = toInt(pick(r, ['Rate', 'rate', 'ARR', 'arr']));
        const occ = toPercent(pick(r, ['Occupancy', 'occupancy', 'Occ %', 'Occupancy %']), 0);

        typeRecords.push({ date: monthDate, type, available, sold, revenue, rate, occupancy: occ });
      }

      if (typeRecords.length) {
        roomTypeResults = await Promise.all(
          typeRecords.map((t) =>
            prisma.roomTypeMetric.upsert({
              // requires @@unique([date, type]) in your Prisma model
              where: { date_type: { date: t.date, type: t.type } },
              update: {
                available: t.available,
                sold: t.sold,
                revenue: t.revenue,
                rate: t.rate,
                occupancy: t.occupancy,
              },
              create: t,
            })
          )
        );
      }
    }

    return res.status(200).json({
      ok: true,
      imported: {
        daily: dailyResults.length,
        roomTypes: roomTypeResults.length,
      },
    });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
