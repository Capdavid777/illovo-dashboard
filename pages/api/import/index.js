// pages/api/import/index.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import formidable from 'formidable';
import { Writable } from 'stream';

export const config = {
  api: { bodyParser: false },
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

const hasKeys = (row, keys) =>
  keys.some((k) => Object.keys(row || {}).some((rk) => lc(rk) === lc(k) || lc(rk).includes(lc(k))));

const pick = (row, ...cands) => {
  if (!row || typeof row !== 'object') return undefined;
  const keys = Object.keys(row);
  for (const cand of cands) {
    const want = lc(cand);
    const hitKey = keys.find((k) => {
      const kk = lc(k);
      return kk === want || kk.includes(want) || want.includes(kk);
    });
    if (hitKey != null) return row[hitKey];
  }
  return undefined;
};

/** read raw body for non-multipart uploads */
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

/* ------------------------------ room-type inference helpers ------------------------------ */

function numericMap(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const n = num(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}
function findByKeyIncludes(nmap, ...needles) {
  const keys = Object.keys(nmap);
  for (const n of needles) {
    const w = lc(n);
    const hit = keys.find((k) => {
      const kk = lc(k);
      return kk === w || kk.includes(w) || w.includes(kk);
    });
    if (hit) return nmap[hit];
  }
  return undefined;
}
function inferRoomTypeNumbers(row, current) {
  const out = { ...current };
  const nmap = numericMap(row);

  if (!out.revenue) {
    out.revenue = findByKeyIncludes(
      nmap, 'revenue', 'room revenue', 'total revenue', 'accommodation revenue', 'rev', 'mtd revenue'
    ) || 0;
  }
  if (!out.sold) {
    out.sold = findByKeyIncludes(
      nmap, 'sold', 'rooms sold', 'sold rooms', 'nights sold', 'room nights sold', 'booked', 'occupied'
    ) || 0;
  }
  if (!out.available) {
    out.available = findByKeyIncludes(
      nmap, 'available', 'rooms available', 'available rooms', 'available nights', 'nights available', 'avail'
    ) || 0;
  }
  if (!out.rate) {
    out.rate = findByKeyIncludes(
      nmap, 'rate', 'avg rate', 'average rate', 'arr', 'adr', 'arr/adr'
    ) || 0;
  }

  if (!out.revenue) {
    const vals = Object.values(nmap);
    out.revenue = vals.length ? Math.max(...vals) : 0;
  }
  if (!out.available && out.sold) {
    const candidate = Object.values(nmap).filter((v) => v >= out.sold && v <= 100000);
    out.available = candidate.length ? Math.max(...candidate) : 0;
  }
  if (!out.sold && out.available) {
    const candidate = Object.values(nmap).filter((v) => v <= out.available && v <= 5000);
    out.sold = candidate.length ? Math.max(...candidate) : 0;
  }
  if (!out.rate && out.revenue && out.sold) {
    out.rate = Math.round(out.revenue / Math.max(1, out.sold));
  }

  return out;
}

/* ------------------------------ history (YoY) helpers ------------------------------ */

const YEAR_RE = /^(20\d{2})$/;
const looksLikeYearKey = (k) => {
  const m = YEAR_RE.exec(String(k).trim());
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 2000 && y <= 2100;
};

/**
 * Accepts:
 *  A) Row-per-year shape: rows already have a Year column and metric columns
 *  B) Transposed shape: first column is a metric name (Revenue / Rooms Sold / Occupancy / Avg Rate),
 *     remaining headers are year numbers (2022, 2023, 2024...) => build rows per year.
 */
function normalizeHistoryFlexible(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const first = rows[0] || {};
  const keys = Object.keys(first);

  // A) Standard row-per-year
  if (keys.some((k) => lc(k) === 'year' || lc(k).includes('year'))) {
    return rows.map((h) => ({
      year: String(pick(h, 'year', 'Year') ?? ''),
      roomsSold: num(pick(h, 'roomsSold', 'rooms sold', 'room nights sold', 'nights sold')),
      occupancy: asPct(pick(h, 'occupancy', 'Occupancy', 'occ', 'occ%', 'occupancy %')),
      revenue: num(pick(h, 'revenue', 'Revenue', 'room revenue', 'total revenue', 'accommodation revenue')),
      rate: num(pick(h, 'rate', 'avg rate', 'average rate', 'arr', 'adr')),
    })).filter((r) => r.year);
  }

  // B) Transposed (metric rows, year columns)
  const yearColumns = keys.filter((k) => looksLikeYearKey(k));
  if (yearColumns.length) {
    // pick a "label" column for the metric name
    const labelKey =
      keys.find((k) => ['metric', 'name', 'field', 'category', 'kpi', 'measure', 'type', 'item', 'row'].includes(lc(k))) ||
      keys.find((k) => !yearColumns.includes(k)) || keys[0];

    const buckets = {};
    for (const y of yearColumns) buckets[y] = { year: String(y), roomsSold: 0, occupancy: 0, revenue: 0, rate: 0 };

    for (const row of rows) {
      const label = lc(row[labelKey]);
      for (const y of yearColumns) {
        const target = buckets[y];
        if (!target) continue;
        if (label.includes('revenue')) target.revenue = num(row[y]);
        else if (label.includes('rooms sold') || label.includes('room nights') || label.includes('nights sold') || label.includes('sold'))
          target.roomsSold = num(row[y]);
        else if (label.includes('occupancy') || label === 'occ' || label.includes('occ%'))
          target.occupancy = asPct(row[y]);
        else if (label.includes('avg rate') || label.includes('average rate') || label === 'arr' || label === 'adr' || label.includes('rate'))
          target.rate = num(row[y]);
      }
    }

    return Object.values(buckets).filter((r) => r.year);
  }

  // Unknown shape
  return [];
}

/* ------------------------------ normalize main ------------------------------ */

function normalize({ overview = {}, daily = [], roomTypes = [], history = [] }) {
  // Daily
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

  // Room Types
  const roomTypesNorm = (roomTypes || []).map((r) => {
    const picked = {
      type:       pick(r, 'type', 'name', 'room type', 'roomtype') || 'Unknown',
      available:  num(pick(r, 'available', 'Available', 'rooms available', 'available rooms', 'available nights', 'nights available', 'avail')),
      sold:       num(pick(r, 'sold', 'Sold', 'rooms sold', 'sold rooms', 'nights sold', 'room nights sold', 'booked', 'occupied')),
      revenue:    num(pick(r, 'revenue', 'Revenue', 'room revenue', 'accommodation revenue', 'total revenue', 'mtd revenue')),
      rate:       num(pick(r, 'rate', 'Rate', 'arr', 'ARR', 'adr', 'ADR', 'arr/adr', 'avg rate', 'average rate')),
      occupancy:  asPct(pick(r, 'occupancy', 'Occupancy', 'occ', 'Occ', 'occ%')),
    };
    const inferred = inferRoomTypeNumbers(r, picked);
    return {
      type: picked.type,
      available: inferred.available || 0,
      sold: inferred.sold || 0,
      revenue: inferred.revenue || 0,
      rate: inferred.rate || 0,
      occupancy: picked.occupancy || (inferred.available ? (100 * (inferred.sold || 0) / inferred.available) : 0),
    };
  });

  // History (flexible)
  const historyNorm = normalizeHistoryFlexible(history);

  // Overview summary
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
      const form = formidable({
        multiples: true,
        keepExtensions: true,
        uploadDir: os.tmpdir(),
        fileWriteStreamHandler: makeMemoryWriter,
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
      let history   = toJson(sheetBy([
        'history', 'historical', 'yearly', 'annual', 'yoy', 'yo y', 'year on year',
        'year-on-year', 'year comparison', 'trend'
      ]));

      // daily fallback by scanning
      if (!daily.length) {
        for (const name of wb.SheetNames) {
          const sj = toJson(wb.Sheets[name]);
          if (sj.length && hasKeys(sj[0], ['day', 'date']) && hasKeys(sj[0], ['revenue', 'actual'])) {
            daily = sj; break;
          }
        }
      }

      // history fallback by scanning: either row-per-year or transposed year columns
      const looksHistory = (rows) => {
        if (!rows.length) return false;
        const k = Object.keys(rows[0] || {});
        return (
          k.some((x) => lc(x).includes('year')) ||
          k.some((x) => looksLikeYearKey(x))
        );
      };
      if (!history.length) {
        for (const name of wb.SheetNames) {
          const sj = toJson(wb.Sheets[name]);
          if (looksHistory(sj)) { history = sj; break; }
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
