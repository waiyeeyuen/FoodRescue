import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

function normalizeServiceBaseUrl(url, servicePath) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const suffix = `/${servicePath}`;
  if (trimmed.endsWith(suffix)) return trimmed.slice(0, -suffix.length);
  return trimmed;
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!raw) return null;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function initializeUserFromStorage() {
  try {
    const token = localStorage.getItem('token');
    const saved = localStorage.getItem('user');
    if (token && saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to parse user from storage:', e);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => initializeUserFromStorage());
  const [cart, setCart] = useState([]);
  const [cartLoading, setCartLoading] = useState(false);

  const accountServiceBaseUrl = normalizeServiceBaseUrl(
    import.meta.env.VITE_ACCOUNT_SERVICE_URL || "http://localhost:3001",
    'account'
  );

  const cartCount = useMemo(() => {
    return (cart || []).reduce((sum, item) => {
      const qty = Number(item?.quantity ?? 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
  }, [cart]);

  const refreshCart = async (overrideUserId) => {
    const userId = overrideUserId || user?.id;
    if (!userId || user?.restaurantName) {
      setCart([]);
      return;
    }
    try {
      setCartLoading(true);
      const res = await fetch(
        `${accountServiceBaseUrl}/account/${encodeURIComponent(userId)}/cart`
      );
      const data = await readResponseBody(res);
      if (!res.ok) {
        const message =
          (data && typeof data === 'object' && data.error) ||
          (typeof data === 'string' ? data : null) ||
          `Failed to load cart (${res.status})`;
        throw new Error(message);
      }
      setCart(Array.isArray(data?.cart) ? data.cart : []);
    } finally {
      setCartLoading(false);
    }
  };

  const addToCart = async ({ item, quantity, pickupTime }) => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');
    const res = await fetch(`${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, quantity, pickupTime }),
    });
    const data = await readResponseBody(res);
    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to add to cart (${res.status})`;
      throw new Error(message);
    }
    setCart(Array.isArray(data?.cart) ? data.cart : []);
    return data;
  };

  const removeFromCart = async (listingId) => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');
    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/items/${encodeURIComponent(listingId)}`,
      { method: 'DELETE' }
    );
    const data = await readResponseBody(res);
    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to remove from cart (${res.status})`;
      throw new Error(message);
    }
    setCart(Array.isArray(data?.cart) ? data.cart : []);
    return data;
  };

  const clearCart = async () => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');
    const res = await fetch(`${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/clear`, {
      method: 'POST',
    });
    const data = await readResponseBody(res);
    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to clear cart (${res.status})`;
      throw new Error(message);
    }
    setCart(Array.isArray(data?.cart) ? data.cart : []);
    return data;
  };

  useEffect(() => {
    if (!user?.id || user?.restaurantName) {
      setCart([]);
      return;
    }
    refreshCart(user.id).catch(() => {
      // keep UI usable even if cart fetch fails
      setCart([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Register a new user account
  const register = async ({ username, email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  };

  // Register a new restaurant account
  const restaurantRegister = async ({ restaurantName, email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/restaurant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantName, email, password }),
    });
    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  };

  // Login to an existing user account
  const login = async ({ email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data);
  };

  // Login to an existing restaurant account
  const restaurantLogin = async ({ email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/restaurant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data);
  };

  // Save token and user to state and localStorage
  const saveSession = ({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
    // Fetch cart in background
    if (user?.id) refreshCart(user.id).catch(() => setCart([]));
  };

  // Logout and clear all session data
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setCart([]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        register,
        restaurantRegister,
        login,
        restaurantLogin,
        logout,
        cart,
        cartCount,
        cartLoading,
        refreshCart,
        addToCart,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
