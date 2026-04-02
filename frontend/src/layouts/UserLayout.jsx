import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { BellIcon, ShoppingCartIcon } from 'lucide-react';

function UserLayout() {
  const { user, logout, cartCount } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const profileMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const location = useLocation();

  const notificationServiceUrl =
    import.meta.env.VITE_NOTIFICATION_SERVICE_URL || 'http://localhost:8000';

  const navItems = [
    { label: 'Home', path: '/' },
    { label: 'Orders', path: '/orders' },
    { label: 'Leaderboard', path: '/leaderboard' },
  ];

  function isVisibleNotification(notification) {
    return String(notification?.status || '').trim().toUpperCase() === 'SENT';
  }

  const isActive = (path) => location.pathname === path;
  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification?.read !== true).length,
    [notifications]
  );

  const loadNotifications = useCallback(
    async ({ silent = false } = {}) => {
      if (!user?.id) return;

      try {
        if (!silent) setNotificationsLoading(true);

        const response = await fetch(
          `${notificationServiceUrl}/notifications/${encodeURIComponent(user.id)}`
        );
        const data = await response.json().catch(() => []);

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load notifications');
        }

        const visibleNotifications = Array.isArray(data)
          ? data.filter((notification) => isVisibleNotification(notification))
          : [];

        setNotifications(visibleNotifications);
        setNotificationsError('');
      } catch (error) {
        setNotificationsError(error?.message || 'Failed to load notifications');
      } finally {
        if (!silent) {
          setNotificationsLoading(false);
        }
      }
    },
    [notificationServiceUrl, user?.id]
  );

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setNotificationsError('');
      return undefined;
    }
    loadNotifications();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadNotifications({ silent: true });
      }
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadNotifications({ silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadNotifications, user?.id]);

  useEffect(() => {
    if (!notificationsOpen || !user?.id) return;
    loadNotifications({ silent: true });
  }, [loadNotifications, notificationsOpen, user?.id]);

  useEffect(() => {
    if (!notificationsOpen || !user?.id || unreadCount === 0) return;

    let cancelled = false;

    async function markNotificationsRead() {
      try {
        const response = await fetch(
          `${notificationServiceUrl}/notifications/${encodeURIComponent(user.id)}/read-all`,
          { method: 'PATCH' }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to mark notifications as read');
        }

        if (!cancelled) {
          setNotifications((prev) =>
            prev.map((notification) => ({ ...notification, read: true }))
          );
        }
      } catch (error) {
        if (!cancelled) {
          setNotificationsError(error?.message || 'Failed to mark notifications as read');
        }
      }
    }

    markNotificationsRead();

    return () => {
      cancelled = true;
    };
  }, [notificationServiceUrl, notificationsOpen, unreadCount, user?.id]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target)
      ) {
        setProfileMenuOpen(false);
      }

      if (
        notificationMenuRef.current &&
        !notificationMenuRef.current.contains(event.target)
      ) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function formatNotificationDate(value) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return 'Just now';

    return parsed.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="site-shell">
      {/* Header */}
      <header className="site-header sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex min-h-[5.25rem] items-center justify-between gap-4">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3">
              <div className="site-brand-mark flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/80">
                <img
                  src="/logo.png"
                  alt="FoodRescue logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="site-brand-wordmark text-xl font-semibold text-slate-900 sm:text-2xl">
                  FoodRescue
                </p>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="absolute left-1/2 hidden -translate-x-1/2 md:flex items-center gap-2 rounded-full border border-white/70 bg-white/55 p-1.5 shadow-[0_18px_34px_-28px_rgba(24,36,33,0.45)] backdrop-blur-sm">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`site-nav-link rounded-full px-4 py-2.5 text-sm font-medium transition ${
                    isActive(item.path)
                      ? 'site-nav-link-active'
                      : ''
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Profile Section */}
            <div className="flex items-center gap-4">
              <div className="relative" ref={notificationMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen((prev) => !prev);
                    setProfileMenuOpen(false);
                  }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-[1.15rem] border border-rose-200 bg-[linear-gradient(180deg,rgba(255,241,242,0.96),rgba(255,228,233,0.92))] shadow-[0_14px_24px_-20px_rgba(190,24,93,0.4)] transition hover:-translate-y-[1px] hover:shadow-[0_18px_28px_-20px_rgba(190,24,93,0.46)]"
                  aria-label="Notifications"
                >
                  <BellIcon className="h-4 w-4 text-rose-700" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="site-popover absolute right-0 mt-3 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[26px] z-50">
                    <div className="border-b border-border/80 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="site-brand-wordmark text-lg font-semibold text-slate-900">Notifications</p>
                          <p className="text-xs text-slate-500">
                            New updates appear here automatically.
                          </p>
                        </div>
                        {unreadCount > 0 && (
                          <span className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-200">
                            {unreadCount} new
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="max-h-[26rem] overflow-y-auto">
                      {notificationsLoading ? (
                        <div className="px-5 py-7 text-sm text-slate-500">
                          Loading notifications...
                        </div>
                      ) : notificationsError ? (
                        <div className="px-5 py-7 text-sm text-red-600">
                          {notificationsError}
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="px-5 py-7 text-sm text-slate-500">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id || `${notification.type}-${notification.createdAt || ''}`}
                            className={`border-b border-white/60 px-5 py-4 last:border-b-0 ${
                              notification.read === true ? 'bg-white/50' : 'bg-red-50/55'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900">
                                  {notification.title || 'Notification'}
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                  {notification.message || 'New update from FoodRescue.'}
                                </p>
                              </div>
                              {notification.read !== true && (
                                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                              )}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                              <span>{formatNotificationDate(notification.createdAt || notification.created_at)}</span>
                              <span className="uppercase tracking-wide">
                                {notification.status || 'pending'}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Cart */}
              <Link
                to="/cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-[radial-gradient(circle_at_top,rgba(236,253,245,0.96),rgba(209,250,229,0.92))] shadow-[0_14px_24px_-20px_rgba(5,150,105,0.45)] transition hover:-translate-y-[1px] hover:shadow-[0_18px_28px_-20px_rgba(5,150,105,0.5)]"
                aria-label="Cart"
              >
                <ShoppingCartIcon className="h-4 w-4 text-emerald-700" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </Link>

              {/* Profile Picture Dropdown */}
              <div className="relative" ref={profileMenuRef}>
                <button
                  onClick={() => {
                    setProfileMenuOpen((prev) => !prev);
                    setNotificationsOpen(false);
                  }}
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[1.35rem] border border-[rgba(20,95,89,0.25)] bg-[linear-gradient(135deg,rgba(20,95,89,0.96),rgba(63,137,123,0.94))] shadow-[0_16px_28px_-20px_rgba(20,95,89,0.75)] transition hover:-translate-y-[1px] hover:shadow-[0_20px_32px_-20px_rgba(20,95,89,0.82)]"
                  title={user?.username || user?.restaurantName}
                >
                  <span className="text-sm font-semibold text-white">
                    {(user?.username || user?.restaurantName || 'U')[0].toUpperCase()}
                  </span>
                </button>

                {/* Profile Dropdown Menu */}
                {profileMenuOpen && (
                  <div className="site-popover absolute right-0 z-50 mt-3 w-56 overflow-hidden rounded-[24px] py-2">
                    <div className="border-b border-border/80 px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">
                        {user?.username}
                      </p>
                      <p className="text-xs text-slate-500">{user?.email}</p>
                    </div>
                    <Link
                      to="/profile"
                      className="site-dropdown-link mx-2 my-1 block px-4 py-2 text-sm"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      Profile
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="mx-2 my-1 w-[calc(100%-1rem)] rounded-2xl px-4 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="site-icon-button md:hidden flex h-10 w-10 items-center justify-center rounded-full transition"
              >
                <svg className="h-6 w-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <nav className="md:hidden border-t border-border/80 py-4">
              <div className="flex flex-col gap-2 rounded-[24px] bg-white/55 p-2 backdrop-blur-sm">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`site-nav-link block rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    isActive(item.path)
                      ? 'site-nav-link-active'
                      : ''
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              </div>
            </nav>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="site-main mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export default UserLayout;
