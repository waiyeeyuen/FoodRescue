import { useEffect, useMemo, useState } from 'react';
import { BellRingIcon, FlameIcon, SmartphoneIcon } from 'lucide-react';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function normalizeUserImpact(impact) {
  const safeImpact = impact && typeof impact === 'object' ? impact : {};
  return {
    mealsRescued: Number(safeImpact.mealsRescued || 0),
    co2KgSaved: Number((safeImpact.co2KgSaved ?? safeImpact.co2) || 0),
    waterLitersSaved: Number((safeImpact.waterLitersSaved ?? safeImpact.water) || 0),
    moneySaved: Number(safeImpact.moneySaved || 0),
    daysSaved: Number((safeImpact.daysSaved ?? safeImpact.currentStreakDays ?? safeImpact.days) || 0),
    leaderboardEligible: Boolean(safeImpact.leaderboardEligible),
    lastSuccessfulOrderAt: safeImpact.lastSuccessfulOrderAt || null,
    completedDayKeys: Array.isArray(safeImpact.completedDayKeys)
      ? safeImpact.completedDayKeys.map((value) => String(value))
      : [],
  };
}

function formatImpactDate(value) {
  if (!value) return 'No confirmed rescues yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No confirmed rescues yet';
  return parsed.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function toSingaporeDayKey(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function getImpactCacheKey(userId) {
  return `impact_profile_${String(userId || '')}`;
}

function normalizeNotificationSettings(profile) {
  const preferences =
    profile?.notificationPreferences && typeof profile.notificationPreferences === 'object'
      ? profile.notificationPreferences
      : {};

  return {
    inAppEnabled: true,
    smsEnabled: Boolean(preferences.smsEnabled),
    phone: typeof profile?.phone === 'string' ? profile.phone : '',
  };
}

function formatPhonePreview(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'No phone number saved yet';

  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 4) return raw;
  return `${raw.slice(0, Math.max(0, raw.length - 4))}${'*'.repeat(Math.min(4, digits.length))}`;
}

export default function UserProfile() {
  const { user } = useAuth();

  const [paymentMethod, setPaymentMethod] = useState('card_4242');
  const [language, setLanguage] = useState('en');
  const [dietary, setDietary] = useState({
    halal: false,
    vegetarian: false,
    vegan: false,
    noBeef: false,
    noSeafood: false,
  });
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsEnabledDraft, setSmsEnabledDraft] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');

  const accountServiceUrl =
    import.meta.env.VITE_ACCOUNT_SERVICE_URL || 'http://localhost:3001';

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      return;
    }

    const controller = new AbortController();

    async function loadProfile() {
      try {
        setProfileLoading(true);
        setProfileUnavailable(false);
        const response = await fetch(
          `${accountServiceUrl}/account/${encodeURIComponent(user.id)}`,
          { signal: controller.signal }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load profile');
        }

        if (!controller.signal.aborted) {
          setProfile(data);
          localStorage.setItem(getImpactCacheKey(user.id), JSON.stringify(data));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to load user profile:', error);
          setProfileUnavailable(true);
          try {
            const cached = localStorage.getItem(getImpactCacheKey(user.id));
            if (cached) {
              setProfile(JSON.parse(cached));
            }
          } catch {}
        }
      } finally {
        if (!controller.signal.aborted) {
          setProfileLoading(false);
        }
      }
    }

    loadProfile();

    return () => controller.abort();
  }, [accountServiceUrl, user?.id]);

  const dietarySummary = useMemo(() => {
    const labels = [];
    if (dietary.halal) labels.push('Halal');
    if (dietary.vegetarian) labels.push('Vegetarian');
    if (dietary.vegan) labels.push('Vegan');
    if (dietary.noBeef) labels.push('No beef');
    if (dietary.noSeafood) labels.push('No seafood');
    return labels.length ? labels.join(', ') : 'None selected';
  }, [dietary]);

  const impact = useMemo(() => normalizeUserImpact(profile?.impact), [profile?.impact]);
  const notificationSettings = useMemo(
    () => normalizeNotificationSettings(profile),
    [profile]
  );
  const streakData = useMemo(() => {
    const fallbackDayKey = impact.lastSuccessfulOrderAt ? toSingaporeDayKey(impact.lastSuccessfulOrderAt) : '';
    const dayKeys = Array.isArray(impact.completedDayKeys)
      ? [...new Set([...impact.completedDayKeys.filter(Boolean), ...(fallbackDayKey ? [fallbackDayKey] : [])])]
      : fallbackDayKey
        ? [fallbackDayKey]
        : [];
    const normalizedSet = new Set(dayKeys);
    const recentDays = Array.from({ length: 5 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (4 - index));
      const key = toSingaporeDayKey(date);
      return {
        key,
        active: normalizedSet.has(key),
        label: date.toLocaleDateString([], { weekday: 'short' }),
      };
    });

    let streak = 0;
    const cursor = new Date();

    while (normalizedSet.has(toSingaporeDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    if (streak === 0) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      while (normalizedSet.has(toSingaporeDayKey(yesterday))) {
        streak += 1;
        yesterday.setDate(yesterday.getDate() - 1);
      }
    }

    return { recentDays, streak };
  }, [impact.completedDayKeys]);

  const impactCards = [
    { label: 'Meals rescued', value: impact.mealsRescued, suffix: '' },
    { label: 'CO2 saved', value: impact.co2KgSaved.toFixed(1), suffix: 'kg' },
    { label: 'Water saved', value: Math.round(impact.waterLitersSaved), suffix: 'L' },
    { label: 'Money saved', value: impact.moneySaved.toFixed(2), suffix: 'SGD' },
  ];

  useEffect(() => {
    setSmsEnabledDraft(notificationSettings.smsEnabled);
    setPhoneDraft(notificationSettings.phone);
  }, [notificationSettings.phone, notificationSettings.smsEnabled]);

  function openSmsDialog() {
    setSettingsError('');
    setSettingsSuccess('');
    setSmsEnabledDraft(notificationSettings.smsEnabled);
    setPhoneDraft(notificationSettings.phone);
    setSmsDialogOpen(true);
  }

  async function handleSaveNotificationSettings(event) {
    event.preventDefault();

    if (!user?.id) return;

    try {
      setSettingsSaving(true);
      setSettingsError('');
      setSettingsSuccess('');

      const response = await fetch(
        `${accountServiceUrl}/account/${encodeURIComponent(user.id)}/notification-settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smsEnabled: smsEnabledDraft,
            phone: phoneDraft,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save notification settings');
      }

      const nextProfile = data?.account || profile;
      setProfile(nextProfile);
      localStorage.setItem(getImpactCacheKey(user.id), JSON.stringify(nextProfile));
      setSettingsSuccess(
        smsEnabledDraft
          ? 'SMS notifications are now active for this number.'
          : 'SMS notifications are now turned off. Website notifications stay on.'
      );
      setSmsDialogOpen(false);
    } catch (error) {
      setSettingsError(error?.message || 'Failed to save notification settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <span className="hero-kicker">Impact Passport</span>
            <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
              Your rescue profile should feel earned, not generic.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Each completed pickup can build a real sustainability story here, from streaks to
              CO2 saved and meals kept out of the bin.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_22px_44px_-30px_rgba(24,36,33,0.45)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Days saved
            </p>
            <p className="mt-3 text-4xl font-semibold text-[var(--brand-ink)]">
              {profileUnavailable && !profile ? '—' : `${impact.daysSaved} days`}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Completed pickup days recorded in your impact history.
            </p>
            <div className="mt-4 rounded-[22px] bg-[rgba(20,95,89,0.08)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current streak
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {profileUnavailable && !profile ? '—' : `${streakData.streak} day${streakData.streak === 1 ? '' : 's'}`}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {streakData.recentDays.map((day) => (
                  <div
                    key={day.key}
                    className="flex flex-col items-center gap-1"
                    title={day.key}
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        day.active
                          ? 'bg-orange-100 text-orange-600 ring-1 ring-orange-200'
                          : 'bg-slate-100 text-slate-300 ring-1 ring-slate-200'
                      }`}
                    >
                      <FlameIcon className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                      {day.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Last completed rescue: {formatImpactDate(impact.lastSuccessfulOrderAt)}
            </p>
            {profileUnavailable && !profile && (
              <p className="mt-2 text-xs text-amber-600">
                Impact data is temporarily unavailable from Firebase right now.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {impactCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_20px_40px_-30px_rgba(24,36,33,0.45)] backdrop-blur-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {profileUnavailable && !profile ? '—' : card.value}
              {card.suffix ? <span className="ml-2 text-sm text-slate-500">{card.suffix}</span> : null}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Profile foundation for notifications and leaderboards</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-3">
              <div className="site-icon-button flex size-12 items-center justify-center rounded-full">
                <span className="text-sm font-semibold text-slate-700">
                  {(profile?.username || user?.username || 'U')[0]?.toUpperCase?.() || 'U'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {profile?.username || user?.username || 'Demo User'}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {profile?.email || user?.email || 'user@email.com'}
                </p>
              </div>
            </div>

            <div className="rounded-[22px] bg-muted/50 p-4 text-sm">
              <p className="text-xs text-muted-foreground">Leaderboard city</p>
              <p className="mt-1 font-medium text-foreground">
                {profile?.city || 'Add a city when you wire editable profile settings'}
              </p>
            </div>

            <div className="rounded-[22px] bg-muted/50 p-4 text-sm">
              <p className="text-xs text-muted-foreground">Dietary preferences</p>
              <p className="mt-1 font-medium text-foreground">{dietarySummary}</p>
            </div>

            <div className="rounded-[22px] bg-muted/50 p-4 text-sm">
              <p className="text-xs text-muted-foreground">Leaderboard status</p>
              <p className="mt-1 font-medium text-foreground">
                {impact.leaderboardEligible ? 'Eligible' : 'Pending city + confirmed rescue data'}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:col-span-2">
          <Card id="notifications">
            <CardHeader>
              <CardTitle>SMS Notifications</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
                <div className="rounded-[22px] border border-slate-200 bg-background p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-slate-100 p-2 text-slate-700">
                      <SmartphoneIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">SMS notifications</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {notificationSettings.smsEnabled
                          ? `Enabled for ${formatPhonePreview(notificationSettings.phone)}`
                          : 'Disabled until you opt in with a phone number.'}
                      </p>
                      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {notificationSettings.smsEnabled ? 'Enabled' : 'Off'}
                      </p>
                    </div>
                </div>
              </div>

              {settingsSuccess ? (
                <p className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {settingsSuccess}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={openSmsDialog}>
                  {notificationSettings.smsEnabled ? 'Manage SMS number' : 'Turn on SMS notifications'}
                </Button>
                {notificationSettings.smsEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={settingsSaving}
                    onClick={async () => {
                      setSmsEnabledDraft(false);
                      setPhoneDraft(notificationSettings.phone);
                      setSettingsError('');
                      setSettingsSuccess('');

                      try {
                        setSettingsSaving(true);
                        const response = await fetch(
                          `${accountServiceUrl}/account/${encodeURIComponent(user?.id || '')}/notification-settings`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              smsEnabled: false,
                              phone: notificationSettings.phone,
                            }),
                          }
                        );
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) {
                          throw new Error(data?.error || 'Failed to turn off SMS notifications');
                        }

                        const nextProfile = data?.account || profile;
                        setProfile(nextProfile);
                        localStorage.setItem(getImpactCacheKey(user.id), JSON.stringify(nextProfile));
                        setSettingsSuccess('SMS notifications are now turned off. Website notifications stay on.');
                      } catch (error) {
                        setSettingsError(error?.message || 'Failed to turn off SMS notifications');
                      } finally {
                        setSettingsSaving(false);
                      }
                    }}
                  >
                    Turn off SMS
                  </Button>
                ) : null}
              </div>

              {settingsError ? (
                <p className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {settingsError}
                </p>
              ) : null}
            </CardContent>
          </Card>

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
                  className="flex items-start gap-3 rounded-[22px] border border-input bg-background px-4 py-3 hover:bg-muted/40"
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
                    <span className="block text-sm font-medium text-foreground">{opt.label}</span>
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

          <Card id="dietary">
            <CardHeader>
              <CardTitle>Dietary Preferences</CardTitle>
              <CardDescription>Used for filtering and recommendation quality</CardDescription>
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
                  className="flex items-center gap-3 rounded-[22px] border border-input bg-background px-4 py-3 hover:bg-muted/40"
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
                className="h-11 w-full rounded-[18px] border border-input bg-background px-3 text-sm"
              >
                <option value="en">English</option>
                <option value="zh">中文 (Chinese)</option>
                <option value="ms">Bahasa Melayu</option>
                <option value="ta">தமிழ் (Tamil)</option>
              </select>
            </CardContent>
            <CardFooter className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {profileLoading ? 'Refreshing profile data...' : 'Profile metrics now read from Firebase impact fields.'}
              </span>
              <Button type="button" variant="outline" disabled title="Not wired up yet">
                Save changes (soon)
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
        <DialogContent className="max-w-lg rounded-[26px]">
          <form onSubmit={handleSaveNotificationSettings}>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>SMS notifications</DialogTitle>
              <DialogDescription>
                Turn on SMS only if you want text messages for key updates.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 px-6 py-4">
              <label className="flex items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/70 px-4 py-4">
                <input
                  type="checkbox"
                  checked={smsEnabledDraft}
                  onChange={(event) => setSmsEnabledDraft(event.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    Receive SMS notifications
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    Use the number below for order confirmations, refund updates, and other important rescue events.
                  </span>
                </span>
              </label>

              <div className="grid gap-2">
                <label htmlFor="sms-phone" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Phone number
                </label>
                <input
                  id="sms-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+65 9123 4567"
                  value={phoneDraft}
                  onChange={(event) => setPhoneDraft(event.target.value)}
                  disabled={!smsEnabledDraft || settingsSaving}
                  className="h-12 w-full rounded-[18px] border border-input bg-background px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                />
                <p className="text-xs text-slate-500">
                  Save digits with country code if needed. Example: `+6591234567`.
                </p>
              </div>

              {settingsError ? (
                <p className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {settingsError}
                </p>
              ) : null}
            </div>

            <DialogFooter className="rounded-b-[26px]">
              <Button
                type="button"
                variant="outline"
                disabled={settingsSaving}
                onClick={() => setSmsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={settingsSaving}>
                {settingsSaving ? 'Saving...' : 'Save settings'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
