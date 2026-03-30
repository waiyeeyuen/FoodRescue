import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/spinner';

function formatMetricValue(metric, value) {
  const numeric = Number(value || 0);
  if (metric === 'co2KgSaved') return `${numeric.toFixed(0)} kg`;
  if (metric === 'waterLitersSaved') return `${numeric.toFixed(0)} L`;
  return String(numeric);
}

function LeaderboardPanel({ title, description, metricKey, data }) {
  const top = Array.isArray(data?.top) ? data.top : [];

  return (
    <section className="rounded-[30px] border border-white/70 bg-white/78 p-5 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>

      <div className="mt-5 space-y-3">
        {top.map((entry) => (
          <div
            key={`${metricKey}-${entry.userId}`}
            className="flex items-center justify-between rounded-[22px] border border-white/70 bg-white/72 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                #{entry.rank}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{entry.username}</p>
                <p className="text-xs text-slate-500">Top 10</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-slate-900">
              {formatMetricValue(metricKey, entry.value)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function UserLeaderboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leaderboards, setLeaderboards] = useState(null);

  const accountServiceUrl =
    import.meta.env.VITE_ACCOUNT_SERVICE_URL || 'http://localhost:3001';

  useEffect(() => {
    if (!user?.id) {
      setLeaderboards(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadLeaderboards() {
      try {
        setLoading(true);
        setError('');

        const params = new URLSearchParams({
          userId: user.id,
          limit: '10',
        });

        const response = await fetch(
          `${accountServiceUrl}/account/leaderboards/users?${params.toString()}`,
          { signal: controller.signal }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load leaderboards');
        }

        if (!controller.signal.aborted) {
          setLeaderboards(data?.leaderboards || null);
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError(fetchError?.message || 'Failed to load leaderboards');
          setLeaderboards(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadLeaderboards();

    return () => controller.abort();
  }, [accountServiceUrl, user?.id]);

  const currentRanks = useMemo(() => ({
    co2: leaderboards?.co2KgSaved?.currentUser?.rank ?? null,
    water: leaderboards?.waterLitersSaved?.currentUser?.rank ?? null,
  }), [leaderboards]);

  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
          <div>
            <span className="hero-kicker">Top 10 Leaderboard</span>
            <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
              See the top 10 users by CO2 and water saved.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Rankings update from completed pickups only, so the board reflects real rescue impact.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Your CO2 rank
              </p>
              <p className="mt-2 text-3xl font-semibold text-[var(--brand-ink)]">
                {currentRanks.co2 ? `#${currentRanks.co2}` : '—'}
              </p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Your water rank
              </p>
              <p className="mt-2 text-3xl font-semibold text-[var(--brand-coral)]">
                {currentRanks.water ? `#${currentRanks.water}` : '—'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-[28px] border border-white/70 bg-white/75 px-6 py-12">
          <Spinner className="size-5" />
          <span className="text-sm text-slate-600">Loading leaderboard...</span>
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <LeaderboardPanel
            title="Top 10 By CO2 Saved"
            description="Higher rank means more completed rescue impact."
            metricKey="co2KgSaved"
            data={leaderboards?.co2KgSaved}
          />
          <LeaderboardPanel
            title="Top 10 By Water Saved"
            description="A second view of sustainability impact across the user base."
            metricKey="waterLitersSaved"
            data={leaderboards?.waterLitersSaved}
          />
        </div>
      )}
    </div>
  );
}
