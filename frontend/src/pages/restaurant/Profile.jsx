import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { ACCOUNT_SERVICE_URL, ORDER_SERVICE_URL } from '@/lib/api';

function normalizeRestaurantImpact(impact) {
  const safeImpact = impact && typeof impact === 'object' ? impact : {};
  return {
    mealsRescued: Number(safeImpact.mealsRescued || 0),
    co2KgSaved: Number((safeImpact.co2KgSaved ?? safeImpact.co2) || 0),
    waterLitersSaved: Number((safeImpact.waterLitersSaved ?? safeImpact.water) || 0),
    revenueRecovered: Number(safeImpact.revenueRecovered || 0),
    ordersFulfilled: Number(safeImpact.ordersFulfilled || 0),
    repeatCustomers: Number(safeImpact.repeatCustomers || 0),
  };
}

function parseDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCollectionTiming(value, createdAt) {
  const direct = parseDateValue(value);
  if (direct) return direct;

  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseDateValue(createdAt);

  const baseDate = parseDateValue(createdAt);
  if (!baseDate) return null;

  const combined = new Date(baseDate);
  combined.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return combined;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'preparing') return 'ready';
  return raw;
}

function toMajorUnits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (Number.isInteger(numeric) && numeric > 100) return numeric / 100;
  return numeric;
}

function getDayStart(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function buildChartSeries(orders, range, metric) {
  const today = getDayStart(new Date());

  if (range === 'year') {
    const months = Array.from({ length: 12 }, (_, index) => {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - (11 - index), 1);
      const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      return {
        key,
        label: monthDate.toLocaleDateString([], { month: 'short' }),
        value: 0,
      };
    });

    for (const order of orders) {
      const date = parseCollectionTiming(order?.item?.pickupTime, order?.createdAt) || parseDateValue(order?.updatedAt);
      if (!date) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = months.find((entry) => entry.key === key);
      if (!bucket) continue;
      bucket.value += getMetricValue(order, metric);
    }

    return months;
  }

  const span = range === 'month' ? 30 : 7;
  const buckets = Array.from({ length: span }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (span - 1 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label:
        range === 'week'
          ? date.toLocaleDateString([], { weekday: 'short' })
          : date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      date,
      value: 0,
    };
  });

  for (const order of orders) {
    const date = parseCollectionTiming(order?.item?.pickupTime, order?.createdAt) || parseDateValue(order?.updatedAt);
    if (!date) continue;
    const bucketKey = getDayStart(date).toISOString().slice(0, 10);
    const bucket = buckets.find((entry) => entry.key === bucketKey);
    if (!bucket) continue;
    bucket.value += getMetricValue(order, metric);
  }

  return buckets;
}

function getMetricValue(order, metric) {
  if (metric === 'revenue') {
    return toMajorUnits(order?.item?.unitAmount ?? order?.item?.price ?? 0) * Number(order?.item?.quantity || 0);
  }

  return Number(order?.item?.quantity || 0);
}

function formatMetric(metric, value) {
  const numeric = Number(value || 0);
  if (metric === 'revenue') return `SGD ${numeric.toFixed(2)}`;
  return `${numeric.toFixed(0)}`;
}

function getVisibleTickIndexes(data) {
  const safeData = Array.isArray(data) ? data : [];
  if (safeData.length <= 7) {
    return safeData.map((_, index) => index);
  }

  const step = Math.ceil(safeData.length / 6);
  const indexes = [];
  for (let index = 0; index < safeData.length; index += step) {
    indexes.push(index);
  }
  if (!indexes.includes(safeData.length - 1)) {
    indexes.push(safeData.length - 1);
  }
  return indexes;
}

function TrendChart({ title, metric, metricHint, data, accentColor, pointColor }) {
  const safeData = Array.isArray(data) ? data : [];
  const width = 760;
  const height = 260;
  const paddingTop = 20;
  const paddingBottom = 42;
  const paddingX = 26;
  const maxValue = Math.max(...safeData.map((point) => Number(point.value || 0)), 1);
  const tickIndexes = getVisibleTickIndexes(safeData);

  const points = safeData.map((point, index) => {
    const x =
      safeData.length === 1
        ? width / 2
        : paddingX + (index * (width - paddingX * 2)) / (safeData.length - 1);
    const y =
      height -
      paddingBottom -
      ((Number(point.value || 0) / maxValue) * (height - paddingTop - paddingBottom));
    return { ...point, x, y };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
  const total = safeData.reduce((sum, point) => sum + Number(point.value || 0), 0);

  return (
    <div className="rounded-[28px] border border-white/70 bg-white/70 p-4 shadow-[0_20px_40px_-30px_rgba(24,36,33,0.45)]">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {title}
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatMetric(metric, total)}
          </p>
        </div>
        <p className="text-xs text-slate-500">{metricHint}</p>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - paddingBottom - ratio * (height - paddingTop - paddingBottom);
          return (
            <line
              key={ratio}
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
              stroke="rgba(148,163,184,0.22)"
              strokeWidth="1"
            />
          );
        })}

        <polyline
          fill="none"
          stroke={accentColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyline}
        />

        {points.map((point) => (
          <circle
            key={point.key}
            cx={point.x}
            cy={point.y}
            r="4.5"
            fill={pointColor}
          />
        ))}

        {tickIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={`${point.key}-label`}
              x={point.x}
              y={height - 12}
              textAnchor="middle"
              className="fill-slate-400 text-[11px]"
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function RestaurantProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartRange, setChartRange] = useState('week');

  const accountServiceUrl = ACCOUNT_SERVICE_URL;
  const orderServiceUrl = ORDER_SERVICE_URL;

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setOrders([]);
      return;
    }

    const controller = new AbortController();

    async function loadStatistics() {
      try {
        setLoading(true);

        const [profileResponse, ordersResponse] = await Promise.all([
          fetch(
            `${accountServiceUrl}/account/restaurant/${encodeURIComponent(user.id)}`,
            { signal: controller.signal }
          ),
          fetch(
            `${orderServiceUrl}/orders/restaurant/${encodeURIComponent(user.id)}?restaurantName=${encodeURIComponent(user.restaurantName || '')}&limit=200`,
            { signal: controller.signal }
          ),
        ]);

        const profileData = await profileResponse.json().catch(() => ({}));
        const orderData = await ordersResponse.json().catch(() => ({}));

        if (!profileResponse.ok) {
          throw new Error(profileData?.error || 'Failed to load restaurant statistics');
        }

        if (!ordersResponse.ok) {
          throw new Error(orderData?.error || 'Failed to load restaurant orders');
        }

        if (!controller.signal.aborted) {
          setProfile(profileData);
          setOrders(Array.isArray(orderData?.orders) ? orderData.orders : []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to load restaurant statistics:', error);
          setProfile(null);
          setOrders([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadStatistics();

    return () => controller.abort();
  }, [accountServiceUrl, orderServiceUrl, user?.id, user?.restaurantName]);

  const impact = useMemo(() => normalizeRestaurantImpact(profile?.impact), [profile?.impact]);

  const completedOrders = useMemo(
    () =>
      orders.filter((order) => normalizeStatus(order?.item?.fulfillmentStatus) === 'completed'),
    [orders]
  );

  const mealsChartData = useMemo(
    () => buildChartSeries(completedOrders, chartRange, 'meals'),
    [completedOrders, chartRange]
  );

  const revenueChartData = useMemo(
    () => buildChartSeries(completedOrders, chartRange, 'revenue'),
    [completedOrders, chartRange]
  );

  const metricCards = [
    { label: 'Meals rescued', value: impact.mealsRescued, suffix: '' },
    { label: 'CO2 saved', value: impact.co2KgSaved.toFixed(1), suffix: 'kg' },
    { label: 'Water saved', value: Math.round(impact.waterLitersSaved), suffix: 'L' },
    { label: 'Revenue recovered', value: impact.revenueRecovered.toFixed(2), suffix: 'SGD' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <span className="hero-kicker">Restaurant Statistics</span>
            <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
              Track rescued meals like a real business dashboard.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              These numbers update from completed pickups, so the charts reflect actual rescues
              and actual revenue recovery instead of placeholder growth.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_22px_44px_-30px_rgba(24,36,33,0.45)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Fulfillment pulse
            </p>
            <p className="mt-3 text-4xl font-semibold text-[var(--brand-ink)]">
              {impact.ordersFulfilled}
            </p>
            <p className="mt-2 text-sm text-slate-600">Completed pickup quantities fulfilled</p>
            <p className="mt-2 text-xs text-slate-500">
              {loading ? 'Refreshing statistics...' : `Repeat customers: ${impact.repeatCustomers}`}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_20px_40px_-30px_rgba(24,36,33,0.45)] backdrop-blur-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {card.value}
              {card.suffix ? <span className="ml-2 text-sm text-slate-500">{card.suffix}</span> : null}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-[30px] border border-white/70 bg-white/78 p-6 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Rescue trends
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              Completed pickup impact over time
            </h2>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 p-1">
            {[
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
              { key: 'year', label: 'Year' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setChartRange(tab.key)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  chartRange === tab.key
                    ? 'bg-[var(--brand-ink)] text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <TrendChart
            title="Meals rescued"
            metric="meals"
            metricHint="Completed pickup quantities"
            data={mealsChartData}
            accentColor="rgba(20,95,89,0.95)"
            pointColor="rgba(238,127,88,0.96)"
          />
          <TrendChart
            title="Revenue recovered"
            metric="revenue"
            metricHint="Completed pickup revenue"
            data={revenueChartData}
            accentColor="rgba(211,168,91,0.95)"
            pointColor="rgba(20,95,89,0.96)"
          />
        </div>
      </section>
    </div>
  );
}
