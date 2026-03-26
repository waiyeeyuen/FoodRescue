import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

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
    if (token && saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to parse user from storage:', e);
  }

  localStorage.removeItem('token');
  localStorage.removeItem('user');
  return null;
}

function getFavoriteStorageKey(userId) {
  return userId ? `favorites_${userId}` : 'favorites_guest';
}

function getOrderStorageKey(userId) {
  return userId ? `orders_${userId}` : 'orders_guest';
}

function readArrayFromStorage(key) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`Failed to parse localStorage key: ${key}`, e);
    return [];
  }
}

function getListingKey(item, fallback = 'listing') {
  const id = item?.Id ?? item?.id ?? item?.listingId ?? item?.ListingId;
  if (id !== undefined && id !== null) return String(id);

  const itemName =
    item?.itemName ?? item?.ItemName ?? item?.name ?? item?.Name ?? fallback;
  const restaurantId = item?.restaurantId ?? item?.RestaurantId ?? 'restaurant';

  return `${restaurantId}-${itemName}`;
}

function getItemStock(item) {
  const stock =
    item?.quantity ??
    item?.Quantity ??
    item?.stock ??
    item?.Stock ??
    item?.remainingQuantity ??
    item?.RemainingQuantity ??
    0;

  const parsed = Number(stock);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeListingItem(rawItem) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const quantity = getItemStock(item);

  return {
    ...item,
    quantity,
  };
}

function normalizeCartEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { item: normalizeListingItem({}), quantity: 0, pickupTime: '' };
  }

  const quantity = Number(entry?.quantity ?? 0);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;

  const rawItem = entry?.item && typeof entry.item === 'object' ? entry.item : entry;

  return {
    ...entry,
    item: normalizeListingItem(rawItem),
    quantity: safeQuantity,
    pickupTime: entry?.pickupTime || '',
  };
}

function buildOrderLineKey({ orderId, item, pickupTime, index = 0 }) {
  return `${orderId}__${getListingKey(item)}__${pickupTime || ''}__${index}`;
}

function dedupeOrders(orderList) {
  const seen = new Set();
  const result = [];

  for (let i = 0; i < orderList.length; i += 1) {
    const order = orderList[i];
    const lineKey =
      order?.lineKey ||
      buildOrderLineKey({
        orderId: order?.orderId || 'unknown-order',
        item: order?.item || {},
        pickupTime: order?.pickupTime || '',
        index: i,
      });

    if (seen.has(lineKey)) continue;
    seen.add(lineKey);

    result.push({ ...order, lineKey });
  }

  return result;
}

export function AuthProvider({ children }) {
  const initialUser = initializeUserFromStorage();

  const [user, setUser] = useState(() => initialUser);
  const [cart, setCart] = useState([]);
  const [cartLoading, setCartLoading] = useState(false);
  const [favorites, setFavorites] = useState(() =>
    readArrayFromStorage(getFavoriteStorageKey(initialUser?.id))
  );
  const [orders, setOrders] = useState(() =>
    dedupeOrders(readArrayFromStorage(getOrderStorageKey(initialUser?.id)))
  );

  const accountServiceBaseUrl = normalizeServiceBaseUrl(
    import.meta.env.VITE_ACCOUNT_SERVICE_URL || 'http://localhost:3001',
    'account'
  );

  const cartCount = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const qty = Number(item?.quantity ?? 0);
        return sum + (Number.isFinite(qty) ? qty : 0);
      }, 0),
    [cart]
  );

  const favoriteCount = useMemo(() => favorites.length, [favorites]);
  const orderCount = useMemo(() => orders.length, [orders]);

  const getCartQuantityForListing = useCallback(
    (itemOrId) => {
      const listingKey =
        typeof itemOrId === 'string' ? itemOrId : getListingKey(itemOrId);

      return cart.reduce((sum, cartItem) => {
        const normalizedCartItem = normalizeCartEntry(cartItem);
        const cartListingKey = getListingKey(normalizedCartItem?.item || {});
        if (cartListingKey !== listingKey) return sum;

        const qty = Number(normalizedCartItem?.quantity ?? 0);
        return sum + (Number.isFinite(qty) ? qty : 0);
      }, 0);
    },
    [cart]
  );

  const getRemainingStockForListing = useCallback(
    (item) => {
      const baseStock = getItemStock(item);
      const currentCartQty = getCartQuantityForListing(item);
      return Math.max(0, baseStock - currentCartQty);
    },
    [getCartQuantityForListing]
  );

  const canAddToCart = useCallback(
    (item, requestedQuantity = 1) => {
      const reqQty = Number(requestedQuantity);
      if (!Number.isFinite(reqQty) || reqQty <= 0) return false;
      return getRemainingStockForListing(item) >= reqQty;
    },
    [getRemainingStockForListing]
  );

  const refreshCart = useCallback(
    async (overrideUserId) => {
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

        setCart(Array.isArray(data?.cart) ? data.cart.map(normalizeCartEntry) : []);
      } finally {
        setCartLoading(false);
      }
    },
    [accountServiceBaseUrl, user?.id, user?.restaurantName]
  );

  const addToCart = async ({ item, quantity, pickupTime }) => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');

    const qtyToAdd = Number(quantity ?? 1);
    if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) {
      throw new Error('Invalid quantity');
    }

    if (!canAddToCart(item, qtyToAdd)) {
      const remaining = getRemainingStockForListing(item);
      if (remaining <= 0) throw new Error('This listing is sold out');
      throw new Error(`You can only add ${remaining} more for this listing`);
    }

    const safeItem = normalizeListingItem(item);

    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: safeItem,
          quantity: qtyToAdd,
          pickupTime,
        }),
      }
    );

    const data = await readResponseBody(res);

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to add to cart (${res.status})`;
      throw new Error(message);
    }

    const nextCart = Array.isArray(data?.cart) ? data.cart.map(normalizeCartEntry) : [];

    const totalForListing = nextCart.reduce((sum, cartItem) => {
      const sameListing = getListingKey(cartItem?.item || {}) === getListingKey(safeItem);
      if (!sameListing) return sum;
      return sum + Number(cartItem?.quantity ?? 0);
    }, 0);

    if (totalForListing > getItemStock(safeItem)) {
      throw new Error('Cart quantity exceeds available listing quantity');
    }

    setCart(nextCart);
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

    setCart(Array.isArray(data?.cart) ? data.cart.map(normalizeCartEntry) : []);
    return data;
  };

  const updateCartItem = async ({ listingId, item, quantity, pickupTime }) => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');

    const qty = Number(quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Invalid quantity');
    }

    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/items/${encodeURIComponent(listingId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: qty,
          pickupTime,
          item: item || undefined,
        }),
      }
    );

    const data = await readResponseBody(res);

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to update cart item (${res.status})`;
      throw new Error(message);
    }

    setCart(Array.isArray(data?.cart) ? data.cart.map(normalizeCartEntry) : []);
    return data;
  };

  const clearCart = async () => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');

    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/clear`,
      { method: 'POST' }
    );

    const data = await readResponseBody(res);

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to clear cart (${res.status})`;
      throw new Error(message);
    }

    setCart(Array.isArray(data?.cart) ? data.cart.map(normalizeCartEntry) : []);
    return data;
  };

  const isFavorite = useCallback(
    (itemOrId) => {
      const key = typeof itemOrId === 'string' ? itemOrId : getListingKey(itemOrId);
      return favorites.some((fav) => getListingKey(fav) === key);
    },
    [favorites]
  );

  const toggleFavorite = useCallback((item) => {
    const key = getListingKey(item);

    setFavorites((prev) => {
      const exists = prev.some((fav) => getListingKey(fav) === key);
      if (exists) return prev.filter((fav) => getListingKey(fav) !== key);
      return [...prev, item];
    });
  }, []);

  const removeFavorite = useCallback((itemOrId) => {
    const key = typeof itemOrId === 'string' ? itemOrId : getListingKey(itemOrId);
    setFavorites((prev) => prev.filter((fav) => getListingKey(fav) !== key));
  }, []);

  const clearFavorites = useCallback(() => {
    setFavorites([]);
  }, []);

  const addOrder = useCallback(async (order) => {
    if (!order) return null;
    setOrders((prev) => dedupeOrders([order, ...prev]));
    return order;
  }, []);

  const addOrdersFromCart = useCallback(async ({ items, pickupTime, orderId }) => {
    const safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) return [];

    const resolvedOrderId =
      orderId || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const createdAt = new Date().toISOString();

    const normalizedOrders = safeItems.map((entry, index) => {
      const normalizedEntry = normalizeCartEntry(entry);

      return {
        orderId: resolvedOrderId,
        lineKey: buildOrderLineKey({
          orderId: resolvedOrderId,
          item: normalizedEntry.item,
          pickupTime: pickupTime || normalizedEntry.pickupTime || '',
          index,
        }),
        item: normalizedEntry.item,
        quantity: normalizedEntry.quantity,
        pickupTime: pickupTime || normalizedEntry.pickupTime || '',
        status: 'Active',
        createdAt,
      };
    });

    setOrders((prev) => dedupeOrders([...normalizedOrders, ...prev]));
    return normalizedOrders;
  }, []);

  const clearOrders = useCallback(() => {
    setOrders([]);
  }, []);

  const recordPurchasedStock = useCallback(async () => {
    return { ok: true };
  }, []);

  useEffect(() => {
    if (user?.id && !user?.restaurantName) {
      refreshCart(user.id).catch((e) => {
        console.error('Failed to refresh cart:', e);
        setCart([]);
      });
    } else {
      setCart([]);
    }
  }, [refreshCart, user?.id, user?.restaurantName]);

  useEffect(() => {
    try {
      localStorage.setItem(getFavoriteStorageKey(user?.id), JSON.stringify(favorites));
    } catch (e) {
      console.error('Failed to save favorites:', e);
    }
  }, [favorites, user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(getOrderStorageKey(user?.id), JSON.stringify(orders));
    } catch (e) {
      console.error('Failed to save orders:', e);
    }
  }, [orders, user?.id]);

  const register = async ({ username, email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data?.error || 'Registration failed');
    return data;
  };

  const restaurantRegister = async ({ restaurantName, email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/restaurant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantName, email, password }),
    });

    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data?.error || 'Registration failed');
    return data;
  };

  const saveSession = ({ token, user: nextUser }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
    setFavorites(readArrayFromStorage(getFavoriteStorageKey(nextUser?.id)));
    setOrders(dedupeOrders(readArrayFromStorage(getOrderStorageKey(nextUser?.id))));

    if (nextUser?.id && !nextUser?.restaurantName) {
      refreshCart(nextUser.id).catch(() => setCart([]));
    } else {
      setCart([]);
    }
  };

  const login = async ({ email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data?.error || 'Login failed');
    saveSession(data);
  };

  const restaurantLogin = async ({ email, password }) => {
    const res = await fetch(`${accountServiceBaseUrl}/account/restaurant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(data?.error || 'Login failed');
    saveSession(data);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setCart([]);
    setFavorites([]);
    setOrders([]);
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
        updateCartItem,
        clearCart,
        favorites,
        favoriteCount,
        toggleFavorite,
        removeFavorite,
        isFavorite,
        clearFavorites,
        orders,
        orderCount,
        addOrder,
        addOrdersFromCart,
        clearOrders,
        getCartQuantityForListing,
        getRemainingStockForListing,
        canAddToCart,
        recordPurchasedStock,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
