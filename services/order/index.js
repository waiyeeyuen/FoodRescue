import express from 'express'
import cors from 'cors'
import admin, { db } from './firebaseAdmin.js'

const app = express()
const USERS = db.collection('users')
const RESTAURANTS = db.collection('restaurants')
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ||
  process.env.NOTIFICATION_URL ||
  'http://notification:3006'
const IMPACT_CO2_PER_MEAL = 1.1
const IMPACT_WATER_PER_MEAL = 81
const IMPACT_TIMEZONE = 'Asia/Singapore'

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions))
app.use(express.json())

const ORDERS = db.collection('orders')

function generateOrderId() {
  return 'ORD_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

function validateOrderData(data) {
  const errors = [];
  if (!data.customerId) errors.push('customerId is required');
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    errors.push('items array is required and must not be empty');
  }
  if (typeof data.totalPrice !== 'number' || data.totalPrice < 0) {
    errors.push('totalPrice must be a non-negative number');
  }
  return errors;
}

function toSerializableDate(value) {
  return value?.toDate?.() || value;
}

function toDateMs(value) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function toMajorUnits(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (Number.isInteger(numeric) && numeric > 100) return numeric / 100
  return numeric
}

function getItemField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function normalizeItemStatus(value, fallback = 'new') {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (['new', 'ready', 'preparing', 'completed', 'cancelled', 'canceled', 'refunded'].includes(normalized)) {
    if (normalized === 'preparing') return 'ready'
    return normalized === 'canceled' ? 'cancelled' : normalized;
  }
  return fallback;
}

function normalizeStoredItem(item, orderStatus = 'pending_payment') {
  const fallbackStatus = orderStatus === 'confirmed' ? 'new' : 'pending';
  return {
    ...item,
    itemId: getItemField(item, 'itemId', 'listingId', 'id', 'Id') ?? '',
    restaurantId: String(getItemField(item, 'restaurantId', 'RestaurantId') || ''),
    restaurantName: String(getItemField(item, 'restaurantName', 'RestaurantName') || ''),
    pickupTime: String(getItemField(item, 'pickupTime', 'PickupTime') || ''),
    fulfillmentStatus: normalizeItemStatus(
      getItemField(item, 'fulfillmentStatus', 'FulfillmentStatus'),
      fallbackStatus
    )
  };
}

function matchesRestaurantItem(item, restaurantId, restaurantName = '') {
  const itemRestaurantId = String(getItemField(item, 'restaurantId', 'RestaurantId') || '');
  const itemRestaurantName = String(getItemField(item, 'restaurantName', 'RestaurantName') || '');

  if (restaurantId && itemRestaurantId && itemRestaurantId === String(restaurantId)) {
    return true;
  }

  if (
    restaurantName &&
    itemRestaurantName &&
    itemRestaurantName.trim().toLowerCase() === String(restaurantName).trim().toLowerCase()
  ) {
    return true;
  }

  return false;
}

function toRestaurantOrderRow(order, item) {
  return {
    orderId: order.orderId,
    customerId: order.customerId,
    totalPrice: order.totalPrice,
    currency: order.currency || 'sgd',
    orderStatus: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    item: {
      ...item,
      itemId: getItemField(item, 'itemId', 'listingId', 'id', 'Id') ?? '',
      restaurantId: String(getItemField(item, 'restaurantId', 'RestaurantId') || ''),
      restaurantName: String(getItemField(item, 'restaurantName', 'RestaurantName') || ''),
      pickupTime: String(getItemField(item, 'pickupTime', 'PickupTime') || ''),
      fulfillmentStatus: normalizeItemStatus(
        getItemField(item, 'fulfillmentStatus', 'FulfillmentStatus'),
        order.status === 'completed' ? 'completed' : 'new'
      )
    }
  };
}

function isOrderCompleted(items) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return false;
  return safeItems.every((item) => normalizeItemStatus(item?.fulfillmentStatus, 'new') === 'completed');
}

function getSingaporeDayKey(value) {
  const parsed = value ? new Date(value) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: IMPACT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IMPACT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed)
}

function getEstimatedMoneySaved(item) {
  const quantity = toPositiveNumber(item?.quantity, 1)
  const originalPrice = toMajorUnits(getItemField(item, 'originalPrice', 'OriginalPrice'))
  const unitAmount = toMajorUnits(getItemField(item, 'unitAmount', 'price', 'Price'))

  if (!Number.isFinite(originalPrice) || !Number.isFinite(unitAmount) || originalPrice <= unitAmount) {
    return 0
  }

  return Number(((originalPrice - unitAmount) * quantity).toFixed(2))
}

function fireAndForgetNotification(body) {
  fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.warn('[order] Notification fire-and-forget failed:', err.message)
  })
}

async function applyCompletedPickupImpact({ order, item, completedAt }) {
  const customerId = String(order?.customerId || '')
  const restaurantId = String(getItemField(item, 'restaurantId', 'RestaurantId') || '')
  const quantity = Math.max(1, Math.floor(toPositiveNumber(item?.quantity, 1)))
  const completedDayKey = getSingaporeDayKey(completedAt?.toISOString?.() || completedAt)
  const moneySaved = getEstimatedMoneySaved(item)
  const paidAmount =
    toMajorUnits(getItemField(item, 'unitAmount', 'price', 'Price') ?? 0) * quantity

  const completedAtValue = completedAt || new Date()
  async function updateImpactDocument(docRef, getExtraImpact = () => ({})) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef)
      const data = snapshot.exists ? (snapshot.data() || {}) : {}
      const existingImpact = data.impact && typeof data.impact === 'object' ? data.impact : {}
      const existingDayKeys = Array.isArray(existingImpact.completedDayKeys)
        ? existingImpact.completedDayKeys.map((key) => String(key))
        : []
      const nextDayKeys = existingDayKeys.includes(completedDayKey)
        ? existingDayKeys
        : [...existingDayKeys, completedDayKey]
      const extraImpact = getExtraImpact(existingImpact)

      transaction.set(
        docRef,
        {
          co2:
            toPositiveNumber(existingImpact.co2KgSaved ?? data.co2) +
            (quantity * IMPACT_CO2_PER_MEAL),
          water:
            toPositiveNumber(existingImpact.waterLitersSaved ?? data.water) +
            (quantity * IMPACT_WATER_PER_MEAL),
          days: nextDayKeys.length,
          impact: {
            ...existingImpact,
            mealsRescued: toPositiveNumber(existingImpact.mealsRescued) + quantity,
            co2KgSaved: toPositiveNumber(existingImpact.co2KgSaved ?? data.co2) + (quantity * IMPACT_CO2_PER_MEAL),
            waterLitersSaved: toPositiveNumber(existingImpact.waterLitersSaved ?? data.water) + (quantity * IMPACT_WATER_PER_MEAL),
            daysSaved: nextDayKeys.length,
            completedDayKeys: nextDayKeys,
            lastSuccessfulOrderAt: completedAtValue,
            leaderboardEligible: true,
            ...extraImpact,
          },
          updatedAt: completedAtValue,
        },
        { merge: true }
      )
    })
  }

  const writes = []

  if (customerId) {
    writes.push(
      updateImpactDocument(USERS.doc(customerId), (existingImpact) => ({
        moneySaved: toPositiveNumber(existingImpact.moneySaved) + moneySaved,
      }))
    )
  }

  if (restaurantId) {
    writes.push(
      updateImpactDocument(RESTAURANTS.doc(restaurantId), (existingImpact) => ({
        revenueRecovered:
          toPositiveNumber(existingImpact.revenueRecovered) +
          (Number.isFinite(paidAmount) ? paidAmount : 0),
        ordersFulfilled: toPositiveNumber(existingImpact.ordersFulfilled) + quantity,
      }))
    )
  }

  await Promise.all(writes)
}

// CREATE ORDER
app.post('/orders', async (req, res) => {
  try {
    const {
      orderId: incomingOrderId,
      customerId,
      items,
      totalPrice,
      notes,
      status,
      currency
    } = req.body;

    const errors = validateOrderData({ customerId, items, totalPrice });
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // ✅ Use the orderId passed by the consumer (same as payment metadata), or generate one
    const orderId = incomingOrderId || generateOrderId();
    const now = new Date();
    const normalizedItems = items.map((item) => normalizeStoredItem(item, status || 'pending_payment'));

    const orderData = {
      orderId,
      customerId,
      items: normalizedItems,
      totalPrice,
      currency: currency || 'sgd',
      notes: notes || '',
      status: status || 'pending_payment',
      createdAt: now,
      updatedAt: now,
      events: [
        {
          type: 'created',
          timestamp: now,
          details: 'Order created'
        }
      ]
    };

    await ORDERS.doc(orderId).set(orderData);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: orderData
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL ORDERS
app.get('/orders', async (req, res) => {
  try {
    const { customerId, status, limit = 50, offset = 0 } = req.query;

    let query = ORDERS;

    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();

    const allOrders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSerializableDate(doc.data().createdAt),
      updatedAt: toSerializableDate(doc.data().updatedAt)
    }))
    .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));

    const paginatedOrders = allOrders.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    res.json({
      success: true,
      total: allOrders.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
      orders: paginatedOrders
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ORDERS FOR A RESTAURANT
app.get('/orders/restaurant/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const {
      restaurantName = '',
      status,
      limit = 100,
      offset = 0
    } = req.query;

    const snapshot = await ORDERS.get();

    const rows = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: toSerializableDate(doc.data().createdAt),
        updatedAt: toSerializableDate(doc.data().updatedAt)
      }))
      .flatMap((order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        return items
          .filter((item) => matchesRestaurantItem(item, restaurantId, restaurantName))
          .map((item) => toRestaurantOrderRow(order, item));
      })
      .filter((row) => {
        if (!status) return true;
        return normalizeItemStatus(row?.item?.fulfillmentStatus, 'new') === normalizeItemStatus(status, 'new');
      })
      .sort((a, b) => {
        const pickupDelta =
          toDateMs(getItemField(a?.item, 'pickupTime', 'PickupTime')) -
          toDateMs(getItemField(b?.item, 'pickupTime', 'PickupTime'));

        if (pickupDelta !== 0) return pickupDelta;
        return toDateMs(b.createdAt) - toDateMs(a.createdAt);
      });

    const paginatedRows = rows.slice(
      parseInt(offset, 10),
      parseInt(offset, 10) + parseInt(limit, 10)
    );

    const counts = rows.reduce((acc, row) => {
      const rowStatus = normalizeItemStatus(row?.item?.fulfillmentStatus, 'new');
      acc.all += 1;
      acc[rowStatus] = (acc[rowStatus] || 0) + 1;
      return acc;
    }, { all: 0, new: 0, ready: 0, completed: 0 });

    res.json({
      success: true,
      restaurantId,
      restaurantName,
      total: rows.length,
      offset: parseInt(offset, 10),
      limit: parseInt(limit, 10),
      counts,
      orders: paginatedRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ORDER STATUS
app.patch('/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const doc = await ORDERS.doc(orderId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const now = new Date();
    await ORDERS.doc(orderId).update({
      status,
      updatedAt: now,
      events: [...(doc.data().events || []), {
        type: 'status_updated',
        timestamp: now,
        details: `Status changed to ${status}`
      }]
    });

    res.json({ success: true, orderId, status });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ITEM STATUS FOR RESTAURANT FULFILLMENT
app.patch('/orders/:orderId/items/:itemId/status', async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { status, restaurantId = '', restaurantName = '' } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const nextStatus = normalizeItemStatus(status, 'new');
    const doc = await ORDERS.doc(orderId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const data = doc.data() || {};
    const items = Array.isArray(data.items) ? data.items : [];
    let updated = false;
    let previousMatchedItem = null;
    let nextMatchedItem = null;

    const nextItems = items.map((item) => {
      const currentItemId = String(getItemField(item, 'itemId', 'listingId', 'id', 'Id') || '');
      const sameItem = currentItemId === String(itemId);
      const sameRestaurant = matchesRestaurantItem(item, restaurantId, restaurantName);

      if (!sameItem || (!sameRestaurant && (restaurantId || restaurantName))) {
        return item;
      }

      updated = true;
      previousMatchedItem = item;
      nextMatchedItem = {
        ...item,
        fulfillmentStatus: nextStatus
      };
      return nextMatchedItem;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Order item not found for restaurant' });
    }

    const now = new Date();
    const nextOrderStatus = isOrderCompleted(nextItems)
      ? 'completed'
      : (data.status === 'pending_payment' ? 'confirmed' : data.status || 'confirmed');

    await ORDERS.doc(orderId).update({
      items: nextItems,
      status: nextOrderStatus,
      updatedAt: now,
      events: [...(data.events || []), {
        type: 'item_status_updated',
        timestamp: now,
        details: `Item ${itemId} status changed to ${nextStatus}`
      }]
    });

    const previousStatus = normalizeItemStatus(
      getItemField(previousMatchedItem, 'fulfillmentStatus', 'FulfillmentStatus'),
      'new'
    );
    const customerId = String(data.customerId || '')

    if (
      customerId &&
      nextStatus === 'ready' &&
      previousStatus !== 'ready' &&
      previousStatus !== 'completed'
    ) {
      fireAndForgetNotification({
        userId: customerId,
        type: 'ORDER_READY',
        orderId
      })
    }

    if (nextStatus === 'completed' && previousStatus !== 'completed' && nextMatchedItem) {
      await applyCompletedPickupImpact({
        order: { ...data, customerId: data.customerId },
        item: nextMatchedItem,
        completedAt: now
      });
    }

    if (customerId && nextOrderStatus === 'completed' && String(data.status || '') !== 'completed') {
      fireAndForgetNotification({
        userId: customerId,
        type: 'ORDER_COMPLETED',
        orderId
      })
    }

    res.json({
      success: true,
      orderId,
      itemId,
      status: nextStatus,
      orderStatus: nextOrderStatus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ORDER HISTORY FOR RECOMMENDATIONS
app.get('/orders/customer/:customerId/history', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { limit = 20 } = req.query;

    const snapshot = await ORDERS
      .where('customerId', '==', customerId)
      .get();

    const confirmedOrders = snapshot.docs
      .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        orderId: data.orderId,
        items: data.items,
        totalPrice: data.totalPrice,
        currency: data.currency || 'sgd',
        status: data.status,
        createdAt: toSerializableDate(data.createdAt)
      };
      })
      .filter(order => order.status === 'confirmed')
      .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));

    const orderHistory = confirmedOrders.slice(0, parseInt(limit));

    const itemFrequency = {};
    orderHistory.forEach(order => {
      order.items.forEach(item => {
        const itemKey = item.id || item.name;
        if (itemKey) {
          itemFrequency[itemKey] = (itemFrequency[itemKey] || 0) + item.quantity;
        }
      });
    });

    res.json({
      success: true,
      customerId,
      totalOrders: confirmedOrders.length,
      orderHistory,
      recommendations: {
        frequentItems: Object.entries(itemFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([itemId, count]) => ({ itemId, purchaseCount: count })),
        preferredCategories: []
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET SPECIFIC ORDER
app.get('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const doc = await ORDERS.doc(orderId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderData = doc.data();
    res.json({
      success: true,
      order: {
        id: doc.id,
        ...orderData,
        createdAt: toSerializableDate(orderData.createdAt),
        updatedAt: toSerializableDate(orderData.updatedAt)
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({ status: 'Order service is running' });
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Order service running on port ${PORT}`);
});
