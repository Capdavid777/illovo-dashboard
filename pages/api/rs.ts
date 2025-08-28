// pages/api/rs.ts
import type { NextApiRequest, NextApiResponse } from "next";

const API = process.env.RS_API; // set in .env.local and on Vercel

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!API) {
    res.status(500).json({ error: "RS_API env var not set" });
    return;
  }

  const t = (req.query.t as string) || "summary";
  const month = (req.query.month as string) || "";

  const url = new URL(API);
  url.searchParams.set("t", t);
  if (month) url.searchParams.set("month", month);

  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) throw new Error(`Upstream ${r.status} ${r.statusText}`);
    const data = await r.json();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
