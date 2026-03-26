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

function normalizeStatus(value, fallback = 'new') {
  const raw = String(value || fallback).trim().toLowerCase();
  if (['new', 'preparing', 'completed'].includes(raw)) return raw;
  return fallback;
}

export default function RestaurantOrders() {
  const { user } = useAuth();

  const orderServiceUrl =
    import.meta.env.VITE_ORDER_SERVICE_URL || 'http://localhost:3004';

  const [statusTab, setStatusTab] = useState('new');
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({ new: 0, preparing: 0, completed: 0, all: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingKey, setUpdatingKey] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadRestaurantOrders() {
      if (!user?.id) {
        setOrders([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const query = new URLSearchParams({
          restaurantName: user?.restaurantName || '',
        });

        const response = await fetch(
          `${orderServiceUrl}/orders/restaurant/${encodeURIComponent(user.id)}?${query.toString()}`,
          { signal: controller.signal }
        );

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load restaurant orders');
        }

        if (!controller.signal.aborted) {
          setOrders(Array.isArray(data?.orders) ? data.orders : []);
          setCounts({
            new: Number(data?.counts?.new || 0),
            preparing: Number(data?.counts?.preparing || 0),
            completed: Number(data?.counts?.completed || 0),
            all: Number(data?.counts?.all || 0),
          });
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError(fetchError?.message || 'Failed to load restaurant orders');
          setOrders([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadRestaurantOrders();

    return () => controller.abort();
  }, [orderServiceUrl, user?.id, user?.restaurantName]);

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      const itemStatus = normalizeStatus(getField(order?.item, 'fulfillmentStatus', 'FulfillmentStatus'));
      return itemStatus === statusTab;
    });
  }, [orders, statusTab]);

  async function updateItemStatus(order, nextStatus) {
    const item = order?.item || {};
    const itemId = getField(item, 'itemId', 'listingId', 'id', 'Id');
    if (!order?.orderId || !itemId) return;

    const updateKey = `${order.orderId}:${itemId}`;

    try {
      setUpdatingKey(updateKey);
      setError(null);

      const response = await fetch(
        `${orderServiceUrl}/orders/${encodeURIComponent(order.orderId)}/items/${encodeURIComponent(itemId)}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus,
            restaurantId: user?.id || '',
            restaurantName: user?.restaurantName || '',
          }),
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update order status');
      }

      setOrders((prev) =>
        prev.map((entry) => {
          const entryItemId = getField(entry?.item, 'itemId', 'listingId', 'id', 'Id');
          if (entry?.orderId !== order.orderId || String(entryItemId) !== String(itemId)) {
            return entry;
          }

          return {
            ...entry,
            orderStatus: data?.orderStatus || entry.orderStatus,
            item: {
              ...entry.item,
              fulfillmentStatus: data?.status || nextStatus,
            },
          };
        })
      );

      setCounts((prev) => {
        const currentStatus = normalizeStatus(getField(order?.item, 'fulfillmentStatus', 'FulfillmentStatus'));
        const normalizedNextStatus = normalizeStatus(nextStatus);
        if (currentStatus === normalizedNextStatus) return prev;

        return {
          ...prev,
          [currentStatus]: Math.max(0, Number(prev?.[currentStatus] || 0) - 1),
          [normalizedNextStatus]: Number(prev?.[normalizedNextStatus] || 0) + 1,
        };
      });
    } catch (updateError) {
      setError(updateError?.message || 'Failed to update order status');
    } finally {
      setUpdatingKey('');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
        <p className="mt-2 text-slate-600">
          View newly confirmed pickups and move them through fulfillment.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {[
          { key: 'new', label: 'New', count: counts.new },
          { key: 'preparing', label: 'Preparing', count: counts.preparing },
          { key: 'completed', label: 'Completed', count: counts.completed },
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

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-12">
          <Spinner className="size-5" />
          <span className="text-sm text-slate-600">Loading restaurant orders...</span>
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-slate-900">No {statusTab} orders</h2>
          <p className="mt-2 text-sm text-slate-500">
            Confirmed orders for your restaurant will appear here after payment succeeds.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Collection</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOrders.map((order) => {
                  const item = order?.item || {};
                  const itemId = getField(item, 'itemId', 'listingId', 'id', 'Id');
                  const itemStatus = normalizeStatus(
                    getField(item, 'fulfillmentStatus', 'FulfillmentStatus')
                  );
                  const updateKey = `${order.orderId}:${itemId}`;
                  const isUpdating = updatingKey === updateKey;
                  const quantity = Number(item?.quantity ?? 0);
                  const paidAmount =
                    toMajorUnits(getField(item, 'unitAmount', 'unitAmountMinor', 'price', 'Price')) *
                    (Number.isFinite(quantity) ? quantity : 0);

                  return (
                    <tr key={updateKey} className="align-top text-sm text-slate-700">
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">
                          {getField(item, 'name', 'itemName', 'ItemName') || 'Item'}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Order {order.orderId}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{quantity}</td>
                      <td className="px-4 py-4 font-medium text-slate-900">
                        {formatMoney(paidAmount, order?.currency)}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDateTime(
                          getField(item, 'pickupTime', 'PickupTime'),
                          order?.createdAt
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{order?.customerId || '-'}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            itemStatus === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : itemStatus === 'preparing'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {itemStatus.charAt(0).toUpperCase() + itemStatus.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {itemStatus === 'new' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isUpdating}
                              onClick={() => updateItemStatus(order, 'preparing')}
                            >
                              {isUpdating ? 'Updating...' : 'Mark Preparing'}
                            </Button>
                          )}
                          {itemStatus !== 'completed' && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={isUpdating}
                              onClick={() => updateItemStatus(order, 'completed')}
                            >
                              {isUpdating ? 'Updating...' : 'Mark Completed'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
