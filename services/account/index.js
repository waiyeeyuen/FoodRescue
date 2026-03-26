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

// Get a user account by ID
app.get('/account/:id', async (req, res) => {
  try {
    const doc = await USERS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { password, ...safeData } = doc.data(); // Exclude password from response

    res.json({ id: doc.id, ...safeData });

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

// CART: Get cart for a user
app.get('/account/:id/cart', async (req, res) => {
  try {
    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const data = doc.data() || {};
    const cart = Array.isArray(data.cart) ? data.cart : [];
    res.json({ cart });
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

    const qty = Number(quantity ?? req.body?.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    const data = doc.data() || {};
    const cart = Array.isArray(data.cart) ? data.cart.slice() : [];

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
    const cart = Array.isArray(data.cart) ? data.cart : [];
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

    const data = doc.data() || {};
    const cart = Array.isArray(data.cart) ? data.cart.slice() : [];
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
