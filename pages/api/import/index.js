// pages/api/import/index.js
import fs from "node:fs";
import path from "node:path";
import formidable from "formidable";
import { PrismaClient } from "@prisma/client";

// IMPORTANT: this API must run on Node (not Edge) and we disable Next's body parser
export const config = {
  api: { bodyParser: false },
  runtime: "nodejs",
};

// Reuse Prisma in dev
let prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;

// ---- small helpers ---------------------------------------------------------
const toNum = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[, ]/g, ""); // remove commas/spaces
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const startOfUTC = (y, m /*1-12*/, d) => new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

function normaliseKey(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 %/()-]/g, "");
}

// Accepts:
//  - rows with a "date" (Date or string) OR
//  - rows with "day" (1..31) + year/month from the form
function extractRow(row, year, month) {
  const obj = {};
  for (const [k, v] of Object.entries(row)) {
    obj[normaliseKey(k)] = v;
  }

  // map likely headers to canonical fields
  const dayVal =
    obj["day"] ??
    obj["date"] ??
    obj["day of month"] ??
    obj["day-of-month"] ??
    obj["d"];

  const revenueVal =
    obj["revenue"] ??
    obj["revenue (r)"] ??
    obj["rev"] ??
    obj["actual revenue"];

  const targetVal =
    obj["target"] ??
    obj["target (r)"] ??
    obj["target revenue"] ??
    obj["daily target"] ??
    obj["budget"];

  const occVal =
    obj["occupancy"] ??
    obj["occupancy (%)"] ??
    obj["occ"] ??
    obj["occ (%)"];

  const arrVal =
    obj["arr"] ??
    obj["average room rate"] ??
    obj["avg rate"] ??
    obj["rate"];

  // date: try to parse. If only a day is present, build with provided year/month
  let date = null;

  if (dayVal instanceof Date) {
    // excel date parsed by xlsx can already be Date
    date = startOfUTC(dayVal.getUTCFullYear(), dayVal.getUTCMonth() + 1, dayVal.getUTCDate());
  } else if (typeof dayVal === "number") {
    date = startOfUTC(year, month, dayVal);
  } else if (typeof dayVal === "string" && dayVal.trim()) {
    // try several formats
    const s = dayVal.trim();
    // dd/mm or dd-mm
    const m1 = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
    if (m1) {
      const d = Number(m1[1]);
      const mm = Number(m1[2]);
      const yy = m1[3] ? Number(m1[3]) : year;
      const fullYear = yy < 100 ? 2000 + yy : yy;
      date = startOfUTC(fullYear, mm, d);
    } else {
      // ISO-ish
      const d = new Date(s);
      if (!isNaN(d.valueOf())) {
        date = startOfUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }
  }

  // If nothing parseable, but we have year/month and a numeric `obj["day"]`
  if (!date && obj["day"] != null) {
    const d = toNum(obj["day"]);
    if (d != null) date = startOfUTC(year, month, d);
  }

  return {
    date,
    revenue: toNum(revenueVal),
    target: toNum(targetVal),
    occupancy: toNum(occVal), // store as 0–100 if that's how your DB is
    arr: toNum(arrVal),
  };
}

// parse multipart form (file + fields)
function parseForm(req) {
  const uploadDir = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(uploadDir, { recursive: true });

  const form = formidable({
    multiples: false,
    uploadDir,
    keepExtensions: true,
    maxFileSize: 20 * 1024 * 1024, // 20MB
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

// ---- main handler ----------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  // absolutely no cache
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  try {
    const { fields, files } = await parseForm(req);

    // form inputs from /admin/import
    const year = Number(fields.year ?? fields.Y ?? fields.y);
    const month = Number(fields.month ?? fields.M ?? fields.m);

    if (!year || !month) {
      return res.status(400).json({ ok: false, error: "Missing year/month" });
    }

    // accept name="file" or name="report"
    const file =
      files.file ||
      files.report ||
      files.upload ||
      Object.values(files)[0];

    if (!file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    const filepath = file.filepath || file.path; // formidable v3 vs v2
    const ext = (file.originalFilename || file.newFilename || "").toLowerCase();

    // Read rows (XLSX or CSV)
    let rows = [];
    if (ext.endsWith(".csv")) {
      const raw = fs.readFileSync(filepath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const header = (lines.shift() || "").split(",").map((h) => h.trim());
      for (const line of lines) {
        const parts = line.split(",");
        const row = {};
        header.forEach((h, i) => (row[h] = parts[i]));
        rows.push(row);
      }
    } else {
      // XLSX
      // use dynamic import to avoid ESM bundling issues in Next
      const XLSX = (await import("xlsx")).default || (await import("xlsx"));
      const buf = fs.readFileSync(filepath);
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    }

    // Map & validate
    const mapped = rows
      .map((r) => extractRow(r, year, month))
      .filter((r) => r.date instanceof Date && !isNaN(r.date.valueOf()));

    if (!mapped.length) {
      return res.status(200).json({ ok: true, imported: 0, skipped: rows.length });
    }

    // Upsert into DB by unique date
    let imported = 0;
    for (const r of mapped) {
      await prisma.dailyMetric.upsert({
        where: { date: r.date },
        update: {
          revenue: r.revenue,
          target: r.target,
          occupancy: r.occupancy,
          arr: r.arr,
        },
        create: {
          date: r.date,
          revenue: r.revenue,
          target: r.target,
          occupancy: r.occupancy,
          arr: r.arr,
        },
      });
      imported += 1;
    }

    // cleanup temp file
    try { fs.unlinkSync(filepath); } catch {}

    return res.status(200).json({ ok: true, imported, skipped: rows.length - imported });
  } catch (err) {
    console.error("IMPORT ERROR:", err);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
}
