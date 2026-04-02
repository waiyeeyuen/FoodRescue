import { PackageIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/spinner';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function toMajorUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (Number.isInteger(num) && num > 100) return num / 100;
  return num;
}

function formatMoney(value, currency = 'SGD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0.00';

  try {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: String(currency || 'SGD').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
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
  if (!match) return null;

  const createdDate = parseDateValue(createdAt);
  if (!createdDate) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const combined = new Date(createdDate);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}

function getDateMs(value) {
  return parseDateValue(value)?.getTime() || 0;
}

function formatDateTime(value, createdAt) {
  const parsed = parseCollectionTiming(value, createdAt);
  if (!parsed) return value || '-';

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPickupTimeFromNotes(order, itemName) {
  const notes = String(order?.notes || '').trim();
  const safeItemName = String(itemName || '').trim();

  if (!notes || !safeItemName) return '';

  const exactItemPattern = new RegExp(
    `-\\s*${escapeRegExp(safeItemName)}(?:\\s*@[^()]*)?\\s*\\(Pickup:\\s*([^)]*)\\)`,
    'i'
  );
  const exactItemMatch = notes.match(exactItemPattern);
  if (exactItemMatch?.[1]) {
    const value = exactItemMatch[1].trim();
    return value === '—' ? '' : value;
  }

  const genericMatch = notes.match(/Pickup:\s*([^) \n\r]+)/i);
  if (genericMatch?.[1]) {
    const value = genericMatch[1].trim();
    return value === '—' ? '' : value;
  }

  return '';
}

function getRemoteItemPickupTime(order, item, itemName) {
  return (
    getField(item, 'pickupTime', 'PickupTime') ||
    getField(order, 'pickupTime', 'PickupTime') ||
    extractPickupTimeFromNotes(order, itemName) ||
    ''
  );
}

function normalizeStatusLabel(value, fallback = 'Active') {
  const raw = String(value || fallback).trim();
  if (!raw) return fallback;
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeOrderItemStatus(value, fallback = 'new') {
  const normalized = String(value || fallback).trim().toLowerCase();

  if (['new', 'pending', 'confirmed'].includes(normalized)) {
    return 'confirmed';
  }

  if (['ready', 'preparing'].includes(normalized)) {
    return 'ready';
  }

  if (['completed', 'collected'].includes(normalized)) {
    return 'completed';
  }

  if (['refunded', 'partially_refunded'].includes(normalized)) {
    return 'refunded';
  }

  if (['cancelled', 'canceled', 'expired', 'failed', 'missed', 'uncollected'].includes(normalized)) {
    return 'uncollected';
  }

  return fallback;
}

function getOrderBucket(row) {
  const normalized = normalizeOrderItemStatus(row?.status, 'confirmed');
  const pickupDate = parseCollectionTiming(row?.pickupTime, row?.createdAt);
  const pickupPassed = pickupDate ? pickupDate.getTime() < Date.now() : false;

  if (normalized === 'completed') {
    return 'completed';
  }

  if (normalized === 'ready') {
    return 'ready';
  }

  if (normalized === 'uncollected') {
    return 'uncollected';
  }

  if (normalized === 'refunded') {
    return 'refunded';
  }

  if (pickupPassed) {
    return 'uncollected';
  }

  return 'confirmed';
}

function getStatusBadge(row) {
  const bucket = getOrderBucket(row);

  if (bucket === 'completed') {
    return {
      label: 'Completed',
      className: 'bg-emerald-100 text-emerald-700',
    };
  }

  if (bucket === 'ready') {
    return {
      label: 'Ready',
      className: 'bg-blue-100 text-blue-700',
    };
  }

  if (bucket === 'confirmed') {
    return {
      label: 'Confirmed',
      className: 'bg-yellow-100 text-yellow-800',
    };
  }

  if (bucket === 'uncollected') {
    return {
      label: 'Uncollected',
      className: 'bg-slate-200 text-slate-700',
    };
  }

  if (bucket === 'refunded') {
    return {
      label: 'Refunded',
      className: 'bg-rose-100 text-rose-700',
    };
  }

  return {
    label: row.status || 'Active',
    className: 'bg-slate-100 text-slate-600',
  };
}

function buildRowKey({ orderId, itemId, itemName, pickupTime, index = 0 }) {
  return [
    orderId || 'order',
    itemId || itemName || 'item',
    pickupTime || '',
    index,
  ].join('__');
}

function isPastOrder(row) {
  return ['completed', 'uncollected', 'refunded'].includes(getOrderBucket(row));
}

function flattenRemoteOrders(orderList) {
  const safeOrders = Array.isArray(orderList) ? orderList : [];

  return safeOrders.flatMap((order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const currency = order?.currency || 'sgd';
    const orderId = order?.orderId || order?.id || 'ORD-UNKNOWN';
    const createdAt = order?.createdAt || null;
    const orderStatus = normalizeOrderItemStatus(order?.status, 'confirmed');

    if (items.length === 0) {
      return [{
        rowKey: buildRowKey({ orderId, itemName: 'Order', index: 0 }),
        orderId,
        itemName: 'Order',
        restaurantName: '',
        quantity: 0,
        pickupTime: '',
        paidAmount: Number(order?.totalPrice ?? 0),
        currency,
        status: normalizeStatusLabel(orderStatus, 'Confirmed'),
        createdAt,
        source: 'remote',
      }];
    }

    return items.map((item, index) => {
      const itemName =
        getField(item, 'name', 'itemName', 'ItemName', 'title', 'itemId') || 'Item';
      const itemId = getField(item, 'itemId', 'listingId', 'id', 'Id');
      const pickupTime = getRemoteItemPickupTime(order, item, itemName);
      const quantity = Number(item?.quantity ?? 0);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
      const itemStatus = normalizeOrderItemStatus(
        getField(item, 'fulfillmentStatus', 'FulfillmentStatus', 'status', 'Status'),
        orderStatus
      );
      const unitPaid = toMajorUnits(
        getField(item, 'unitAmount', 'unitAmountMinor', 'price', 'Price')
      );

      return {
        rowKey: buildRowKey({
          orderId,
          itemId: itemId != null ? String(itemId) : '',
          itemName,
          pickupTime,
          index,
        }),
        orderId,
        itemName: String(itemName),
        restaurantName: String(
          getField(item, 'restaurantName', 'RestaurantName') || ''
        ),
        quantity: safeQuantity,
        pickupTime,
        paidAmount: Number((unitPaid * safeQuantity).toFixed(2)),
        currency,
        status: normalizeStatusLabel(itemStatus, 'Confirmed'),
        createdAt,
        source: 'remote',
      };
    });
  });
}

export default function UserOrders() {
  const { user } = useAuth();
  const [statusTab, setStatusTab] = useState('confirmed');
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteOrders, setRemoteOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const orderServiceUrl =
    import.meta.env.VITE_ORDER_SERVICE_URL || 'http://localhost:3004';

  useEffect(() => {
    const controller = new AbortController();

    async function loadOrders() {
      if (!user?.id) {
        setRemoteOrders([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${orderServiceUrl}/orders?customerId=${encodeURIComponent(user.id)}&limit=100`,
          { signal: controller.signal }
        );

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load orders');
        }

        if (!controller.signal.aborted) {
          setRemoteOrders(Array.isArray(data?.orders) ? data.orders : []);
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError(fetchError?.message || 'Failed to load orders');
          setRemoteOrders([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadOrders();

    return () => controller.abort();
  }, [orderServiceUrl, user?.id]);

  const mergedRows = useMemo(() => {
    return flattenRemoteOrders(remoteOrders).sort((a, b) => {
      const aTime = getDateMs(a?.createdAt);
      const bTime = getDateMs(b?.createdAt);
      return bTime - aTime;
    });
  }, [remoteOrders]);

  const filteredBySearch = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return mergedRows;

    return mergedRows.filter((row) => {
      const haystack = [
        row?.itemName,
        row?.restaurantName,
        row?.orderId,
        row?.status,
        row?.pickupTime,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [mergedRows, searchQuery]);

  const counts = useMemo(() => {
    let confirmed = 0;
    let ready = 0;
    let completed = 0;
    let uncollected = 0;
    let refunded = 0;

    for (const row of mergedRows) {
      const bucket = getOrderBucket(row);
      if (bucket === 'confirmed') confirmed += 1;
      else if (bucket === 'ready') ready += 1;
      else if (bucket === 'completed') completed += 1;
      else if (bucket === 'uncollected') uncollected += 1;
      else if (bucket === 'refunded') refunded += 1;
    }

    return { confirmed, ready, completed, uncollected, refunded };
  }, [mergedRows]);

  const visibleRows = useMemo(() => {
    return filteredBySearch.filter((row) => {
      return getOrderBucket(row) === statusTab;
    });
  }, [filteredBySearch, statusTab]);

  const PAGE_SIZE = 8;

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [statusTab, searchQuery]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visibleRows.slice(start, start + PAGE_SIZE);
  }, [page, visibleRows]);

  return (
    <div className="flex flex-col gap-6">
      <div className="spotlight-panel overflow-hidden rounded-[32px] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
          <div>
            <span className="hero-kicker">Pickup Timeline</span>
            <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
              Your rescue orders, without the clutter.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Upcoming collections stay front and center, while past rescues are neatly tucked
              away for quick review.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/70 bg-white/70 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Confirmed
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.confirmed}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/70 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Ready
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.ready}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {[
          { key: 'confirmed', label: 'Confirmed', count: counts.confirmed },
          { key: 'ready', label: 'Ready', count: counts.ready },
          { key: 'completed', label: 'Completed', count: counts.completed },
          { key: 'refunded', label: 'Refunded', count: counts.refunded },
          { key: 'uncollected', label: 'Uncollected', count: counts.uncollected },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
              statusTab === tab.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                statusTab === tab.key
                  ? 'bg-white/15 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="spotlight-panel flex flex-col gap-3 rounded-[28px] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item, restaurant, pickup time, or order ID"
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          Auto-synced from your confirmed orders
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && mergedRows.length === 0 ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-12">
          <Spinner className="size-5" />
          <span className="text-sm text-slate-600">Loading orders...</span>
        </div>
      ) : mergedRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <PackageIcon className="size-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No orders yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Once you complete checkout, your orders will appear here.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-foreground">No matching orders</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a different search term or switch to the other filter.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/80 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)] backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-white/70">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Collection Timing</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Order ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedRows.map((row) => (
                  <tr key={row.rowKey} className="align-top text-sm text-slate-700">
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{row.itemName}</div>
                      {row.restaurantName && (
                        <div className="mt-1 text-xs text-slate-500">{row.restaurantName}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 font-medium text-slate-900">
                      {formatMoney(row.paidAmount, row.currency)}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {formatDateTime(row.pickupTime, row.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-slate-600">{row.quantity}</td>
                    <td className="px-4 py-4">
                      {(() => {
                        const badge = getStatusBadge(row);
                        return (
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">{row.orderId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span>
                Page {page} of {pageCount}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-full border border-slate-200 px-3 py-1.5 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page === pageCount}
                  className="rounded-full border border-slate-200 px-3 py-1.5 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
