import express from 'express'
import cors from 'cors'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const OUTSYSTEMS_BASE = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

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
