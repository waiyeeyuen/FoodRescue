import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
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

function getFavoriteStorageKey(userId) {
  return userId ? `favorites_${userId}` : 'favorites_guest';
}

function initializeFavoritesFromStorage(userId) {
  try {
    const saved = localStorage.getItem(getFavoriteStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to parse favorites from storage:', e);
    return [];
  }
}

function getOrderStorageKey(userId) {
  return userId ? `orders_${userId}` : 'orders_guest';
}

function initializeOrdersFromStorage(userId) {
  try {
    const saved = localStorage.getItem(getOrderStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to parse orders from storage:', e);
    return [];
  }
}

function getStockStorageKey(userId) {
  return userId ? `listing_stock_${userId}` : 'listing_stock_guest';
}

function initializeStockOverridesFromStorage(userId) {
  try {
    const saved = localStorage.getItem(getStockStorageKey(userId));
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to parse stock overrides from storage:', e);
    return {};
  }
}

function getListingKey(item, fallback = 'listing') {
  const id =
    item?.Id ??
    item?.id ??
    item?.listingId ??
    item?.ListingId;

  if (id !== undefined && id !== null) return String(id);

  const itemName =
    item?.itemName ??
    item?.ItemName ??
    item?.name ??
    item?.Name ??
    fallback;

  const restaurantId =
    item?.restaurantId ??
    item?.RestaurantId ??
    'restaurant';

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

function getItemBaseStock(item, cartItem) {
  const candidates = [
    cartItem?.baseStock,
    cartItem?.originalStock,
    cartItem?.listingStock,
    cartItem?.availableStockBeforePurchase,
    item?.baseStock,
    item?.originalStock,
    item?.listingStock,
    item?.availableStockBeforePurchase,
    item?.__baseStock,
    item?.__listingStock,
    item?.quantity,
    item?.Quantity,
    item?.stock,
    item?.Stock,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function normalizeListingItem(rawItem, fallbackQuantity) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};

  const existingQty = getItemStock(item);
  const fallbackQtyNum = Number(fallbackQuantity);
  const resolvedQty =
    existingQty > 0
      ? existingQty
      : Number.isFinite(fallbackQtyNum) && fallbackQtyNum >= 0
        ? fallbackQtyNum
        : 0;

  return {
    ...item,
    quantity: resolvedQty,
    __baseStock:
      Number(item?.__baseStock) > 0
        ? Number(item.__baseStock)
        : resolvedQty,
  };
}

function normalizeCartEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      item: normalizeListingItem({}, 0),
      quantity: 0,
      pickupTime: '',
    };
  }

  const rawQuantity = Number(entry?.quantity ?? 0);
  const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 0;

  const rawItem = entry?.item && typeof entry.item === 'object' ? entry.item : entry;
  const item = normalizeListingItem(rawItem, getItemBaseStock(rawItem, entry));

  return {
    ...entry,
    item,
    quantity,
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
    const key =
      order?.lineKey ||
      buildOrderLineKey({
        orderId: order?.orderId || 'unknown-order',
        item: order?.item || {},
        pickupTime: order?.pickupTime || '',
        index: i,
      });

    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      ...order,
      lineKey: key,
    });
  }

  return result;
}

export function AuthProvider({ children }) {
  const initialUser = initializeUserFromStorage();

  const [user, setUser] = useState(() => initialUser);
  const [cart, setCart] = useState([]);
  const [cartLoading, setCartLoading] = useState(false);
  const [favorites, setFavorites] = useState(() =>
    initializeFavoritesFromStorage(initialUser?.id)
  );
  const [orders, setOrders] = useState(() =>
    dedupeOrders(initializeOrdersFromStorage(initialUser?.id))
  );
  const [stockOverrides, setStockOverrides] = useState(() =>
    initializeStockOverridesFromStorage(initialUser?.id)
  );

  const accountServiceBaseUrl = normalizeServiceBaseUrl(
    import.meta.env.VITE_ACCOUNT_SERVICE_URL || 'http://localhost:3001',
    'account'
  );

  const cartCount = useMemo(() => {
    return (cart || []).reduce((sum, item) => {
      const qty = Number(item?.quantity ?? 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
  }, [cart]);

  const favoriteCount = useMemo(() => favorites.length, [favorites]);
  const orderCount = useMemo(() => orders.length, [orders]);

  const getCartQuantityForListing = useCallback(
    (itemOrId) => {
      const listingKey =
        typeof itemOrId === 'string' ? itemOrId : getListingKey(itemOrId);

      return (cart || []).reduce((sum, cartItem) => {
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
      const key = getListingKey(item);
      const baseStock = getItemStock(item);

      const overriddenStock =
        stockOverrides[key] !== undefined && stockOverrides[key] !== null
          ? Number(stockOverrides[key])
          : baseStock;

      const safeOverriddenStock = Number.isFinite(overriddenStock) ? overriddenStock : 0;
      const currentCartQty = getCartQuantityForListing(item);

      return Math.max(0, safeOverriddenStock - currentCartQty);
    },
    [stockOverrides, getCartQuantityForListing]
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

        const nextCart = Array.isArray(data?.cart)
          ? data.cart.map(normalizeCartEntry)
          : [];

        setCart(nextCart);
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
      if (remaining <= 0) {
        throw new Error('This listing is fully reserved or sold out');
      }
      throw new Error(`You can only add ${remaining} more for this listing`);
    }

    const safeItem = normalizeListingItem(item, getItemStock(item));

    const payload = {
      item: {
        ...safeItem,
        __baseStock: Number(safeItem?.__baseStock ?? getItemStock(safeItem)),
      },
      quantity: qtyToAdd,
      pickupTime,
    };

    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

    const nextCart = Array.isArray(data?.cart)
      ? data.cart.map(normalizeCartEntry)
      : [];

    const totalForListing = nextCart.reduce((sum, cartItem) => {
      const sameListing =
        getListingKey(cartItem?.item || {}) === getListingKey(safeItem);
      if (!sameListing) return sum;
      return sum + Number(cartItem?.quantity ?? 0);
    }, 0);

    const allowedStock =
      stockOverrides[getListingKey(safeItem)] !== undefined
        ? Number(stockOverrides[getListingKey(safeItem)])
        : getItemStock(safeItem);

    if (totalForListing > allowedStock) {
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

    const nextCart = Array.isArray(data?.cart)
      ? data.cart.map(normalizeCartEntry)
      : [];

    setCart(nextCart);
    return data;
  };

  const clearCart = async () => {
    if (!user?.id) throw new Error('Not logged in');
    if (user?.restaurantName) throw new Error('Cart is only available for users');

    const res = await fetch(
      `${accountServiceBaseUrl}/account/${encodeURIComponent(user.id)}/cart/clear`,
      {
        method: 'POST',
      }
    );

    const data = await readResponseBody(res);

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : null) ||
        `Failed to clear cart (${res.status})`;
      throw new Error(message);
    }

    const nextCart = Array.isArray(data?.cart)
      ? data.cart.map(normalizeCartEntry)
      : [];

    setCart(nextCart);
    return data;
  };

  const isFavorite = (itemOrId) => {
    const key =
      typeof itemOrId === 'string'
        ? itemOrId
        : getListingKey(itemOrId);

    return favorites.some((fav) => getListingKey(fav) === key);
  };

  const toggleFavorite = (item) => {
    const key = getListingKey(item);

    setFavorites((prev) => {
      const exists = prev.some((fav) => getListingKey(fav) === key);
      if (exists) {
        return prev.filter((fav) => getListingKey(fav) !== key);
      }
      return [...prev, item];
    });
  };

  const removeFavorite = (itemOrId) => {
    const key =
      typeof itemOrId === 'string'
        ? itemOrId
        : getListingKey(itemOrId);

    setFavorites((prev) =>
      prev.filter((fav) => getListingKey(fav) !== key)
    );
  };

  const clearFavorites = () => {
    setFavorites([]);
  };

  const addOrder = async (order) => {
    if (!order) return null;

    const normalizedItem = normalizeListingItem(
      order?.item || {},
      getItemStock(order?.item || {})
    );

    const normalized = {
      ...order,
      item: normalizedItem,
      quantity: Number(order?.quantity ?? 1) || 1,
      createdAt: order?.createdAt || new Date().toISOString(),
      status: order?.status || 'Active',
      lineKey:
        order?.lineKey ||
        buildOrderLineKey({
          orderId: order?.orderId || `ORD-${Date.now()}`,
          item: normalizedItem,
          pickupTime: order?.pickupTime || '',
          index: 0,
        }),
    };

    setOrders((prev) => {
      const nextOrders = dedupeOrders([normalized, ...prev]);

      try {
        localStorage.setItem(
          getOrderStorageKey(user?.id),
          JSON.stringify(nextOrders)
        );
      } catch (e) {
        console.error('Failed to save orders to storage:', e);
      }

      return nextOrders;
    });

    return normalized;
  };

  const addOrdersFromCart = async ({ items, pickupTime, orderId }) => {
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('addOrdersFromCart: no items received', items);
      return [];
    }

    const createdAt = new Date().toISOString();
    const resolvedOrderId = orderId || `ORD-${Date.now()}`;

    const normalizedOrders = items
      .map((rawCartItem, index) => {
        const cartItem = normalizeCartEntry(rawCartItem);
        const sourceItem =
          cartItem?.item && typeof cartItem.item === 'object'
            ? cartItem.item
            : rawCartItem?.item && typeof rawCartItem.item === 'object'
              ? rawCartItem.item
              : rawCartItem;

        const normalizedItem = normalizeListingItem(
          sourceItem,
          getItemBaseStock(sourceItem, rawCartItem)
        );

        const quantity = Number(cartItem?.quantity ?? rawCartItem?.quantity ?? 0);
        const resolvedPickupTime =
          cartItem?.pickupTime || rawCartItem?.pickupTime || pickupTime || '';

        if (!sourceItem || !Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }

        return {
          orderId: resolvedOrderId,
          lineKey: buildOrderLineKey({
            orderId: resolvedOrderId,
            item: normalizedItem,
            pickupTime: resolvedPickupTime,
            index,
          }),
          createdAt,
          pickupTime: resolvedPickupTime,
          status: 'Active',
          item: normalizedItem,
          quantity,
        };
      })
      .filter(Boolean);

    if (!normalizedOrders.length) {
      console.warn('addOrdersFromCart: normalized orders empty', items);
      return [];
    }

    setOrders((prev) => {
      const nextOrders = dedupeOrders([...normalizedOrders, ...prev]);

      try {
        localStorage.setItem(
          getOrderStorageKey(user?.id),
          JSON.stringify(nextOrders)
        );
      } catch (e) {
        console.error('Failed to save orders to storage:', e);
      }

      console.log('Orders saved:', nextOrders);
      return nextOrders;
    });

    return normalizedOrders;
  };

  const recordPurchasedStock = async (items) => {
    if (!Array.isArray(items) || items.length === 0) return;

    setStockOverrides((prev) => {
      const next = { ...prev };

      for (const rawCartItem of items) {
        const cartItem = normalizeCartEntry(rawCartItem);
        const item = cartItem?.item || {};
        const key = getListingKey(item);
        const purchasedQty = Number(cartItem?.quantity ?? 1);

        if (!Number.isFinite(purchasedQty) || purchasedQty <= 0) continue;

        const currentStock =
          next[key] !== undefined && next[key] !== null
            ? Number(next[key])
            : Math.max(
                getItemBaseStock(item, cartItem),
                getItemStock(item),
                purchasedQty
              );

        const safeCurrentStock = Number.isFinite(currentStock) ? currentStock : 0;
        const nextStock = Math.max(0, safeCurrentStock - purchasedQty);

        next[key] = nextStock;
      }

      return next;
    });
  };

  const clearOrders = () => {
    setOrders([]);

    try {
      localStorage.removeItem(getOrderStorageKey(user?.id));
    } catch (e) {
      console.error('Failed to clear orders from storage:', e);
    }
  };

  useEffect(() => {
    if (!user?.id || user?.restaurantName) {
      setCart([]);
      return;
    }

    refreshCart(user.id).catch(() => {
      setCart([]);
    });
  }, [user?.id, user?.restaurantName, refreshCart]);

  useEffect(() => {
    setFavorites(initializeFavoritesFromStorage(user?.id));
    setOrders(dedupeOrders(initializeOrdersFromStorage(user?.id)));
    setStockOverrides(initializeStockOverridesFromStorage(user?.id));
  }, [user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getFavoriteStorageKey(user?.id),
        JSON.stringify(favorites)
      );
    } catch (e) {
      console.error('Failed to save favorites to storage:', e);
    }
  }, [favorites, user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getOrderStorageKey(user?.id),
        JSON.stringify(dedupeOrders(orders))
      );
    } catch (e) {
      console.error('Failed to save orders to storage:', e);
    }
  }, [orders, user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getStockStorageKey(user?.id),
        JSON.stringify(stockOverrides)
      );
    } catch (e) {
      console.error('Failed to save stock overrides to storage:', e);
    }
  }, [stockOverrides, user?.id]);

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

  const saveSession = ({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
    setFavorites(initializeFavoritesFromStorage(user?.id));
    setOrders(dedupeOrders(initializeOrdersFromStorage(user?.id)));
    setStockOverrides(initializeStockOverridesFromStorage(user?.id));

    if (user?.id) {
      refreshCart(user.id).catch(() => setCart([]));
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
    setStockOverrides({});
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
        stockOverrides,
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