import { useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreVerticalIcon, PlusIcon } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DELETE_LISTING_SERVICE_URL, INVENTORY_SERVICE_URL } from '@/lib/api';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function toImageSrc(value) {
  if (!value) return null;

  let raw = String(value).trim();

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const bucket = import.meta.env.VITE_S3_BUCKET;
  const region = import.meta.env.VITE_AWS_REGION;

  const key = raw.startsWith("foods/") ? raw : `foods/${raw}`;

  const finalUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  console.log("FINAL IMAGE URL:", finalUrl);

  return finalUrl;
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
  const inventoryServiceUrl = INVENTORY_SERVICE_URL;
  const deleteListingServiceUrl = DELETE_LISTING_SERVICE_URL;

  const { user } = useAuth();
  const restaurantId = user?.id;

  const PAGE_SIZE = 5;
  const PAGE_WINDOW = 5;

  const [listings, setListings] = useState([]);
  const [deletedListings, setDeletedListings] = useState([]);
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
  const [deleteBusyId, setDeleteBusyId] = useState('');
  const [deletePreviewBusyId, setDeletePreviewBusyId] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);
  const [deletePreview, setDeletePreview] = useState(null);
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

    console.log("📡 Fetching listings for restaurantId:", restaurantId);

    const currentListingsPromise = fetch(
      `${inventoryServiceUrl}/inventory/restaurant/${encodeURIComponent(restaurantId)}`,
      { signal }
    );

    const deletedListingsPromise = fetch(
      `${inventoryServiceUrl}/inventory/restaurant/${encodeURIComponent(restaurantId)}/deleted`,
      { signal }
    );

    const [res, deletedRes] = await Promise.all([currentListingsPromise, deletedListingsPromise]);

    console.log("📡 Response status:", res.status);

    const [data, deletedData] = await Promise.all([
      readResponseBody(res),
      readResponseBody(deletedRes),
    ]);

    console.log("🔥 RAW LISTINGS FROM BACKEND:", data);

    if (!res.ok) {
      let message = 'Failed to load listings';
      if (typeof data === 'string') {
        message = data || message;
      } else {
        message = data?.error || message;
      }
      throw new Error(message);
    }

    console.log("✅ Setting listings:", data);

    setListings(Array.isArray(data) ? data : []);
    if (!deletedRes.ok) {
      console.warn('Failed to load deleted listings preview:', deletedData);
      setDeletedListings([]);
    } else {
      setDeletedListings(Array.isArray(deletedData) ? deletedData : []);
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.error("❌ fetchListings error:", e);
    setError(e?.message || 'Failed to load listings');
    setDeletedListings([]);
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

  const liveRows = useMemo(() => {
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
          isDeleted: false,
        };
      })
      .sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity));
  }, [listings]);

  const deletedRows = useMemo(() => {
    return deletedListings
      .map((item) => {
        const deletedAtRaw = getField(item, 'deletedAt', 'DeletedAt');
        const deletedAtMs = deletedAtRaw ? new Date(deletedAtRaw).getTime() : null;
        const name = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
        const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);
        const price = Number(getField(item, 'price', 'Price') ?? 0);
        const imageUrlRaw = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
        const imageUrl = toImageSrc(imageUrlRaw);

        return {
          key: getField(item, 'Id', 'id', 'listingId', 'ListingId') ?? `${name}-${deletedAtMs ?? ''}`,
          name,
          imageUrl,
          raw: item,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          price: Number.isFinite(price) ? price : 0,
          expiryMs: deletedAtMs,
          deletedAtMs,
          isExpired: false,
          isDeleted: true,
        };
      })
      .sort((a, b) => (b.deletedAtMs ?? 0) - (a.deletedAtMs ?? 0));
  }, [deletedListings]);

  const totalRows = liveRows.length + deletedRows.length;

  const counts = useMemo(() => {
    let active = 0;
    let expired = 0;
    for (const row of liveRows) {
      if (row.isExpired) expired += 1;
      else active += 1;
    }
    return { active, expired, deleted: deletedRows.length };
  }, [deletedRows.length, liveRows]);

  const filteredRows = useMemo(() => {
    if (statusTab === 'deleted') return deletedRows;
    const rows = liveRows;
    if (statusTab === 'expired') return rows.filter((r) => r.isExpired);
    return rows.filter((r) => !r.isExpired);
  }, [deletedRows, liveRows, statusTab]);

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

  const resetDeleteDialog = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetItem(null);
    setDeletePreview(null);
  };

  const getDeletePreviewSummary = (preview) => {
    const orders = Array.isArray(preview?.affectedOrders) ? preview.affectedOrders : [];
    const customerIds = new Set();
    const fallbackTotalListingUnits = orders.reduce((sum, order) => {
      const customerId = String(order?.customerId || '').trim();
      if (customerId) customerIds.add(customerId);

      return (
        sum +
        (Array.isArray(order?.items) ? order.items : []).reduce((itemSum, entry) => {
          const quantity = Math.max(1, Number(entry?.quantity || 1) || 1);
          return itemSum + quantity;
        }, 0)
      );
    }, 0);

    return {
      affectedOrders: Number(preview?.summary?.affectedOrders || orders.length || 0),
      affectedCustomers: Number(preview?.summary?.affectedCustomers || customerIds.size || 0),
      totalListingUnits: Number(
        preview?.summary?.totalListingUnits || fallbackTotalListingUnits || 0
      ),
      totalRefundAmount: Number(preview?.summary?.totalRefundAmount || 0),
    };
  };

  const buildDeleteNotificationPreview = (preview, item) => {
    const restaurantName =
      preview?.listing?.restaurantName ||
      getField(item, 'restaurantName', 'RestaurantName') ||
      user?.restaurantName ||
      'this restaurant';
    const listingName =
      preview?.listing?.itemName ||
      getField(item, 'itemName', 'ItemName', 'name', 'Name') ||
      'this listing';

    return (
      `Restaurant ${restaurantName} has deleted listing ${listingName}. ` +
      `You have been refunded $XX.XX for N ${listingName} across M orders.`
    );
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
      const storedImageValue = typeof body === 'string' ? body : body?.key;
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
    const payload = {
      restaurantId,
      restaurantName: form.restaurantName.trim(),
      itemName: form.itemName.trim(),
      description: form.description.trim(),
      expiryTime: new Date(form.expiryLocal).toISOString(),
      price: Number(form.price),
      originalPrice: form.originalPrice === '' ? null : Number(form.originalPrice),
      quantity: Number(form.quantity),
      imageURL: form.imageURL.trim(),
      cuisineType: form.cuisineType.trim(),
    };

    console.log("🚀 CREATING LISTING PAYLOAD:", payload);

    const res = await fetch(`${inventoryServiceUrl}/inventory/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log("📡 Create response status:", res.status);

    const body = await readResponseBody(res);

    console.log("📦 Create response body:", body);

    if (!res.ok) {
      throw new Error(
        typeof body === 'string' ? body : body?.error || 'Failed to create listing'
      );
    }

    console.log("✅ Listing created successfully");

    // ✅ reset form AFTER success
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

    // ✅ refetch listings
    await fetchListings();

    setCreateOpen(false);

  } catch (e) {
    console.error("❌ Create listing error:", e);
    setCreateError(e?.message || 'Failed to create listing');
  } finally {
    setCreating(false);
  }
};

  const prepareDeleteListing = async (item) => {
    const listingId = getField(item, 'Id', 'id', 'listingId', 'ListingId');

    if (!restaurantId || !listingId) {
      setDeleteError('Missing restaurant or listing id');
      return;
    }

    const busyKey = String(listingId);

    try {
      setDeletePreviewBusyId(busyKey);
      setDeleteError(null);
      setDeleteMessage('');
      setDeletePreview(null);
      setDeleteTargetItem(item);

      const previewResponse = await fetch(
        `${deleteListingServiceUrl}/delete-listing/${encodeURIComponent(
          listingId
        )}/preview?restaurantId=${encodeURIComponent(restaurantId)}&restaurantName=${encodeURIComponent(
          user?.restaurantName || ''
        )}`
      );

      const previewBody = await readResponseBody(previewResponse);
      if (!previewResponse.ok) {
        throw new Error(
          typeof previewBody === 'string'
            ? previewBody
            : previewBody?.error || 'Failed to preview listing delete'
        );
      }

      setDeletePreview(previewBody);
      setDeleteConfirmOpen(true);
    } catch (error) {
      setDeleteTargetItem(null);
      setDeletePreview(null);
      setDeleteError(error?.message || 'Failed to prepare listing delete');
    } finally {
      setDeletePreviewBusyId('');
    }
  };

  const confirmDeleteListing = async () => {
    const activeItem = deleteTargetItem;
    const listingId = getField(activeItem, 'Id', 'id', 'listingId', 'ListingId');

    if (!restaurantId || !listingId) {
      setDeleteError('Missing restaurant or listing id');
      return;
    }

    const busyKey = String(listingId);

    try {
      setDeleteBusyId(busyKey);
      setDeleteError(null);
      setDeleteMessage('');

      const deleteResponse = await fetch(
        `${deleteListingServiceUrl}/delete-listing/${encodeURIComponent(listingId)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurantId,
            restaurantName: user?.restaurantName || '',
            reason: 'restaurant_removed_listing',
          }),
        }
      );

      const deleteBody = await readResponseBody(deleteResponse);
      if (!deleteResponse.ok) {
        throw new Error(
          typeof deleteBody === 'string'
            ? deleteBody
            : deleteBody?.error || 'Failed to delete listing'
        );
      }

      const refundedOrders = Number(deleteBody?.summary?.refundedOrders || 0);
      const totalRefundAmount = Number(deleteBody?.summary?.totalRefundAmount || 0);

      setDeleteMessage(
        refundedOrders > 0
          ? `Listing deleted. Refunded ${refundedOrders} order${refundedOrders === 1 ? '' : 's'} for ${formatMoney(totalRefundAmount)}.`
          : 'Listing deleted successfully.'
      );

      resetDeleteDialog();
      setDetailsOpen(false);
      setDetailsItem(null);
      await fetchListings(undefined, { showLoading: false });
    } catch (error) {
      setDeleteError(error?.message || 'Failed to delete listing');
    } finally {
      setDeleteBusyId('');
    }
  };

  const deleteDialogListingName =
    deletePreview?.listing?.itemName ||
    getField(deleteTargetItem, 'itemName', 'ItemName', 'name', 'Name') ||
    'this listing';
  const deleteDialogRestaurantName =
    deletePreview?.listing?.restaurantName ||
    getField(deleteTargetItem, 'restaurantName', 'RestaurantName') ||
    user?.restaurantName ||
    'this restaurant';
  const deleteDialogSummary = getDeletePreviewSummary(deletePreview);
  const deleteDialogBusyKey = String(
    getField(deleteTargetItem, 'Id', 'id', 'listingId', 'ListingId') || ''
  );
  const isPreparingDelete = deletePreviewBusyId === deleteDialogBusyKey;
  const isDeletingListing = deleteBusyId === deleteDialogBusyKey;
  const detailsListingName =
    getField(detailsItem, 'itemName', 'ItemName', 'name', 'Name') || 'Untitled';
  const detailsListingId = getField(detailsItem, 'Id', 'id', 'listingId', 'ListingId') || '—';
  const detailsDescription = getField(detailsItem, 'description', 'Description') || '';
  const detailsStatus = String(getField(detailsItem, 'status', 'Status') || '').trim().toLowerCase();
  const detailsIsDeleted = detailsStatus === 'deleted';
  const detailsExpiryMs = parseExpiryToMs(detailsItem);
  const detailsIsExpired =
    !detailsIsDeleted && Boolean(detailsExpiryMs) && Number(detailsExpiryMs) < Date.now();
  const detailsImageSrc = toImageSrc(
    getField(detailsItem, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl')
  );
  const detailsDeletedAt = getField(detailsItem, 'deletedAt', 'DeletedAt');
  const detailsSummary =
    detailsIsDeleted && detailsItem?.summary && typeof detailsItem.summary === 'object'
      ? detailsItem.summary
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="spotlight-panel overflow-hidden rounded-[32px] p-6 sm:p-8">
        <div className="flex flex-col gap-6">
          <div>
            <span className="hero-kicker">Listing Studio</span>
            <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
              Make your rescue listings feel premium at a glance.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Publish, review, and retire items from a calmer surface that feels closer to a real
              merchant product than a plain dashboard table.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Active
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.active}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Expired
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.expired}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Deleted
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.deleted}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/70 bg-card/90 ring-1 ring-border shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)] backdrop-blur-sm">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Your Listings</h2>

            {!loading && !error && totalRows > 0 && (
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStatusTab('deleted')}
                  className={`rounded-full border-slate-200 text-slate-700 hover:bg-slate-50 ${
                    statusTab === 'deleted'
                      ? 'bg-slate-100 ring-1 ring-slate-200 border-transparent hover:bg-slate-200'
                      : ''
                  }`}
                >
                  Deleted ({counts.deleted})
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
                      {uploadingImage
                      ? 'Uploading image to server...'
                      : 'Optional. Image URL will be auto-filled after upload.'}
                    </p>
                    {uploadImageError && (
                      <p className="mt-1 text-xs text-red-600">{uploadImageError}</p>
                    )}
                  </div>

                 <div className="sm:col-span-3">
                  <label className="text-xs text-muted-foreground">
                    Image URL (auto-filled after upload)
                  </label>

                  <input
                    value={form.imageURL}
                    onChange={(e) => setForm((f) => ({ ...f, imageURL: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                    placeholder="https://your-image-url..."
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

        {deleteMessage && (
          <div className="mx-4 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {deleteMessage}
          </div>
        )}

        {deleteError && (
          <div className="mx-4 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12">
            <Spinner className="size-6" />
            <span className="text-sm text-muted-foreground">Loading listings...</span>
          </div>
        ) : error ? (
          <div className="p-4 sm:p-5 text-sm text-red-600">{error}</div>
        ) : totalRows === 0 ? (
          <div className="p-4 sm:p-5 text-sm text-muted-foreground">
            No listings yet. Use “Create Listing” to add your first one.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-4 sm:p-5 text-sm text-muted-foreground">
            No {statusTab} listings.
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
                    <th className="text-left font-medium px-4 py-3">
                      {statusTab === 'deleted' ? 'Deleted on' : 'Expiry'}
                    </th>
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
                        {r.isDeleted
                          ? r.deletedAtMs
                            ? new Date(r.deletedAtMs).toLocaleString()
                            : '—'
                          : r.expiryMs
                            ? new Date(r.expiryMs).toLocaleString()
                            : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                            r.isDeleted
                              ? 'bg-slate-100 text-slate-700 ring-slate-200'
                              : r.isExpired
                              ? 'bg-red-50 text-red-700 ring-red-200'
                              : 'bg-green-50 text-green-700 ring-green-200'
                          }`}
                        >
                          {r.isDeleted ? 'Deleted' : r.isExpired ? 'Expired' : 'Active'}
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
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto p-0 sm:max-w-3xl">
          {detailsItem ? (
            <div className="grid gap-0">
              <div className="border-b border-border/70 bg-[linear-gradient(135deg,rgba(240,253,250,0.96),rgba(255,247,237,0.98))]">
                <div className="grid gap-0 md:grid-cols-[15rem_minmax(0,1fr)]">
                  <div className="relative min-h-52 overflow-hidden bg-slate-100">
                    {detailsImageSrc ? (
                      <img
                        src={detailsImageSrc}
                        alt={detailsListingName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full min-h-52 w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(20,95,89,0.22),rgba(255,255,255,0.95))] text-6xl font-semibold text-slate-400">
                        {String(detailsListingName).slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/40 to-transparent px-5 py-4 text-white md:hidden">
                      <p className="text-lg font-semibold">{detailsListingName}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 px-6 py-6">
                    <DialogHeader className="gap-3 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ring-1 ${
                            detailsIsDeleted
                              ? 'bg-slate-100 text-slate-700 ring-slate-200'
                              : detailsIsExpired
                                ? 'bg-red-50 text-red-700 ring-red-200'
                                : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          }`}
                        >
                          {detailsIsDeleted ? 'Deleted listing' : detailsIsExpired ? 'Expired listing' : 'Active listing'}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                          ID {detailsListingId}
                        </span>
                      </div>
                      <DialogTitle className="text-3xl font-semibold tracking-tight text-slate-950">
                        {detailsListingName}
                      </DialogTitle>
                      <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
                        {detailsIsDeleted
                          ? `This listing has been removed from the storefront${detailsDeletedAt ? ` on ${new Date(detailsDeletedAt).toLocaleString()}` : ''}.`
                          : 'Review pricing, timing, and listing health before deciding whether to keep it live or delete it.'}
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Quantity
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">
                          {getField(detailsItem, 'quantity', 'Quantity') ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Price
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">
                          {formatMoney(getField(detailsItem, 'price', 'Price') ?? 0)}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Original
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">
                          {getField(detailsItem, 'originalPrice', 'OriginalPrice') != null
                            ? formatMoney(getField(detailsItem, 'originalPrice', 'OriginalPrice'))
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Cuisine
                        </p>
                        <p className="mt-2 text-lg font-semibold text-slate-950">
                          {getField(detailsItem, 'cuisineType', 'CuisineType') || '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 px-6 py-6">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
                  <div className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_18px_36px_-30px_rgba(24,36,33,0.4)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Listing profile
                    </p>
                    <div className="mt-4 grid gap-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">
                          {detailsIsDeleted ? 'Deleted on' : 'Expiry'}
                        </span>
                        <span className="text-right font-medium text-slate-900">
                          {detailsIsDeleted
                            ? detailsDeletedAt
                              ? new Date(detailsDeletedAt).toLocaleString()
                              : '—'
                            : getField(detailsItem, 'expiryTime', 'ExpiryTime') || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">Restaurant</span>
                        <span className="text-right font-medium text-slate-900">
                          {getField(detailsItem, 'restaurantName', 'RestaurantName') || user?.restaurantName || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">Listing type</span>
                        <span className="text-right font-medium text-slate-900">
                          {detailsIsDeleted ? 'Archived delete record' : detailsIsExpired ? 'Expired live listing' : 'Live listing'}
                        </span>
                      </div>
                      {detailsIsDeleted && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Delete reason</span>
                          <span className="text-right font-medium text-slate-900">
                            {getField(detailsItem, 'deletedReason', 'DeletedReason') || 'restaurant_removed_listing'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-emerald-200/70 bg-emerald-50/80 p-5 shadow-[0_18px_36px_-30px_rgba(20,95,89,0.3)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Refund impact
                    </p>
                    {detailsIsDeleted ? (
                      <div className="mt-4 grid gap-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-emerald-800/70">Refunded orders</span>
                          <span className="font-semibold text-emerald-950">
                            {Number(detailsSummary?.refundedOrders || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-emerald-800/70">Affected customers</span>
                          <span className="font-semibold text-emerald-950">
                            {Number(detailsSummary?.affectedCustomers || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-emerald-800/70">Units refunded</span>
                          <span className="font-semibold text-emerald-950">
                            {Number(detailsSummary?.totalListingUnits || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-emerald-800/70">Refund total</span>
                          <span className="font-semibold text-emerald-950">
                            {formatMoney(detailsSummary?.totalRefundAmount || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-emerald-800/70">Discounts restored</span>
                          <span className="font-semibold text-emerald-950">
                            {Number(detailsSummary?.rewardsRestored || 0)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm leading-6 text-emerald-900">
                        If you delete this listing, all users will be refunded. You will lose all earnings related to this listing.
                      </p>
                    )}
                  </div>
                </div>

                {detailsDescription ? (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-5 text-sm leading-6 text-slate-700">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Description
                    </p>
                    <p className="mt-3">{detailsDescription}</p>
                  </div>
                ) : null}

                {!detailsIsDeleted && (
                  <div className="flex items-center justify-end border-t border-border/70 pt-5">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => prepareDeleteListing(detailsItem)}
                      disabled={
                        deleteBusyId === String(detailsListingId || '') ||
                        deletePreviewBusyId === String(detailsListingId || '')
                      }
                      className="gap-2"
                    >
                      {(deleteBusyId === String(detailsListingId || '') ||
                        deletePreviewBusyId === String(detailsListingId || '')) && (
                        <Spinner className="size-4" />
                      )}
                      {deletePreviewBusyId === String(detailsListingId || '')
                        ? 'Checking refunds...'
                        : deleteBusyId === String(detailsListingId || '')
                          ? 'Deleting...'
                          : 'Delete Listing'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No details.</div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && deleteBusyId) return;
          setDeleteConfirmOpen(open);
          if (!open) {
            setDeleteTargetItem(null);
            setDeletePreview(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <div className="border-b border-border/70 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,255,255,0.98))] px-6 py-5">
            <AlertDialogHeader className="gap-3">
              <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                Delete listing
              </span>
              <AlertDialogTitle>
                Remove &quot;{deleteDialogListingName}&quot; from {deleteDialogRestaurantName}?
              </AlertDialogTitle>
            </AlertDialogHeader>
          </div>

          <div className="grid gap-5 px-6 py-6">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Orders
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {deleteDialogSummary.affectedOrders}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Customers
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {deleteDialogSummary.affectedCustomers}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Units
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {deleteDialogSummary.totalListingUnits}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_32px_-26px_rgba(24,36,33,0.35)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Refund total
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {formatMoney(deleteDialogSummary.totalRefundAmount)}
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {deleteError}
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingListing}>Keep Listing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDeleteListing}
              disabled={isPreparingDelete || isDeletingListing}
              className="gap-2"
            >
              {isDeletingListing && <Spinner className="size-4 text-white" />}
              {isDeletingListing ? 'Deleting & refunding...' : 'Delete & refund'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
