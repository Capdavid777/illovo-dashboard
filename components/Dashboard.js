// components/Dashboard.js
import React, { useMemo, useState } from 'react';
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

/* ------------------------------ brand palettes (with gradients) ------------------------------ */

const ROOM_PALETTES = {
  '2 Bed':         { start: '#0A2240', end: '#0F2E5E' }, // Deep Navy Blue
  '1 Bed':         { start: '#708090', end: '#5F6B7A' }, // Slate Gray
  'Deluxe Studio': { start: '#B38B6D', end: '#A17855' }, // Warm Taupe
  'Queen':         { start: '#D4AF37', end: '#C29D2C' }, // Soft Gold
  'Queen Room':    { start: '#D4AF37', end: '#C29D2C' }, // alias
};
const getPalette = (type) => ROOM_PALETTES[type] || { start: '#64748B', end: '#475569' };
const gradIdFor = (type) => `grad-${String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/* ------------------------------ component ------------------------------ */

const Dashboard = ({ overview }) => {
  const [selectedView, setSelectedView] = useState('overview');
  const ov = useMemo(() => normalizeOverview(overview), [overview]);

  /* ------------------------------ derived data ------------------------------ */

  const fallbackRoomTypeData = [
    { type: 'Queen', rooms: 26, available: 806, sold: 274, revenue: 233853, rate: 853, occupancy: 34 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 132, revenue: 106226, rate: 804, occupancy: 43 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 260, revenue: 279620, rate: 1075, occupancy: 52 },
    { type: '2 Bed', rooms: 7,  available: 217, sold: 130, revenue: 177729, rate: 1367, occupancy: 60 },
  ];
  const roomTypeRaw = Array.isArray(ov.roomTypes) && ov.roomTypes.length ? ov.roomTypes : fallbackRoomTypeData;

  const roomTypeData = roomTypeRaw.map((rt) => {
    const available = num(rt.available, null);
    const sold      = num(rt.sold, null);
    const revenue   = num(rt.revenue, 0);
    const rate      = num(rt.rate ?? rt.arr, 0);
    const occFromCalc = (available && sold !== null) ? (sold / available) * 100 : null;
    const occ = asPercent(rt.occupancy ?? occFromCalc ?? 0, 0);
    return { type: rt.type || 'Unknown', available: available ?? 0, sold: sold ?? 0, revenue, rate, occupancy: occ };
  });

  const rtTotalRevenue   = roomTypeData.reduce((a, r) => a + num(r.revenue), 0);
  const rtTotalAvailable = roomTypeData.reduce((a, r) => a + num(r.available), 0);
  const rtTotalSold      = roomTypeData.reduce((a, r) => a + num(r.sold), 0);
  const rtWeightedADR    = rtTotalSold ? Math.round(rtTotalRevenue / rtTotalSold) : 0;
  const rtAvgOcc         = rtTotalAvailable ? Math.round((rtTotalSold / rtTotalAvailable) * 100) : 0;

  const fallbackYearlyData = [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];
  const yearlyData = Array.isArray(ov.history) && ov.history.length ? ov.history : fallbackYearlyData;

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

  /* ---------- Custom Legend & Tooltip for Daily Revenue vs Target ---------- */

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
              <BarChart
                data={ov.dailyData}
                margin={{ top: 28, right: 24, bottom: 12, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis tickMargin={10} />
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
    const [sortBy, setSortBy] = useState('revenue');
    const [asc, setAsc] = useState(false);
    const [compact, setCompact] = useState(true); // default density = Compact

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
        {/* Summary Banner */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="Room Types" value={sorted.length} subtitle="Active types" icon={SlidersHorizontal} />
          <MetricCard title="Revenue MTD" value={currency(rtTotalRevenue)} subtitle="Across all types" icon={DollarSign} />
          <MetricCard title="Weighted ADR" value={currency(rtWeightedADR)} subtitle="Revenue ÷ sold" icon={Home} />
          <MetricCard title="Avg Occupancy" value={pct(rtAvgOcc)} subtitle="Sold ÷ available" icon={Users} />
        </div>

        {/* Controls */}
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

        {/* Cards Grid */}
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
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, num(room.occupancy)))}%`,
                          background: `linear-gradient(90deg, ${pal.start}, ${pal.end})`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{pct(room.occupancy)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Revenue by Room Type (Pie) */}
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
                  <Pie
                    data={roomTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ payload, percent, x, y, textAnchor }) => {
                      const pal = getPalette(payload.type);
                      return (
                        <text x={x} y={y} fill={pal.end} textAnchor={textAnchor} dominantBaseline="central">
                          {payload.type} {(percent * 100).toFixed(0)}%
                        </text>
                      );
                    }}
                    outerRadius={80}
                    dataKey="revenue"
                  >
                    {roomTypeData.map((r, idx) => (
                      <Cell key={`cell-${idx}`} fill={`url(#${gradIdFor(r.type)})`} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Occupancy vs ADR (with helper explanation) */}
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold">Occupancy vs ADR</h3>

            <details className="text-xs text-gray-600 mb-4 mt-2">
              <summary className="cursor-pointer select-none text-gray-700">How to read this</summary>
              <div className="mt-2 leading-relaxed">
                <p className="mb-1">
                  The chart compares each room type’s <span className="font-medium">Occupancy (%)</span> with its
                  {' '}<span className="font-medium">Average Daily Rate (ADR)</span> so you can see how price and demand line up:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><span className="font-medium">High ADR + low occupancy</span> → likely overpriced; consider discounting or promos.</li>
                  <li><span className="font-medium">Low ADR + high occupancy</span> → room type is underpriced; test a rate increase.</li>
                  <li><span className="font-medium">Both high</span> → star performer; protect rate and allocate inventory.</li>
                  <li><span className="font-medium">Both low</span> → weak product; repackage or reposition.</li>
                </ul>
              </div>
            </details>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={roomTypeData}
                  margin={{ top: 28, right: 24, bottom: 12, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis tickMargin={10} />
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
              <LineChart
                data={yearlyData}
                margin={{ top: 28, right: 24, bottom: 12, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickMargin={10} />
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
              <LineChart
                data={yearlyData}
                margin={{ top: 28, right: 24, bottom: 12, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickMargin={10} />
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
