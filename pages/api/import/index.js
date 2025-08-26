// pages/api/admin/import/index.js
import * as XLSX from 'xlsx';
import { getSession } from '@auth0/nextjs-auth0';
import prisma from '../../../lib/prisma'; // adjust if your prisma import path differs

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const toPercent = (v) => {
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
};

export default async function handler(req, res) {
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

    /* ------------------ existing Daily + RoomTypes import ------------------ */
    // Keep your current logic here unchanged…

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
