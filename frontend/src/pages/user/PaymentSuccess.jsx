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
    return data?.error || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  const { user, addOrdersFromCart, clearCart } = useAuth();

  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Finalising your order...');

  const sessionId = searchParams.get('session_id');
  const orderServiceUrl =
    import.meta.env.VITE_ORDER_SERVICE_URL || 'http://localhost:3004';

  async function sendOrderToBackend({ userId, items, orderId, pickupTime }) {
    if (!userId || !Array.isArray(items) || items.length === 0) return;

    const response = await fetch(`${orderServiceUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: userId,
        orderId,
        pickupTime,
        items,
      }),
    });

    if (!response.ok) {
      const errorMessage = await readErrorMessage(
        response,
        'Failed to save order to backend'
      );
      throw new Error(errorMessage);
    }
  }

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
        const pickupTime = pending?.pickupTime || '';
        const orderId =
          pending?.orderId || pending?.sessionId || sessionId || `ORD-${Date.now()}`;

        if (items.length > 0) {
          await addOrdersFromCart({ items, pickupTime, orderId });

          try {
            await sendOrderToBackend({
              userId: user?.id,
              items,
              orderId,
              pickupTime,
            });
          } catch (err) {
            console.error('Failed to sync order to backend:', err);
          }
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
  }, [sessionId, user?.id, addOrdersFromCart, clearCart, orderServiceUrl]);

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