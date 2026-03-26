import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightIcon,
  Clock3Icon,
  PencilIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  StoreIcon,
  TicketPercentIcon,
  Trash2Icon,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

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

  if (raw.startsWith('http')) return raw;

  const bucket = import.meta.env.VITE_S3_BUCKET;
  const region = import.meta.env.VITE_AWS_REGION;
  if (!bucket || !region) return null;

  const key = raw.startsWith('foods/') ? raw : `foods/${raw}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function formatPickupTiming(value) {
  if (!value) return 'Not selected';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLocalDateTimeInput(date) {
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function getMinimumPickupDateTime() {
  const now = new Date();
  now.setSeconds(0, 0);
  return formatLocalDateTimeInput(now);
}

function normalizeRewardStatus(payload) {
  const reward = payload?.reward && typeof payload.reward === 'object' ? payload.reward : payload;
  const stampsCount = Number(reward?.stampsCount ?? reward?.StampsCount ?? 0) || 0;
  const completedOrdersTowardsReward = stampsCount % 5;
  const eligibleRaw =
    reward?.eligible ??
    reward?.Eligible ??
    reward?.isEligible ??
    reward?.IsEligible ??
    reward?.active ??
    reward?.Active;

  const eligible =
    eligibleRaw === undefined
      ? false
      : Boolean(
          typeof eligibleRaw === 'string'
            ? ['true', '1', 'yes', 'active'].includes(eligibleRaw.trim().toLowerCase())
            : eligibleRaw
        );

  const discountPercent = Number(
    reward?.discountPercent ??
    reward?.DiscountPercent ??
    reward?.discount_percentage ??
    reward?.DiscountPercentage ??
    0
  );

  const ordersLeft = Number(
    reward?.ordersLeft ??
    reward?.OrdersLeft ??
    reward?.remainingOrders ??
    reward?.RemainingOrders ??
    (eligible ? 0 : 4 - completedOrdersTowardsReward)
  );

  return {
    eligible,
    active: eligible,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    ordersLeft: Number.isFinite(ordersLeft) ? Math.max(0, Math.floor(ordersLeft)) : 0,
    stampsCount,
  };
}

export default function UserCart() {
  const {
    user,
    cart,
    cartCount,
    cartLoading,
    removeFromCart,
    updateCartItem,
    getRemainingStockForListing,
  } = useAuth();

  const placeOrderBaseUrl =
    import.meta.env.VITE_PLACE_ORDER_SERVICE_URL || 'http://localhost:4001';
  const inventoryServiceUrl =
    import.meta.env.VITE_INVENTORY_SERVICE_URL || 'http://localhost:3000';

  const [busyId, setBusyId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [rewardStatus, setRewardStatus] = useState(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [liveStockMap, setLiveStockMap] = useState({});
  const [editingKey, setEditingKey] = useState('');
  const [editQuantity, setEditQuantity] = useState('1');
  const [editPickupTime, setEditPickupTime] = useState('');

  const normalizedCart = useMemo(() => {
    return (cart || []).map((entry, index) => {
      const item = entry?.item || entry;

      const listingId =
        getField(entry, 'listingId', 'ListingId') ??
        getField(item, 'listingId', 'ListingId', 'id', 'Id');

      const itemName = getField(entry, 'itemName', 'ItemName') ??
        getField(item, 'itemName', 'ItemName', 'name', 'Name') ??
        'Item';

      const restaurantName =
        getField(entry, 'restaurantName', 'RestaurantName') ??
        getField(item, 'restaurantName', 'RestaurantName');

      const restaurantId =
        getField(entry, 'restaurantId', 'RestaurantId') ??
        getField(item, 'restaurantId', 'RestaurantId');

      const imageURL =
        getField(entry, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl') ??
        getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');

      const priceRaw =
        getField(entry, 'price', 'Price') ??
        getField(item, 'price', 'Price');

      const quantityRaw = getField(entry, 'quantity', 'Quantity') ?? 0;
      const pickupTime = getField(entry, 'pickupTime', 'PickupTime') ?? '';

      const price = Number(priceRaw ?? 0);
      const quantity = Number(quantityRaw ?? 0);
      const lineTotal =
        Number.isFinite(price) && Number.isFinite(quantity) ? price * quantity : 0;

      const fallbackStock = getRemainingStockForListing(item) + quantity;
      const liveAvailableRaw =
        listingId != null && liveStockMap[String(listingId)] !== undefined
          ? Number(liveStockMap[String(listingId)])
          : fallbackStock;
      const availableForThisLine = Number.isFinite(liveAvailableRaw)
        ? Math.max(0, liveAvailableRaw)
        : 0;
      const exceedsStock = quantity > availableForThisLine;

      return {
        raw: entry,
        item,
        key: `${listingId ?? 'listing'}-${pickupTime || index}`,
        listingId,
        itemName,
        restaurantName,
        restaurantId,
        imageURL,
        price: Number.isFinite(price) ? price : 0,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        pickupTime,
        lineTotal,
        availableForThisLine,
        exceedsStock,
      };
    });
  }, [cart, getRemainingStockForListing, liveStockMap]);

  const hasInvalidStock = normalizedCart.some((line) => line.exceedsStock);

  const total = useMemo(() => {
    return normalizedCart.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [normalizedCart]);

  const rewardDiscount = rewardStatus?.eligible ? Number(rewardStatus.discountPercent || 0) : 0;
  const discountedTotal = useMemo(() => {
    if (rewardDiscount <= 0) return total;
    return Number((total * ((100 - rewardDiscount) / 100)).toFixed(2));
  }, [total, rewardDiscount]);
  const rewardSavings = useMemo(() => {
    if (rewardDiscount <= 0) return 0;
    return Number((total - discountedTotal).toFixed(2));
  }, [discountedTotal, rewardDiscount, total]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRewardStatus() {
      if (!user?.id) {
        setRewardStatus(null);
        return;
      }

      try {
        setRewardLoading(true);

        const response = await fetch(
          `${placeOrderBaseUrl}/orders/reward-status/${encodeURIComponent(user.id)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('Failed to load reward status');
        }

        const data = await response.json();
        if (!controller.signal.aborted) {
          setRewardStatus(normalizeRewardStatus(data));
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setRewardStatus(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setRewardLoading(false);
        }
      }
    }

    loadRewardStatus();

    return () => controller.abort();
  }, [user?.id, placeOrderBaseUrl]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLiveAvailability() {
      if (!cart?.length) {
        setLiveStockMap({});
        return;
      }

      try {
        const response = await fetch(`${inventoryServiceUrl}/inventory/active`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load inventory');
        }

        const listings = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];

        const nextMap = {};
        for (const listing of listings) {
          const listingId =
            getField(listing, 'Id', 'id', 'listingId', 'ListingId') ?? null;
          if (listingId == null) continue;

          const quantity = Number(
            getField(
              listing,
              'quantity',
              'Quantity',
              'stock',
              'Stock',
              'remainingQuantity',
              'RemainingQuantity'
            ) ?? 0
          );

          nextMap[String(listingId)] = Number.isFinite(quantity) ? quantity : 0;
        }

        if (!controller.signal.aborted) {
          setLiveStockMap(nextMap);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setLiveStockMap({});
        }
      }
    }

    loadLiveAvailability();

    return () => controller.abort();
  }, [cart, inventoryServiceUrl]);

  const onRemove = async (listingId) => {
    setCheckoutError(null);
    try {
      setBusyId(listingId);
      await removeFromCart(listingId);
    } catch (e) {
      setCheckoutError(e?.message || 'Failed to remove item');
    } finally {
      setBusyId(null);
    }
  };

  const startEditing = (line) => {
    setCheckoutError(null);
    setEditingKey(line.key);
    setEditQuantity(String(line.quantity || 1));
    setEditPickupTime(String(line.pickupTime || ''));
  };

  const cancelEditing = () => {
    setEditingKey('');
    setEditQuantity('1');
    setEditPickupTime('');
  };

  const saveEdit = async (line) => {
    const quantity = Number(editQuantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCheckoutError('Quantity must be a positive number.');
      return;
    }

    if (!editPickupTime) {
      setCheckoutError('Please select a collection timing.');
      return;
    }

    if (quantity > line.availableForThisLine) {
      setCheckoutError(`Only ${line.availableForThisLine} item(s) are available right now.`);
      return;
    }

    try {
      setBusyId(line.listingId);
      setCheckoutError(null);
      await updateCartItem({
        listingId: line.listingId,
        item: line.item,
        quantity,
        pickupTime: editPickupTime,
      });
      cancelEditing();
    } catch (error) {
      setCheckoutError(error?.message || 'Failed to update cart item');
    } finally {
      setBusyId(null);
    }
  };

  const onCheckout = async () => {
    if (!user?.id) return;

    if (!normalizedCart.length) {
      setCheckoutError('Your cart is empty');
      return;
    }

    if (hasInvalidStock) {
      setCheckoutError('Some items in your cart exceed available stock. Please remove them before checkout.');
      return;
    }

    setCheckoutError(null);

    try {
      setCheckoutLoading(true);

      const pendingOrderId = `ORD-${Date.now()}`;

      sessionStorage.setItem(
        'pending_checkout',
        JSON.stringify({
          orderId: pendingOrderId,
          items: normalizedCart.map((c) => ({
            listingId: c.listingId,
            itemName: c.itemName || 'Item',
            restaurantName: c.restaurantName || '',
            restaurantId: c.restaurantId || '',
            price: Number(c.price ?? 0),
            quantity: Number(c.quantity ?? 1),
            pickupTime: c.pickupTime || '',
          })),
          pickupTime:
            normalizedCart.length === 1 ? (normalizedCart[0]?.pickupTime || '') : '',
        })
      );

      const cartPayload = normalizedCart.map((c) => ({
        name: c.itemName || 'Item',
        itemId: c.listingId,
        quantity: Number(c.quantity ?? 1),
        unitAmount: Number(c.price ?? 0),
        pickupTime: c.pickupTime || '',
        restaurantName: c.restaurantName || '',
        restaurantId: c.restaurantId || '',
      }));

      const notesLines = normalizedCart
        .map((c) => {
          const pickup = c.pickupTime ? `Pickup: ${c.pickupTime}` : 'Pickup: —';
          const restaurant = c.restaurantName ? `@ ${c.restaurantName}` : '';
          return `- ${c.itemName || 'Item'} ${restaurant} (${pickup})`;
        })
        .join('\n');

      const res = await fetch(`${placeOrderBaseUrl}/orders/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: pendingOrderId,
          userId: user.id,
          cart: cartPayload,
          currency: 'sgd',
          notes: `Cart checkout\n${notesLines}`,
          successUrl: `${window.location.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/cart`,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        sessionStorage.removeItem('pending_checkout');
        throw new Error(data?.error || 'Checkout failed');
      }

      const checkoutUrl = data?.payment?.checkoutUrl;
      if (!checkoutUrl) {
        sessionStorage.removeItem('pending_checkout');
        throw new Error('Missing checkoutUrl from payment service');
      }

      // Persist backend IDs so payment-success has stable references.
      try {
        const raw = sessionStorage.getItem('pending_checkout');
        const pending = raw ? JSON.parse(raw) : null;
        if (pending && typeof pending === 'object') {
          sessionStorage.setItem(
            'pending_checkout',
            JSON.stringify({
              ...pending,
              orderId: data?.orderId || pending.orderId,
              paymentId: data?.payment?.paymentId || pending.paymentId,
            })
          );
        }
      } catch {
        // Non-fatal
      }

      window.location.href = checkoutUrl;
    } catch (e) {
      setCheckoutError(e?.message || 'Checkout failed');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (cartLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16">
        <Spinner className="size-6" />
        <span className="text-sm text-muted-foreground">Loading cart...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Cart</h1>
        </div>
        <Link to="/" className="self-start">
          <Button type="button" variant="outline">
            Continue browsing
          </Button>
        </Link>
      </div>

      {checkoutError && (
        <div className="text-sm text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl p-3">
          {checkoutError}
        </div>
      )}

      {cartCount === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No items</CardTitle>
            <CardDescription>Add a listing from Home to get started.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/">
              <Button type="button">Go to listings</Button>
            </Link>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader className="border-b-0 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
              <div className="flex items-center gap-3">
                <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                  <ShoppingBagIcon className="size-4" />
                </div>
                <CardTitle className="text-white">Cart Items</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              {normalizedCart.map((c) => (
                <div
                  key={c.key}
                  className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="size-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                      {toImageSrc(c.imageURL) ? (
                        <img
                          src={toImageSrc(c.imageURL)}
                          alt={c.itemName || 'Item'}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                          <ShoppingBagIcon className="size-5" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-slate-900">
                            {c.itemName || 'Item'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <StoreIcon className="size-3.5" />
                              {(c.restaurantName || c.restaurantId || 'Restaurant').toString()}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3Icon className="size-3.5" />
                              {formatPickupTiming(c.pickupTime)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-200">
                            <p className="text-[11px] uppercase tracking-wide text-slate-500">
                              Subtotal
                            </p>
                            <p className="mt-1 text-base font-semibold text-slate-900">
                              {formatMoney(c.lineTotal)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => startEditing(c)}
                            disabled={busyId === c.listingId}
                            aria-label="Edit item"
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600"
                            onClick={() => onRemove(c.listingId)}
                            disabled={busyId === c.listingId}
                            aria-label="Remove item"
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Price each
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {formatMoney(c.price)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Quantity
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{c.quantity}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Availability
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {c.availableForThisLine} left
                          </p>
                        </div>
                      </div>

                      {editingKey === c.key && (
                        <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                          <div className="grid gap-1">
                            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Quantity
                            </label>
                            <input
                              type="number"
                              min="1"
                              max={Math.max(1, c.availableForThisLine)}
                              value={editQuantity}
                              onChange={(e) => setEditQuantity(e.target.value)}
                              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200"
                            />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Collection timing
                            </label>
                            <input
                              type="datetime-local"
                              min={getMinimumPickupDateTime()}
                              value={editPickupTime}
                              onChange={(e) => setEditPickupTime(e.target.value)}
                              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200"
                            />
                          </div>
                          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              onClick={cancelEditing}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              className="rounded-2xl"
                              onClick={() => saveEdit(c)}
                              disabled={busyId === c.listingId}
                            >
                              Save changes
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {c.exceedsStock && (
                    <div className="mt-4 rounded-2xl bg-red-50 px-3 py-3 text-xs text-red-700 ring-1 ring-red-200">
                      This cart line exceeds available stock. Available now: {c.availableForThisLine}.
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="overflow-hidden lg:sticky lg:top-24">
              <CardHeader className="border-b-0 bg-slate-50">
                <CardTitle>Checkout Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pt-0">
                <div
                  className={`rounded-3xl border px-4 py-4 text-sm ${
                    rewardStatus?.eligible
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {rewardLoading ? (
                    <span className="text-slate-500">Checking reward eligibility...</span>
                  ) : rewardStatus?.eligible ? (
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <div className="inline-flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <ShieldCheckIcon className="size-4" />
                        </div>
                        <div>
                          <p className="font-semibold">Reward Active</p>
                          <p className="text-xs text-emerald-700">
                            Your {rewardStatus.discountPercent}% discount is ready for this checkout.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <div className="inline-flex size-8 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200">
                          <TicketPercentIcon className="size-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">Reward Progress</p>
                          <p className="text-xs text-slate-500">
                            {rewardStatus
                              ? `${rewardStatus.ordersLeft} order${rewardStatus.ordersLeft === 1 ? '' : 's'} left to unlock 20% off.`
                              : 'Reward status unavailable right now.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Items</span>
                    <span className="font-semibold text-slate-900">{cartCount}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-semibold text-slate-900">{formatMoney(total)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500">Reward discount</span>
                    <span className={rewardSavings > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-400'}>
                      {rewardSavings > 0 ? `- ${formatMoney(rewardSavings)}` : '$0.00'}
                    </span>
                  </div>
                  <div className="mt-4 border-t border-dashed border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total payable</p>
                      <p className="text-right text-2xl font-semibold text-slate-900">
                        {formatMoney(discountedTotal)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200">
                      <ShieldCheckIcon className="size-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-900">Before you pay</p>
                      <p>
                        Double-check collection timing for each line item. Payment will confirm stock and apply any eligible reward automatically.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button
                  type="button"
                  className="h-11 w-full rounded-2xl"
                  onClick={onCheckout}
                  disabled={checkoutLoading || hasInvalidStock}
                >
                  <span>{checkoutLoading ? 'Proceeding...' : 'Proceed to checkout'}</span>
                  {!checkoutLoading && <ArrowRightIcon className="size-4" />}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
