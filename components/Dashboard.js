// components/Dashboard.js
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  Activity, Calendar, DollarSign, Home, Target, Users,
  ArrowUpDown, SlidersHorizontal
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
const currency = (n) => `R${num(n).toLocaleString()}`;
const pct = (n) => `${Math.round(num(n))}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const Y_TICK_SMALL = { fontSize: 11 };
const isJson = (res) => (res.headers.get('content-type') || '').toLowerCase().includes('application/json');

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

/* ------------------------------ Month switcher (visible text) ------------------------------ */
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
    while (cur <= end) {
      out.push(toKey(cur)); cur.setMonth(cur.getMonth() + 1);
    }
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
        if (Array.isArray(vv) && vv.length >= 10 && vv.length <= 40 && vv.every((x) => x && typeof x === 'object')) candidates.push(vv);
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
  const date = lookup(['date', 'dt', 'dayDate']);
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

/* ------------------------------ month-aware selectors ------------------------------ */

const get = (obj, keys, fallback) => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k]; return fallback; };

function pickArrayForMonth(raw, monthKey, fieldNames) {
  // Accept: direct array, { [monthKey]: [] }, or array with per-item 'month'/'period'/'monthKey'/'date'
  const rawField = get(raw, fieldNames, null);
  if (!rawField) return null;

  // { [monthKey]: [...] }
  if (!Array.isArray(rawField) && typeof rawField === 'object') {
    if (Array.isArray(rawField[monthKey])) return rawField[monthKey];
  }

  // direct array (maybe carries a month on the items)
  if (Array.isArray(rawField)) {
    const first = rawField[0];
    if (first && typeof first === 'object') {
      const monthProp = ['month', 'period', 'monthKey'].find((p) => p in first);
      if (monthProp) {
        const filtered = rawField.filter((r) => String(r[monthProp]) === monthKey);
        if (filtered.length) return filtered;
      }
      // Allow date-based filtering if items have 'date'
      if ('date' in first) {
        const m = monthKey.split('-').join('-');
        const filtered = rawField.filter((r) => {
          const d = r.date ? new Date(r.date) : null;
          return d && toKey(d) === monthKey;
        });
        if (filtered.length) return filtered;
      }
    }
    // Otherwise we assume the array already belongs to the selected month
    return rawField;
  }

  return null;
}

/* If room-types totals diverge too far from overview revenue, treat them as stale and ignore. */
function totalsMismatch(roomTypesArr, overviewRevenue) {
  if (!Array.isArray(roomTypesArr) || roomTypesArr.length === 0) return true;
  const sum = roomTypesArr.reduce((a, r) => a + num(r.revenue), 0);
  const A = Math.max(1, Math.abs(num(overviewRevenue)));
  const gap = Math.abs(sum - num(overviewRevenue));
  return gap / A > 0.2; // >20% off looks like a different month
}

/* ------------------------------ normalization ------------------------------ */

function normalizeOverview(raw = {}, monthKey) {
  let dailyArr = sniffDailyArray(raw);
  if (!Array.isArray(dailyArr)) dailyArr = [];
  const dailyData = dailyArr.map((row, i) => mapDailyRow(row, i)).filter(Boolean);

  let revenueToDate   = num(get(raw, ['revenueToDate','revenue_to_date','revenue'], NaN));
  let targetToDate    = num(get(raw, ['targetToDate','target_to_date','target'], NaN));
  let averageRoomRate = num(get(raw, ['averageRoomRate','avgRoomRate','arr','adr'], NaN));
  let occupancyRate   = get(raw, ['occupancyRate','occupancy_to_date','occupancy'], undefined);
  occupancyRate = occupancyRate === undefined ? NaN : asPercent(occupancyRate);

  if (!Number.isFinite(revenueToDate) && dailyData.length) revenueToDate = dailyData.reduce((a, d) => a + num(d.revenue, 0), 0);
  if (!Number.isFinite(targetToDate)  && dailyData.length) targetToDate  = dailyData.reduce((a, d) => a + num(d.target, 0), 0);
  if (!Number.isFinite(occupancyRate) && dailyData.length) {
    const vals = dailyData.map((d) => num(d.occupancy)).filter((n) => Number.isFinite(n));
    occupancyRate = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  if (!Number.isFinite(averageRoomRate)) averageRoomRate = 0;

  dailyData.sort((a, b) => a.day - b.day);

  const targetVariance = (Number.isFinite(targetToDate) ? targetToDate : 0) - (Number.isFinite(revenueToDate) ? revenueToDate : 0);
  const lastUpdated = get(raw, ['lastUpdated','updatedAt','last_updated'], null);

  // Month-aware extraction
  let roomTypes = pickArrayForMonth(raw, monthKey, ['roomTypes','roomTypesData']);
  if (roomTypes && totalsMismatch(roomTypes, revenueToDate)) roomTypes = null;

  let history = pickArrayForMonth(raw, monthKey, ['history','yearlyData']);
  // If not month-shaped, accept plain array (e.g., pure per-year rows)
  if (!history && Array.isArray(get(raw, ['history','yearlyData'], null))) {
    history = get(raw, ['history','yearlyData'], null);
  }

  return {
    revenueToDate: Number.isFinite(revenueToDate) ? revenueToDate : 0,
    targetToDate:  Number.isFinite(targetToDate) ? targetToDate : 0,
    averageRoomRate,
    occupancyRate: Number.isFinite(occupancyRate) ? occupancyRate : 0,
    targetVariance,
    dailyData,
    lastUpdated,
    roomTypes: Array.isArray(roomTypes) ? roomTypes : null,
    history: Array.isArray(history) ? history : null,
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

  const debugOn = (() => {
    if (typeof window === 'undefined') return false;
    try { return new URL(window.location.href).searchParams.get('debug') === '1'; } catch { return false; }
  })();
  const inspectOn = (() => {
    if (typeof window === 'undefined') return false;
    try { return new URL(window.location.href).searchParams.get('inspect') === '1'; } catch { return false; }
  })();

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
        if (inspectOn && !rawSlice) {
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
  }, [month, inspectOn]);

  const rawForNormalize = monthOverview || overview || {};
  const ov = useMemo(() => normalizeOverview(rawForNormalize, month), [rawForNormalize, month]);

  /* ------------------------------ derived aggregates ------------------------------ */

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

  const yearlyData = Array.isArray(ov.history) && ov.history.length ? ov.history : [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];

  const breakevenRate = 1237;
  const revenueProgressPct   = ov.targetToDate > 0 ? Math.round(100 * clamp01(ov.revenueToDate / ov.targetToDate)) : 0;
  const occupancyTargetPct   = 62;
  const occupancyProgressPct = Math.round(100 * clamp01(ov.occupancyRate / occupancyTargetPct));

  /* ------------------------------ UI bits ------------------------------ */

  const MetricCard = ({ title, value, subtitle, icon: Icon }) => (
    <div className="group rounded-xl border border-[#CBA135] bg-white shadow-sm transition-all duration-200 transform-gpu hover:-translate-y-1 hover:shadow-xl">
      <div className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {!!subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="p-3 rounded-full text-[#CBA135] bg-[#CBA135]/10 ring-1 ring-[#CBA135]/30">
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );

  const LegendSwatch = ({ type }) => (
    <span style={{ width: 12, height: 12, display: 'inline-block', borderRadius: 2,
      background: type === 'revenue' ? 'linear-gradient(90deg, #EF4444 50%, #10B981 50%)' : '#000000',
      border: '1px solid rgba(0,0,0,0.25)' }} />
  );

  const renderLegend = () => (
    <div className="flex items-center justify-center gap-6 mt-2 text-sm">
      <div className="flex items-center gap-2"><LegendSwatch type="target" /><span>Daily Target</span></div>
      <div className="flex items-center gap-2"><LegendSwatch type="revenue" /><span>Actual Revenue</span></div>
    </div>
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const pData = payload[0]?.payload || {};
    const rev = num(pData.revenue);
    const tgt = num(pData.target);
    const epsilon = Math.max(100, tgt * 0.01);
    const hitTarget = (pData.met === true) || (rev + epsilon >= tgt);
    const revColor = hitTarget ? '#10B981' : '#EF4444';

    return (
      <div className="rounded-md bg-white shadow border p-3 text-sm">
        <div className="font-medium mb-1">Day {label}</div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-black" /><span>Daily Target</span></div>
          <span className="font-medium">{currency(pData.target)}</span>
        </div>
        <div className="flex items-center justify-between gap-6 mt-1">
          <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: revColor }} /><span>Actual Revenue</span></div>
          <span className="font-medium" style={{ color: revColor }}>{currency(pData.revenue)}</span>
        </div>
      </div>
    );
  };

  /* ------------------------------ views ------------------------------ */

  const OverviewView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="Revenue to Date" value={currency(ov.revenueToDate)} subtitle={ov.targetToDate ? `vs ${currency(ov.targetToDate)} target` : undefined} icon={DollarSign} />
        <MetricCard title="Occupancy Rate" value={pct(ov.occupancyRate)} subtitle={`vs ${pct(62)} target`} icon={Users} />
        <MetricCard title="Average Room Rate" value={currency(ov.averageRoomRate)} subtitle={`vs breakeven ${currency(breakevenRate)}`} icon={Home} />
        <MetricCard title="Target Variance" value={currency(Math.abs(ov.targetVariance))} subtitle={ov.targetVariance >= 0 ? 'Target – Revenue' : 'Revenue – Target'} icon={Target} />
      </div>

      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Daily Revenue vs Target</h3>
        <div className="h-80">
          {ov.dailyData?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ov.dailyData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis tick={Y_TICK_SMALL} />
                <RechartsTooltip content={<CustomTooltip />} />
                <Legend content={renderLegend} />
                <Bar dataKey="target" name="Daily Target" fill="#000000" />
                <Bar dataKey="revenue" name="Actual Revenue">
                  {ov.dailyData.map((d, i) => {
                    const rev = num(d.revenue);
                    const tgt = num(d.target);
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

  const RoomTypesView = () => {
    const [sortBy, setSortBy] = useState('revenue');
    const [asc, setAsc] = useState(false);
    const [compact, setCompact] = useState(true);

    const sorted = useMemo(() => {
      const keyMap = {
        revenue: (r) => num(r.revenue),
        occupancy: (r) => num(r.occupancy),
        rate: (r) => num(r.rate),
        sold: (r) => num(r.sold),
      };
      const keyFn = keyMap[sortBy] || keyMap.revenue;
      const arr = [...roomTypeData].sort((a, b) => keyFn(b) - keyFn(a));
      return asc ? arr.reverse() : arr;
    }, [roomTypeData, sortBy, asc]);

    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="Room Types" value={sorted.length} subtitle="Active types" icon={SlidersHorizontal} />
          <MetricCard title="Revenue MTD" value={currency(rtTotalRevenue)} subtitle="Across all types" icon={DollarSign} />
          <MetricCard title="Weighted ADR" value={currency(rtWeightedADR)} subtitle="Revenue ÷ sold" icon={Home} />
          <MetricCard title="Avg Occupancy" value={pct(rtAvgOcc)} subtitle="Sold ÷ available" icon={Users} />
        </div>

        <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600">Sort by</label>
            <select className="border rounded-md px-2 py-1 text-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="revenue">Revenue</option>
              <option value="occupancy">Occupancy</option>
              <option value="rate">ADR</option>
              <option value="sold">Sold</option>
            </select>
            <button className="ml-2 inline-flex items-center border px-2 py-1 rounded-md text-sm" onClick={() => setAsc(v => !v)} type="button" title="Toggle ascending/descending">
              <ArrowUpDown className="w-4 h-4 mr-1" />
              {asc ? 'Asc' : 'Desc'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="density" className="text-sm text-gray-600">Density</label>
            <select id="density" className="border rounded-md px-2 py-1 text-sm" value={compact ? 'compact' : 'comfort'} onChange={(e) => setCompact(e.target.value === 'compact')}>
              <option value="comfort">Comfort</option>
              <option value="compact">Compact</option>
            </select>
          </div>
        </div>

        <div className={`grid gap-6 ${compact ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
          {sorted.map((room, i) => {
            const pal = getPalette(room.type);
            return (
              <div key={room.type + i} className="bg-white rounded-lg shadow p-5 border">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-lg font-semibold">{room.type}</h4>
                    <p className="text-xs text-gray-500">
                      <span>{num(room.sold)}</span>
                      <span className="mx-0.5 font-bold text-black">/</span>
                      <span>{num(room.available)}</span>
                      <span> sold</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div title="Month-to-date revenue">
                    <p className="text-gray-500">Revenue</p>
                    <p className="font-semibold">{currency(room.revenue)}</p>
                  </div>
                  <div title="Average daily rate (ADR)">
                    <p className="text-gray-500">ADR</p>
                    <p className="font-semibold">{currency(room.rate)}</p>
                  </div>
                  <div className="col-span-2" title="Occupancy (sold ÷ available)">
                    <p className="text-gray-500 mb-1">Occupancy</p>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full"
                        style={{ width: `${Math.max(0, Math.min(100, num(room.occupancy)))}%`,
                                 background: `linear-gradient(90deg, ${pal.start}, ${pal.end})` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{pct(room.occupancy)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Revenue by Room Type</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
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
                  <Pie data={roomTypeData} cx="50%" cy="50%" labelLine={false}
                       label={({ payload, percent, x, y, textAnchor }) => {
                         const pal = getPalette(payload.type);
                         return <text x={x} y={y} fill={pal.end} textAnchor={textAnchor} dominantBaseline="central">
                           {payload.type} {(percent * 100).toFixed(0)}%
                         </text>;
                       }} outerRadius={80} dataKey="revenue">
                    {roomTypeData.map((r, idx) => (<Cell key={`cell-${idx}`} fill={`url(#${gradIdFor(r.type)})`} />))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold">Occupancy vs ADR</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roomTypeData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
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

  const HistoricalView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Annual Revenue Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
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
          <h3 className="text-lg font-semibold mb-4">Occupancy Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
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

  /* ------------------------------ layout & debug ------------------------------ */

  const Inspector = () => {
    if (!inspectOn) return null;
    const dailySum = ov.dailyData.reduce((a, d) => a + num(d.revenue), 0);
    const targetSum = ov.dailyData.reduce((a, d) => a + num(d.target), 0);
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-3 text-xs space-y-2">
          <div><b>Inspector</b> (add <code>&inspect=1</code> to toggle)</div>
          {rawSlice && (
            <>
              <div><b>Raw slice ({rawSlice.tag}):</b></div>
              <pre className="overflow-auto">{JSON.stringify(rawSlice.slice, null, 2)}</pre>
            </>
          )}
          <div><b>Normalization summary:</b></div>
          <pre className="overflow-auto">{JSON.stringify({
            month,
            dailyRows: ov.dailyData.length,
            dailySumRevenue: dailySum,
            dailySumTarget: targetSum,
            revenueToDate: ov.revenueToDate,
            targetToDate: ov.targetToDate,
            occupancyRate: ov.occupancyRate,
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
                <p className="text-sm font-medium">
                  {ov.lastUpdated ? new Date(ov.lastUpdated).toLocaleDateString() : new Date().toLocaleDateString()}
                </p>
                {sourceInfo && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Source: {sourceInfo.source} {sourceInfo.status ? `(HTTP ${sourceInfo.status})` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>

          {loading && <div className="pb-3 text-sm text-gray-600">Loading data for {month}…</div>}
          {!loading && !monthOverview && (
            <div className="pb-3 text-sm text-red-600">
              No data found for {month}. Check admin APIs or add <code>/public/data/{month}.json</code>.
            </div>
          )}
        </div>
      </div>

      {debugOn && sourceInfo && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <pre className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-3 overflow-auto">
            {JSON.stringify(sourceInfo, null, 2)}
          </pre>
        </div>
      )}

      <Inspector />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-1">
          {[{ id: 'overview', name: 'Overview', icon: Activity }, { id: 'rooms', name: 'Room Types', icon: Home }, { id: 'historical', name: 'Historical', icon: Calendar }].map((tab) => (
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
