<<<<<<< HEAD
// pages/api/admin/import/index.js
=======
// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
import * as XLSX from 'xlsx';
import { getSession } from '@auth0/nextjs-auth0';
import prisma from '../../../lib/prisma'; // adjust if your prisma import path differs

<<<<<<< HEAD
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
=======
export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

// Reuse Prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

/* ------------------------------ helpers ------------------------------ */

const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
};

// Normalize occupancy to a percent number (0..100)
const toPercent = (v) => {
<<<<<<< HEAD
  const n = toNum(v, 0);
  if (!Number.isFinite(n)) return 0;
  // accept either 0..1 fraction or 0..100 percentage
  return n <= 1.5 ? n * 100 : n;
};

// Flexible getter: try multiple header spellings (case-insensitive)
const getKey = (row, keys) => {
  const map = {};
  Object.keys(row || {}).forEach((k) => (map[k.toLowerCase()] = k));
  for (const want of keys) {
    const hit = map[want.toLowerCase()];
    if (hit) return row[hit];
  }
  return undefined;
};

export const config = {
  api: { bodyParser: false }, // we’re reading multipart via formidable/next-connect in your current impl
=======
  const n = toNum(v);
  if (n == null) return null;
  return n <= 1.5 ? Math.round(n * 100 * 10) / 10 : Math.round(n * 10) / 10;
};

function toUtcMidnightDate(cell, year, month) {
  if (cell == null || cell === '') return null;

  // Excel serial?
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0));
  }

  // Parse-able date?
  const asDate = new Date(cell);
  if (!isNaN(asDate)) {
    return new Date(Date.UTC(
      asDate.getUTCFullYear(),
      asDate.getUTCMonth(),
      asDate.getUTCDate(),
      0, 0, 0, 0
    ));
  }

  // Day-of-month only (e.g., "22")
  const dayNum = Number(String(cell).trim());
  if (Number.isFinite(dayNum)) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, dayNum, 0, 0, 0, 0));
  }

  return null;
}

// case/space-insensitive header lookup
const pick = (row, candidates) => {
  const m = new Map(Object.entries(row).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
  for (const c of candidates) {
    const key = String(c).trim().toLowerCase();
    if (m.has(key)) return m.get(key);
  }
  return null;
};

// find likely Room Types sheet
const findRoomTypesSheetName = (wb) => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (n.includes('room') && n.includes('type')) return name;
  }
  return null;
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
};

// find likely Historical sheet
const findHistoricalSheetName = (wb) => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (n.includes('historical') || n.includes('history') || n.includes('year')) return name;
  }
  return null;
};

/* ------------------------------ handler ------------------------------ */

export default async function handler(req, res) {
<<<<<<< HEAD
  // --- Auth guard (keep whatever you have)
  const session = await getSession(req, res);
  if (!session?.user) {
    return res.status(401).json({ ok: false, error: 'UNAUTH' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD' });
  }

  try {
    // however you’re parsing the uploaded file today — keep that
    // Below is a common pattern with `formidable` already in many setups.
    const { fields, files } = await parseMultipart(req); // <<< use your existing helper
    const file = files?.file; // adapt if your field name differs

    const wb = XLSX.readFile(file.filepath || file.path);
=======
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Parse form-data (file + year + month)
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, f, fl) => (err ? reject(err) : resolve({ fields: f, files: fl })));
    });

    const year  = Number(Array.isArray(fields.year)  ? fields.year[0]  : fields.year);
    const month = Number(Array.isArray(fields.month) ? fields.month[0] : fields.month);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploaded?.filepath || uploaded?.path;
    if (!filePath) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb

    /* ------------------ existing Daily + RoomTypes import ------------------ */
    // Keep your current logic here unchanged…

<<<<<<< HEAD
    /* ------------------ NEW: Historical (Yearly) sheet ------------------ */
    const histSheet =
      wb.Sheets['Historical'] ||
      wb.Sheets['History'] ||
      wb.Sheets['historical'] ||
      wb.Sheets['HISTORICAL'];

    if (histSheet) {
      const rows = XLSX.utils.sheet_to_json(histSheet, { defval: null });

      // upsert all yearly rows
      for (const r of rows) {
        const year      = toNum(getKey(r, ['year']));
        if (!year) continue; // need a year

        const roomsSold = toNum(getKey(r, ['roomsSold', 'rooms_sold', 'sold']));
        const occupancy = toPercent(getKey(r, ['occupancy', 'occ', 'occ%']));
        const revenue   = toNum(getKey(r, ['revenue', 'rev']));
        const rate      = toNum(getKey(r, ['rate', 'adr', 'avg rate', 'avg_rate']));

        await prisma.yearMetric.upsert({
          where: { year },
          update: { roomsSold, occupancy, revenue, rate },
          create: { year, roomsSold, occupancy, revenue, rate },
        });
      }
    }

    return res.json({ ok: true, message: 'Import completed (including Historical, if present).' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'IMPORT_FAIL' });
=======
    /* ---------- DAILY (first sheet) ---------- */
    const dailySheetName = wb.SheetNames[0];
    const dailyWS = wb.Sheets[dailySheetName];
    const dailyRaw = XLSX.utils.sheet_to_json(dailyWS, { raw: true, defval: null, blankrows: false });

    const dailyRecords = [];
    for (const r of dailyRaw) {
      const dateCell = pick(r, ['date', 'day']);
      const date = toUtcMidnightDate(dateCell, year, month);
      if (!date) continue;

      const revenue   = toNum(pick(r, ['revenue']));
      const target    = toNum(pick(r, ['target']));
      const arr       = toNum(pick(r, ['arr', 'rate']));
      const occRaw    = pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %']);
      const occupancy = toPercent(occRaw);

      dailyRecords.push({ date, revenue, target, arr, occupancy });
    }

    let dailyCount = 0;
    if (dailyRecords.length) {
      const results = await Promise.all(
        dailyRecords.map((row) =>
          prisma.dailyMetric.upsert({
            where: { date: row.date },
            update: { revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
            create: { date: row.date, revenue: row.revenue, target: row.target, arr: row.arr, occupancy: row.occupancy },
          })
        )
      );
      dailyCount = results.length;
    }

    /* ---------- ROOM TYPES (optional sheet) ---------- */
    const rtSheetName = findRoomTypesSheetName(wb);
    let rtCount = 0;

    if (rtSheetName) {
      const rtWS  = wb.Sheets[rtSheetName];
      const rtRaw = XLSX.utils.sheet_to_json(rtWS, { raw: true, defval: null, blankrows: false });

      const rows = [];
      for (const r of rtRaw) {
        const dateCell  = pick(r, ['date', 'day']);
        const date      = toUtcMidnightDate(dateCell, year, month);
        if (!date) continue;

        const type      = String(pick(r, ['type', 'roomtype', 'room type']) || '').trim();
        if (!type) continue;

        const available = toNum(pick(r, ['available', 'avail']));
        const sold      = toNum(pick(r, ['sold', 'rooms sold', 'roomnights', 'room nights']));
        const revenue   = toNum(pick(r, ['revenue']));
        const rate      = toNum(pick(r, ['rate', 'arr']));
        const occRaw    = pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %']);
        const occupancy = toPercent(occRaw);

        rows.push({ date, type, available, sold, revenue, rate, occupancy });
      }

      if (rows.length) {
        const results = await Promise.all(
          rows.map((row) =>
            prisma.roomTypeMetric.upsert({
              where: { date_type: { date: row.date, type: row.type } },
              update: {
                available: row.available, sold: row.sold, revenue: row.revenue,
                rate: row.rate, occupancy: row.occupancy,
              },
              create: {
                date: row.date, type: row.type, available: row.available, sold: row.sold,
                revenue: row.revenue, rate: row.rate, occupancy: row.occupancy,
              },
            })
          )
        );
        rtCount = results.length;
      }
    }

    /* ---------- HISTORICAL (optional sheet) ---------- */
    const histSheetName = findHistoricalSheetName(wb); // e.g. "Historical", "History", "Yearly"
    let histCount = 0;

    if (histSheetName) {
      const hWS  = wb.Sheets[histSheetName];
      const hRaw = XLSX.utils.sheet_to_json(hWS, { raw: true, defval: null, blankrows: false });

      // Expected headers (case/space-insensitive):
      // Year | Rooms Sold | Revenue | Rate | Occupancy
      const yrRows = [];
      for (const r of hRaw) {
        const y = toNum(pick(r, ['year', 'yr']));
        if (!Number.isFinite(y)) continue;

        const roomsSold = toNum(pick(r, ['rooms sold', 'roomssold', 'rooms_sold', 'rooms']));
        const revenue   = toNum(pick(r, ['revenue']));
        const rate      = toNum(pick(r, ['rate', 'arr', 'avg rate', 'average rate']));
        const occPct    = toPercent(pick(r, ['occupancy', 'occ', 'occupancy %', 'occ %']));

        yrRows.push({ year: Number(y), roomsSold: roomsSold ?? 0, revenue: revenue ?? 0, rate: rate ?? 0, occupancy: occPct ?? 0 });
      }

      if (yrRows.length) {
        const results = await Promise.all(
          yrRows.map((row) =>
            prisma.yearMetric.upsert({
              where: { year: row.year },
              update: {
                roomsSold: row.roomsSold,
                revenue: row.revenue,
                rate: row.rate,
                occupancy: row.occupancy,
              },
              create: row,
            })
          )
        );
        histCount = results.length;
      }
    }

    return res.status(200).json({
      ok: true,
      importedDays: dailyCount,
      importedRoomTypeRows: rtCount,
      importedYears: histCount,
      note: {
        roomTypesSheet: rtSheetName || 'not found',
        historicalSheet: histSheetName || 'not found',
      },
    });
  } catch (err) {
    console.error('IMPORT ERROR:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
>>>>>>> bb86a5dca9293db80ba022033ce1c20ee3098ecb
  }
}

/* ---------------- helpers you likely already have ---------------- */
// If you already have a multipart parser, keep using it and delete this.
import formidable from 'formidable';
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, keepExtensions: true });
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}
