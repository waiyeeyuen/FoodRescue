import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';

function RestaurantLayout() {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const location = useLocation();

  const navItems = [
    { label: 'Listings', path: '/restaurant/listings' },
    { label: 'Orders', path: '/restaurant/orders' },
    { label: 'Statistics', path: '/restaurant/profile' },
  ];

  const isActive = (path) => location.pathname === path;

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  return (
    <div className="site-shell">
      <header className="site-header sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative flex min-h-[5.25rem] items-center justify-between gap-4">
            <Link to="/restaurant/listings" className="flex items-center gap-3">
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

            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-white/70 bg-white/55 p-1.5 shadow-[0_18px_34px_-28px_rgba(24,36,33,0.45)] backdrop-blur-sm md:flex">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`site-nav-link rounded-full px-4 py-2.5 text-sm font-medium transition ${
                    isActive(item.path) ? 'site-nav-link-active' : ''
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-4">
              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((prev) => !prev)}
                  className="site-icon-button flex h-10 w-10 items-center justify-center overflow-hidden rounded-full transition"
                  title={user?.restaurantName}
                >
                  <span className="text-sm font-semibold text-slate-700">
                    {(user?.restaurantName || 'R')[0].toUpperCase()}
                  </span>
                </button>

                {profileMenuOpen && (
                  <div className="site-popover absolute right-0 z-50 mt-3 w-60 overflow-hidden rounded-[24px] py-2">
                    <div className="border-b border-border/80 px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">{user?.restaurantName}</p>
                      <p className="text-xs text-slate-500">{user?.email}</p>
                    </div>
                    <Link
                      to="/restaurant/settings"
                      className="site-dropdown-link mx-2 my-1 block px-4 py-2 text-sm"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      Profile
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="mx-2 my-1 w-[calc(100%-1rem)] rounded-2xl px-4 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="site-icon-button flex h-10 w-10 items-center justify-center rounded-full transition md:hidden"
                aria-label="Open menu"
              >
                <svg className="h-6 w-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {mobileMenuOpen && (
            <nav className="md:hidden border-t border-border/80 py-4">
              <div className="flex flex-col gap-2 rounded-[24px] bg-white/55 p-2 backdrop-blur-sm">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`site-nav-link block rounded-2xl px-4 py-3 text-sm font-medium transition ${
                      isActive(item.path) ? 'site-nav-link-active' : ''
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

      <main className="site-main mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export default RestaurantLayout;
