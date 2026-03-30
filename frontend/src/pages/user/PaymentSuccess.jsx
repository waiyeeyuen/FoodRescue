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

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  const { user, clearCart } = useAuth();

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
          setMessage('Payment received. We are waiting for the final inventory result.');
          return;
        }

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

        await clearCart().catch((err) => {
          console.warn('Failed to clear cart after payment:', err);
        });

        if (processedKey) {
          sessionStorage.setItem(processedKey, 'true');
        }

        sessionStorage.removeItem('pending_checkout');

        setStatus('success');
        setMessage('Payment received. We are checking stock now. If anything fails, your update will appear in the notification bell.');
      } catch (err) {
        console.error('Failed to finalize payment success flow:', err);
        setStatus('error');
        setMessage(err?.message || 'Payment succeeded, but we could not confirm the inventory result yet.');
      }
    }

    finalizePayment();
  }, [sessionId, user?.id, clearCart, paymentServiceUrl]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-xl rounded-[32px] shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 shadow-[0_20px_40px_-24px_rgba(22,163,74,0.65)]">
            <CheckCircle2Icon className="h-8 w-8 text-green-600" />
          </div>
          <CardTitle className="site-brand-wordmark text-3xl">
            {status === 'error' ? 'Payment Received' : 'Payment Successful'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>

        <CardContent className="text-center text-sm text-slate-600">
          {status === 'processing' && <p>We are updating your order now.</p>}
          {status === 'success' && <p>Check Orders for confirmed items or the bell icon for new notifications.</p>}
          {status === 'error' && <p>Please refresh once, then check Orders or the bell icon for updates.</p>}
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
