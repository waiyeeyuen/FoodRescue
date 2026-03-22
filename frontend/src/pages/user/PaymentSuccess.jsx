import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2Icon } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function readPendingCheckout() {
  try {
    const raw = sessionStorage.getItem('pending_checkout');
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.error('Failed to parse pending checkout:', e);
    return null;
  }
}

function normalizePendingItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const item =
        entry?.item && typeof entry.item === 'object'
          ? entry.item
          : entry;

      const quantity = Number(entry?.quantity ?? 0);

      if (!item || !Number.isFinite(quantity) || quantity <= 0) {
        return null;
      }

      return {
        ...entry,
        item,
        quantity,
        pickupTime: entry?.pickupTime || '',
      };
    })
    .filter(Boolean);
}

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addOrdersFromCart, recordPurchasedStock, clearCart } = useAuth();

  const sessionId = searchParams.get('session_id');
  const hasFinalizedRef = useRef(false);
  const [finalizeError, setFinalizeError] = useState('');

  useEffect(() => {
    const finalizeOrder = async () => {
      if (hasFinalizedRef.current) return;

      const pendingCheckout = readPendingCheckout();
      console.log('pendingCheckout:', pendingCheckout);

      const itemsToOrder = normalizePendingItems(pendingCheckout?.items);
      console.log('itemsToOrder:', itemsToOrder);

      if (!itemsToOrder.length) {
        setFinalizeError('No pending checkout items found.');
        return;
      }

      const resolvedOrderId =
        pendingCheckout?.orderId ||
        sessionId ||
        `ORD-${Date.now()}`;

      const processedKey = `processed_order_${resolvedOrderId}`;

      if (sessionStorage.getItem(processedKey) === 'done') {
        hasFinalizedRef.current = true;
        return;
      }

      hasFinalizedRef.current = true;
      sessionStorage.setItem(processedKey, 'processing');
      setFinalizeError('');

      try {
        const createdOrders = await addOrdersFromCart({
          items: itemsToOrder,
          pickupTime: pendingCheckout?.pickupTime || '',
          orderId: resolvedOrderId,
        });

        console.log('createdOrders:', createdOrders);

        await Promise.resolve(recordPurchasedStock(itemsToOrder));

        sessionStorage.setItem(processedKey, 'done');
        sessionStorage.removeItem('pending_checkout');

        await clearCart().catch(() => {});
      } catch (e) {
        console.error('Failed to finalize order:', e);
        sessionStorage.removeItem(processedKey);
        setFinalizeError('Failed to save your order. Please try again.');
        hasFinalizedRef.current = false;
      }
    };

    finalizeOrder();
  }, [addOrdersFromCart, recordPurchasedStock, clearCart, sessionId]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader className="pb-2">
          <div className="mb-4 flex justify-center">
            <CheckCircle2Icon className="size-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold">Payment Successful!</CardTitle>
          <CardDescription className="mt-1 text-base">
            Your order has been placed and confirmed. You&apos;ll receive updates as your order is prepared.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pb-2">
          {sessionId && (
            <div className="inline-flex items-center rounded-full bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
              Session: {sessionId.slice(0, 25)}...
            </div>
          )}

          {finalizeError && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-red-200">
              {finalizeError}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2 pt-4">
          <Button
            type="button"
            className="h-11 w-full rounded-2xl"
            onClick={() => navigate('/orders')}
          >
            View My Orders
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-2xl"
            onClick={() => navigate('/')}
          >
            Back to Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}