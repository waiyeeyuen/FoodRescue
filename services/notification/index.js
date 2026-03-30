// index.js
import express from 'express';
import { connectRabbitMQ } from './rabbitmq.js';
import { handleEvent, getTitle, getMessage, getChannel } from './handler.js';
import { sendNotification } from './sender.js';
import { db, FieldValue } from '../firebase/firebaseAdmin.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, './.env') });

const app = express();
app.use(express.json());

function toDateValue(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTimestamp(value) {
  return toDateValue(value)?.getTime() || 0;
}

function serializeNotification(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: toDateValue(data.createdAt || data.created_at)?.toISOString() || null,
  };
}

async function getNotificationsForUser(userId) {
  const [camelSnapshot, snakeSnapshot] = await Promise.all([
    db.collection('notifications')
      .where('userId', '==', userId)
      .limit(100)
      .get(),
    db.collection('notifications')
      .where('user_id', '==', userId)
      .limit(100)
      .get(),
  ]);

  const merged = new Map();

  [...camelSnapshot.docs, ...snakeSnapshot.docs].forEach((doc) => {
    merged.set(doc.id, serializeNotification(doc));
  });

  return Array.from(merged.values())
    .sort((a, b) => toTimestamp(b.createdAt || b.created_at) - toTimestamp(a.createdAt || a.created_at))
    .slice(0, 50);
}

// Start RabbitMQ consumer
async function startConsumer() {
  const channel = await connectRabbitMQ();
  
  ['order.expired', 'listing.expired', 'reward.triggered'].forEach(queue => {
    channel.consume(queue, async (msg) => {
      const data = await handleEvent(msg);
      
      const status = await sendNotification(data);
       
      await db.collection('notifications')
        .doc(data.docId)
        .update({ status });
        
      channel.ack(msg);
    });
  });
}

// REST API for frontend (behind Kong)
app.get('/notifications/:user_id', async (req, res) => {
  try {
    res.json(await getNotificationsForUser(req.params.user_id));
  } catch (err) {
    console.error('[notifications/list] ❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/notifications/:user_id/read-all', async (req, res) => {
  try {
    const notifications = await getNotificationsForUser(req.params.user_id);
    const unreadNotifications = notifications.filter((notification) => notification.read !== true);

    if (unreadNotifications.length === 0) {
      return res.json({ success: true, updated: 0 });
    }

    const batch = db.batch();
    unreadNotifications.forEach((notification) => {
      batch.update(db.collection('notifications').doc(notification.id), {
        read: true,
        readAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    res.json({ success: true, updated: unreadNotifications.length });
  } catch (err) {
    console.error('[notifications/read-all] ❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 11 — called by Place Order (fire-and-forget)
app.post('/notifications/send', async (req, res) => {
  const { userId, type, orderId, insufficientItems, userPhone, phone } = req.body || {};

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const resolvedPhone =
      userPhone ||
      phone ||
      userDoc.data()?.phone ||
      process.env.DEFAULT_SMS_TO ||
      '';

    console.log('[notifications/send] Incoming:', JSON.stringify({
      userId,
      type,
      orderId,
      hasPhone: Boolean(resolvedPhone),
      hasInsufficientItems: Array.isArray(insufficientItems) && insufficientItems.length > 0
    }));

    if (!resolvedPhone && String(type || '').toUpperCase() !== 'PUSH') {
      return res.status(400).json({
        success: false,
        error: 'Missing destination phone (provide phone/userPhone, set DEFAULT_SMS_TO, or store users/{userId}.phone)'
      });
    }

    const normalizedType = (type || '').toUpperCase();

    const notificationData = {
      userId,
      type: normalizedType,
      title: getTitle(normalizedType),
      message: getMessage(normalizedType),
      channel: getChannel(normalizedType),
      userPhone: resolvedPhone,
      status: 'PENDING',
      read: false,
    };

    const docRef = await db.collection('notifications').add({
      ...notificationData,
      createdAt: FieldValue.serverTimestamp(),
    });

    const status = await sendNotification(notificationData);
    console.log('[notifications/send] Delivery status:', status);

    await db.collection('notifications').doc(docRef.id).update({ status });

    res.json({ success: true });
  } catch (err) {
    console.error('[notifications/send] ❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3006;

startConsumer().catch(console.error);
app.listen(PORT, () => console.log(`Notifications service on :${PORT}`));
