// pages/api/import/index.js
import fs from 'fs/promises';
import path from 'path';
import formidable from 'formidable';

export const config = {
  api: { bodyParser: false }, // formidable handles multipart/form-data
};

/* ------------------------------ helpers ------------------------------ */

const FORCE_LOCAL_WRITE = process.env.FORCE_LOCAL_WRITE === '1';

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[^0-9.-]+/g, '');
  const n = s ? Number(s) : 0;
  return Number.isFinite(n) ? n : 0;
};
const asPct = (v) => {
  const n = num(v);
  return n <= 1.5 ? n * 100 : n;
};
const lc = (s) => String(s || '').toLowerCase().trim();
const hasKeys = (row, keys) =>
  keys.some((k) => Object.keys(row || {}).some((rk) => lc(rk) === lc(k) || lc(rk).includes(lc(k))));

/** Pick first available file from any field name / array shape */
function pickFirstFile(files) {
  if (!files || typeof files !== 'object') return null;
  for (const val of Object.values(files)) {
    if (!val) continue;
    if (Array.isArray(val)) {
      for (const f of val) {
        if (f && (f.filepath || f.path || f.originalFilename)) return f;
      }
    } else if (typeof val === 'object') {
      if (val.filepath || val.path || val.originalFilename) return val;
    }
  }
  return null;
}

async function parseCsv(text) {
  const sep = text.includes(';') && !text.includes(',') ? ';' : ',';
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines.shift().split(sep).map((s) => s.trim());
  return lines
    .filter(Boolean)
    .map((row) => {
      const vals = row.split(sep).map((s) => s.trim());
      const o = {};
      headers.forEach((h, i) => (o[h] = vals[i]));
      return o;
    });
}

function normalize({ overview = {}, daily = [], roomTypes = [], history = [] }) {
  const dailyData = daily.map((d, i) => {
    const dayCol = d.day ?? d.Day ?? d.d ?? d.D;
    const dateCol = d.date ?? d.Date ?? d.dt ?? d.Dt ?? d['day date'];
    const revCol =
      d.revenue ?? d.Revenue ?? d.actual ?? d['actual revenue'] ?? d['accommodation revenue'] ?? d['total revenue'];
    const tgtCol = d.target ?? d.Target ?? d.budget ?? d.Budget ?? d['daily target'];
    const rateCol = d.rate ?? d.Rate ?? d.arr ?? d.ARR ?? d.adr ?? d.ADR ?? d['average rate'];
    const occCol = d.occupancy ?? d.Occupancy ?? d.occ ?? d['occ%'] ?? d['occupancy rate'];

    let day = num(dayCol);
    if (!day && dateCol) {
      try {
        const dt = new Date(dateCol);
        if (!Number.isNaN(dt.valueOf())) day = dt.getDate();
      } catch {}
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

  return {
    overview: {
      revenueToDate: num(overview.revenueToDate ?? overview.revenue ?? overview['revenue to date']),
      targetToDate: num(overview.targetToDate ?? overview.target ?? overview['target to date']),
      averageRoomRate: num(overview.averageRoomRate ?? overview.arr ?? overview.adr ?? overview['avg rate']),
      occupancyRate: asPct(overview.occupancyRate ?? overview.occupancy),
      daily: dailyData,
      roomTypes: (roomTypes || []).map((r) => ({
        type: r.type || r.name || r['room type'] || 'Unknown',
        available: num(r.available ?? r['rooms available'] ?? r['available rooms']),
        sold: num(r.sold ?? r['rooms sold']),
        revenue: num(r.revenue),
        rate: num(r.rate ?? r.arr ?? r.adr ?? r['avg rate']),
        occupancy: asPct(r.occupancy ?? r.occ),
      })),
      history: (history || []).map((h) => ({
        year: String(h.year ?? h.Year ?? ''),
        roomsSold: num(h.roomsSold ?? h['rooms sold']),
        occupancy: asPct(h.occupancy ?? h.Occupancy),
        revenue: num(h.revenue ?? h.Revenue),
        rate: num(h.rate ?? h['avg rate']),
      })),
      lastUpdated: new Date().toISOString(),
    },
  };
}

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

/* ------------------------------ API handler ------------------------------ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const form = formidable({
      multiples: true,              // tolerate array or single
      keepExtensions: true,
      maxFileSize: 25 * 1024 * 1024,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const year = Number(fields.year);
    const month = Number(fields.month);

    const fileObj =
      (files && (files.file || files.report || files.upload)) || // common names
      pickFirstFile(files);                                      // any other key/shape

    if (!fileObj) {
      const known = Object.keys(files || {});
      return res.status(400).json({
        error: 'IMPORT_FAILED',
        reason:
          `No file received (expected form field like "file"). ` +
          `Found file fields: ${known.length ? known.join(', ') : 'none'}`,
      });
    }

    const filepath = fileObj.filepath || fileObj.path;
    if (!filepath) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Unable to read uploaded file path' });
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Invalid year/month' });
    }

    const key = `${year}-${String(month).padStart(2, '0')}.json`;
    const filename = lc(fileObj.originalFilename || fileObj.newFilename || '');
    const buf = await fs.readFile(filepath);

    let parsed = null;

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
      let daily = toJson(sheetBy(['daily', 'days', 'daily revenue', 'calendar', 'month']));
      let roomTypes = toJson(sheetBy(['roomtypes', 'room types', 'types', 'rooms']));
      let history = toJson(sheetBy(['history', 'annual', 'yoy', 'yearly']));

      if (!daily.length) {
        for (const name of wb.SheetNames) {
          const sj = toJson(wb.Sheets[name]);
          if (sj.length && hasKeys(sj[0], ['day', 'date']) && hasKeys(sj[0], ['revenue', 'actual'])) {
            daily = sj;
            break;
          }
        }
      }

      parsed = normalize({ overview, daily, roomTypes, history });
    } else if (filename.endsWith('.csv')) {
      const daily = await parseCsv(buf.toString('utf8'));
      parsed = normalize({ overview: {}, daily, roomTypes: [], history: [] });
    } else {
      return res
        .status(400)
        .json({ error: 'IMPORT_FAILED', reason: 'Unsupported file type (use .xlsx, .xls or .csv)' });
    }

    const rows = parsed?.overview?.daily?.length ?? 0;
    if (!rows) {
      return res
        .status(400)
        .json({ error: 'IMPORT_FAILED', reason: 'No rows found in Daily sheet (or columns not recognised)' });
    }

    // 1) Try bucket first
    const bucket = await uploadToAdminBucket(key, parsed);
    if (bucket.ok) {
      return res.status(200).json({ ok: true, key, rows });
    }

    // 2) Local write (dev/forced)
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

    // 3) Nothing configured
    return res.status(500).json({
      error: 'IMPORT_FAILED',
      reason: bucket.reason || 'No storage configured (set ADMIN_BUCKET_PUT_URL or use FORCE_LOCAL_WRITE=1 in dev)',
    });
  } catch (err) {
    return res.status(500).json({ error: 'IMPORT_FAILED', reason: String(err?.message || err) });
  }
}
