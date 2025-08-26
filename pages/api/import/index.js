import { PrismaClient } from '@prisma/client';
import formidable from 'formidable';
import * as XLSX from 'xlsx';

export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const toPercent = (v) => {
  const n = toNum(v);
  if (n == null) return null;
  return n <= 1.5 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
};
function toUtcMidnightDate(cell, year, month) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  const asDate = new Date(cell);
  if (!isNaN(asDate)) return new Date(Date.UTC(asDate.getUTCFullYear(), asDate.getUTCMonth(), asDate.getUTCDate()));
  const dayNum = Number(String(cell).trim());
  if (Number.isFinite(dayNum)) return new Date(Date.UTC(Number(year), Number(month) - 1, dayNum));
  return null;
}
const pick = (row, keys) => {
  const map = new Map(Object.entries(row).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
  for (const k of keys) {
    const kk = String(k).trim().toLowerCase();
    if (map.has(kk)) return map.get(kk);
  }
  return null;
};
const findRoomTypesSheetName = (wb) => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (n.includes('room') && n.includes('type')) return name;
  }
  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  try {
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

    // Daily sheet (first tab)
    const dailyWS = wb.Sheets[wb.SheetNames[0]];
    const dailyRaw = XLSX.utils.sheet_to_json(dailyWS, { raw: true, defval: null, blankrows: false });
    const daily = [];
    for (const r of dailyRaw) {
      const date = toUtcMidnightDate(pick(r, ['date', 'day']), year, month);
      if (!date) continue;
      daily.push({
        date,
        revenue:   toNum(pick(r, ['revenue'])),
        target:    toNum(pick(r, ['target'])),
        arr:       toNum(pick(r, ['arr', 'rate'])),
        occupancy: toPercent(pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %'])),
      });
    }
    let dailyCount = 0;
    if (daily.length) {
      await Promise.all(daily.map((row) =>
        prisma.dailyMetric.upsert({
          where: { date: row.date },
          update: row,
          create: row,
        })
      ));
      dailyCount = daily.length;
    }

    // Room types sheet (optional)
    const rtSheet = findRoomTypesSheetName(wb);
    let rtCount = 0;
    if (rtSheet) {
      const rtWS = wb.Sheets[rtSheet];
      const rtRaw = XLSX.utils.sheet_to_json(rtWS, { raw: true, defval: null, blankrows: false });
      const rows = [];
      for (const r of rtRaw) {
        const date = toUtcMidnightDate(pick(r, ['date', 'day']), year, month);
        if (!date) continue;
        const type = String(pick(r, ['type', 'roomtype', 'room type']) || '').trim();
        if (!type) continue;
        rows.push({
          date, type,
          available: toNum(pick(r, ['available', 'avail'])),
          sold:      toNum(pick(r, ['sold', 'rooms sold', 'roomnights', 'room nights'])),
          revenue:   toNum(pick(r, ['revenue'])),
          rate:      toNum(pick(r, ['rate', 'arr'])),
          occupancy: toPercent(pick(r, ['occupancy', 'occ', 'occ %', 'occupancy %'])),
        });
      }
      if (rows.length) {
        await Promise.all(rows.map((row) =>
          prisma.roomTypeMetric.upsert({
            where: { date_type: { date: row.date, type: row.type } },
            update: { available: row.available, sold: row.sold, revenue: row.revenue, rate: row.rate, occupancy: row.occupancy },
            create: row,
          })
        ));
        rtCount = rows.length;
      }
    }

    res.status(200).json({ ok: true, importedDays: dailyCount, importedRoomTypeRows: rtCount, note: rtSheet ? `Sheet: ${rtSheet}` : 'No RoomTypes sheet found' });
  } catch (e) {
    console.error('IMPORT ERROR', e);
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
