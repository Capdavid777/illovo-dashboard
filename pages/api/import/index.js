// pages/api/import/index.js
import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';

// Required for file upload parsing on Next.js API routes
export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

// reuse prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

function parseForm(req) {
  const form = formidable({ multiples: false, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

// try several common header names
function firstFile(files) {
  const candidate = files.file ?? files.report ?? files.upload ?? files.data;
  return Array.isArray(candidate) ? candidate[0] : candidate;
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parseDateCell(value, year, month /* 1-12 */) {
  if (!value) return null;

  // CSV date string?
  if (typeof value === 'string') {
    // Try ISO / dd/mm/yyyy / yyyy-mm-dd
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t + 'T00:00:00Z');

    const m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (m) {
      const [ , d, mo, y ] = m.map(Number);
      const yy = y < 100 ? 2000 + y : y;
      return new Date(Date.UTC(yy, mo - 1, d));
    }
  }

  // Excel serial?
  if (typeof value === 'number') {
    const t = XLSX.SSF.parse_date_code(value);
    if (t) return new Date(Date.UTC(t.y, (t.m || month) - 1, t.d));
  }

  // Fallback: assume "day of month"
  const d = Number(value);
  if (Number.isFinite(d) && d >= 1 && d <= 31) {
    return new Date(Date.UTC(year, month - 1, d));
  }
  return null;
}

async function upsertDailyMetric(row) {
  const { date, revenue, target, occupancy, arr, notes } = row;
  return prisma.dailyMetric.upsert({
    where: { date },
    create: { date, revenue, target, occupancy, arr, notes },
    update: { revenue, target, occupancy, arr, notes },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { fields, files } = await parseForm(req);

    // support both array/object shape and different field names
    const f = firstFile(files);
    if (!f) return res.status(400).json({ ok: false, error: 'MISSING_FILE' });

    const year  = Number(fields.year ?? new Date().getFullYear());
    const month = Number(fields.month ?? (new Date().getMonth() + 1)); // 1..12

    const filePath = f.filepath || f.path; // formidable v3 vs v2
    const buf = await readFile(filePath);

    let rows = [];

    if ((f.originalFilename || f.newFilename || '').toLowerCase().endsWith('.csv')) {
      // CSV
      const text = buf.toString('utf8');
      // very simple CSV splitter; use a real parser if needed
      const lines = text.split(/\r?\n/).filter(Boolean);
      const header = lines.shift();
      const cols = header.split(',').map(s => s.trim().toLowerCase());

      const idx = (name) => cols.findIndex(c => c.includes(name));
      const iDate = idx('date');
      const iDay  = iDate === -1 ? idx('day') : -1;
      const iRev  = idx('revenue');
      const iTgt  = idx('target');
      const iOcc  = idx('occup');
      const iArr  = idx('arr');
      const iNote = idx('note');

      for (const line of lines) {
        const a = line.split(',');
        const raw = (iDate !== -1 ? a[iDate] : (iDay !== -1 ? a[iDay] : null));
        const date = parseDateCell(raw, year, month);
        if (!date) continue;

        rows.push({
          date,
          revenue: toNum(a[iRev]),
          target: toNum(a[iTgt]),
          occupancy: toNum(a[iOcc]), // store as percent, e.g. 46
          arr: toNum(a[iArr]),
          notes: iNote !== -1 ? a[iNote] : null,
        });
      }
    } else {
      // XLSX
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: null });

      // Heuristics: map common headings
      for (const r of json) {
        const raw =
          r.date ?? r.Date ?? r.DAY ?? r.Day ?? r['Day '] ?? r.D ??
          r['day of month'] ?? r['day'];

        const date = parseDateCell(raw, year, month);
        if (!date) continue;

        const revenue   = toNum(r.revenue ?? r.Revenue ?? r.Turnover ?? r['Daily Revenue']);
        const target    = toNum(r.target ?? r.Target ?? r['Daily Target']);
        const occupancy = toNum(r.occupancy ?? r.Occupancy ?? r['Occ %'] ?? r['Occupancy %']);
        const arr       = toNum(r.arr ?? r.ARR ?? r['Average Room Rate'] ?? r['Avg Rate']);
        const notes     = r.notes ?? r.Notes ?? null;

        rows.push({ date, revenue, target, occupancy, arr, notes });
      }
    }

    // upsert rows
    let imported = 0;
    for (const row of rows) {
      await upsertDailyMetric(row);
      imported++;
    }

    // kill all caches
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    return res.status(200).json({ ok: true, imported });
  } catch (err) {
    console.error('import error:', err);
    return res.status(500).json({ ok: false, error: 'IMPORT_FAILED' });
  }
}
