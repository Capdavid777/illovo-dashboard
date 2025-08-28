// components/Dashboard.js
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

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const asPercent = (v, d = 0) => { const n = num(v, d); return !Number.isFinite(n) ? d : (n <= 1.5 ? n * 100 : n); };
const currency = (n) => `R${num(n).toLocaleString()}`;
const pct = (n) => `${Math.round(num(n))}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const Y_TICK_SMALL = { fontSize: 11 };

function normalizeOverview(raw = {}) {
  const get = (keys, fallback) => { for (const k of keys) if (raw?.[k] !== undefined && raw?.[k] !== null) return raw[k]; return fallback; };
  const revenueToDate   = num(get(['revenueToDate', 'revenue_to_date', 'revenue'], 0));
  const targetToDate    = num(get(['targetToDate', 'target_to_date', 'target'], 0));
  const averageRoomRate = num(get(['averageRoomRate', 'avgRoomRate', 'arr'], 0));
  let occupancyRate = get(['occupancyRate', 'occupancy_to_date', 'occupancy'], undefined);
  occupancyRate = occupancyRate === undefined ? NaN : asPercent(occupancyRate);

  const dailyRaw = get(['dailySeries', 'daily', 'items', 'rows'], []) || [];
  const dailyData = dailyRaw.map((d, i) => {
    const day = d.day ?? (d.date ? new Date(d.date).getUTCDate() : i + 1);
    return {
      day,
      date: d.date,
      target: num(d.target ?? d.targetRevenue ?? d.target_revenue, 0),
      revenue: num(d.revenue, 0),
      occupancy: asPercent(d.occupancy ?? d.occ ?? d.occupancyRate ?? d.occRate, 0),
      rate: num(d.rate ?? d.arr ?? d.averageRate, 0),
      met: d.met ?? undefined,
    };
  });

  if (!Number.isFinite(occupancyRate)) {
    const vals = dailyData.map((d) => d.occupancy).filter((n) => Number.isFinite(n));
    occupancyRate = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const targetVariance = targetToDate - revenueToDate;
  const lastUpdated = get(['lastUpdated', 'updatedAt', 'last_updated'], null);
  const roomTypes = get(['roomTypes', 'roomTypesData'], null);
  const history   = get(['history', 'yearlyData'], null);

  return { revenueToDate, targetToDate, averageRoomRate, occupancyRate, targetVariance, dailyData, lastUpdated, roomTypes, history };
}

/* ------------------------------ brand palettes ------------------------------ */

const ROOM_PALETTES = {
  '2 Bed':         { start: '#0A2240', end: '#0F2E5E' },
  '1 Bed':         { start: '#708090', end: '#5F6B7A' },
  'Deluxe Studio': { start: '#B38B6D', end: '#A17855' },
  'Queen':         { start: '#D4AF37', end: '#C29D2C' },
  'Queen Room':    { start: '#D4AF37', end: '#C29D2C' }, // alias
};
const getPalette = (type) => ROOM_PALETTES[type] || { start: '#64748B', end: '#475569' };
const gradIdFor = (type) => `grad-${String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/* ------------------------------ component ------------------------------ */

const Dashboard = ({ overview }) => {
  const [selectedView, setSelectedView] = useState('overview');
  const [roomTypesState, setRoomTypesState] = useState(null);
  const ov = useMemo(() => normalizeOverview(overview), [overview]);

  // If overview didn’t include roomTypes, fetch them on the client as a fallback
  useEffect(() => {
    let abort = false;
    async function loadRoomTypes() {
      if (ov.roomTypes && Array.isArray(ov.roomTypes)) {
        setRoomTypesState(ov.roomTypes);
        return;
      }
      try {
        const r = await fetch('/api/room-types', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!abort) {
          const list = Array.isArray(j?.items) ? j.items : j;
          setRoomTypesState(list || null);
        }
      } catch {
        // ignore – UI shows fallbacks
      }
    }
    loadRoomTypes();
    return () => { abort = true; };
  }, [ov.roomTypes]);

  /* ------------------------------ data ------------------------------ */

  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'];

  /* ------------------------------ derived data ------------------------------ */

  const fallbackRoomTypeData = [
    { type: 'Queen', rooms: 26, available: 806, sold: 274, revenue: 233853, rate: 853, occupancy: 34 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 132, revenue: 106226, rate: 804, occupancy: 43 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 260, revenue: 279620, rate: 1075, occupancy: 52 },
    { type: '2 Bed', rooms: 7,  available: 217, sold: 130, revenue: 177729, rate: 1367, occupancy: 60 },
  ];

  // Derive normalised room-type rows from provided data (or fallback)
  const baseRoomTypeData = useMemo(() => {
    const source = (roomTypesState && roomTypesState.length)
      ? roomTypesState
      : (ov.roomTypes || fallbackRoomTypeData);

    return (source ?? []).map(r => {
      const available = num(r.available ?? r.rooms ?? r.capacity, 0);
      const sold      = num(r.sold ?? r.booked ?? r.nights, 0);
      const revenue   = num(r.revenue, 0);

      // Prefer explicit rate; if missing, derive ADR safely
      const adr = Number.isFinite(num(r.rate))
        ? num(r.rate)
        : (sold ? Math.round(revenue / sold) : 0);

      // Prefer provided occupancy; else compute from sold/available
      const occRaw = (r.occupancy ?? r.occ ?? r.occupancyRate);
      const occ = Number.isFinite(num(occRaw))
        ? asPercent(occRaw, 0)
        : (available ? (sold / available) * 100 : 0);

      const revpar = available ? revenue / available : 0;

      return {
        ...r,
        available,
        sold,
        revenue,
        rate: adr,
        adr,
        occupancy: Math.round(occ * 10) / 10,
        revpar,
      };
    });
  }, [roomTypesState, ov.roomTypes]);

  // Sorting state + helpers
  const [sortBy, setSortBy] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');

  const toggleSort = (key) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'type' ? 'asc' : 'desc');
    }
  };

  const sortedRoomTypes = useMemo(() => {
    const list = [...baseRoomTypeData];
    list.sort((a, b) => {
      if (sortBy === 'type') {
        const av = (a.type || '').toString().toLowerCase();
        const bv = (b.type || '').toString().toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = num(a[sortBy]);
      const bv = num(b[sortBy]);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [baseRoomTypeData, sortBy, sortDir]);

  const colorsMap = useMemo(() => {
    const m = new Map();
    sortedRoomTypes.forEach((r, i) => m.set(r.type, colors[i % colors.length]));
    return m;
  }, [sortedRoomTypes]);

  const roomTypeData = sortedRoomTypes;

  const fallbackYearlyData = [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];
  const yearlyData = Array.isArray(ov.history) && ov.history.length ? ov.history : fallbackYearlyData;

  const rtTotalRevenue   = roomTypeData.reduce((a, r) => a + num(r.revenue), 0);
  const rtTotalAvailable = roomTypeData.reduce((a, r) => a + num(r.available), 0);
  const rtTotalSold      = roomTypeData.reduce((a, r) => a + num(r.sold), 0);
  const rtWeightedADR    = rtTotalSold ? Math.round(rtTotalRevenue / rtTotalSold) : 0;
  const rtAvgOcc         = rtTotalAvailable ? Math.round((rtTotalSold / rtTotalAvailable) * 100) : 0;

  const revenueProgressPct   = ov.targetToDate > 0 ? Math.round(100 * clamp01(ov.revenueToDate / ov.targetToDate)) : 0;
  const occupancyTargetPct   = 62;
  const occupancyProgressPct = Math.round(100 * clamp01(ov.occupancyRate / occupancyTargetPct));
  const breakevenRate = 1237;

  /* ------------------------------ reusable bits ------------------------------ */

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
    <span
      style={{
        width: 12, height: 12, display: 'inline-block', borderRadius: 2,
        background: type === 'revenue'
          ? 'linear-gradient(90deg, #EF4444 50%, #10B981 50%)'
          : '#000000',
        border: '1px solid rgba(0,0,0,0.25)',
      }}
    />
  );

  const renderLegend = () => (
    <div className="flex items-center justify-center gap-6 mt-2 text-sm">
      <div className="flex items-center gap-2">
        <LegendSwatch type="target" />
        <span>Daily Target</span>
      </div>
      <div className="flex items-center gap-2">
        <LegendSwatch type="revenue" />
        <span>Actual Revenue</span>
      </div>
    </div>
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const pData = payload[0]?.payload || {};
    const hitTarget = num(pData.revenue) >= num(pData.target);
    const revColor = hitTarget ? '#10B981' : '#EF4444';

    return (
      <div className="rounded-md bg-white shadow border p-3 text-sm">
        <div className="font-medium mb-1">Day {label}</div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-black" />
            <span>Daily Target</span>
          </div>
          <span className="font-medium">{currency(pData.target)}</span>
        </div>
        <div className="flex items-center justify-between gap-6 mt-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: revColor }} />
            <span>Actual Revenue</span>
          </div>
          <span className="font-medium" style={{ color: revColor }}>{currency(pData.revenue)}</span>
        </div>
      </div>
    );
  };

  /* ------------------------------ VIEWS ------------------------------ */

  const OverviewView = () => (
    <div className="space-y-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Revenue to Date"
          value={currency(ov.revenueToDate)}
          subtitle={ov.targetToDate ? `vs ${currency(ov.targetToDate)} target` : undefined}
          icon={DollarSign}
        />
        <MetricCard
          title="Occupancy Rate"
          value={pct(ov.occupancyRate)}
          subtitle={`vs ${pct(occupancyTargetPct)} target`}
          icon={Users}
        />
        <MetricCard
          title="Average Room Rate"
          value={currency(ov.averageRoomRate)}
          subtitle={`vs breakeven ${currency(breakevenRate)}`}
          icon={Home}
        />
        <MetricCard
          title="Target Variance"
          value={currency(Math.abs(ov.targetVariance))}
          subtitle={ov.targetVariance >= 0 ? 'Target – Revenue' : 'Revenue – Target'}
          icon={Target}
        />
      </div>

      {/* Progress Bars */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Progress to Breakeven</h3>
        <div className="space-y-2 mb-4">
          <div className="flex justify-between">
            <span className="text-sm font-medium text-gray-700">Revenue Progress</span>
            <span className="text-sm text-gray-500">{revenueProgressPct}% of target</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full ${revenueProgressPct >= 100 ? 'bg-[#CBA135]' : 'bg-black'}`}
              style={{ width: `${revenueProgressPct}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm font-medium text-gray-700">Occupancy Progress</span>
            <span className="text-sm text-gray-500">{occupancyProgressPct}% of target</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full ${occupancyProgressPct >= 100 ? 'bg-[#CBA135]' : 'bg-black'}`}
              style={{ width: `${occupancyProgressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Daily Revenue Chart */}
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
                  {ov.dailyData.map((d, i) => (
                    <Cell key={`rev-${i}`} fill={d.revenue >= d.target ? '#10B981' : '#EF4444'} />
                  ))}
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
    const SortIcon = ({ col }) => (
      <span className="ml-1 text-gray-400">
        {sortBy !== col ? '↕' : sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );

    const Th = ({ label, col, right }) => (
      <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${right ? 'text-right' : 'text-left'} text-gray-600`}>
        <button onClick={() => toggleSort(col)} className="inline-flex items-center hover:text-gray-900">
          {label}
          <SortIcon col={col} />
        </button>
      </th>
    );

    return (
      <div className="space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {roomTypeData.map((room, index) => (
            <MetricCard
              key={room.type || index}
              title={room.type}
              value={`${Math.round(room.occupancy)}%`}
              subtitle={`${currency(room.rate)} avg rate`}
              icon={Home}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Revenue Share Pie */}
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Room Type Revenue</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={roomTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ type, percent }) => `${type} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="revenue"
                  >
                    {roomTypeData.map((r, i) => (
                      <Cell key={`cell-${i}`} fill={colorsMap.get(r.type) || colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bar-ish progress list */}
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Room Type Performance</h3>
            <div className="space-y-4">
              {roomTypeData.map((room, i) => (
                <div key={room.type || i} className="border-l-4 pl-4" style={{ borderColor: colorsMap.get(room.type) || colors[i % colors.length] }}>
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{room.type}</span>
                    <span className="text-sm text-gray-500">
                      {num(room.sold, 0)}/{num(room.available, 0)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Revenue: {currency(room.revenue)} | ADR: {currency(room.rate)} | RevPAR: {currency(room.revpar)}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, num(room.occupancy)))}%`,
                        backgroundColor: colorsMap.get(room.type) || colors[i % colors.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sortable details table */}
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Room Type Details</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <Th label="Type" col="type" />
                  <Th label="Available" col="available" right />
                  <Th label="Sold" col="sold" right />
                  <Th label="Occ %" col="occupancy" right />
                  <Th label="ADR" col="rate" right />
                  <Th label="RevPAR" col="revpar" right />
                  <Th label="Revenue" col="revenue" right />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {roomTypeData.map((r, i) => (
                  <tr key={r.type || i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: colorsMap.get(r.type) || colors[i % colors.length] }}
                        />
                        <span className="font-medium text-gray-900">{r.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.available)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.sold)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{pct(r.occupancy)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{currency(r.rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{currency(r.revpar)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{currency(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

  /* ------------------------------ layout ------------------------------ */

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
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
              <div className="text-right">
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="text-sm font-medium">
                  {ov.lastUpdated ? new Date(ov.lastUpdated).toLocaleDateString() : new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-1">
          {[
            { id: 'overview', name: 'Overview', icon: Activity },
            { id: 'rooms', name: 'Room Types', icon: Home },
            { id: 'historical', name: 'Historical', icon: Calendar },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedView(tab.id)}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedView === tab.id ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
              type="button"
              aria-current={selectedView === tab.id ? 'page' : undefined}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        {selectedView === 'overview' && <OverviewView />}
        {selectedView === 'rooms' && <RoomTypesView />}
        {selectedView === 'historical' && <HistoricalView />}
      </div>
    </div>
  );
};

export default Dashboard;
