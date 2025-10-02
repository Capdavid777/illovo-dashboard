// components/Dashboard.js
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine
} from 'recharts';
import {
  Activity, Calendar, DollarSign, Home, Target, Users,
  SlidersHorizontal, Info
} from 'lucide-react';

/* ------------------------------ helpers ------------------------------ */

const num = (v, d = 0) => {
  if (v == null) return d;
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return d;
    const isPercent = /%$/.test(s);
    const cleaned = s.replace(/[^0-9.-]+/g, '');
    const n = cleaned === '' ? NaN : Number(cleaned);
    if (!Number.isFinite(n)) return d;
    return isPercent ? n / 100 : n;
  }
  return d;
};
const asPercent = (v, d = 0) => {
  const n = num(v, d);
  return n <= 1.5 ? n * 100 : n;
};
const currency = (n) => `R${Math.round(num(n)).toLocaleString()}`;
const pct = (n) => `${Math.round(num(n))}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const Y_TICK_SMALL = { fontSize: 11 };
const isJson = (res) => (res.headers.get('content-type') || '').toLowerCase().includes('application/json');

/* robust parse for timestamps */
const parseLastUpdated = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.valueOf()) ? null : v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = s.length === 10 ? Number(s) * 1000 : Number(s);
    const d = new Date(n);
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  const hasTZ = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTZ ? s : s + 'Z');
  return Number.isNaN(d.valueOf()) ? null : d;
};

/* ------------------------------ arrears setting ------------------------------ */
const ARREARS_DAYS = (() => {
  const v = typeof process !== 'undefined' ? Number(process.env.NEXT_PUBLIC_ARREARS_DAYS) : NaN;
  return Number.isFinite(v) ? v : 1;
})();

/* ------------------------------ month utils ------------------------------ */
const pad2 = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const fromKey = (key) => {
  const [y, m] = (key || '').split('-').map((x) => parseInt(x, 10));
  return new Date(isFinite(y) ? y : new Date().getFullYear(), isFinite(m) ? m - 1 : new Date().getMonth(), 1);
};
const fmtMonth = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });

function useMonthParam() {
  const current = () => toKey(new Date());
  const [month, setMonthState] = useState(() => {
    if (typeof window === 'undefined') return current();
    try { return new URL(window.location.href).searchParams.get('month') || current(); }
    catch { return current(); }
  });
  const setMonth = (next) => {
    setMonthState(next);
    if (typeof window !== 'undefined') {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('month', next);
        window.history.replaceState({}, '', u.toString());
      } catch {}
    }
  };
  return { month, setMonth };
}

const daysInMonth = (monthKey) => {
  const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m, 0).getDate();
};

/* ------------------------------ Month switcher ------------------------------ */
function MonthSwitcher({ monthKey, onChange, minKey, maxKey }) {
  const d = fromKey(monthKey);
  const prev = () => {
    const nk = toKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    if (!minKey || nk >= minKey) onChange(nk);
  };
  const next = () => {
    const nk = toKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    if (!maxKey || nk <= maxKey) onChange(nk);
  };

  const options = (() => {
    const out = [];
    const start = minKey ? fromKey(minKey) : new Date(d.getFullYear() - 1, 0, 1);
    const end   = maxKey ? fromKey(maxKey) : new Date(d.getFullYear() + 1, 11, 1);
    const cur = new Date(start);
    while (cur <= end) { out.push(toKey(cur)); cur.setMonth(cur.getMonth() + 1); }
    return out.reverse();
  })();

  return (
    <div className="flex items-center gap-2">
      <button onClick={prev} className="px-2 py-1 border rounded" type="button" aria-label="Previous month">&lt;</button>
      <div className="font-medium text-neutral-900">{fmtMonth(d)}</div>
      <button onClick={next} className="px-2 py-1 border rounded" type="button" aria-label="Next month">&gt;</button>
      <select
        value={monthKey}
        onChange={(e) => onChange(e.target.value)}
        className="ml-2 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
        style={{ color: '#111827' }}
        aria-label="Jump to month"
      >
        {options.map((k) => (<option key={k} value={k}>{fmtMonth(fromKey(k))}</option>))}
      </select>
    </div>
  );
}

/* ------------------------------ deep helpers for normalization ------------------------------ */

function sniffDailyArray(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const candidates = [];
  const directKeys = ['dailySeries', 'daily', 'items', 'rows', 'days', 'data'];
  for (const k of directKeys) if (Array.isArray(raw[k])) candidates.push(raw[k]);
  const objDaily = raw.daily || raw.days || null;
  if (objDaily && !Array.isArray(objDaily) && typeof objDaily === 'object') {
    const keys = Object.keys(objDaily).filter((k) => /^\d+$/.test(k));
    if (keys.length >= 10) {
      const arr = keys.sort((a,b) => a - b).map((k) => ({ day: Number(k), ...objDaily[k] }));
      candidates.push(arr);
    }
  }
  for (const v of Object.values(raw)) {
    if (Array.isArray(v) && v.length >= 10 && v.length <= 40 && v.every((x) => x && typeof x === 'object')) candidates.push(v);
  }
  for (const v of Object.values(raw)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const vv of Object.values(v)) {
        if (Array.isArray(vv) && vv.length >= 10 && vv.every((x) => x && typeof x === 'object')) candidates.push(vv);
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || [];
}

function mapDailyRow(d, i) {
  if (!d || typeof d !== 'object') return null;
  const keys = Object.keys(d);
  const lookup = (names) => {
    for (const name of names) {
      const hit = keys.find((k) => k.toLowerCase() === String(name).toLowerCase());
      if (hit) return d[hit];
    }
    for (const name of names) {
      const hit = keys.find((k) => k.toLowerCase().includes(String(name).toLowerCase()));
      if (hit) return d[hit];
    }
    return undefined;
  };

  const day = num(lookup(['day', 'd', 'dateDay']), NaN);
  the date = lookup(['date', 'dt', 'dayDate']);
  const revenue = num(lookup(['revenue','actual','actualRevenue','accommodationRevenue','accommRevenue','accomRevenue','accRevenue','totalRevenue','rev','income']), NaN);
  const target  = num(lookup(['target','dailyTarget','targetRevenue','budget','goal','forecast']), NaN);
  const rate    = num(lookup(['rate','arr','adr','averageRate','avgRate']), NaN);
  const occVal  = lookup(['occupancy','occ','occupancyRate','occRate','occ%']);
  const occupancy = asPercent(occVal ?? NaN, NaN);
  const metFlag = lookup(['met','hitTarget','metTarget']);

  return {
    day: Number.isFinite(day) ? day : (date ? new Date(date).getDate() : i + 1),
    date,
    revenue: Number.isFinite(revenue) ? revenue : 0,
    target: Number.isFinite(target) ? target : 0,
    rate: Number.isFinite(rate) ? rate : 0,
    occupancy: Number.isFinite(occupancy) ? occupancy : 0,
    met: metFlag === true || metFlag === 'true' || metFlag === 1 ? true : undefined,
  };
}

/* ------------------------------ normalization ------------------------------ */

function normalizeOverview(raw = {}) {
  const get = (keys, fallback) => {
    for (const k of keys) {
      const v = raw?.[k];
      if (v !== undefined && v !== null) return v;
    }
    return fallback;
  };

  let dailyArr = sniffDailyArray(raw);
  if (!Array.isArray(dailyArr)) dailyArr = [];
  const dailyData = dailyArr.map((row, i) => mapDailyRow(row, i)).filter(Boolean);

  let revenueToDate   = num(get(['revenueToDate','revenue_to_date','revenue'], NaN));
  let targetToDate    = num(get(['targetToDate','target_to_date','target'], NaN));
  let averageRoomRate = num(get(['averageRoomRate','avgRoomRate','arr','adr'], NaN));
  let occupancyRate   = get(['occupancyRate','occupancy_to_date','occupancy'], undefined);
  occupancyRate = occupancyRate === undefined ? NaN : asPercent(occupancyRate);

  const hasDaily = dailyData.length > 0;
  const hasAnyMoney = hasDaily && dailyData.some(d => num(d.revenue) > 0 || num(d.target) > 0);

  if ((!Number.isFinite(revenueToDate) || revenueToDate === 0) && hasAnyMoney) {
    revenueToDate = dailyData.reduce((a, d) => a + num(d.revenue, 0), 0);
  }
  if ((!Number.isFinite(targetToDate) || targetToDate === 0) && hasAnyMoney) {
    targetToDate  = dailyData.reduce((a, d) => a + num(d.target, 0), 0);
  }
  if ((!Number.isFinite(occupancyRate) || occupancyRate === 0) && hasDaily) {
    const vals = dailyData.map(d => num(d.occupancy)).filter(n => Number.isFinite(n));
    occupancyRate = vals.length ? (vals.reduce((a,b)=>a+b,0) / vals.length) : 0;
  }
  if (!Number.isFinite(averageRoomRate)) averageRoomRate = 0;

  dailyData.sort((a, b) => a.day - b.day);

  const targetVariance = (Number.isFinite(targetToDate) ? targetToDate : 0) -
                         (Number.isFinite(revenueToDate) ? revenueToDate : 0);
  const lastUpdated = get(['lastUpdated','updatedAt','last_updated'], null);
  const roomTypesRaw = get(['roomTypes','roomTypesData'], null);
  const historyRaw   = get(['history','yearlyData'], null);

  return {
    revenueToDate: Number.isFinite(revenueToDate) ? revenueToDate : 0,
    targetToDate:  Number.isFinite(targetToDate) ? targetToDate : 0,
    averageRoomRate,
    occupancyRate: Number.isFinite(occupancyRate) ? occupancyRate : 0,
    dailyData,
    targetVariance,
    lastUpdated,
    roomTypes: Array.isArray(roomTypesRaw) ? roomTypesRaw : null,
    history: Array.isArray(historyRaw) ? historyRaw : null,
  };
}

/* ------------------------------ palettes ------------------------------ */

const ROOM_PALETTES = {
  '2 Bed':         { start: '#0A2240', end: '#0F2E5E' },
  '1 Bed':         { start: '#708090', end: '#5F6B7A' },
  'Deluxe Studio': { start: '#B38B6D', end: '#A17855' },
  'Queen':         { start: '#D4AF37', end: '#C29D2C' },
  'Queen Room':    { start: '#D4AF37', end: '#C29D2C' },
};
const getPalette = (type) => ROOM_PALETTES[type] || { start: '#64748B', end: '#475569' };
const gradIdFor = (type) => `grad-${String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/* ------------------------------ Month targets ------------------------------ */
const TARGETS = {
  default: { occupancyPct: 62, arrBreakeven: 1237, revenue: undefined },
  "2025-09": { occupancyPct: 52, arrBreakeven: 1395, revenue: undefined },
  "2025-10": { occupancyPct: 49, arrBreakeven: 1378, revenue: undefined }, // October
};
function getTargetsForMonth(monthKey) {
  return TARGETS[monthKey] || TARGETS.default;
}

/* ------------------------------ Occupancy to-date (weighted) ------------------------------ */
function computeOccToDatePct(dailyRows, cutoff = new Date(), fallbackRoomsPerDay = 60) {
  if (!Array.isArray(dailyRows) || dailyRows.length === 0) return 0;

  const rowsToDate = dailyRows.filter(r => {
    if (r?.date) {
      const d = new Date(r.date);
      return !Number.isNaN(d.valueOf()) && d <= cutoff;
    }
    return Number.isFinite(r?.day);
  });

  let soldSum = 0;
  let availSum = 0;

  for (const r of rowsToDate) {
    const rate = num(r.rate, 0);
    const rev  = num(r.revenue, 0);
    const occP = num(r.occupancy, 0);

    const sold = rate > 0 ? (rev / rate) : 0;
    const avail =
      (occP > 0 && sold > 0) ? (sold / (occP / 100)) :
      (occP > 0 || sold > 0) ? fallbackRoomsPerDay : fallbackRoomsPerDay;

    soldSum += sold;
    availSum += avail;
  }

  if (availSum <= 0) return 0;
  return (soldSum / availSum) * 100;
}

/* ------------------------------ Progress Ring ------------------------------ */

function ProgressRing({ percent, target, size = 60, stroke = 8, label }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const t = Math.max(0, Math.min(100, Number(target) || 0));

  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const dash = (p / 100) * c;

  const angle = (t / 100) * 2 * Math.PI - Math.PI / 2;
  const cx = size / 2 + radius * Math.cos(angle);
  const cy = size / 2 + radius * Math.sin(angle);

  const met = p >= t;
  const progColor = met ? '#10B981' : '#EF4444';

  return (
    <svg width={size} height={size} aria-label={label || 'progress'}>
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={radius} fill="none"
        stroke={progColor} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`} transform={`rotate(-90 ${size/2} ${size/2})`}
      />
      <circle cx={cx} cy={cy} r={3.2} fill="#000" />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="12" fontWeight="600" fill="#111">
        {Math.round(p)}%
      </text>
    </svg>
  );
}

/* ------------------------------ Metric card ------------------------------ */

const InfoTip = ({ children }) => (
  <span className="inline-flex items-center gap-1 text-gray-500" title={children}>
    <Info className="w-3.5 h-3.5" />
  </span>
);

const MetricCard = ({ title, value, subtitle, icon: Icon, chip, rightSlot, tooltip }) => (
  <div className="group rounded-xl border border-[#CBA135] bg-white shadow-sm transition-all duration-200 transform-gpu hover:-translate-y-1 hover:shadow-xl">
    <div className="flex items-start justify-between p-6">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          {tooltip && <InfoTip>{tooltip}</InfoTip>}
          {chip && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-[#CBA135]/40 text-[#111] bg-[#CBA135]/10">
              {chip}
            </span>
          )}
        </div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {!!subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="p-2 rounded-full text-[#CBA135] bg-[#CBA135]/10 ring-1 ring-[#CBA135]/30 flex items-center justify-center">
        {rightSlot ? rightSlot : <Icon className="w-6 h-6" />}
      </div>
    </div>
  </div>
);

/* ------------------------------ component ------------------------------ */

const Dashboard = ({ overview }) => {
  const { month, setMonth } = useMonthParam();
  const [minKey, setMinKey] = useState();
  const [maxKey, setMaxKey] = useState();
  const [monthOverview, setMonthOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedView, setSelectedView] = useState('overview');
  const [sourceInfo, setSourceInfo] = useState(null);
  const [rawSlice, setRawSlice] = useState(null);
  const [lastUpdatedStr, setLastUpdatedStr] = useState('');

  /* toggles */
  const inspectOnQuery = (() => {
    if (typeof window === 'undefined') return false;
    try { return new URL(window.location.href).searchParams.get('inspect') === '1'; } catch { return false; }
  })();
  const showInspector = (process.env.NODE_ENV !== 'production') && inspectOnQuery;

  /* fetch bounds */
  useEffect(() => {
    let alive = true;
    fetch('/data/index.json').then(r => r.ok ? r.json() : null).then((j) => {
      if (!alive || !j) return;
      if (j.min) setMinKey(j.min);
      if (j.max) setMaxKey(j.max);
      if (j.max && month > j.max) setMonth(j.max);
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* fetch month data (multi-source) */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSourceInfo(null);
    setRawSlice(null);

    const record = (info) => { console.info('[Dashboard loader]', info); if (alive) setSourceInfo(info); };

    async function tryJson(url, tag) {
      const r = await fetch(url, { cache: 'no-store', credentials: 'include', redirect: 'follow' });
      if (r.ok && isJson(r)) {
        const j = await r.json();
        if (showInspector && !rawSlice) {
          const slice = Array.isArray(j) ? j.slice(0, 3) : (typeof j === 'object' ? Object.fromEntries(Object.entries(j).slice(0, 20)) : j);
          setRawSlice({ tag, slice });
        }
        return { ok: true, json: j, status: r.status };
      }
      return { ok: false, status: r.status, jsonCt: isJson(r) };
    }

    (async () => {
      try {
        const r1 = await tryJson(`/api/month?month=${month}`, 'admin-bucket');
        if (r1.ok) {
          if (alive) { setMonthOverview(r1.json?.overview ? r1.json.overview : r1.json); setLoading(false); }
          record({ source: 'admin-bucket (/api/month)', status: r1.status, json: true });
          return;
        } else {
          record({ source: 'admin-bucket (/api/month)', status: r1.status, json: r1.jsonCt, skipped: true });
        }
      } catch (e) { record({ source: 'admin-bucket', error: String(e) }); }

      try {
        const [ov, dm] = await Promise.all([
          tryJson(`/api/overview?month=${month}`, 'admin-db/overview'),
          tryJson(`/api/daily-metrics?month=${month}`, 'admin-db/daily'),
        ]);
        if (ov.ok || dm.ok) {
          const ovJson = ov.ok ? ov.json : null;
          const dmJson = dm.ok ? dm.json : null;
          const daily =
            (dmJson && (dmJson.daily || dmJson.rows || dmJson.items || dmJson.data || (Array.isArray(dmJson) ? dmJson : null))) || [];
          const merged = { ...(ovJson?.overview || ovJson || {}), daily };
          if (alive) { setMonthOverview(merged); setLoading(false); }
          record({ source: 'admin-db (/api/overview + /api/daily-metrics)', ovStatus: ov.status, dmStatus: dm.status, json: { ov: ov.ok, dm: dm.ok } });
          return;
        } else {
          record({ source: 'admin-db (/api/overview + /api/daily-metrics)', ov: { status: ov.status }, dm: { status: dm.status }, skipped: true });
        }
      } catch (e) { record({ source: 'admin-db', error: String(e) }); }

      try {
        const r2 = await tryJson(`/data/${month}.json`, 'static');
        if (r2.ok) {
          if (alive) { setMonthOverview(r2.json?.overview || r2.json || null); setLoading(false); }
          record({ source: 'static (/public/data)', status: r2.status, json: true });
          return;
        } else {
          record({ source: 'static (/public/data)', status: r2.status, json: r2.jsonCt, skipped: true });
        }
      } catch (e) { record({ source: 'static (/public/data)', error: String(e) }); }

      if (alive) { setMonthOverview(null); setLoading(false); }
    })();

    return () => { alive = false; };
  }, [month, showInspector]);

  /* normalize */
  const rawForNormalize = monthOverview || overview || {};
  const ov = useMemo(() => normalizeOverview(rawForNormalize, month), [rawForNormalize, month]);

  /* last updated text */
  useEffect(() => {
    let d =
      parseLastUpdated(ov?.lastUpdated) ||
      parseLastUpdated(monthOverview?.lastUpdated) ||
      parseLastUpdated(overview?.lastUpdated);

    if (!d && Array.isArray(ov?.dailyData) && ov.dailyData.length) {
      let best = null;
      for (const r of ov.dailyData) {
        if (r?.date) {
          const dd = parseLastUpdated(r.date);
          if (dd && (!best || dd > best)) best = dd;
        }
      }
      if (!best) {
        const lastDay = ov.dailyData.reduce((a, r) => Math.max(a, num(r.day, 0)), 0);
        if (lastDay > 0) {
          const [y, m] = month.split('-').map(n => parseInt(n, 10));
          best = new Date(y, (m || 1) - 1, lastDay, 23, 59, 0);
        }
      }
      d = best;
    }
    if (!d) d = new Date();

    const str = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(d);
    setLastUpdatedStr(str);
  }, [ov?.lastUpdated, ov?.dailyData, month, monthOverview?.lastUpdated, overview?.lastUpdated]);

  /* ------------------------------ derived aggregates ------------------------------ */

  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ARREARS_DAYS);
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const mtdRows = useMemo(() => {
    if (!Array.isArray(ov.dailyData)) return [];
    return ov.dailyData.filter(r => {
      if (r?.date) {
        const d = new Date(r.date);
        return !Number.isNaN(d.valueOf()) && d <= cutoffDate;
      }
      return Number.isFinite(r?.day);
    });
  }, [ov.dailyData, cutoffDate]);

  const arrRatesMTD = mtdRows
    .map(d => num(d.rate, NaN))
    .filter(n => Number.isFinite(n) && n > 0);
  const arrMeanMTD = arrRatesMTD.length
    ? Math.round(arrRatesMTD.reduce((a,b)=>a+b,0) / arrRatesMTD.length)
    : 0;

  const revSumMTD   = mtdRows.reduce((a, d) => a + num(d.revenue, 0), 0);
  const nightsSumMTD = mtdRows.reduce((a, d) => {
    const rate = num(d.rate, 0);
    const rev  = num(d.revenue, 0);
    return a + (rate > 0 ? (rev / rate) : 0);
  }, 0);
  const arrWeightedMTD = nightsSumMTD > 0 ? Math.round(revSumMTD / nightsSumMTD) : 0;

  const dailyRates = (ov.dailyData || [])
    .map(d => num(d.rate, NaN))
    .filter(n => Number.isFinite(n) && n > 0);
  const dailyRateAvg = dailyRates.length ? Math.round(dailyRates.reduce((a,b)=>a+b,0) / dailyRates.length) : 0;

  const averageRoomRateFinal =
    arrMeanMTD || arrWeightedMTD || Math.round(num(ov.averageRoomRate)) || dailyRateAvg || 0;

  const monthTargets = getTargetsForMonth(month);
  const OCC_TARGET = num(monthTargets.occupancyPct, 62);
  const ARR_BREAKEVEN = num(monthTargets.arrBreakeven, 1237);

  const occToDatePct = useMemo(() => computeOccToDatePct(ov.dailyData, cutoffDate), [ov.dailyData, cutoffDate]);

  const elapsedDays = mtdRows.length;
  const totalDays = daysInMonth(month);
  const mtdChip = `${elapsedDays}/${totalDays} days`;

  const revenueProgressPct = ov.targetToDate > 0 ? Math.round(100 * clamp01(ov.revenueToDate / ov.targetToDate)) : 0;
  const rateProgressPct    = ARR_BREAKEVEN > 0 ? Math.round(100 * clamp01(averageRoomRateFinal / ARR_BREAKEVEN)) : 0;

  /* ---------- Target line (supports top-level targets.daily_revenue_target) ---------- */
  const dailyTargetLevel = useMemo(() => {
    const first = (ov.dailyData || []).map(d => num(d.target, NaN)).find(v => Number.isFinite(v) && v > 0);
    if (Number.isFinite(first)) return first;
    const top = num(monthOverview?.targets?.daily_revenue_target, NaN);
    if (Number.isFinite(top) && top > 0) return top;
    if (ov.targetToDate > 0 && totalDays > 0) return Math.round(ov.targetToDate / totalDays);
    return 0;
  }, [ov.dailyData, ov.targetToDate, totalDays, monthOverview]);

  /* ------------------------------ legends & tooltips ------------------------------ */

  const renderLegend = () => (
    <div className="flex items-center justify-center gap-6 mt-2 text-sm">
      <div className="flex items-center gap-2">
        <span style={{ width: 12, height: 12, display: 'inline-block', borderRadius: 2, background: 'linear-gradient(90deg, #EF4444 50%, #10B981 50%)', border: '1px solid rgba(0,0,0,0.25)' }} />
        <span>Actual Revenue</span>
      </div>
    </div>
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const pData = payload[0]?.payload || {};
    const rev = num(pData.revenue);
    const tgt = num(dailyTargetLevel);
    const epsilon = Math.max(100, tgt * 0.01);
    const hitTarget = (pData.met === true) || (rev + epsilon >= tgt);
    const revColor = hitTarget ? '#10B981' : '#EF4444';

    return (
      <div className="rounded-md bg-white shadow border p-3 text-sm">
        <div className="font-medium mb-1">Day {label}</div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: revColor }} />
            <span>Actual Revenue</span>
          </div>
          <span className="font-medium" style={{ color: revColor }}>{currency(rev)}</span>
        </div>
      </div>
    );
  };

  /* ------------------------------ views ------------------------------ */

  const OverviewView = () => {
    // Ensure the Y-axis always includes the target line
    const chartMaxY = useMemo(() => {
      const maxRev = Math.max(0, ...((ov.dailyData || []).map(d => num(d.revenue, 0))));
      const tgt = num(dailyTargetLevel, 0);
      const m = Math.max(maxRev, tgt);
      // round up a bit for headroom
      return m > 0 ? Math.ceil((m * 1.1) / 1000) * 1000 : 1000;
    }, [ov.dailyData, dailyTargetLevel]);

    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Revenue to Date"
            value={currency(ov.revenueToDate)}
            subtitle={ov.targetToDate ? `vs ${currency(ov.targetToDate)} target` : undefined}
            icon={DollarSign}
            chip={mtdChip}
            rightSlot={<ProgressRing percent={revenueProgressPct} target={100} label="revenue progress" />}
            tooltip="Completion vs daily target (to date)."
          />
          <MetricCard
            title="Occupancy Rate"
            value={pct(occToDatePct)}
            subtitle={`vs ${pct(OCC_TARGET)} target`}
            icon={Users}
            chip={mtdChip}
            rightSlot={<ProgressRing percent={occToDatePct} target={OCC_TARGET} label="occupancy progress" />}
            tooltip="Weighted occupancy to date (daily sold ÷ daily available), cutoff: yesterday 23:59."
          />
          <MetricCard
            title="Average Room Rate"
            value={currency(averageRoomRateFinal)}
            subtitle={`vs breakeven ${currency(ARR_BREAKEVEN)}`}
            icon={Home}
            chip={mtdChip}
            rightSlot={<ProgressRing percent={rateProgressPct} target={100} label="rate vs breakeven" />}
            tooltip="ARR = simple average of Daily tab's ARR values to date (matches spreadsheet)."
          />
          <MetricCard
            title="Target Variance"
            value={currency(Math.abs(ov.targetVariance))}
            subtitle={ov.targetVariance >= 0 ? 'Target – Revenue' : 'Revenue – Target'}
            icon={Target}
            chip={mtdChip}
            rightSlot={<ProgressRing percent={revenueProgressPct} target={100} label="progress vs target" />}
            tooltip="Variance uses the same to-date cutoff as Revenue."
          />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="sr-only">Daily Revenue vs Target</h3>
          <div className="h-80">
            {ov.dailyData?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ov.dailyData} margin={{ top: 40, right: 16, bottom: 8, left: 8 }}>
                  <text
                    x="50%"
                    y={18}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: 16, fontWeight: 700, fill: '#111', pointerEvents: 'none' }}
                  >
                    Daily Revenue vs Target
                  </text>

                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  {/* 👇 force Y domain to include the target line */}
                  <YAxis tick={Y_TICK_SMALL} domain={[0, chartMaxY]} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend content={renderLegend} />

                  {dailyTargetLevel > 0 && (
                    <ReferenceLine
                      y={dailyTargetLevel}
                      stroke="#000"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                      label={{ value: `Target ${currency(dailyTargetLevel)}`, position: 'top', fill: '#000', fontSize: 12 }}
                    />
                  )}

                  <Bar dataKey="revenue" name="Actual Revenue">
                    {ov.dailyData.map((d, i) => {
                      const rev = num(d.revenue);
                      const tgt = num(dailyTargetLevel);
                      const epsilon = Math.max(100, tgt * 0.01);
                      const met = (d.met === true) || (rev + epsilon >= tgt);
                      return <Cell key={`rev-${i}`} fill={met ? '#10B981' : '#EF4444'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">No daily data yet.</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* -------- Room Types -------- */

  const roomTypeRaw = Array.isArray(ov.roomTypes) && ov.roomTypes.length ? ov.roomTypes : [
    { type: 'Queen', rooms: 26, available: 806, sold: 274, revenue: 233853, rate: 853, occupancy: 34 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 132, revenue: 106226, rate: 804, occupancy: 43 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 260, revenue: 279620, rate: 1075, occupancy: 52 },
    { type: '2 Bed', rooms: 7,  available: 217, sold: 130, revenue: 177729, rate: 1367, occupancy: 60 },
  ];
  const roomTypeData = roomTypeRaw.map((rt) => {
    const available = num(rt.available, null);
    const sold      = num(rt.sold, null);
    const revenue   = num(rt.revenue, 0);
    const rate      = num(rt.rate ?? rt.arr ?? rt.adr, 0);
    const occFromCalc = (available && sold !== null) ? (sold / available) * 100 : null;
    const occ = asPercent(rt.occupancy ?? occFromCalc ?? 0, 0);
    return { type: rt.type || 'Unknown', available: available ?? 0, sold: sold ?? 0, revenue, rate, occupancy: occ };
  });

  const rtTotalRevenue   = roomTypeData.reduce((a, r) => a + num(r.revenue), 0);
  const rtTotalAvailable = roomTypeData.reduce((a, r) => a + num(r.available), 0);
  const rtTotalSold      = roomTypeData.reduce((a, r) => a + num(r.sold), 0);
  const rtWeightedADR    = rtTotalSold ? Math.round(rtTotalRevenue / rtTotalSold) : 0;
  const rtAvgOcc         = rtTotalAvailable ? Math.round((rtTotalSold / rtTotalAvailable) * 100) : 0;

  const RoomTypesView = () => {
    const [sortBy, setSortBy] = useState('revenue');
    const [asc, setAsc] = useState(false);

    const sorted = useMemo(() => {
      const keyMap = {
        revenue: (r) => num(r.revenue),
        occupancy: (r) => num(r.occupancy),
        rate: (r) => num(r.rate),
        sold: (r) => num(r.sold),
      };
      const keyFn = keyMap[sortBy] || keyMap.revenue;
      return [...roomTypeData].sort((a, b) => keyFn(b) - keyFn(a));
    }, [roomTypeData, sortBy]);

    useEffect(() => { if (asc) sorted.reverse(); }, [asc, sorted]);

    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="Room Types" value={sorted.length} subtitle="Active types" icon={SlidersHorizontal} />
          <MetricCard title="Revenue MTD" value={currency(rtTotalRevenue)} subtitle="Across all types" icon={DollarSign} />
          <MetricCard title="Weighted ADR" value={currency(rtWeightedADR)} subtitle="Revenue ÷ sold" icon={Home} />
          <MetricCard title="Avg Occupancy" value={pct(rtAvgOcc)} subtitle="Sold ÷ available" icon={Users} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="sr-only">Revenue by Room Type</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 40, right: 16, bottom: 8, left: 8 }}>
                  <text
                    x="50%" y={18}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 16, fontWeight: 700, fill: '#111', pointerEvents: 'none' }}
                  >
                    Revenue by Room Type
                  </text>

                  <defs>
                    {roomTypeData.map((r) => {
                      const pal = getPalette(r.type);
                      const id = gradIdFor(r.type);
                      return (
                        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1" key={id}>
                          <stop offset="0%" stopColor={pal.start} />
                          <stop offset="100%" stopColor={pal.end} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <Pie
                    data={roomTypeData}
                    cx="50%" cy="50%"
                    labelLine={false}
                    label={({ payload, percent, x, y, textAnchor }) => {
                      const pal = getPalette(payload.type);
                      return <text x={x} y={y} fill={pal.end} textAnchor={textAnchor} dominantBaseline="central">
                        {payload.type} {(percent * 100).toFixed(0)}%
                      </text>;
                    }}
                    outerRadius={80}
                    dataKey="revenue"
                  >
                    {roomTypeData.map((r, idx) => (<Cell key={`cell-${idx}`} fill={`url(#${gradIdFor(r.type)})`} />))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="sr-only">Occupancy vs ADR</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roomTypeData} margin={{ top: 40, right: 16, bottom: 8, left: 8 }}>
                  <text
                    x="50%" y={18}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: 16, fontWeight: 700, fill: '#111', pointerEvents: 'none' }}
                  >
                    Occupancy vs ADR
                  </text>

                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis tick={Y_TICK_SMALL} />
                  <RechartsTooltip formatter={(value, name) => {
                    if (name === 'occupancy') return [`${Math.round(value)}%`, 'Occupancy'];
                    if (name === 'rate') return [currency(value), 'ADR'];
                    return [value, name];
                  }} />
                  <Legend />
                  <Bar dataKey="occupancy" fill="#10B981" name="Occupancy (%)" />
                  <Bar dataKey="rate" fill="#3B82F6" name="ADR (R)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* -------- Historical -------- */

  const yearlyData = Array.isArray(ov.history) && ov.history.length ? ov.history : [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759,  occupancy: 45, revenue: 701738,  rate: 925  },
    { year: '2025', roomsSold: 569,  occupancy: 46, revenue: 593854,  rate: 1042 }
  ];

  const HistoricalView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="sr-only">Annual Revenue Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData} margin={{ top: 40, right: 16, bottom: 8, left: 8 }}>
                <text
                  x="50%" y={18}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 16, fontWeight: 700, fill: '#111', pointerEvents: 'none' }}
                >
                  Annual Revenue Trend
                </text>

                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tick={Y_TICK_SMALL} />
                <RechartsTooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="sr-only">Occupancy Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData} margin={{ top: 40, right: 16, bottom: 8, left: 8 }}>
                <text
                  x="50%" y={18}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 16, fontWeight: 700, fill: '#111', pointerEvents: 'none' }}
                >
                  Occupancy Trend
                </text>

                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tick={Y_TICK_SMALL} />
                <RechartsTooltip formatter={(value) => [`${Math.round(num(value))}%`, 'Occupancy']} />
                <Line type="monotone" dataKey="occupancy" stroke="#10B981" strokeWidth={3} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Year-over-Year Comparison</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Year</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rooms Sold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Occupancy</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Rate</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {yearlyData.map((y, i) => (
                <tr key={y.year || i}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{y.year}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{num(y.roomsSold)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pct(asPercent(y.occupancy))}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(y.revenue)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(y.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  /* ------------------------------ header & layout ------------------------------ */

  const tabs = [
    { id: 'overview', name: 'Overview', icon: Activity },
    { id: 'rooms', name: 'Room Types', icon: Home },
    { id: 'historical', name: 'Historical', icon: Calendar },
  ];

  const Inspector = () => {
    if (!showInspector) return null;
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-3 text-xs space-y-2">
          <div><b>Inspector</b> (add <code>&inspect=1</code> to toggle; hidden in production)</div>
          {rawSlice && (
            <>
              <div><b>Raw slice:</b></div>
              <pre className="overflow-auto">{JSON.stringify(rawSlice.slice, null, 2)}</pre>
            </>
          )}
          <div><b>Derived:</b></div>
          <pre className="overflow-auto">{JSON.stringify({
            month,
            arrearsDays: ARREARS_DAYS,
            elapsedDays: mtdRows.length,
            totalDays,
            occToDatePct: Math.round(occToDatePct),
            revenueProgressPct,
            rateProgressPct,
            arrMeanMTD,
            arrWeightedMTD
          }, null, 2)}</pre>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <Image src="/rs-logo2.png" alt="Reserved Suites" width={40} height={40} priority />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Reserved Suites Illovo</h1>
                <p className="text-sm text-gray-500">Revenue Dashboard</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <MonthSwitcher monthKey={month} onChange={setMonth} minKey={minKey} maxKey={maxKey} />
              <div className="text-right">
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="text-sm font-medium text-gray-900">{lastUpdatedStr || '—'}</p>
                {sourceInfo && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Source: {sourceInfo.source || '—'} {sourceInfo.status ? `(HTTP ${sourceInfo.status})` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Inspector />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setSelectedView(tab.id)}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedView === tab.id ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              type="button" aria-current={selectedView === tab.id ? 'page' : undefined}>
              <tab.icon className="w-4 h-4 mr-2" />{tab.name}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        {selectedView === 'overview' && <OverviewView />}
        {selectedView === 'rooms' && <RoomTypesView />}
        {selectedView === 'historical' && <HistoricalView />}
      </div>
    </div>
  );
};

export default Dashboard;
