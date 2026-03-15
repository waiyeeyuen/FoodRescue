import express from 'express'
import cors from 'cors'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const OUTSYSTEMS_BASE = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

async function createListing(req, res) {
  try {
    const {
      createdAt,
      expiryTime,
      expiryAtUtcSeconds,
      itemName,
      name,
      price,
      quantity,
      supplier,
      restaurantId,
    } = req.body || {};

    const normalizedItemName = itemName || name;
    const normalizedCreatedAt = Number.isFinite(Number(createdAt))
      ? Number(createdAt)
      : Math.floor(Date.now() / 1000);
    const normalizedExpiryTime = Number.isFinite(Number(expiryTime))
      ? Number(expiryTime)
      : Number.isFinite(Number(expiryAtUtcSeconds))
        ? Number(expiryAtUtcSeconds)
        : null;

    const normalizedPrice = Number(price);
    const normalizedQuantity = Number(quantity);

    if (!normalizedItemName || !supplier || !restaurantId) {
      return res.status(400).json({ error: 'restaurantId, name, and supplier are required' });
    }
    if (!Number.isFinite(normalizedPrice) || !Number.isFinite(normalizedQuantity)) {
      return res.status(400).json({ error: 'price and quantity must be numbers' });
    }
    if (!Number.isFinite(normalizedExpiryTime)) {
      return res.status(400).json({ error: 'expiryTime (UTC epoch seconds) is required' });
    }

    const payload = {
      createdAt: Math.floor(normalizedCreatedAt),
      expiryTime: Math.floor(normalizedExpiryTime),
      itemName: normalizedItemName,
      price: normalizedPrice,
      quantity: Math.floor(normalizedQuantity),
      supplier,
      restaurantId,
    };

    const authHeader = req.get('authorization');
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };

    const baseUrls = [
      `${OUTSYSTEMS_BASE}/CreateListing`,
      `${OUTSYSTEMS_BASE}/CreateListing/`,
    ];

    const attempts = [];

    const tryRequest = async (url, init) => {
      const response = await fetch(url, init);
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      attempts.push({ url, method: init.method, status: response.status, data });
      return { response, data };
    };

    // 1) Try POST JSON (typical REST create)
    for (const url of baseUrls) {
      const { response, data } = await tryRequest(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (response.ok) return res.status(201).json(data ?? { ok: true });
    }

    // 2) Fallback: some OutSystems endpoints are configured as GET with query params
    const qs = new URLSearchParams(
      Object.entries(payload).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {})
    ).toString();

    for (const url of baseUrls) {
      const { response, data } = await tryRequest(`${url}?${qs}`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
      });
      if (response.ok) return res.status(201).json(data ?? { ok: true });
    }

    return res.status(502).json({
      error: 'Failed to create listing (upstream)',
      attempts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Create a new listing (preferred)
app.post('/inventory/listings', createListing);

// Backward-compat: older/alternate path
app.post('/inventory/createListing', createListing);

// Get all active listings
app.get('/inventory/active', async (req, res) => {
  try {
    const response = await fetch(`${OUTSYSTEMS_BASE}/GetActiveListing`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch active listings' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get listings by restaurant ID
app.get('/inventory/restaurant/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const response = await fetch(`${OUTSYSTEMS_BASE}/GetListingByRestaurant?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch restaurant listings' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get listings by item name
app.get('/inventory/search/item', async (req, res) => {
  try {
    const { itemName } = req.query;
    if (!itemName) return res.status(400).json({ error: 'itemName is required' });
    const response = await fetch(`${OUTSYSTEMS_BASE}/GetListingByItemName?itemName=${encodeURIComponent(itemName)}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch listings by item name' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get listings by restaurant name
app.get('/inventory/search/restaurant-name', async (req, res) => {
  try {
    const { restaurantName } = req.query;
    if (!restaurantName) return res.status(400).json({ error: 'restaurantName is required' });
    const response = await fetch(`${OUTSYSTEMS_BASE}/GetListingByRestaurantName?restaurantName=${encodeURIComponent(restaurantName)}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch listings by restaurant name' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Inventory service running on port ${PORT}`);
});
