import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, RefreshCwIcon } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function parseExpiryToMs(item) {
  const raw = getField(item, 'expiryTime', 'ExpiryTime');
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    // Heuristic: seconds vs ms
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }
  const num = Number(raw);
  if (Number.isFinite(num)) {
    return num < 10_000_000_000 ? num * 1000 : num;
  }
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.getTime();
  return null;
}

function formatLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!raw) return null;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through and return raw text when backend sends invalid JSON.
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function RestaurantListings() {
  const inventoryServiceUrl =
    import.meta.env.VITE_INVENTORY_SERVICE_URL || 'http://localhost:3000';

  const { user } = useAuth();
  const restaurantId = user?.id;

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [form, setForm] = useState(() => {
    const now = new Date();
    const inSixHours = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    return {
      restaurantName: user?.restaurantName || '',
      itemName: '',
      description: '',
      price: '',
      originalPrice: '',
      quantity: '',
      expiryLocal: formatLocalInputValue(inSixHours),
      imageURL: '',
      cuisineType: '',
    };
  });

  const fetchListings = async (signal) => {
    if (!restaurantId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `${inventoryServiceUrl}/inventory/restaurant/${encodeURIComponent(restaurantId)}`,
        { signal }
      );
      if (!res.ok) {
        let message = 'Failed to load listings';
        try {
          const body = await readResponseBody(res);
          if (typeof body === 'string') {
            message = body || message;
          } else {
            message = body?.error || message;
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const data = await readResponseBody(res);
      setListings(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchListings(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryServiceUrl, restaurantId]);

  const rows = useMemo(() => {
    const now = Date.now();
    return listings
      .map((item) => {
        const expiryMs = parseExpiryToMs(item);
        const isExpired = expiryMs ? expiryMs < now : false;
        const name = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
        const supplier = getField(item, 'supplier', 'Supplier') ?? '—';
        const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);
        const price = Number(getField(item, 'price', 'Price') ?? 0);
        return {
          key: getField(item, 'Id', 'id', 'listingId', 'ListingId') ?? `${name}-${expiryMs ?? ''}`,
          name,
          supplier,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          price: Number.isFinite(price) ? price : 0,
          expiryMs,
          isExpired,
        };
      })
      .sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity));
  }, [listings]);

    const onCreate = async (e) => {
    e.preventDefault();
    if (!restaurantId) {
      setCreateError('Missing restaurant id');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const expiryMs = new Date(form.expiryLocal).getTime();
      if (!Number.isFinite(expiryMs)) throw new Error('Invalid expiry time');

      const parsedPrice = Number(form.price);
      const parsedQuantity = Number(form.quantity);
      const parsedOriginalPrice = form.originalPrice === '' ? null : Number(form.originalPrice);
      if (!Number.isFinite(parsedPrice) || !Number.isFinite(parsedQuantity)) {
        throw new Error('Price and quantity must be valid numbers');
      }
      if (parsedOriginalPrice !== null && !Number.isFinite(parsedOriginalPrice)) {
        throw new Error('Original price must be a valid number');
      }

      const payload = {
        restaurantId,
        restaurantName: form.restaurantName.trim(),
        itemName: form.itemName.trim(),
        description: form.description.trim(),
        expiryTime: new Date(form.expiryLocal).toISOString(),
        price: parsedPrice,
        originalPrice: parsedOriginalPrice,
        quantity: parsedQuantity,
        imageURL: form.imageURL.trim(),
        cuisineType: form.cuisineType.trim(),
      };

      const res = await fetch(`${inventoryServiceUrl}/inventory/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let message = 'Failed to create listing';
        try {
          const body = await readResponseBody(res);
          if (typeof body === 'string') {
            message = body || message;
          } else {
            message = body?.error || message;
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      setForm((f) => ({
        ...f,
        itemName: '',
        description: '',
        price: '',
        originalPrice: '',
        quantity: '',
        imageURL: '',
        cuisineType: '',
      }));
      await fetchListings();
    } catch (e2) {
      setCreateError(e2?.message || 'Failed to create listing');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Listings</h1>
          <p className="text-slate-600 mt-2">
            Create listings and view everything you’ve published (including expired).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => fetchListings()}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-base font-semibold">Add Listing</h2>
          <PlusIcon className="text-muted-foreground size-4" />
        </div>

        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label className="text-xs text-muted-foreground">Restaurant name</label>
            <input
              value={form.restaurantName}
              onChange={(e) => setForm((f) => ({ ...f, restaurantName: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder={user?.restaurantName || 'Restaurant'}
              required
            />
          </div>

          <div className="sm:col-span-3">
            <label className="text-xs text-muted-foreground">Item name</label>
            <input
              value={form.itemName}
              onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="e.g. Fried Fish Noodle Soup"
              required
            />
          </div>

          <div className="sm:col-span-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <input
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="8.90"
              inputMode="decimal"
              required
            />
          </div>

          <div className="sm:col-span-1">
            <label className="text-xs text-muted-foreground">Original</label>
            <input
              value={form.originalPrice}
              onChange={(e) => setForm((f) => ({ ...f, originalPrice: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="5.00"
              inputMode="decimal"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="text-xs text-muted-foreground">Qty</label>
            <input
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="10"
              inputMode="numeric"
              required
            />
          </div>

          <div className="sm:col-span-3">
            <label className="text-xs text-muted-foreground">Expiry (local time)</label>
            <input
              type="datetime-local"
              value={form.expiryLocal}
              onChange={(e) => setForm((f) => ({ ...f, expiryLocal: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Sent to inventory as ISO datetime (UTC).
            </p>
          </div>

          <div className="sm:col-span-3">
            <label className="text-xs text-muted-foreground">Cuisine type</label>
            <input
              value={form.cuisineType}
              onChange={(e) => setForm((f) => ({ ...f, cuisineType: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="e.g. chinese"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="text-xs text-muted-foreground">Image URL</label>
            <input
              value={form.imageURL}
              onChange={(e) => setForm((f) => ({ ...f, imageURL: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="https://..."
            />
          </div>

          <div className="sm:col-span-6">
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full min-h-24 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y"
              placeholder="Describe the item (portion size, pickup notes, etc.)"
            />
          </div>

          <div className="sm:col-span-6 flex items-end justify-end">
            <Button type="submit" disabled={creating} className="gap-2">
              {creating && <Spinner className="text-primary-foreground size-4" />}
              {creating ? 'Creating...' : 'Create Listing'}
            </Button>
          </div>

          {createError && (
            <div className="sm:col-span-6 text-sm text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl p-3">
              {createError}
            </div>
          )}
        </form>
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-border overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold">Your Listings</h2>
          {!loading && !error && (
            <p className="text-xs text-muted-foreground">{rows.length} total</p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12">
            <Spinner className="size-6" />
            <span className="text-sm text-muted-foreground">Loading listings...</span>
          </div>
        ) : error ? (
          <div className="p-4 sm:p-5 text-sm text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-4 sm:p-5 text-sm text-muted-foreground">
            No listings yet. Create your first one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Name</th>
                  <th className="text-left font-medium px-4 py-3">Supplier</th>
                  <th className="text-right font-medium px-4 py-3">Qty</th>
                  <th className="text-right font-medium px-4 py-3">Price</th>
                  <th className="text-left font-medium px-4 py-3">Expiry</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.supplier}</td>
                    <td className="px-4 py-3 text-right">{r.quantity}</td>
                    <td className="px-4 py-3 text-right">${r.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.expiryMs ? new Date(r.expiryMs).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                          r.isExpired
                            ? 'bg-red-50 text-red-700 ring-red-200'
                            : 'bg-green-50 text-green-700 ring-green-200'
                        }`}
                      >
                        {r.isExpired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
