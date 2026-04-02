import { useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';

export default function RestaurantSettings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

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
        setLoading(true);
        const response = await fetch(
          `${accountServiceUrl}/account/restaurant/${encodeURIComponent(user.id)}`,
          { signal: controller.signal }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load restaurant profile');
        }

        if (!controller.signal.aborted) {
          setProfile(data);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to load restaurant profile:', error);
          setProfile(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => controller.abort();
  }, [accountServiceUrl, user?.id]);

  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <span className="hero-kicker">Profile</span>
        <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
          Keep your business profile polished and easy to trust.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          Business identity and contact details live here, while rescue impact stays in the
          statistics dashboard.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-[30px] border border-white/70 bg-white/78 p-6 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Business profile
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900">
            {profile?.restaurantName || user?.restaurantName || 'Restaurant'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {profile?.email || user?.email || 'restaurant@email.com'}
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[22px] bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Leaderboard city</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {profile?.city || 'Not set yet'}
              </p>
            </div>
            <div className="rounded-[22px] bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Account type</p>
              <p className="mt-1 text-sm font-medium text-foreground">Restaurant partner</p>
            </div>
            <div className="rounded-[22px] bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {profile?.email || user?.email || '-'}
              </p>
            </div>
            <div className="rounded-[22px] bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Profile status</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {loading ? 'Refreshing...' : 'Synced from Firebase'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/70 bg-white/78 p-6 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Coming later
          </p>
          <h2 className="mt-3 text-xl font-semibold text-slate-900">
            Editable business fields
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Restaurant description, city updates, profile image, and staff access controls can be
            wired here once write flows are added.
          </p>
        </div>
      </section>
    </div>
  );
}
