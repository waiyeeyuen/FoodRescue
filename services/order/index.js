import express from 'express'
import cors from 'cors'
import { db } from './firebaseAdmin.js'

const app = express()

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

function getItemField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function normalizeItemStatus(value, fallback = 'new') {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (['new', 'preparing', 'completed', 'cancelled', 'canceled', 'refunded'].includes(normalized)) {
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
    }, { all: 0, new: 0, preparing: 0, completed: 0 });

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

    const nextItems = items.map((item) => {
      const currentItemId = String(getItemField(item, 'itemId', 'listingId', 'id', 'Id') || '');
      const sameItem = currentItemId === String(itemId);
      const sameRestaurant = matchesRestaurantItem(item, restaurantId, restaurantName);

      if (!sameItem || (!sameRestaurant && (restaurantId || restaurantName))) {
        return item;
      }

      updated = true;
      return {
        ...item,
        fulfillmentStatus: nextStatus
      };
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
