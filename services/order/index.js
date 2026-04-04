import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { db } from './firebaseAdmin.js'

const app = express()
const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  process.env.ACCOUNT_URL ||
  'http://account:3001'
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ||
  process.env.NOTIFICATION_URL ||
  'http://notification:3006'

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "x-correlation-id"]
};
const CORRELATION_HEADER = 'x-correlation-id'

app.use(cors(corsOptions))
app.use(express.json())

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()]
  return String(Array.isArray(value) ? value[0] : value || '').trim()
}

function withCorrelationHeaders(headers = {}, correlationId = '') {
  if (!correlationId) return { ...headers }
  return {
    ...headers,
    [CORRELATION_HEADER]: correlationId,
  }
}

function correlationMiddleware(serviceName) {
  return (req, res, next) => {
    const correlationId = getHeaderValue(req.headers) || `${serviceName}:${randomUUID()}`
    req.correlationId = correlationId
    res.setHeader(CORRELATION_HEADER, correlationId)
    console.log(`[${serviceName}] ${req.method} ${req.originalUrl} cid=${correlationId}`)
    next()
  }
}

app.use(correlationMiddleware('order'))

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

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  const raw = await response.text()
  if (!raw) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function fetchJson(url, options = {}, correlationId = '') {
  const response = await fetch(url, {
    ...options,
    headers: withCorrelationHeaders(options?.headers || {}, correlationId),
  })
  const data = await readBody(response)

  if (!response.ok) {
    const error = new Error((data && data.error) || `Request failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
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

function toMinorUnits(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (!Number.isInteger(numeric)) return Math.round(numeric * 100)
  if (numeric <= 100) return numeric * 100
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
  if (['new', 'pending', 'ready', 'preparing', 'completed', 'cancelled', 'canceled', 'refunded'].includes(normalized)) {
    if (normalized === 'preparing') return 'ready'
    return normalized === 'canceled' ? 'cancelled' : normalized;
  }
  return fallback;
}

function isRefundedLikeStatus(value) {
  const normalized = normalizeItemStatus(value, 'new')
  return normalized === 'refunded' || normalized === 'cancelled'
}

function deriveOrderStatusFromItems(items, currentStatus = 'confirmed') {
  const safeItems = Array.isArray(items) ? items : []
  if (safeItems.length === 0) return currentStatus || 'confirmed'

  const statuses = safeItems.map((item) =>
    normalizeItemStatus(getItemField(item, 'fulfillmentStatus', 'FulfillmentStatus'), 'new')
  )

  if (statuses.every((status) => status === 'completed')) {
    return 'completed'
  }

  if (statuses.every((status) => isRefundedLikeStatus(status))) {
    return 'refunded'
  }

  if (statuses.some((status) => isRefundedLikeStatus(status))) {
    return 'partially_refunded'
  }

  if (currentStatus === 'pending_payment') {
    return 'confirmed'
  }

  return currentStatus || 'confirmed'
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

function getEstimatedMoneySaved(item) {
  const quantity = toPositiveNumber(item?.quantity, 1)
  const originalPrice = toMajorUnits(getItemField(item, 'originalPrice', 'OriginalPrice'))
  const unitAmount = toMajorUnits(getItemField(item, 'unitAmount', 'price', 'Price'))

  if (!Number.isFinite(originalPrice) || !Number.isFinite(unitAmount) || originalPrice <= unitAmount) {
    return 0
  }

  return Number(((originalPrice - unitAmount) * quantity).toFixed(2))
}

function fireAndForgetNotification(body, correlationId = '') {
  fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
    method: 'POST',
    headers: withCorrelationHeaders({ 'Content-Type': 'application/json' }, correlationId),
    body: JSON.stringify(body),
  }).catch((err) => {
    console.warn(`[order] Notification fire-and-forget failed cid=${correlationId || 'n/a'}:`, err.message)
  })
}

async function applyCompletedPickupImpact({ order, item, completedAt, correlationId = '' }) {
  const customerId = String(order?.customerId || '')
  const restaurantId = String(getItemField(item, 'restaurantId', 'RestaurantId') || '')
  if (!customerId && !restaurantId) return

  const quantity = Math.max(1, Math.floor(toPositiveNumber(item?.quantity, 1)))
  const moneySaved = getEstimatedMoneySaved(item)
  const paidAmount =
    toMajorUnits(getItemField(item, 'unitAmount', 'price', 'Price') ?? 0) * quantity

  await fetchJson(`${ACCOUNT_SERVICE_URL}/account/internal/impact/order-completed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId,
      restaurantId,
      quantity,
      moneySaved,
      paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
      completedAt: completedAt?.toISOString?.() || new Date().toISOString(),
    }),
  }, correlationId)
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

// GET REFUNDABLE ORDER ITEMS FOR A LISTING
app.get('/orders/listings/:listingId/affected', async (req, res) => {
  try {
    const { listingId } = req.params
    const { restaurantId = '', restaurantName = '', includeCompleted = 'false' } = req.query
    const includeCompletedItems = String(includeCompleted).trim().toLowerCase() === 'true'
    const normalizedListingId = String(listingId || '').trim()

    if (!normalizedListingId) {
      return res.status(400).json({ error: 'listingId is required' })
    }

    const snapshot = await ORDERS.get()
    const grouped = new Map()

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {}
      const items = Array.isArray(data.items) ? data.items : []
      const orderId = String(data.orderId || doc.id || '')
      const customerId = String(data.customerId || '')
      const currency = String(data.currency || 'sgd')
      const createdAt = toSerializableDate(data.createdAt)
      const orderStatus = String(data.status || 'confirmed')

      items.forEach((item) => {
        const currentItemId = String(getItemField(item, 'itemId', 'listingId', 'id', 'Id') || '')
        const sameListing = currentItemId === normalizedListingId
        const sameRestaurant = matchesRestaurantItem(item, restaurantId, restaurantName)
        const itemStatus = normalizeItemStatus(
          getItemField(item, 'fulfillmentStatus', 'FulfillmentStatus'),
          orderStatus === 'confirmed' ? 'new' : 'pending'
        )

        if (!sameListing) return
        if ((restaurantId || restaurantName) && !sameRestaurant) return
        if (!includeCompletedItems && itemStatus === 'completed') return
        if (isRefundedLikeStatus(itemStatus)) return

        const quantity = Math.max(1, Math.floor(toPositiveNumber(item?.quantity, 1)))
        const unitAmountMinor = toMinorUnits(
          getItemField(item, 'unitAmount', 'unitAmountMinor', 'price', 'Price')
        )
        const refundAmountMinor = Math.max(0, unitAmountMinor * quantity)

        if (!grouped.has(orderId)) {
          grouped.set(orderId, {
            orderId,
            customerId,
            currency,
            orderStatus,
            createdAt: createdAt?.toISOString?.() || null,
            totalRefundAmountMinor: 0,
            totalRefundAmount: 0,
            items: [],
          })
        }

        const entry = grouped.get(orderId)
        entry.items.push({
          itemId: currentItemId,
          itemName: String(getItemField(item, 'name', 'itemName', 'ItemName', 'title') || 'Item'),
          quantity,
          unitAmountMinor,
          unitAmount: Number((unitAmountMinor / 100).toFixed(2)),
          refundAmountMinor,
          refundAmount: Number((refundAmountMinor / 100).toFixed(2)),
          status: itemStatus,
          pickupTime: String(getItemField(item, 'pickupTime', 'PickupTime') || ''),
          restaurantId: String(getItemField(item, 'restaurantId', 'RestaurantId') || ''),
          restaurantName: String(getItemField(item, 'restaurantName', 'RestaurantName') || ''),
        })
        entry.totalRefundAmountMinor += refundAmountMinor
        entry.totalRefundAmount = Number((entry.totalRefundAmountMinor / 100).toFixed(2))
      })
    })

    const orders = Array.from(grouped.values()).sort(
      (a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt)
    )

    const totalRefundAmountMinor = orders.reduce(
      (sum, order) => sum + Number(order.totalRefundAmountMinor || 0),
      0
    )

    res.json({
      success: true,
      listingId: normalizedListingId,
      total: orders.length,
      totalRefundAmountMinor,
      totalRefundAmount: Number((totalRefundAmountMinor / 100).toFixed(2)),
      orders,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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
    const {
      status,
      restaurantId = '',
      restaurantName = '',
      reason = '',
      refundAmount = 0,
      paymentId = '',
    } = req.body || {};

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
    const now = new Date();
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
        fulfillmentStatus: nextStatus,
      };

      if (nextStatus === 'refunded') {
        nextMatchedItem.refundReason = String(reason || '')
        nextMatchedItem.refundAmount = Number(refundAmount || 0) || 0
        nextMatchedItem.refundPaymentId = String(paymentId || '')
        nextMatchedItem.refundedAt = now
      }

      return nextMatchedItem;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Order item not found for restaurant' });
    }

    const nextOrderStatus = deriveOrderStatusFromItems(
      nextItems,
      data.status === 'pending_payment' ? 'confirmed' : data.status || 'confirmed'
    );

    await ORDERS.doc(orderId).update({
      items: nextItems,
      status: nextOrderStatus,
      updatedAt: now,
      events: [...(data.events || []), {
        type: 'item_status_updated',
        timestamp: now,
        details:
          nextStatus === 'refunded' && reason
            ? `Item ${itemId} status changed to refunded (${reason})`
            : `Item ${itemId} status changed to ${nextStatus}`
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
      }, req.correlationId)
    }

    if (nextStatus === 'completed' && previousStatus !== 'completed' && nextMatchedItem) {
      await applyCompletedPickupImpact({
        order: { ...data, customerId: data.customerId },
        item: nextMatchedItem,
        completedAt: now,
        correlationId: req.correlationId,
      });
    }

    if (customerId && nextOrderStatus === 'completed' && String(data.status || '') !== 'completed') {
      fireAndForgetNotification({
        userId: customerId,
        type: 'ORDER_COMPLETED',
        orderId
      }, req.correlationId)
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
