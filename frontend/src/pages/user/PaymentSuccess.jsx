import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

function getProcessedSessionKey(sessionId) {
  return sessionId ? `payment_success_processed_${sessionId}` : null;
}

async function readErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();
    if (data?.error && Array.isArray(data.details) && data.details.length > 0) {
      return `${data.error}: ${data.details.join(', ')}`;
    }
    return data?.error || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

function getField(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function toMajorUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  // Heuristic: treat large integers as minor units (cents).
  if (Number.isInteger(num) && num > 100) return num / 100;
  return num;
}

function normalizeOrderItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];

  const normalized = items
    .map((entry) => {
      const wrappedItem =
        entry?.item && typeof entry.item === 'object' ? entry.item : entry;

      const quantity = Number(getField(entry, 'quantity', 'Quantity') ?? 0);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;

      const id =
        getField(entry, 'listingId', 'ListingId', 'id', 'Id') ??
        getField(wrappedItem, 'listingId', 'ListingId', 'id', 'Id');

      const name =
        getField(entry, 'itemName', 'ItemName') ||
        getField(wrappedItem, 'itemName', 'ItemName', 'name', 'Name') ||
        'Item';

      const priceRaw =
        getField(entry, 'price', 'Price') ?? getField(wrappedItem, 'price', 'Price') ?? 0;

      return {
        id: id != null ? String(id) : undefined,
        name: String(name || 'Item'),
        quantity: safeQuantity,
        unitPrice: toMajorUnits(priceRaw),
        raw: entry
      };
    })
    .filter((i) => i.quantity > 0);

  const totalPrice = Number(
    normalized
      .reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * item.quantity, 0)
      .toFixed(2)
  );

  return { normalized, totalPrice };
}

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  const { user, addOrdersFromCart, clearCart } = useAuth();

  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Finalising your order...');

  const sessionId = searchParams.get('session_id');
  const paymentServiceUrl =
    import.meta.env.VITE_PAYMENT_SERVICE_URL || 'http://localhost:3003';

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    async function finalizePayment() {
      try {
        const pending = readPendingCheckout();
        const processedKey = getProcessedSessionKey(sessionId);

        if (processedKey && sessionStorage.getItem(processedKey) === 'true') {
          setStatus('success');
          setMessage('Payment already processed.');
          return;
        }

        if (!pending) {
          setStatus('success');
          setMessage('Payment received. No pending checkout data was found.');
          return;
        }

        const items = Array.isArray(pending?.items) ? pending.items : [];
        const pickupTime =
          pending?.pickupTime ||
          (items.length === 1 ? (items[0]?.pickupTime || '') : '');
        const orderId =
          pending?.orderId || pending?.sessionId || sessionId || `ORD-${Date.now()}`;

        // Trigger backend pipeline (payment → stock check → place-order → OutSystems decrement)
        // even when Stripe webhooks aren’t running locally.
        if (sessionId) {
          const confirmRes = await fetch(`${paymentServiceUrl}/payments/confirm-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });

          if (!confirmRes.ok) {
            const errorMessage = await readErrorMessage(confirmRes, 'Failed to confirm payment');
            throw new Error(errorMessage);
          }
        }

        if (items.length > 0) {
          await addOrdersFromCart({ items, pickupTime, orderId });
        }

        await clearCart().catch((err) => {
          console.warn('Failed to clear cart after payment:', err);
        });

        if (processedKey) {
          sessionStorage.setItem(processedKey, 'true');
        }

        sessionStorage.removeItem('pending_checkout');

        setStatus('success');
        setMessage('Your payment was successful and your order has been recorded.');
      } catch (err) {
        console.error('Failed to finalize payment success flow:', err);
        setStatus('error');
        setMessage(err?.message || 'Payment succeeded, but the order could not be finalised.');
      }
    }

    finalizePayment();
  }, [sessionId, user?.id, addOrdersFromCart, clearCart, paymentServiceUrl]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-lg rounded-2xl shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2Icon className="h-8 w-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl">
            {status === 'error' ? 'Payment Received' : 'Payment Successful'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>

        <CardContent className="text-center text-sm text-slate-600">
          {status === 'processing' && <p>We are updating your order now.</p>}
          {status === 'success' && <p>Your order is ready in the Orders tab.</p>}
          {status === 'error' && <p>Please check your Orders tab or try refreshing once.</p>}
        </CardContent>

        <CardFooter className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => navigate('/orders')}>
            View Orders
          </Button>
          <Button onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
