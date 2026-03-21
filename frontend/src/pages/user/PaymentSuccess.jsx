import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2Icon } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCart } = useAuth();
  const sessionId = searchParams.get('session_id');

  // Clear cart only after confirmed payment redirect
  useEffect(() => {
    clearCart().catch(() => {});
  }, []);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader className="pb-2">
          <div className="flex justify-center mb-4">
            <CheckCircle2Icon className="size-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold">Payment Successful!</CardTitle>
          <CardDescription className="text-base mt-1">
            Your order has been placed and confirmed. You'll receive updates as your order is prepared.
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-2">
          {sessionId && (
            <div className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground font-mono mt-2">
              Session: {sessionId}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2 pt-4">
          <Button
            type="button"
            className="w-full rounded-2xl h-11"
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
