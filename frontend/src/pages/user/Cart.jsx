import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2Icon } from 'lucide-react';

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

export default function UserCart() {
  const {
    user,
    cart,
    cartCount,
    cartLoading,
    removeFromCart,
    clearCart,
    getRemainingStockForListing,
  } = useAuth();

  const placeOrderBaseUrl =
    import.meta.env.VITE_PLACE_ORDER_SERVICE_URL || 'http://localhost:4001';

  const [busyId, setBusyId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);

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

      const remainingOutsideCart = getRemainingStockForListing(item);
      const availableForThisLine = remainingOutsideCart + quantity;
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
  }, [cart, getRemainingStockForListing]);

  const hasInvalidStock = normalizedCart.some((line) => line.exceedsStock);

  const total = useMemo(() => {
    return normalizedCart.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [normalizedCart]);

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
          items: cart,
          pickupTime: '',
        })
      );

      const cartPayload = normalizedCart.map((c) => ({
        name: c.itemName || 'Item',
        itemId: c.listingId,
        quantity: Number(c.quantity ?? 1),
        unitAmount: Number(c.price ?? 0),
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
          <p className="text-slate-600 mt-2">
            {cartCount > 0 ? `${cartCount} item(s) in your cart` : 'Your cart is empty'}
          </p>
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
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Items</CardTitle>
              <CardDescription>Review your selections before checkout.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {normalizedCart.map((c) => (
                <div
                  key={c.key}
                  className="rounded-2xl border border-input bg-background px-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-12 overflow-hidden rounded-xl bg-muted ring-1 ring-border shrink-0">
                      {c.imageURL ? (
                        <img
                          src={c.imageURL}
                          alt={c.itemName || 'Item'}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {c.itemName || 'Item'}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {(c.restaurantName || c.restaurantId || '').toString()}
                        {c.pickupTime ? ` • Pickup ${c.pickupTime}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.quantity} × {formatMoney(c.price)} ={' '}
                        <span className="font-semibold text-foreground">
                          {formatMoney(c.lineTotal)}
                        </span>
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRemove(c.listingId)}
                      disabled={busyId === c.listingId}
                      aria-label="Remove item"
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>

                  {c.exceedsStock && (
                    <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 ring-1 ring-red-200">
                      This cart line exceeds available stock. Available now: {c.availableForThisLine}.
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Total payable at checkout.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Items</span>
                <span className="font-semibold">{cartCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold text-lg">{formatMoney(total)}</span>
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button
                type="button"
                className="w-full rounded-2xl h-11"
                onClick={onCheckout}
                disabled={checkoutLoading || hasInvalidStock}
              >
                {checkoutLoading ? 'Proceeding...' : 'Proceed to checkout'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-2xl"
                onClick={() => clearCart().catch(() => {})}
                disabled={checkoutLoading}
              >
                Clear cart
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}