import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import admin, { db } from '../firebase/firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const USERS = db.collection('users')
const RESTAURANTS = db.collection('restaurants')
const JWT_SECRET = process.env.JWT_SECRET || 'foodrescue-secret' // Use env variable in production

function createDefaultUserImpact() {
  return {
    mealsRescued: 0,
    co2KgSaved: 0,
    waterLitersSaved: 0,
    moneySaved: 0,
    daysSaved: 0,
    completedDayKeys: [],
    lastSuccessfulOrderAt: null,
    leaderboardEligible: true
  };
}

function createDefaultRestaurantImpact() {
  return {
    mealsRescued: 0,
    co2KgSaved: 0,
    waterLitersSaved: 0,
    revenueRecovered: 0,
    ordersFulfilled: 0,
    repeatCustomers: 0,
    daysSaved: 0,
    completedDayKeys: [],
    lastSuccessfulOrderAt: null,
    leaderboardEligible: true
  };
}

function normalizeImpact(impact, defaultsFactory) {
  const safeImpact = impact && typeof impact === 'object' ? impact : {};
  const defaults = defaultsFactory();

  return {
    ...defaults,
    ...safeImpact,
    daysSaved: Number(
      safeImpact.daysSaved ??
      safeImpact.currentStreakDays ??
      defaults.daysSaved ??
      0
    ) || 0,
    completedDayKeys: Array.isArray(safeImpact.completedDayKeys)
      ? [...new Set(safeImpact.completedDayKeys.map((key) => String(key).trim()).filter(Boolean))]
      : [],
    leaderboardEligible:
      safeImpact.leaderboardEligible === undefined
        ? defaults.leaderboardEligible
        : Boolean(safeImpact.leaderboardEligible)
  };
}

function buildLegacyImpactFields(safeData, impact) {
  return {
    co2: Number(safeData.co2 ?? impact.co2KgSaved ?? 0) || 0,
    water: Number(safeData.water ?? impact.waterLitersSaved ?? 0) || 0,
    days: Number(safeData.days ?? impact.daysSaved ?? 0) || 0,
  };
}

async function ensureLegacyImpactFields(docRef, safeData, impact) {
  const updates = {};

  if (safeData.co2 === undefined) updates.co2 = Number(impact.co2KgSaved || 0) || 0;
  if (safeData.water === undefined) updates.water = Number(impact.waterLitersSaved || 0) || 0;
  if (safeData.days === undefined) updates.days = Number(impact.daysSaved || 0) || 0;

  if (Object.keys(updates).length === 0) return;

  await docRef.set(updates, { merge: true });
}

function sanitizeAccountDocument(doc, defaultsFactory) {
  const data = doc.data() || {};
  const { password, ...safeData } = data;
  const impact = normalizeImpact(
    {
      ...(safeData.impact && typeof safeData.impact === 'object' ? safeData.impact : {}),
      co2KgSaved:
        safeData?.impact?.co2KgSaved ??
        safeData.co2 ??
        0,
      waterLitersSaved:
        safeData?.impact?.waterLitersSaved ??
        safeData.water ??
        0,
      daysSaved:
        safeData?.impact?.daysSaved ??
        safeData.days ??
        0,
    },
    defaultsFactory
  );
  const legacyImpactFields = buildLegacyImpactFields(safeData, impact);

  return {
    id: doc.id,
    ...safeData,
    ...legacyImpactFields,
    city: typeof safeData.city === 'string' ? safeData.city : '',
    impact
  };
}

function sanitizeLeaderboardValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildMetricLeaderboard(entries, metric, limit, currentUserId = '') {
  const sorted = [...entries].sort((a, b) => {
    const delta =
      sanitizeLeaderboardValue(b?.impact?.[metric]) -
      sanitizeLeaderboardValue(a?.impact?.[metric]);

    if (delta !== 0) return delta;
    return String(a?.username || '').localeCompare(String(b?.username || ''));
  });

  const top = sorted.slice(0, limit).map((entry, index) => ({
    rank: index + 1,
    userId: entry.id,
    username: entry.username || `User ${index + 1}`,
    value: sanitizeLeaderboardValue(entry?.impact?.[metric]),
  }));

  const currentUserIndex = currentUserId
    ? sorted.findIndex((entry) => entry.id === String(currentUserId))
    : -1;

  const currentUser =
    currentUserIndex >= 0
      ? {
          rank: currentUserIndex + 1,
          userId: sorted[currentUserIndex].id,
          username: sorted[currentUserIndex].username || 'You',
          value: sanitizeLeaderboardValue(sorted[currentUserIndex]?.impact?.[metric]),
        }
      : null;

  return { top, currentUser };
}

// Register a new user account
app.post('/account/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' }); // All fields are required
    }

    // Check if email is already registered
    const existing = await USERS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Hash password before storing

    const newUser = {
      username,
      email,
      password: hashedPassword,
      cart: [],
      city: '',
      co2: 0,
      water: 0,
      days: 0,
      impact: createDefaultUserImpact(),
      createdAt: new Date()
    };

    const docRef = await USERS.add(newUser);

    // Return token so the user is immediately logged in after registering
    const token = jwt.sign({ id: docRef.id, email, username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: docRef.id, username, email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new restaurant account
app.post('/account/restaurant/register', async (req, res) => {
  try {
    const { restaurantName, email, password } = req.body;

    if (!restaurantName || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Check if email is already registered
    const existing = await RESTAURANTS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newRestaurant = {
      restaurantName,
      email,
      password: hashedPassword,
      cart: [],
      city: '',
      co2: 0,
      water: 0,
      days: 0,
      impact: createDefaultRestaurantImpact(),
      createdAt: new Date()
    };

    const docRef = await RESTAURANTS.add(newRestaurant);

    const token = jwt.sign({ id: docRef.id, email, restaurantName }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: docRef.id, restaurantName, email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing user account
app.post('/account/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Find user by email
    const snapshot = await USERS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' }); // Generic message to avoid enumeration
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    const passwordMatch = await bcrypt.compare(password, user.password); // Verify hashed password
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign JWT with user identity
    const token = jwt.sign(
      { id: doc.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: doc.id, username: user.username, email: user.email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing restaurant account
app.post('/account/restaurant/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Find restaurant by email
    const snapshot = await RESTAURANTS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const doc = snapshot.docs[0];
    const restaurant = doc.data();

    const passwordMatch = await bcrypt.compare(password, restaurant.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign JWT with restaurant identity
    const token = jwt.sign(
      { id: doc.id, email: restaurant.email, restaurantName: restaurant.restaurantName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: doc.id, restaurantName: restaurant.restaurantName, email: restaurant.email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USER LEADERBOARDS
app.get('/account/leaderboards/users', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(25, Number(req.query.limit ?? 10) || 10));
    const currentUserId = String(req.query.userId || '').trim();

    const snapshot = await USERS.get();
    const users = snapshot.docs.map((doc) => sanitizeAccountDocument(doc, createDefaultUserImpact));

    const co2KgSaved = buildMetricLeaderboard(users, 'co2KgSaved', limit, currentUserId);
    const waterLitersSaved = buildMetricLeaderboard(users, 'waterLitersSaved', limit, currentUserId);

    res.json({
      success: true,
      limit,
      leaderboards: {
        co2KgSaved,
        waterLitersSaved,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a user account by ID
app.get('/account/:id', async (req, res) => {
  try {
    const doc = await USERS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawData = doc.data() || {};
    const safeDoc = sanitizeAccountDocument(doc, createDefaultUserImpact);
    await ensureLegacyImpactFields(USERS.doc(req.params.id), rawData, safeDoc.impact);
    res.json(safeDoc);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a restaurant account by ID
app.get('/account/restaurant/:id', async (req, res) => {
  try {
    const doc = await RESTAURANTS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawData = doc.data() || {};
    const safeDoc = sanitizeAccountDocument(doc, createDefaultRestaurantImpact);
    await ensureLegacyImpactFields(RESTAURANTS.doc(req.params.id), rawData, safeDoc.impact);
    res.json(safeDoc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeCartItem(input) {
  const listingId =
    input?.listingId ||
    input?.ListingId ||
    input?.id ||
    input?.Id ||
    input?.listing_id ||
    input?.listingID;

  const itemName = input?.itemName || input?.ItemName || input?.name || input?.Name;
  const restaurantId = input?.restaurantId || input?.RestaurantId;
  const restaurantName = input?.restaurantName || input?.RestaurantName;
  const imageURL = input?.imageURL || input?.ImageURL || input?.imageUrl || input?.ImageUrl || '';
  const expiryTime = input?.expiryTime || input?.ExpiryTime || '';
  const cuisineType = input?.cuisineType || input?.CuisineType || '';

  const priceRaw = input?.price ?? input?.Price ?? 0;
  const price = Number(priceRaw);

  return {
    listingId: String(listingId || ''),
    itemName: String(itemName || ''),
    restaurantId: restaurantId ? String(restaurantId) : '',
    restaurantName: restaurantName ? String(restaurantName) : '',
    imageURL: imageURL ? String(imageURL) : '',
    expiryTime: expiryTime ? String(expiryTime) : '',
    cuisineType: cuisineType ? String(cuisineType) : '',
    price: Number.isFinite(price) ? price : 0
  };
}

function isExpiredCartItem(item) {
  const expiryTime = item?.expiryTime || item?.ExpiryTime || '';
  if (!expiryTime) return false;

  const expiryDate = new Date(expiryTime);
  if (Number.isNaN(expiryDate.getTime())) return false;

  return expiryDate.getTime() <= Date.now();
}

function sanitizeCart(cart) {
  const safeCart = Array.isArray(cart) ? cart : [];
  return safeCart.filter((item) => !isExpiredCartItem(item));
}

async function updateCartIfSanitized(docRef, cart, sanitizedCart) {
  if (sanitizedCart.length === cart.length) return;

  await docRef.update({
    cart: sanitizedCart,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// CART: Get cart for a user
app.get('/account/:id/cart', async (req, res) => {
  try {
    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const data = doc.data() || {};
    const cart = Array.isArray(data.cart) ? data.cart : [];
    const sanitizedCart = sanitizeCart(cart);

    await updateCartIfSanitized(docRef, cart, sanitizedCart);
    res.json({ cart: sanitizedCart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CART: Add item (merge by listingId)
app.post('/account/:id/cart/items', async (req, res) => {
  try {
    const { item, quantity, pickupTime } = req.body || {};
    const normalized = normalizeCartItem(item || req.body);

    if (!normalized.listingId) {
      return res.status(400).json({ error: 'listingId is required' });
    }
    if (isExpiredCartItem(normalized)) {
      return res.status(400).json({ error: 'This listing has expired' });
    }

    const qty = Number(quantity ?? req.body?.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart.slice() : []);

    const idx = cart.findIndex(
      (c) => String(c?.listingId || '') === String(normalized.listingId)
    );

    const pickup = pickupTime ?? req.body?.pickup_time ?? '';

    if (idx >= 0) {
      const existing = cart[idx] || {};
      const existingQty = Number(existing.quantity ?? 0);
      cart[idx] = {
        ...existing,
        ...normalized,
        quantity: (Number.isFinite(existingQty) ? existingQty : 0) + qty,
        pickupTime: pickup ? String(pickup) : (existing.pickupTime || ''),
        updatedAt: new Date().toISOString()
      };
    } else {
      cart.push({
        ...normalized,
        quantity: qty,
        pickupTime: pickup ? String(pickup) : '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await docRef.update({
      cart,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CART: Remove item by listingId
app.delete('/account/:id/cart/items/:listingId', async (req, res) => {
  try {
    const { id, listingId } = req.params;
    const docRef = USERS.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart : []);
    const filtered = cart.filter(
      (c) => String(c?.listingId || '') !== String(listingId)
    );

    await docRef.update({
      cart: filtered,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ cart: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CART: Update an existing cart item by listingId
app.put('/account/:id/cart/items/:listingId', async (req, res) => {
  try {
    const { id, listingId } = req.params;
    const { quantity, pickupTime, item } = req.body || {};

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const docRef = USERS.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    if (item && isExpiredCartItem(normalizeCartItem(item))) {
      return res.status(400).json({ error: 'This listing has expired' });
    }

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart.slice() : []);
    const idx = cart.findIndex(
      (c) => String(c?.listingId || '') === String(listingId)
    );

    if (idx < 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    const existing = cart[idx] || {};
    const normalized = item ? normalizeCartItem(item) : {};

    cart[idx] = {
      ...existing,
      ...normalized,
      listingId: String(existing?.listingId || listingId),
      quantity: qty,
      pickupTime:
        pickupTime !== undefined && pickupTime !== null
          ? String(pickupTime)
          : String(existing?.pickupTime || ''),
      updatedAt: new Date().toISOString()
    };

    await docRef.update({
      cart,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CART: Clear cart
app.post('/account/:id/cart/clear', async (req, res) => {
  try {
    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    await docRef.update({
      cart: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ cart: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Account service running on port ${PORT}`);
});
