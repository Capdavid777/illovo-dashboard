// pages/api/import-month.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';

// IMPORTANT for Vercel: use the Node runtime and turn off the default body parser
export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

// reuse Prisma in dev
const prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ---------- helpers ----------
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const STRIP_NUM = /[^0-9.\-]/g;
const toNumber = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(STRIP_NUM, ''));
  return isFinite(n) ? n : null;
};

const parsePercent = (v) => {
  if (v == null || v === '') return null;
  let n = typeof v === 'number' ? v : Number(String(v).replace(STRIP_NUM, ''));
  if (!isFinite(n)) return null;
  // if looks like a fraction (0..1), convert to %
  if (n > 0 && n <= 1) n = n * 100;
  // clip to [0, 100]
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return Math.round(n * 10) / 10;
};

const excelSerialToDate = (num) => {
  // Excel serial (days since 1899-12-30)
  const ms = Math.round((Number(num) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? null : d;
};

const parseDateLoose = (v, year, month) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToDate(v);

  const s = String(v).trim();

  // dd/mm/yyyy or d/m/yyyy
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [_, d, m, y] = m1;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(dt) ? null : dt;
  }
  // yyyy-mm-dd or yyyy/mm/dd
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m2) {
    const [_, y, m, d] = m2;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(dt) ? null : dt;
  }

  // Fallback: native parser (works for "22 Aug 2025", etc.)
  const dt = new Date(s);
  if (!isNaN(dt)) return dt;

  // If sheet only has "Day" numbers, construct from UI year/month
  const dayNum = toNumber(s);
  if (dayNum) {
    const dt2 = new Date(Date.UTC(year, month - 1, dayNum));
    return isNaN(dt2) ? null : dt2;
  }
  return null;
};

// map many possible header names to a logical field
const FIELD_SYNONYMS = {
  date: ['date', 'day', 'reportdate'],
  revenue: ['revenue', 'rev', 'revenue_r', 'revenue(r)', 'revenue_zar', 'actualrevenue'],
  target: ['target', 'dailytarget', 'target_r', 'target(r)'],
  occupancy: ['occupancy', 'occ', 'occ%', 'occpercent', 'occupancy(%)', 'occupancyrate'],
  arr: ['arr', 'averageroomrate', 'avgroomrate', 'average rate', 'rate', 'arr_r', 'arr(r)'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
};

const findField = (rowObj, keys) => {
  // normalize keys in the row once
  const normMap = {};
  for (const k of Object.keys(rowObj)) {
    normMap[norm(k)] = k;
  }
  for (const alias of keys) {
    const k = normMap[alias];
    if (k != null) return rowObj[k];
  }
  return undefined;
};

const dayStartUTC = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    // 1) parse the multipart form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, keepExtensions: true });
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const year = Number(fields.year);
    const month = Number(fields.month); // 1..12
    if (!year || !month) {
      return res.status(400).json({ ok: false, error: 'MISSING_YEAR_MONTH' });
    }

    const file = files.file;
    if (!file || !file.filepath) {
      return res.status(400).json({ ok: false, error: 'MISSING_FILE' });
    }

    const buf = fs.readFileSync(file.filepath);
    let rows = [];

    // 2) read CSV or XLSX into row objects
    const isCsv = /\.csv$/i.test(file.originalFilename || '');
    if (isCsv) {
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    } else {
      const wb = XLSX.read(buf, { type: 'buffer' });
      // look across all sheets; concatenate
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        const arr = XLSX.utils.sheet_to_json(sheet, { defval: null });
        rows = rows.concat(arr);
      }
    }

    // 3) map rows to our schema
    const toImport = [];
    const skipped = [];
    for (const row of rows) {
      // normalize & find values by synonyms
      const dateRaw = findField(row, FIELD_SYNONYMS.date);
      const revenueRaw = findField(row, FIELD_SYNONYMS.revenue);
      const targetRaw = findField(row, FIELD_SYNONYMS.target);
      const occRaw = findField(row, FIELD_SYNONYMS.occupancy);
      const arrRaw = findField(row, FIELD_SYNONYMS.arr);
      const notesRaw = findField(row, FIELD_SYNONYMS.notes);

      // build / parse date
      const dt = parseDateLoose(dateRaw, year, month);
      if (!dt) {
        skipped.push({ reason: 'NO_DATE', row });
        continue;
      }
      if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month) {
        skipped.push({ reason: 'OUT_OF_MONTH', rowDate: dt.toISOString().slice(0, 10) });
        continue;
      }

      const revenue = toNumber(revenueRaw);
      const target = toNumber(targetRaw);
      const occupancy = parsePercent(occRaw); // as % 0..100
      const arr = toNumber(arrRaw);
      const notes = notesRaw == null ? null : String(notesRaw);

      // allow partial rows (e.g., only revenue filled)
      if (
        revenue == null &&
        target == null &&
        occupancy == null &&
        arr == null &&
        (notes == null || notes === '')
      ) {
        skipped.push({ reason: 'EMPTY_ROW' });
        continue;
      }

      toImport.push({
        date: dayStartUTC(dt),
        revenue: revenue ?? null,
        target: target ?? null,
        occupancy: occupancy ?? null,
        arr: arr ?? null,
        notes: notes,
      });
    }

    // 4) upsert each day
    let imported = 0;
    for (const r of toImport) {
      await prisma.dailyMetric.upsert({
        where: { date: r.date },
        update: {
          revenue: r.revenue,
          target: r.target,
          occupancy: r.occupancy,
          arr: r.arr,
          notes: r.notes,
        },
        create: r,
      });
      imported++;
    }

    return res.status(200).json({
      ok: true,
      imported,
      skipped: skipped.length,
      message:
        `Imported ${imported} day(s). Skipped ${skipped.length}.` +
        (skipped.length
          ? ' (Common reasons: header mismatch, no date, or rows outside the chosen month.)'
          : ''),
      details: skipped.slice(0, 10), // first few reasons for quick debugging
    });
  } catch (err) {
    console.error('import-month error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
