import { PackageIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
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

function getStatusBadge(row) {
  const normalized = String(row?.status || '').trim().toLowerCase();
  const past = isPastOrder(row);

  if (['completed', 'collected'].includes(normalized)) {
    return {
      label: 'Completed',
      className: 'bg-emerald-100 text-emerald-700',
    };
  }

  if (normalized === 'preparing') {
    return {
      label: 'Preparing',
      className: 'bg-blue-100 text-blue-700',
    };
  }

  if (['confirmed', 'new', 'active'].includes(normalized)) {
    return {
      label: row.status,
      className: 'bg-yellow-100 text-yellow-800',
    };
  }

  if (past) {
    return {
      label: 'Past',
      className: 'bg-slate-100 text-slate-600',
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
  const status = String(row?.status || '').trim().toLowerCase();
  if (['completed', 'collected', 'cancelled', 'canceled', 'expired', 'refunded', 'failed'].includes(status)) {
    return true;
  }

  const pickupDate = parseCollectionTiming(row?.pickupTime, row?.createdAt);
  if (pickupDate) {
    return pickupDate.getTime() < Date.now();
  }

  return false;
}

function flattenRemoteOrders(orderList) {
  const safeOrders = Array.isArray(orderList) ? orderList : [];

  return safeOrders.flatMap((order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const currency = order?.currency || 'sgd';
    const orderId = order?.orderId || order?.id || 'ORD-UNKNOWN';
    const createdAt = order?.createdAt || null;
    const orderStatus = normalizeStatusLabel(order?.status, 'Confirmed');

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
        status: orderStatus,
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
        status: orderStatus,
        createdAt,
        source: 'remote',
      };
    });
  });
}

function flattenLocalOrders(orderList) {
  const safeOrders = Array.isArray(orderList) ? orderList : [];

  return safeOrders.map((order, index) => {
    const item = order?.item || {};
    const itemName =
      getField(item, 'itemName', 'ItemName', 'name', 'Name') || 'Item';
    const itemId = getField(item, 'listingId', 'ListingId', 'id', 'Id');
    const quantity = Number(order?.quantity ?? 0);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const unitPaid = toMajorUnits(getField(item, 'price', 'Price', 'unitAmount'));

    return {
      rowKey:
        order?.lineKey ||
        buildRowKey({
          orderId: order?.orderId,
          itemId: itemId != null ? String(itemId) : '',
          itemName,
          pickupTime: order?.pickupTime || '',
          index,
        }),
      orderId: order?.orderId || 'ORD-PENDING',
      itemName: String(itemName),
      restaurantName: String(
        getField(item, 'restaurantName', 'RestaurantName') || ''
      ),
      quantity: safeQuantity,
      pickupTime: order?.pickupTime || '',
      paidAmount: Number((unitPaid * safeQuantity).toFixed(2)),
      currency: 'sgd',
      status: normalizeStatusLabel(order?.status, 'Active'),
      createdAt: order?.createdAt || null,
      source: 'local',
    };
  });
}

export default function UserOrders() {
  const { user, orders: localOrders, clearOrders } = useAuth();
  const [statusTab, setStatusTab] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteOrders, setRemoteOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    const merged = new Map();

    for (const row of flattenLocalOrders(localOrders)) {
      merged.set(row.rowKey, row);
    }

    for (const row of flattenRemoteOrders(remoteOrders)) {
      merged.set(row.rowKey, row);
    }

    return Array.from(merged.values()).sort((a, b) => {
      const aTime = getDateMs(a?.createdAt);
      const bTime = getDateMs(b?.createdAt);
      return bTime - aTime;
    });
  }, [localOrders, remoteOrders]);

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
    let active = 0;
    let past = 0;

    for (const row of mergedRows) {
      if (isPastOrder(row)) past += 1;
      else active += 1;
    }

    return { active, past };
  }, [mergedRows]);

  const visibleRows = useMemo(() => {
    return filteredBySearch.filter((row) => {
      const past = isPastOrder(row);
      return statusTab === 'past' ? past : !past;
    });
  }, [filteredBySearch, statusTab]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Orders</h1>
        <p className="mt-2 text-slate-600">
          Track upcoming collections and review your past order history.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {[
          { key: 'active', label: 'Active', count: counts.active },
          { key: 'past', label: 'Past', count: counts.past },
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item, restaurant, pickup time, or order ID"
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />
        </div>

        {localOrders.length > 0 && (
          <Button type="button" variant="outline" onClick={clearOrders}>
            Clear local placeholders
          </Button>
        )}
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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
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
                {visibleRows.map((row) => (
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
        </div>
      )}
    </div>
  );
}
