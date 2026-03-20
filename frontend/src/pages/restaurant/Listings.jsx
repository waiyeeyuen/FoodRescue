import { useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreVerticalIcon, PlusIcon } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function toImageSrc(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.includes('/')) return `https://res.cloudinary.com/dpcwnbkis/image/upload/${raw}`;
  return null;
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

  const PAGE_SIZE = 5;
  const PAGE_WINDOW = 5;

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [creating, setCreating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [uploadImageError, setUploadImageError] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState(null);
  const [statusTab, setStatusTab] = useState('active');
  const [page, setPage] = useState(1);
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

  useEffect(() => {
    if (!user?.restaurantName) return;
    setForm((prev) => {
      if (prev.restaurantName) return prev;
      return { ...prev, restaurantName: user.restaurantName };
    });
  }, [user?.restaurantName]);

  const fetchListings = async (signal, { showLoading = true } = {}) => {
    if (!restaurantId) return;
    try {
      if (showLoading) setLoading(true);
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
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    let activeController = null;

    const runFetch = ({ showLoading = false } = {}) => {
      const controller = new AbortController();
      activeController = controller;
      fetchListings(controller.signal, { showLoading });
    };

    runFetch({ showLoading: true });

    // Keep restaurant listing status fresh every minute (active vs expired).
    const intervalId = setInterval(() => {
      if (activeController) activeController.abort();
      runFetch();
    }, 60 * 1000);

    return () => {
      clearInterval(intervalId);
      if (activeController) activeController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryServiceUrl, restaurantId]);

  const rows = useMemo(() => {
    const now = Date.now();
    return listings
      .map((item) => {
        const expiryMs = parseExpiryToMs(item);
        const isExpired = expiryMs ? expiryMs < now : false;
        const name = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
        const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);
        const price = Number(getField(item, 'price', 'Price') ?? 0);
        const imageUrlRaw = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
        const imageUrl = toImageSrc(imageUrlRaw);
        return {
          key: getField(item, 'Id', 'id', 'listingId', 'ListingId') ?? `${name}-${expiryMs ?? ''}`,
          name,
          imageUrl,
          raw: item,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          price: Number.isFinite(price) ? price : 0,
          expiryMs,
          isExpired,
        };
      })
      .sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity));
  }, [listings]);

  const counts = useMemo(() => {
    let active = 0;
    let expired = 0;
    for (const row of rows) {
      if (row.isExpired) expired += 1;
      else active += 1;
    }
    return { active, expired };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (statusTab === 'expired') return rows.filter((r) => r.isExpired);
    return rows.filter((r) => !r.isExpired);
  }, [rows, statusTab]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [statusTab]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), pageCount));
  }, [pageCount]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const pageWindowStart = Math.floor((page - 1) / PAGE_WINDOW) * PAGE_WINDOW + 1;
  const pageWindowEnd = Math.min(pageCount, pageWindowStart + PAGE_WINDOW - 1);
  const pageButtons = [];
  for (let i = pageWindowStart; i <= pageWindowEnd; i += 1) pageButtons.push(i);

  const openDetails = (item) => {
    setDetailsItem(item);
    setDetailsOpen(true);
  };

  const handleImageUpload = async (file) => {
    if (!file) return;

    setUploadingImage(true);
    setUploadImageError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`${inventoryServiceUrl}/inventory/upload-image`, {
        method: 'POST',
        body: formData,
      });

      const body = await readResponseBody(res);
      if (!res.ok) {
        if (typeof body === 'string') throw new Error(body || 'Failed to upload image');
        throw new Error(body?.error || 'Failed to upload image');
      }

      const imageUrl = typeof body === 'string' ? body : body?.url;
      const imageRef = typeof body === 'string' ? null : body?.imageRef || body?.publicId;
      const storedImageValue = imageRef || imageUrl;
      if (!storedImageValue) {
        throw new Error('Upload succeeded but no image reference was returned');
      }

      setForm((f) => ({ ...f, imageURL: String(storedImageValue) }));
      setUploadPreviewUrl(imageUrl ? String(imageUrl) : toImageSrc(storedImageValue) || '');
    } catch (e) {
      setUploadImageError(e?.message || 'Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

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
      setUploadPreviewUrl('');
      await fetchListings();
      setCreateOpen(false);
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
            View everything you’ve published (including expired).
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-border overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Your Listings</h2>

            {!loading && !error && rows.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStatusTab('active')}
                  className={`rounded-full border-green-200 text-green-700 hover:bg-green-50 ${
                    statusTab === 'active'
                      ? 'bg-green-50 ring-1 ring-green-200 border-transparent hover:bg-green-100'
                      : ''
                  }`}
                >
                  Active ({counts.active})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStatusTab('expired')}
                  className={`rounded-full border-red-200 text-red-700 hover:bg-red-50 ${
                    statusTab === 'expired'
                      ? 'bg-red-50 ring-1 ring-red-200 border-transparent hover:bg-red-100'
                      : ''
                  }`}
                >
                  Expired ({counts.expired})
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (open) {
                  setCreateError(null);
                  setUploadImageError(null);
                  setUploadPreviewUrl('');
                }
              }}
            >
              <DialogTrigger
                render={
                  <Button type="button" className="gap-2" disabled={!restaurantId} />
                }
              >
                <PlusIcon className="size-4" />
                Create Listing
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[calc(100vh-4rem)] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create listing</DialogTitle>
                  <DialogDescription>
                    Add a new listing to your storefront. Expiry is stored as UTC ISO time.
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-6">
                  <div className="sm:col-span-3">
                    <label className="text-xs text-muted-foreground">Restaurant name</label>
                    <input
                      value={form.restaurantName}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, restaurantName: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setForm((f) => ({ ...f, originalPrice: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setForm((f) => ({ ...f, expiryLocal: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cuisineType: e.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                      placeholder="e.g. chinese"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="text-xs text-muted-foreground">Upload image</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        handleImageUpload(file);
                        e.target.value = '';
                      }}
                      className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                      disabled={creating || uploadingImage}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {uploadingImage ? 'Uploading to Cloudinary...' : 'Optional. Image reference is auto-filled below.'}
                    </p>
                    {uploadImageError && (
                      <p className="mt-1 text-xs text-red-600">{uploadImageError}</p>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <label className="text-xs text-muted-foreground">Image URL</label>
                    <input
                      value={form.imageURL}
                      onChange={(e) => setForm((f) => ({ ...f, imageURL: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                      placeholder="Cloudinary image ref or https://..."
                    />
                    {(uploadPreviewUrl || toImageSrc(form.imageURL)) && (
                      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted/20">
                        <img
                          src={uploadPreviewUrl || toImageSrc(form.imageURL)}
                          alt="Listing preview"
                          className="h-28 w-full object-cover"
                        />
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-6">
                    <label className="text-xs text-muted-foreground">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, description: e.target.value }))
                      }
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
              </DialogContent>
            </Dialog>
          </div>
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
            No listings yet. Use “Create Listing” to add your first one.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-4 sm:p-5 text-sm text-muted-foreground">
            No {statusTab === 'expired' ? 'expired' : 'active'} listings.
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Name</th>
                    <th className="text-right font-medium px-4 py-3">Qty</th>
                    <th className="text-right font-medium px-4 py-3">Price</th>
                    <th className="text-left font-medium px-4 py-3">Expiry</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    <th className="text-right font-medium px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="size-8 overflow-hidden rounded-md bg-muted ring-1 ring-border">
                            {r.imageUrl ? (
                              <img
                                src={r.imageUrl}
                                alt={r.name}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                                {String(r.name || 'L').slice(0, 1).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <p className="truncate font-medium text-foreground">{r.name}</p>
                        </div>
                      </td>
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
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openDetails(r.raw)}
                          aria-label="View details"
                        >
                          <MoreVerticalIcon className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of{' '}
                {filteredRows.length}
              </p>

              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon />
                  </Button>

                  {pageButtons.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      size="xs"
                      variant={p === page ? 'secondary' : 'outline'}
                      onClick={() => setPage(p)}
                      className="min-w-9"
                    >
                      {p}
                    </Button>
                  ))}

                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={page >= pageCount}
                    aria-label="Next page"
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setDetailsItem(null);
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[calc(100vh-4rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Listing details</DialogTitle>
            <DialogDescription>Full details for this listing.</DialogDescription>
          </DialogHeader>

          {detailsItem ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                  {toImageSrc(getField(detailsItem, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl')) ? (
                    <img
                      src={toImageSrc(getField(detailsItem, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl'))}
                      alt={getField(detailsItem, 'itemName', 'ItemName', 'name', 'Name') || 'Listing'}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                      {String(
                        getField(detailsItem, 'itemName', 'ItemName', 'name', 'Name') || 'L'
                      )
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {getField(detailsItem, 'itemName', 'ItemName', 'name', 'Name') || 'Untitled'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ID: {getField(detailsItem, 'Id', 'id', 'listingId', 'ListingId') || '—'}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="font-medium">
                    {getField(detailsItem, 'quantity', 'Quantity') ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium">{getField(detailsItem, 'price', 'Price') ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Original price</span>
                  <span className="font-medium">
                    {getField(detailsItem, 'originalPrice', 'OriginalPrice') ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Cuisine</span>
                  <span className="font-medium">
                    {getField(detailsItem, 'cuisineType', 'CuisineType') ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Expiry</span>
                  <span className="font-medium">
                    {getField(detailsItem, 'expiryTime', 'ExpiryTime') ?? '—'}
                  </span>
                </div>
              </div>

              {getField(detailsItem, 'description', 'Description') ? (
                <div className="rounded-xl bg-muted/40 p-3 text-sm">
                  {getField(detailsItem, 'description', 'Description')}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No details.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
