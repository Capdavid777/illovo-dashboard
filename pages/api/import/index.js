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

// ---------- helpers ----------
const toNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Excel often stores 57% as 0.57 (with % formatting). Store percent in DB.
const normalizeOccupancyToPercent = (v, sold, available) => {
  // If no explicit v but we have sold/available, derive it
  if ((v === '' || v == null) && Number.isFinite(sold) && Number.isFinite(available) && available > 0) {
    return Math.round((sold / available) * 1000) / 10; // 1 decimal
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
};

// Parse Excel serial or arbitrary date-ish into UTC midnight
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

// Case-insensitive header read
const pick = (obj, keys) => {
  if (!obj) return null;
  for (const k of keys) if (obj[k] != null) return obj[k];
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), v]));
  for (const k of keys.map(String).map((s) => s.toLowerCase())) if (lower[k] != null) return lower[k];
  return null;
};

// Read sheet to JSON with blanks preserved
const readSheet = (wb, nameOrIndex = 0) => {
  const sheetName = typeof nameOrIndex === 'number' ? wb.SheetNames[nameOrIndex] : nameOrIndex;
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { raw: true, defval: null, blankrows: false });
};

// Find a sheet by exact or loose name (e.g. "Room Types" / "RoomTypes")
const findRoomTypeSheetName = (wb) => {
  const names = wb.SheetNames || [];
  const wanted = ['room types', 'roomtypes'];
  for (const n of names) {
    const nm = String(n).trim().toLowerCase();
    if (wanted.includes(nm)) return n;              // exact
  }
  // loose contains
  for (const n of names) {
    const nm = String(n).trim().toLowerCase();
    if (nm.includes('room') && nm.includes('type')) return n;
  }
  return null;
};

// ---------- main handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Parse form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, f, fl) => (err ? reject(err) : resolve({ fields: f, files: fl })));
    });

    const year  = Number(Array.isArray(fields.year)  ? fields.year[0]  : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);
    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    // Read workbook
    const wb = XLSX.readFile(filePath);

    // -------- Overview (sheet 1) -> DailyMetric --------
    const overviewRows = readSheet(wb, 0);
    const dailyRecords = [];
    for (const r of overviewRows) {
      const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
      const date = toUtcMidnightDate(dateCell, year, month);
      if (!date) continue;

      const revenue   = toNum(pick(r, ['Revenue', 'revenue']));
      const target    = toNum(pick(r, ['Target', 'target']));
      const arr       = toNum(pick(r, ['ARR', 'arr', 'Rate', 'rate']));
      const occRaw    = pick(r, ['Occupancy', 'occupancy', 'Occ', 'occ', 'Occ %', 'Occupancy %']);
      const occupancy = normalizeOccupancyToPercent(occRaw, null, null);

      dailyRecords.push({ date, revenue, target, arr, occupancy });
    }

    const dailyResult = await Promise.all(
      dailyRecords.map((row) =>
        prisma.dailyMetric.upsert({
          where: { date: row.date },
          update: { revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
          create: { date: row.date, revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
        })
      )
    );

    // -------- Room Types (optional sheet) -> RoomType + RoomTypeDaily --------
    let roomTypeUpserts = 0;
    const rtSheetName = findRoomTypeSheetName(wb);
    if (rtSheetName) {
      const rtRows = readSheet(wb, rtSheetName);

      for (const r of rtRows) {
        const dateCell = pick(r, ['Date', 'date', 'Day', 'day']);
        const date = toUtcMidnightDate(dateCell, year, month);
        const typeName = String(pick(r, ['Type', 'type', 'Room Type', 'room type'])).trim();
        if (!date || !typeName) continue;

        // Resolve or create the RoomType
        const type = await prisma.roomType.upsert({
          where: { name: typeName },
          update: {},
          create: { name: typeName },
        });

        const rooms      = toNum(pick(r, ['Rooms', 'rooms']));
        const available  = toNum(pick(r, ['Available', 'available', 'Avail', 'avail']));
        const sold       = toNum(pick(r, ['Sold', 'sold', 'Room Nights', 'room nights']));
        const revenue    = toNum(pick(r, ['Revenue', 'revenue']));
        const rate       = toNum(pick(r, ['Rate', 'rate', 'ARR', 'arr']));
        const occRaw     = pick(r, ['Occupancy', 'occupancy', 'Occ %', 'Occ', 'occ']);
        const occupancy  = normalizeOccupancyToPercent(occRaw, sold ?? undefined, available ?? undefined);

        await prisma.roomTypeDaily.upsert({
          where: { roomTypeId_date: { roomTypeId: type.id, date } },
          update: { rooms, available, sold, revenue, rate, occupancy },
          create: { roomTypeId: type.id, date, rooms, available, sold, revenue, rate, occupancy },
        });

        roomTypeUpserts++;
      }
    }

    return res.status(200).json({
      ok: true,
      importedOverviewDays: dailyResult.length,
      importedRoomTypeRows: roomTypeUpserts,
      note: rtSheetName ? `Room types sheet used: "${rtSheetName}"` : 'No room types sheet found',
    });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
