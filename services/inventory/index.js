import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import {db} from '../firebase/firebaseAdmin.js'
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express()
const INVENTORY = db.collection('inventory')
const DELETED_LISTINGS = db.collection('deleted_listings')

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

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

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key]
  }
  return undefined
}

function toSerializableDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toISOString()
}

function buildDeletedListingRecord({
  listingId,
  listingSnapshot,
  deleteSummary,
  deletedByRestaurantId,
  deletedByRestaurantName,
  reason,
}) {
  const listing = listingSnapshot && typeof listingSnapshot === 'object' ? listingSnapshot : {}
  const deletedAt = new Date().toISOString()

  return {
    listingId,
    Id: listingId,
    status: 'deleted',
    restaurantId: String(
      getField(listing, 'restaurantId', 'RestaurantId') || deletedByRestaurantId || ''
    ),
    restaurantName: String(
      getField(listing, 'restaurantName', 'RestaurantName') || deletedByRestaurantName || ''
    ),
    itemName: String(getField(listing, 'itemName', 'ItemName', 'name', 'Name') || ''),
    description: String(getField(listing, 'description', 'Description') || ''),
    price: Number(getField(listing, 'price', 'Price') ?? 0) || 0,
    originalPrice:
      getField(listing, 'originalPrice', 'OriginalPrice') == null
        ? null
        : Number(getField(listing, 'originalPrice', 'OriginalPrice')),
    quantity: Number(getField(listing, 'quantity', 'Quantity') ?? 0) || 0,
    expiryTime: String(getField(listing, 'expiryTime', 'ExpiryTime') || ''),
    imageURL: String(getField(listing, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl') || ''),
    cuisineType: String(getField(listing, 'cuisineType', 'CuisineType') || ''),
    deletedAt,
    deletedReason: String(reason || 'restaurant_removed_listing'),
    deletedByRestaurantId: String(deletedByRestaurantId || ''),
    deletedByRestaurantName: String(deletedByRestaurantName || ''),
    summary: {
      refundedOrders: Number(deleteSummary?.refundedOrders || 0),
      affectedCustomers: Number(deleteSummary?.affectedCustomers || 0),
      totalListingUnits: Number(deleteSummary?.totalListingUnits || 0),
      totalRefundAmount: Number(deleteSummary?.totalRefundAmount || 0),
      notificationsSent: Number(deleteSummary?.notificationsSent || 0),
      notificationsFailed: Number(deleteSummary?.notificationsFailed || 0),
      rewardsRestored: Number(deleteSummary?.rewardsRestored || 0),
      rewardsRestoreFailed: Number(deleteSummary?.rewardsRestoreFailed || 0),
    },
    listing,
  }
}

async function deleteListingInOutSystems(listingId) {
  const url = `${OUTSYSTEMS_BASE}/DeleteFoodListing?listingId=${encodeURIComponent(listingId)}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })

  const data = await readOutsystemsBody(response)

  if (!response.ok) {
    const error = new Error('Failed to delete listing in OutSystems')
    error.status = response.status
    error.data = data
    throw error
  }

  if (data && typeof data === 'object' && data.success === false) {
    const error = new Error(data.message || 'OutSystems rejected the delete request')
    error.status = 502
    error.data = data
    throw error
  }

  return data
}

async function archiveDeletedListing({
  listingId,
  listingSnapshot,
  deleteSummary,
  deletedByRestaurantId,
  deletedByRestaurantName,
  reason,
}) {
  const record = buildDeletedListingRecord({
    listingId,
    listingSnapshot,
    deleteSummary,
    deletedByRestaurantId,
    deletedByRestaurantName,
    reason,
  })

  await DELETED_LISTINGS.doc(String(listingId)).set(record, { merge: true })
  return record
}

function fileToDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
}

// function toCloudinaryPublicId(value) {
//   if (!value) return ''
//   const raw = String(value).trim()
//   if (!raw) return ''

//   // If it is already a public id-like value, keep it.
//   if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw

//   // Convert full Cloudinary delivery URL to public_id to keep payload short.
//   const marker = '/image/upload/'
//   const markerIndex = raw.indexOf(marker)
//   if (markerIndex === -1) return raw

//   let pathPart = raw.slice(markerIndex + marker.length)
//   const queryIndex = pathPart.indexOf('?')
//   if (queryIndex >= 0) pathPart = pathPart.slice(0, queryIndex)

//   const versionMatch = pathPart.match(/^v\d+\/(.+)$/)
//   const publicIdWithExt = versionMatch ? versionMatch[1] : pathPart
//   return publicIdWithExt.replace(/\.[^/.]+$/, '')
// }

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

    console.log(" Incoming Listing request:");
    console.log({
      restaurantId,
      restaurantName,
      itemName,
      price,
      quantity,
      expiryTime,
      imageURL,
    });

    const normalizedImageRef = imageURL
  ? imageURL.split('/').pop()
  : '';

    console.log("Normalized imageURL:", normalizedImageRef);

    const params = new URLSearchParams({
      restaurantId: String(restaurantId),
      restaurantName: String(restaurantName).trim(),
      itemName: String(itemName).trim(),
      description: description ?? '',
      price: String(Number(price)),
      originalPrice: originalPrice != null ? String(Number(originalPrice)) : '',
      quantity: String(Number(quantity)),
      expiryTime: String(expiryTime),
      imageURL: normalizedImageRef,
      cuisineType: cuisineType ?? '',
    });

    const url = `${OUTSYSTEMS_BASE}/CreateListing?${params.toString()}`;

    console.log("OutSystems URL:", url);

    const attempts = [];

    const tryRequest = async (method) => {
      console.log(`Trying ${method} request to OutSystems...`);

      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json' },
      });

      const data = await readOutsystemsBody(response);

      console.log(`OutSystems ${method} response:`, {
        status: response.status,
        data,
      });

      attempts.push({ method, status: response.status, data });

      return { response, data };
    };

    {
      const { response, data } = await tryRequest('GET');
      if (response.ok) {
        console.log("GET succeeded");
        return res.status(201).json(data);
      }
    }

    {
      const { response, data } = await tryRequest('POST');
      if (response.ok) {
        console.log("POST succeeded");
        return res.status(201).json(data);
      }
    }

    console.error("OutSystems failed:", attempts);

    return res.status(502).json({
      error: 'OutSystems CreateListing failed',
      attempts,
    });

  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// Create a listing (frontend calls this)
app.post('/inventory/listings', createListing);

// Backward-compat alias
app.post('/inventory/createListing', createListing);

app.post('/inventory/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image is required' });
    }

    const file = req.file;

    const fileName = `foods/${Date.now()}-${file.originalname}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3.send(command);

    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    return res.status(201).json({
  key: fileName,  
  url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`, // for preview only
});

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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

app.get('/inventory/restaurant/:restaurantId/deleted', async (req, res) => {
  try {
    const { restaurantId } = req.params
    const snapshot = await DELETED_LISTINGS.where('restaurantId', '==', String(restaurantId)).get()

    const deletedListings = snapshot.docs
      .map((doc) => {
        const data = doc.data() || {}
        return {
          id: doc.id,
          ...data,
          listingId: String(data.listingId || data.Id || doc.id),
          Id: String(data.Id || data.listingId || doc.id),
          deletedAt: toSerializableDate(data.deletedAt),
        }
      })
      .sort((a, b) => {
        const aTime = a.deletedAt ? new Date(a.deletedAt).getTime() : 0
        const bTime = b.deletedAt ? new Date(b.deletedAt).getTime() : 0
        return bTime - aTime
      })

    return res.json(deletedListings)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

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

app.delete('/inventory/listings/:id', async (req, res) => {
  try {
    const listingId = String(req.params.id || '').trim()
    if (!listingId) {
      return res.status(400).json({ error: 'listing id is required' })
    }

    const {
      listing = null,
      summary = null,
      restaurantId = '',
      restaurantName = '',
      reason = 'restaurant_removed_listing',
    } = req.body || {}

    const outsystemsResponse = await deleteListingInOutSystems(listingId)

    let deletedListing = null
    let archiveWarning = null

    try {
      deletedListing = await archiveDeletedListing({
        listingId,
        listingSnapshot: listing,
        deleteSummary: summary,
        deletedByRestaurantId: restaurantId,
        deletedByRestaurantName: restaurantName,
        reason,
      })
    } catch (archiveError) {
      archiveWarning = archiveError.message || 'Failed to archive deleted listing'
      console.warn('[inventory] Listing deleted, but archive write failed:', archiveWarning)
    }

    return res.json({
      success: true,
      message: 'Deleted successfully',
      listingId,
      deletedListing,
      archiveStored: Boolean(deletedListing),
      archiveWarning,
      outsystemsResponse,
    })
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message,
      details: err.data || null,
    })
  }
})

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
