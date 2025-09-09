// pages/api/import/index.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import formidable from 'formidable';
import { Writable } from 'stream';

export const config = {
  api: { bodyParser: false }, // we'll read raw or use formidable ourselves
};

/* ------------------------------ utils ------------------------------ */

const FORCE_LOCAL_WRITE = process.env.FORCE_LOCAL_WRITE === '1';

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[^0-9.-]+/g, '');
  const n = s ? Number(s) : 0;
  return Number.isFinite(n) ? n : 0;
};
const asPct = (v) => (num(v) <= 1.5 ? num(v) * 100 : num(v));
const lc = (s) => String(s || '').toLowerCase().trim();

/** case-insensitive contains/equal key pick with simple synonym tolerance */
const pick = (row, ...cands) => {
  if (!row || typeof row !== 'object') return undefined;
  const keys = Object.keys(row);
  for (const cand of cands) {
    const want = lc(cand);
    // exact or substring match (both ways so "arr/adr" or "average rate" still match)
    const hitKey = keys.find((k) => {
      const kk = lc(k);
      return kk === want || kk.includes(want) || want.includes(kk);
    });
    if (hitKey != null) return row[hitKey];
  }
  return undefined;
};

const hasKeys = (row, keys) =>
  keys.some((k) => Object.keys(row || {}).some((rk) => lc(rk) === lc(k) || lc(rk).includes(lc(k))));

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pickFirstFile(files) {
  if (!files || typeof files !== 'object') return null;
  for (const val of Object.values(files)) {
    if (!val) continue;
    if (Array.isArray(val)) {
      for (const f of val) if (f && (f.filepath || f.path || f.buffer || f.originalFilename)) return f;
    } else if (typeof val === 'object') {
      if (val.filepath || val.path || val.buffer || val.originalFilename) return val;
    }
  }
  return null;
}

function makeMemoryWriter(file) {
  const chunks = [];
  return new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    final(cb) { file.buffer = Buffer.concat(chunks); cb(); },
  });
}

async function parseCsv(text) {
  const sep = text.includes(';') && !text.includes(',') ? ';' : ',';
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines.shift().split(sep).map((s) => s.trim());
  return lines.filter(Boolean).map((row) => {
    const vals = row.split(sep).map((s) => s.trim());
    const o = {};
    headers.forEach((h, i) => (o[h] = vals[i]));
    return o;
  });
}

/* ------------------------------ normalize ------------------------------ */

function normalize({ overview = {}, daily = [], roomTypes = [], history = [] }) {
  // --- Daily
  const dailyData = daily.map((d, i) => {
    const dayCol  = pick(d, 'day', 'Day', 'd');
    const dateCol = pick(d, 'date', 'Date', 'dt', 'day date');
    const revCol  = pick(d, 'revenue', 'Revenue', 'actual', 'actual revenue', 'accommodation revenue', 'total revenue', 'room revenue');
    const tgtCol  = pick(d, 'target', 'Target', 'budget', 'Budget', 'daily target', 'goal', 'forecast');
    const rateCol = pick(d, 'rate', 'Rate', 'arr', 'ARR', 'adr', 'ADR', 'arr/adr', 'avg rate', 'average rate');
    const occCol  = pick(d, 'occupancy', 'Occupancy', 'occ', 'occ%', 'occupancy rate');

    let day = num(dayCol);
    if (!day && dateCol) {
      try { const dt = new Date(dateCol); if (!Number.isNaN(dt.valueOf())) day = dt.getDate(); } catch {}
    }
    if (!day) day = i + 1;

    return {
      day,
      date: dateCol ?? null,
      revenue: num(revCol),
      target: num(tgtCol),
      rate: num(rateCol),
      occupancy: asPct(occCol),
    };
  });

  // --- Room Types (case-insensitive + common synonyms)
  const roomTypesNorm = (roomTypes || []).map((r) => ({
    type:       pick(r, 'type', 'name', 'room type', 'roomtype') || 'Unknown',
    available:  num(pick(r, 'available', 'Available', 'rooms available', 'available rooms', 'avail')),
    sold:       num(pick(r, 'sold', 'Sold', 'rooms sold', 'sold rooms', 'occupied', 'booked')),
    revenue:    num(pick(r, 'revenue', 'Revenue', 'room revenue', 'accommodation revenue', 'total revenue')),
    rate:       num(pick(r, 'rate', 'Rate', 'arr', 'ARR', 'adr', 'ADR', 'arr/adr', 'avg rate', 'average rate')),
    occupancy:  asPct(pick(r, 'occupancy', 'Occupancy', 'occ', 'Occ', 'occ%')),
  }));

  // --- History (unchanged, but tolerate caps)
  const historyNorm = (history || []).map((h) => ({
    year: String(pick(h, 'year', 'Year') ?? ''),
    roomsSold: num(pick(h, 'roomsSold', 'rooms sold')),
    occupancy: asPct(pick(h, 'occupancy', 'Occupancy')),
    revenue: num(pick(h, 'revenue', 'Revenue')),
    rate: num(pick(h, 'rate', 'avg rate', 'average rate')),
  }));

  // --- Overview summary with tolerant keys
  const ovRevenue = num(pick(overview, 'revenueToDate', 'revenue to date', 'revenue'));
  const ovTarget  = num(pick(overview, 'targetToDate', 'target to date', 'target'));
  const ovArr     = num(pick(overview, 'averageRoomRate', 'avg rate', 'arr', 'adr', 'average rate'));
  const ovOcc     = asPct(pick(overview, 'occupancyRate', 'occupancy'));

  return {
    overview: {
      revenueToDate: ovRevenue,
      targetToDate:  ovTarget,
      averageRoomRate: ovArr,
      occupancyRate: ovOcc,
      daily: dailyData,
      roomTypes: roomTypesNorm,
      history: historyNorm,
      lastUpdated: new Date().toISOString(),
    },
  };
}

/* ------------------------------ storage ------------------------------ */

async function uploadToAdminBucket(key, json) {
  const url = process.env.ADMIN_BUCKET_PUT_URL;
  const token = process.env.ADMIN_BUCKET_TOKEN;
  if (!url) return { ok: false, reason: 'ADMIN_BUCKET_PUT_URL not configured' };

  const res = await fetch(`${url}?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(json),
  });
  const txt = await res.text().catch(() => '');
  return res.ok ? { ok: true } : { ok: false, reason: `bucket upload failed (${res.status}): ${txt.slice(0, 200)}` };
}

/* ------------------------------ handler ------------------------------ */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const ct = String(req.headers['content-type'] || '');
    let year, month, filename, buf;

    if (/multipart\/form-data/i.test(ct)) {
      // Fallback: support multipart via formidable
      const form = formidable({
        multiples: true,
        keepExtensions: true,
        uploadDir: os.tmpdir(),
        fileWriteStreamHandler: makeMemoryWriter, // also capture a buffer
        maxFileSize: 25 * 1024 * 1024,
      });

      const { fields, files } = await new Promise((resolve, reject) => {
        form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
      });

      year = Number(fields.year);
      month = Number(fields.month);

      const fileObj =
        (files && (files.file || files.report || files.upload)) ||
        pickFirstFile(files);

      if (!fileObj) {
        const known = Object.keys(files || {});
        return res.status(400).json({
          error: 'IMPORT_FAILED',
          reason: `No file received. Found file fields: ${known.length ? known.join(', ') : 'none'}`,
        });
      }

      filename = lc(fileObj.originalFilename || fileObj.newFilename || '');
      const filepath = fileObj.filepath || fileObj.path || null;
      const buffer = fileObj.buffer || null;
      if (!filepath && !buffer) {
        return res.status(400).json({
          error: 'IMPORT_FAILED',
          reason: 'Unable to read uploaded file path or buffer (formidable)',
        });
      }
      buf = buffer || (await fs.readFile(filepath));
    } else {
      // Preferred path: raw binary
      year = Number(req.query.year);
      month = Number(req.query.month);
      filename = lc(req.query.filename || req.headers['x-filename'] || 'upload.xlsx');
      buf = await readRawBody(req);
      if (!buf?.length) {
        return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Empty request body' });
      }
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
        !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Invalid year/month' });
    }

    const key = `${year}-${String(month).padStart(2, '0')}.json`;

    let parsed;
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.read(buf, { type: 'buffer' });

      const sheetBy = (patterns) => {
        const names = wb.SheetNames || [];
        const idx = names.findIndex((n) => patterns.some((p) => lc(n).includes(lc(p))));
        return idx >= 0 ? wb.Sheets[names[idx]] : null;
      };
      const toJson = (sheet) =>
        sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false }) : [];

      const overview = toJson(sheetBy(['overview', 'summary', 'totals']))[0] || {};
      let daily     = toJson(sheetBy(['daily', 'days', 'daily revenue', 'calendar', 'month']));
      let roomTypes = toJson(sheetBy(['roomtypes', 'room types', 'types', 'rooms']));
      let history   = toJson(sheetBy(['history', 'annual', 'yoy', 'yearly']));

      if (!daily.length) {
        for (const name of wb.SheetNames) {
          const sj = toJson(wb.Sheets[name]);
          if (sj.length && hasKeys(sj[0], ['day', 'date']) && hasKeys(sj[0], ['revenue', 'actual'])) {
            daily = sj; break;
          }
        }
      }
      parsed = normalize({ overview, daily, roomTypes, history });
    } else if (filename.endsWith('.csv')) {
      const daily = await parseCsv(buf.toString('utf8'));
      parsed = normalize({ overview: {}, daily, roomTypes: [], history: [] });
    } else {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Unsupported file type (use .xlsx, .xls or .csv)' });
    }

    const rows = parsed?.overview?.daily?.length ?? 0;
    if (!rows) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'No rows found in Daily sheet (or columns not recognised)' });
    }

    // Upload to bucket if configured; otherwise write locally in dev.
    const bucket = await uploadToAdminBucket(key, parsed);
    if (bucket.ok) return res.status(200).json({ ok: true, key, rows });

    if (FORCE_LOCAL_WRITE || process.env.NODE_ENV !== 'production') {
      const outDir = path.join(process.cwd(), 'public', 'data');
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, key), JSON.stringify(parsed, null, 2));
      return res.status(200).json({
        ok: true,
        key,
        rows,
        note: FORCE_LOCAL_WRITE ? 'written to public/data (forced)' : 'written to public/data (dev)',
      });
    }

    return res.status(500).json({
      error: 'IMPORT_FAILED',
      reason: bucket.reason || 'No storage configured (set ADMIN_BUCKET_PUT_URL or use FORCE_LOCAL_WRITE=1 in dev)',
    });
  } catch (err) {
    return res.status(500).json({ error: 'IMPORT_FAILED', reason: String(err?.message || err) });
  }
}
