import { useMemo, useState } from 'react';

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

export default function UserProfile() {
  const { user } = useAuth();

  const [paymentMethod, setPaymentMethod] = useState('card_4242');
  const [notificationStyle, setNotificationStyle] = useState('push');
  const [language, setLanguage] = useState('en');
  const [dietary, setDietary] = useState({
    halal: false,
    vegetarian: false,
    vegan: false,
    noBeef: false,
    noSeafood: false,
  });

  const dietarySummary = useMemo(() => {
    const labels = [];
    if (dietary.halal) labels.push('Halal');
    if (dietary.vegetarian) labels.push('Vegetarian');
    if (dietary.vegan) labels.push('Vegan');
    if (dietary.noBeef) labels.push('No beef');
    if (dietary.noSeafood) labels.push('No seafood');
    return labels.length ? labels.join(', ') : 'None selected';
  }, [dietary]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Profile Settings</h1>
          <p className="text-slate-600 mt-2">
            Boilerplate settings (temporary UI; not saved yet).
          </p>
        </div>
        <Button type="button" variant="outline" disabled title="Not wired up yet">
          Save changes (soon)
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Temporary profile data</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-slate-200 ring-1 ring-slate-200 flex items-center justify-center">
                <span className="text-sm font-semibold text-slate-700">
                  {(user?.username || 'U')[0]?.toUpperCase?.() || 'U'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {user?.username || 'Demo User'}
                </p>
                <p className="truncate text-xs text-slate-500">{user?.email || 'user@email.com'}</p>
              </div>
            </div>

            <div className="rounded-xl bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Dietary preferences</p>
              <p className="mt-1 font-medium text-foreground">{dietarySummary}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:col-span-2">
          <Card id="payment">
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
              <CardDescription>Choose your default payment option</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                { id: 'card_4242', label: 'Card (Visa •••• 4242)', hint: 'Default test card' },
                { id: 'paynow', label: 'PayNow', hint: 'Pay via QR' },
                { id: 'cash', label: 'Cash on pickup', hint: 'Pay at collection' },
              ].map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-start gap-3 rounded-xl border border-input bg-background px-3 py-3 hover:bg-muted/40"
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={opt.id}
                    checked={paymentMethod === opt.id}
                    onChange={() => setPaymentMethod(opt.id)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </CardContent>
            <CardFooter>
              <Button type="button" variant="outline" disabled>
                Manage payment methods (soon)
              </Button>
            </CardFooter>
          </Card>

          <Card id="notifications">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>How you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Style</label>
                <select
                  value={notificationStyle}
                  onChange={(e) => setNotificationStyle(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="push">Push notifications</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground">Preview</p>
                <p className="mt-1 font-medium text-foreground">
                  {notificationStyle === 'push'
                    ? 'Push: “Your order is ready for pickup.”'
                    : notificationStyle === 'sms'
                      ? 'SMS: “Your order is ready for pickup.”'
                      : 'Email: “Your order is ready for pickup.”'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card id="dietary">
            <CardHeader>
              <CardTitle>Dietary Preferences</CardTitle>
              <CardDescription>Used for filtering and recommendations</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'halal', label: 'Halal' },
                { key: 'vegetarian', label: 'Vegetarian' },
                { key: 'vegan', label: 'Vegan' },
                { key: 'noBeef', label: 'No beef' },
                { key: 'noSeafood', label: 'No seafood' },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center gap-3 rounded-xl border border-input bg-background px-3 py-3 hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={dietary[opt.key]}
                    onChange={(e) =>
                      setDietary((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                    }
                  />
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card id="language">
            <CardHeader>
              <CardTitle>Language</CardTitle>
              <CardDescription>Choose your display language</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 sm:max-w-sm">
              <label className="text-xs text-muted-foreground">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="en">English</option>
                <option value="zh">中文 (Chinese)</option>
                <option value="ms">Bahasa Melayu</option>
                <option value="ta">தமிழ் (Tamil)</option>
              </select>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
