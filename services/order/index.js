import express from 'express'
import cors from 'cors'
import { db } from './firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions))
app.use(express.json())

const ORDERS = db.collection('orders')

// Utility function to generate order ID
function generateOrderId() {
  return 'ORD_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

// Utility function to validate order data
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

// CREATE ORDER
app.post('/orders', async (req, res) => {
  try {
    const { customerId, items, totalPrice, notes } = req.body;
    
    // Validate input
    const errors = validateOrderData({ customerId, items, totalPrice });
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const orderId = generateOrderId();
    const now = new Date();

    const orderData = {
      orderId,
      customerId,
      items,
      totalPrice,
      notes: notes || '',
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

// GET ALL ORDERS (for history and recommendations)
app.get('/orders', async (req, res) => {
  try {
    const { customerId, limit = 50, offset = 0 } = req.query;
    
    let query = ORDERS;

    // Filter by customerId if provided
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }

    // Order by creation time (newest first)
    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    
    const allOrders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
      updatedAt: doc.data().updatedAt?.toDate?.() || doc.data().updatedAt
    }));

    // Apply pagination
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
        createdAt: orderData.createdAt?.toDate?.() || orderData.createdAt,
        updatedAt: orderData.updatedAt?.toDate?.() || orderData.updatedAt
      }
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
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .get();

    const orderHistory = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        orderId: data.orderId,
        items: data.items,
        totalPrice: data.totalPrice,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      };
    });

    // Aggregate items for recommendations
    const itemFrequency = {};
    const categoryPreferences = {};

    orderHistory.forEach(order => {
      order.items.forEach(item => {
        itemFrequency[item.itemId] = (itemFrequency[item.itemId] || 0) + item.quantity;
        
        if (item.category) {
          categoryPreferences[item.category] = (categoryPreferences[item.category] || 0) + 1;
        }
      });
    });

    res.json({
      success: true,
      customerId,
      totalOrders: orderHistory.length,
      orderHistory,
      recommendations: {
        frequentItems: Object.entries(itemFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([itemId, count]) => ({ itemId, purchaseCount: count })),
        preferredCategories: Object.entries(categoryPreferences)
          .sort((a, b) => b[1] - a[1])
          .map(([category, count]) => ({ category, frequency: count }))
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

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Order service running on port ${PORT}`);
});
