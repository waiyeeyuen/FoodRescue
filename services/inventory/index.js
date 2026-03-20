import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import {db} from '../firebase/firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const cloudinaryConfigured =
  Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(process.env.CLOUDINARY_API_KEY) &&
  Boolean(process.env.CLOUDINARY_API_SECRET)

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
}

const OUTSYSTEMS_BASE = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

async function readOutsystemsBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!raw) return null;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Continue to fallback parser.
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function fileToDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
}

function toCloudinaryPublicId(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''

  // If it is already a public id-like value, keep it.
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw

  // Convert full Cloudinary delivery URL to public_id to keep payload short.
  const marker = '/image/upload/'
  const markerIndex = raw.indexOf(marker)
  if (markerIndex === -1) return raw

  let pathPart = raw.slice(markerIndex + marker.length)
  const queryIndex = pathPart.indexOf('?')
  if (queryIndex >= 0) pathPart = pathPart.slice(0, queryIndex)

  const versionMatch = pathPart.match(/^v\d+\/(.+)$/)
  const publicIdWithExt = versionMatch ? versionMatch[1] : pathPart
  return publicIdWithExt.replace(/\.[^/.]+$/, '')
}

async function createListing(req, res) {
  try {
    const {
      restaurantId,
      restaurantName,
      itemName,
      description,
      price,
      originalPrice,
      quantity,
      expiryTime,
      imageURL,
      cuisineType,
    } = req.body || {};

    // Basic validation
    // if (!restaurantId || !restaurantName || !itemName) {
    //   return res.status(400).json({ error: 'restaurantId, restaurantName, itemName are required' });
    // }
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'price is required' });
    }
    if (quantity === undefined || quantity === null || Number.isNaN(Number(quantity))) {
      return res.status(400).json({ error: 'quantity is required' });
    }
    if (!expiryTime) {
      return res.status(400).json({ error: 'expiryTime is required' });
    }

    const normalizedRestaurantName = String(restaurantName).trim();
    const normalizedItemName = String(itemName).trim();
    const normalizedExpiryTime = String(expiryTime).trim();
    const normalizedDescription = description === undefined || description === null ? '' : String(description);

    if (!normalizedRestaurantName || !normalizedItemName || !normalizedExpiryTime) {
      return res.status(400).json({ error: 'restaurantName, itemName, expiryTime must be non-empty' });
    }

    const normalizedImageRef = toCloudinaryPublicId(imageURL)

    const params = new URLSearchParams({
      restaurantId: String(restaurantId),
      restaurantName: normalizedRestaurantName,
      itemName: normalizedItemName,
      description: normalizedDescription,
      price: String(Number(price)),
      originalPrice: originalPrice != null && originalPrice !== '' ? String(Number(originalPrice)) : '',
      quantity: String(Number(quantity)),
      expiryTime: normalizedExpiryTime, // e.g. "2026-03-31T23:59:59.938Z"
      imageURL: normalizedImageRef,
      cuisineType: cuisineType ?? '',
    });

    const url = `${OUTSYSTEMS_BASE}/CreateListing?${params.toString()}`;

    const attempts = [];
    const tryRequest = async (method) => {
      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json' },
      });
      const data = await readOutsystemsBody(response);
      attempts.push({ method, status: response.status, url, data });
      return { response, data };
    };

    // OutSystems example uses query params; try GET first.
    {
      const { response, data } = await tryRequest('GET');
      if (response.ok) return res.status(201).json(data);
    }
    {
      const { response, data } = await tryRequest('POST');
      if (response.ok) return res.status(201).json(data);
    }

    return res.status(502).json({
      error: 'OutSystems CreateListing failed',
      attempts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Create a listing (frontend calls this)
app.post('/inventory/listings', createListing);

// Backward-compat alias
app.post('/inventory/createListing', createListing);

// Upload listing image to Cloudinary
app.post('/inventory/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!cloudinaryConfigured) {
      return res.status(500).json({
        error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in services/inventory/.env',
      })
    }

    const imageUrlInput = req.body?.imageUrl ? String(req.body.imageUrl).trim() : ''
    let uploadSource = null

    if (req.file) {
      uploadSource = fileToDataUri(req.file)
    } else if (imageUrlInput) {
      uploadSource = imageUrlInput
    }

    if (!uploadSource) {
      return res.status(400).json({ error: 'image file or imageUrl is required' })
    }

    const shortId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const publicId = `fr/${shortId}`

    const uploadResult = await cloudinary.uploader.upload(uploadSource, {
      public_id: publicId,
      overwrite: false,
      resource_type: 'image',
    })

    return res.status(201).json({
      url: uploadResult.secure_url,
      imageRef: uploadResult.public_id,
      publicId: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Image upload failed' })
  }
})

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
    console.log('restaurantid', restaurantId)
    const response = await fetch(`${OUTSYSTEMS_BASE}/GetListingByRestaurantId?restaurantId=${encodeURIComponent(restaurantId)}`);
    const data = await readOutsystemsBody(response);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch restaurant listings' });
    }
    if (Array.isArray(data)) {
      return res.json(data);
    }
    // OutSystems returns plain-text (e.g. the restaurantId) when there are no listings
    if (typeof data === 'string') {
      return res.json([]);
    }
    return res.json(data ?? []);
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

// Post a new inventory item
app.post("/inventory", async (req, res) => {
  try {
    const { name, quantity, supplier } = req.body;

    if (!name || !quantity || !supplier) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const expiry = new Date(Date.now() + 5 * 60 * 60 * 1000);

    const newItem = {
      name,
      quantity,
      supplier,
      expiry
    };

    const docRef = await INVENTORY.add(newItem);

    res.status(201).json({ id: docRef.id, ...newItem });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an inventory item
app.put("/inventory/:id", async (req, res) => {
  try {
    const docRef = INVENTORY.doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Not found" });
    }

    const { name, quantity, supplier } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (quantity !== undefined) updates.quantity = quantity;
    if (supplier !== undefined) updates.supplier = supplier;

    await docRef.update(updates);
    res.json({ id: req.params.id, ...doc.data(), ...updates });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an inventory item
app.delete("/inventory/:id", async (req, res) => {
  try {
    const docRef = INVENTORY.doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: "Not found" }); 
    }

    await docRef.delete();
    res.json({ message: "Deleted successfully" }); 

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Inventory service running on port ${PORT}`);
});
