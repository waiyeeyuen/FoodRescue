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

export default function UserCart() {
  const { user, cart, cartCount, cartLoading, removeFromCart, clearCart } = useAuth();

  const placeOrderBaseUrl =
    import.meta.env.VITE_PLACE_ORDER_SERVICE_URL || 'http://localhost:4001';

  const [busyId, setBusyId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);

  const total = useMemo(() => {
    return (cart || []).reduce((sum, item) => {
      const qty = Number(item?.quantity ?? 0);
      const price = Number(item?.price ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum;
      return sum + qty * price;
    }, 0);
  }, [cart]);

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
    setCheckoutError(null);
    try {
      setCheckoutLoading(true);

      // ✅ unitAmount instead of price — matches what composite expects
      const cartPayload = (cart || []).map((c) => ({
        name: c.itemName || 'Item',
        itemId: c.listingId || c.itemId,
        quantity: Number(c.quantity ?? 1),
        unitAmount: Number(c.price ?? 0),
      }));

      const notesLines = (cart || [])
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
      if (!res.ok) throw new Error(data?.error || 'Checkout failed');

      const checkoutUrl = data?.payment?.checkoutUrl;
      if (!checkoutUrl) throw new Error('Missing checkoutUrl from payment service');

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
              {(cart || []).map((c) => {
                const qty = Number(c.quantity ?? 0);
                const price = Number(c.price ?? 0);
                const lineTotal = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
                return (
                  <div
                    key={c.listingId}
                    className="flex items-center gap-3 rounded-2xl border border-input bg-background px-3 py-3"
                  >
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
                        {qty} × {formatMoney(price)} ={' '}
                        <span className="font-semibold text-foreground">{formatMoney(lineTotal)}</span>
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
                );
              })}
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
                disabled={checkoutLoading}
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
