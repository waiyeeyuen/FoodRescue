import { useEffect, useMemo, useState } from 'react';
import { Award, Crown, Medal } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/spinner';

function formatMetricValue(metric, value) {
  const numeric = Number(value || 0);
  if (metric === 'co2KgSaved') return `${numeric.toFixed(0)} kg`;
  if (metric === 'waterLitersSaved') return `${numeric.toFixed(0)} L`;
  return String(numeric);
}

function getPodiumOrderClass(rank) {
  if (rank === 1) return 'md:order-2';
  if (rank === 2) return 'md:order-1';
  if (rank === 3) return 'md:order-3';
  return '';
}

function getPodiumHeightClass(rank) {
  if (rank === 1) return 'h-[4.5rem] md:h-24';
  if (rank === 2) return 'h-12 md:h-[4.5rem]';
  if (rank === 3) return 'h-10 md:h-14';
  return 'h-10';
}

function getRankPalette(rank) {
  if (rank === 1) {
    return {
      card:
        'border-amber-200 bg-[linear-gradient(180deg,rgba(255,250,223,0.98),rgba(255,234,188,0.92))] shadow-[0_26px_54px_-34px_rgba(180,122,27,0.5)]',
      badge: 'bg-amber-500 text-white',
      icon: 'text-amber-700',
      pedestal: 'bg-[linear-gradient(180deg,rgba(250,204,21,0.9),rgba(217,119,6,0.82))]',
      accent: 'text-amber-950',
    };
  }

  if (rank === 2) {
    return {
      card:
        'border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(226,232,240,0.92))] shadow-[0_24px_48px_-34px_rgba(71,85,105,0.4)]',
      badge: 'bg-slate-500 text-white',
      icon: 'text-slate-700',
      pedestal: 'bg-[linear-gradient(180deg,rgba(203,213,225,0.95),rgba(100,116,139,0.82))]',
      accent: 'text-slate-950',
    };
  }

  return {
    card:
      'border-orange-200 bg-[linear-gradient(180deg,rgba(255,242,234,0.98),rgba(254,215,170,0.92))] shadow-[0_24px_48px_-34px_rgba(194,65,12,0.4)]',
    badge: 'bg-orange-500 text-white',
    icon: 'text-orange-700',
    pedestal: 'bg-[linear-gradient(180deg,rgba(251,146,60,0.92),rgba(194,65,12,0.8))]',
    accent: 'text-orange-950',
  };
}

function getRankIcon(rank) {
  if (rank === 1) return Crown;
  if (rank === 2) return Medal;
  return Award;
}

function PodiumCard({ entry, metricKey, currentUserId }) {
  const isCurrentUser = String(entry?.userId || '') === String(currentUserId || '');
  const palette = getRankPalette(entry.rank);
  const Icon = getRankIcon(entry.rank);

  return (
    <div className={`flex flex-col justify-end ${getPodiumOrderClass(entry.rank)}`}>
      <div
        className={`rounded-[28px] border px-5 py-5 ${
          palette.card
        } ${
          isCurrentUser
            ? 'ring-2 ring-[rgba(20,95,89,0.28)] shadow-[0_28px_60px_-34px_rgba(20,95,89,0.46)]'
            : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-2xl px-3 text-sm font-bold ${palette.badge}`}
          >
            #{entry.rank}
          </span>
          <div className="min-w-0">
            <p className={`truncate text-base font-semibold ${palette.accent}`}>
              {entry.username}
            </p>
          </div>
        </div>

        <p className={`mt-5 text-3xl font-semibold tracking-tight flex justify-center ${palette.accent}`}>
          {formatMetricValue(metricKey, entry.value)}
        </p>
      </div>
    </div>
  );
}

function LeaderboardRow({ entry, metricKey, currentUserId }) {
  const isCurrentUser = String(entry?.userId || '') === String(currentUserId || '');

  return (
    <div
      className={`flex items-center justify-between rounded-[22px] border border-px-4 py-3 ${
        isCurrentUser
          ? 'border-[rgba(20,95,89,0.22)] bg-[linear-gradient(135deg,rgba(225,246,242,0.96),rgba(255,242,234,0.9))] shadow-[0_20px_40px_-30px_rgba(20,95,89,0.42)]'
          : 'border-white/70 bg-white/72'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold ${
            isCurrentUser
              ? 'bg-[var(--brand-ink)] text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          #{entry.rank}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{entry.username}</p>
            {isCurrentUser && (
              <span className="rounded-full bg-[rgba(20,95,89,0.12)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-ink)]">
                You
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-sm font-semibold text-slate-900">
        {formatMetricValue(metricKey, entry.value)}
      </p>
    </div>
  );
}

function LeaderboardPanel({ title, description, metricKey, data, currentUserId }) {
  const top = Array.isArray(data?.top) ? data.top : [];
  const podiumEntries = top.filter((entry) => Number(entry?.rank) >= 1 && Number(entry?.rank) <= 3);
  const remainingEntries = top.filter((entry) => Number(entry?.rank) >= 4 && Number(entry?.rank) <= 10);

  return (
    <section className="rounded-[30px] border border-white/70 bg-white/78 p-5 shadow-[0_24px_50px_-32px_rgba(24,36,33,0.45)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>

      {top.length === 0 ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-white/65 px-4 py-6 text-sm text-slate-500">
          No leaderboard entries yet.
        </div>
      ) : (
        <>
          {podiumEntries.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-3 md:items-end">
              {podiumEntries.map((entry) => (
                <PodiumCard
                  key={`${metricKey}-podium-${entry.userId}`}
                  entry={entry}
                  metricKey={metricKey}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )}

          {remainingEntries.length > 0 && (
            <div className="mt-6 space-y-3">
              {remainingEntries.map((entry) => (
                <LeaderboardRow
                  key={`${metricKey}-row-${entry.userId}`}
                  entry={entry}
                  metricKey={metricKey}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function getLeaderboardCacheKey(userId) {
  return `leaderboards_${String(userId || '')}`;
}

export default function UserLeaderboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leaderboards, setLeaderboards] = useState(null);
  const [stale, setStale] = useState(false);

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
        setStale(false);

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
          setStale(Boolean(data?.stale));
          localStorage.setItem(
            getLeaderboardCacheKey(user.id),
            JSON.stringify({ leaderboards: data?.leaderboards || null })
          );
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError(fetchError?.message || 'Failed to load leaderboards');
          try {
            const cached = localStorage.getItem(getLeaderboardCacheKey(user.id));
            if (cached) {
              const parsed = JSON.parse(cached);
              setLeaderboards(parsed?.leaderboards || null);
              setStale(true);
              return;
            }
          } catch {}
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
              See the top users by CO<sub className="text-2xl">2</sub> and water saved.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Rankings update from completed pickups only, so the board reflects real rescue impact.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_36px_-28px_rgba(24,36,33,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Your CO<sub className="text-xs">2</sub> rank
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
        <>
          {stale && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Showing cached leaderboard data while Firebase is temporarily unavailable.
            </div>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <LeaderboardPanel
              title="Top 10 By CO2 Saved"
              description="Higher rank means more completed rescue impact."
              metricKey="co2KgSaved"
              data={leaderboards?.co2KgSaved}
              currentUserId={user?.id}
            />
            <LeaderboardPanel
              title="Top 10 By Water Saved"
              description="A second view of sustainability impact across the user base."
              metricKey="waterLitersSaved"
              data={leaderboards?.waterLitersSaved}
              currentUserId={user?.id}
            />
          </div>
        </>
      )}
    </div>
  );
}
