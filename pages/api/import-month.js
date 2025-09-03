// pages/api/import-month.js
import prisma from '../../lib/prisma';
import formidable from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';

export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

/* ------------------------------ helpers ------------------------------ */

// normalize string for header matching
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

// number helpers
const STRIP_NUM = /[^0-9.\-]/g;
const toNumber = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(STRIP_NUM, ''));
  return Number.isFinite(n) ? n : null;
};

const parsePercent = (v) => {
  if (v == null || v === '') return null;
  let n = typeof v === 'number' ? v : Number(String(v).replace(STRIP_NUM, ''));
  if (!Number.isFinite(n)) return null;
  // allow 0..1 inputs (fractions)
  if (n > 0 && n <= 1) n = n * 100;
  // clip to 0..100 and round to 0.1
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return Math.round(n * 10) / 10;
};

// Excel serial date
const excelSerialToDate = (num) => {
  const ms = Math.round((Number(num) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Build Date from mixed inputs; here we return a **local** date
const parseDateLoose = (v, year, month) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToDate(v);

  const s = String(v).trim();

  // dd/mm/yyyy or d/m/yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mm, y] = m;
    const dt = new Date(Number(y), Number(mm) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // yyyy-mm-dd or yyyy/mm/dd
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const [, y, mm, d] = m;
    const dt = new Date(Number(y), Number(mm) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Native parser (e.g., "22 Aug 2025")
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);

  // Fallback: treat as day number using UI year/month
  const dayNum = toNumber(s);
  if (dayNum) {
    const dt2 = new Date(year, month - 1, dayNum, 0, 0, 0, 0);
    return Number.isNaN(dt2.getTime()) ? null : dt2;
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

// find a value in a row using normalized header synonyms
const findField = (rowObj, keys) => {
  const normMap = {};
  for (const k of Object.keys(rowObj || {})) {
    normMap[norm(k)] = k; // normalized header -> original header
  }
  for (const alias of keys) {
    const hit = normMap[norm(alias)]; // normalize alias too  ← FIX
    if (hit != null) return rowObj[hit];
  }
  return undefined;
};

// reset a JS Date to local midnight
const dayStartLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

// pick first value from possibly-array Formidable outputs
const first = (v) => (Array.isArray(v) ? v[0] : v);

/* ------------------------------ handler ------------------------------ */

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

    const year = Number(first(fields.year));
    const month = Number(first(fields.month)); // 1..12
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, error: 'MISSING_OR_BAD_YEAR_MONTH' });
    }

    let upload = first(files.file);
    if (!upload || !upload.filepath) {
      return res.status(400).json({ ok: false, error: 'MISSING_FILE' });
    }

    const buf = fs.readFileSync(upload.filepath);

    // 2) read CSV/XLS/XLSX into row objects
    // XLSX.read handles CSV/XLS/XLSX when type:'buffer' is provided
    const wb = XLSX.read(buf, { type: 'buffer' });
    let rows = [];
    // If it’s a CSV, there will usually be one sheet; for xlsx, we merge all sheets
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const arr = XLSX.utils.sheet_to_json(sheet, { defval: null });
      rows = rows.concat(arr);
    }

    // 3) map rows to our schema
    const toImport = [];
    const skipped = [];
    for (const row of rows) {
      const dateRaw = findField(row, FIELD_SYNONYMS.date);
      const revenueRaw = findField(row, FIELD_SYNONYMS.revenue);
      const targetRaw = findField(row, FIELD_SYNONYMS.target);
      const occRaw = findField(row, FIELD_SYNONYMS.occupancy);
      const arrRaw = findField(row, FIELD_SYNONYMS.arr);
      const notesRaw = findField(row, FIELD_SYNONYMS.notes);

      const dt = parseDateLoose(dateRaw, year, month);
      if (!dt) {
        skipped.push({ reason: 'NO_DATE' });
        continue;
      }
      if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month) {
        skipped.push({ reason: 'OUT_OF_MONTH', rowDate: dt.toISOString().slice(0, 10) });
        continue;
      }

      const revenue = toNumber(revenueRaw);
      const target = toNumber(targetRaw);
      const occupancy = parsePercent(occRaw); // % 0..100
      const arr = toNumber(arrRaw);
      const notes = notesRaw == null ? null : String(notesRaw);

      // Skip entirely empty rows
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
        date: dayStartLocal(dt),
        revenue: revenue ?? null,
        target: target ?? null,
        occupancy: occupancy ?? null,
        arr: arr ?? null,
        notes,
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
      details: skipped.slice(0, 10),
    });
  } catch (err) {
    console.error('import-month error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
