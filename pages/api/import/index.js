// pages/api/import/index.js
import fs from 'fs/promises';
import path from 'path';
import formidable from 'formidable';

export const config = {
  api: { bodyParser: false }, // let formidable parse multipart/form-data
};

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

async function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines.shift().split(',').map(s => s.trim());
  return lines.map((row) => {
    const vals = row.split(',').map(s => s.trim());
    const o = {};
    headers.forEach((h, i) => (o[h] = vals[i]));
    return o;
  });
}

function normalize({ overview = {}, daily = [], roomTypes = [], history = [] }) {
  const dailyData = daily.map((d, i) => ({
    day: num(d.day) || (d.date ? new Date(d.date).getDate() : i + 1),
    date: d.date ?? null,
    revenue: num(d.revenue ?? d.actual),
    target: num(d.target ?? d.budget),
    rate: num(d.rate ?? d.arr ?? d.adr),
    occupancy: asPct(d.occupancy ?? d.occ),
  }));

  return {
    overview: {
      revenueToDate: num(overview.revenueToDate ?? overview.revenue),
      targetToDate:  num(overview.targetToDate ?? overview.target),
      averageRoomRate: num(overview.averageRoomRate ?? overview.arr ?? overview.adr),
      occupancyRate:  asPct(overview.occupancyRate ?? overview.occupancy),
      daily: dailyData,
      roomTypes: roomTypes.map(r => ({
        type: r.type || r.name || 'Unknown',
        available: num(r.available),
        sold: num(r.sold),
        revenue: num(r.revenue),
        rate: num(r.rate ?? r.arr ?? r.adr),
        occupancy: asPct(r.occupancy ?? r.occ),
      })),
      history: history.map(h => ({
        year: String(h.year ?? h.Year ?? ''),
        roomsSold: num(h.roomsSold ?? h['rooms sold']),
        occupancy: asPct(h.occupancy ?? h.Occupancy),
        revenue: num(h.revenue ?? h.Revenue),
        rate: num(h.rate ?? h['avg rate']),
      })),
      lastUpdated: new Date().toISOString(),
    }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const form = formidable({ multiples: false, keepExtensions: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const year = Number(fields.year);
    const month = Number(fields.month);
    const file = files.file || files.report || files.upload;

    if (!file || !file.filepath) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'No file received (expected form field "file")' });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Invalid year/month' });
    }

    const key = `${year}-${String(month).padStart(2, '0')}.json`;
    const filename = (file.originalFilename || file.newFilename || '').toLowerCase();
    const buf = await fs.readFile(file.filepath);

    let parsed = null;

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.read(buf, { type: 'buffer' });

      const by = (want) => wb.Sheets[wb.SheetNames.find(s => s.toLowerCase() === want)];
      const toJson = (sheet) => (sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : []);

      const overview = toJson(by('overview'))[0] || {};
      const daily = toJson(by('daily'));
      const roomTypes = toJson(by('roomtypes'));
      const history = toJson(by('history'));

      parsed = normalize({ overview, daily, roomTypes, history });
    } else if (filename.endsWith('.csv')) {
      const daily = await parseCsv(buf.toString('utf8'));
      parsed = normalize({ overview: {}, daily, roomTypes: [], history: [] });
    } else {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'Unsupported file type (use .xlsx or .csv)' });
    }

    const rows = parsed?.overview?.daily?.length ?? 0;
    if (!rows) {
      return res.status(400).json({ error: 'IMPORT_FAILED', reason: 'No rows found in Daily sheet' });
    }

    // Try bucket first
    const bucket = await uploadToAdminBucket(key, parsed);
    if (bucket.ok) {
      return res.status(200).json({ ok: true, key, rows });
    }

    // Dev fallback: write to public/data locally
    if (process.env.NODE_ENV !== 'production') {
      await fs.mkdir(path.join(process.cwd(), 'public', 'data'), { recursive: true });
      await fs.writeFile(path.join(process.cwd(), 'public', 'data', key), JSON.stringify(parsed, null, 2));
      return res.status(200).json({ ok: true, key, rows, note: 'written to public/data (dev fallback)' });
    }

    return res.status(500).json({ error: 'IMPORT_FAILED', reason: bucket.reason || 'No storage configured' });
  } catch (err) {
    return res.status(500).json({ error: 'IMPORT_FAILED', reason: String(err?.message || err) });
  }
}
