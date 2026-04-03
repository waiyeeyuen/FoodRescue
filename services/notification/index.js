// index.js
import express from 'express';
import { connectRabbitMQ } from './rabbitmq.js';
import { handleEvent, getTitle, getMessage, getChannel } from './handler.js';
import { resolveNotificationDelivery } from './accountClient.js';
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
const NOTIFICATION_CACHE_TTL_MS = 30 * 1000;
const notificationCache = new Map();

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

function isQuotaError(error) {
  const message = String(error?.message || '').toUpperCase();
  return (
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('QUOTA EXCEEDED') ||
    message.includes('QUOTA_EXCEEDED')
  );
}

function getCachedNotifications(userId) {
  const cacheKey = String(userId || '');
  const cached = notificationCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    notificationCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedNotifications(userId, notifications) {
  notificationCache.set(String(userId || ''), {
    value: Array.isArray(notifications) ? notifications : [],
    expiresAt: Date.now() + NOTIFICATION_CACHE_TTL_MS,
  });
}

function upsertCachedNotification(userId, notification) {
  if (!userId || !notification) return;

  const existing = getCachedNotifications(userId) || [];
  const next = [
    notification,
    ...existing.filter((entry) => String(entry?.id || '') !== String(notification.id || '')),
  ]
    .sort((a, b) => toTimestamp(b.createdAt || b.created_at) - toTimestamp(a.createdAt || a.created_at))
    .slice(0, 50);

  setCachedNotifications(userId, next);
}

function invalidateNotificationCache(userId) {
  if (!userId) return;
  notificationCache.delete(String(userId));
}

async function getNotificationsForUser(userId) {
  const cached = getCachedNotifications(userId);
  if (cached) return cached;

  const camelSnapshot = await db.collection('notifications')
    .where('userId', '==', userId)
    .limit(100)
    .get();

  const merged = new Map();

  camelSnapshot.docs.forEach((doc) => {
    merged.set(doc.id, serializeNotification(doc));
  });

  if (merged.size === 0) {
    const snakeSnapshot = await db.collection('notifications')
      .where('user_id', '==', userId)
      .limit(100)
      .get();

    snakeSnapshot.docs.forEach((doc) => {
      merged.set(doc.id, serializeNotification(doc));
    });
  }

  const notifications = Array.from(merged.values())
    .sort((a, b) => toTimestamp(b.createdAt || b.created_at) - toTimestamp(a.createdAt || a.created_at))
    .slice(0, 50);

  setCachedNotifications(userId, notifications);
  return notifications;
}

// Start RabbitMQ consumer
async function startConsumer() {
  const channel = await connectRabbitMQ();
  
  ['order.expired', 'listing.expired', 'reward.triggered'].forEach(queue => {
    channel.consume(queue, async (msg) => {
      if (!msg) return;

      let data;

      try {
        data = await handleEvent(msg);
        const status = await sendNotification(data);

        await db.collection('notifications')
          .doc(data.docId)
          .update({ status });

        upsertCachedNotification(data.userId, {
          id: data.docId,
          ...data,
          status,
          createdAt: new Date().toISOString(),
        });

        channel.ack(msg);
      } catch (error) {
        console.error(`[notifications/consumer] Failed to process ${queue}:`, error?.message || error);
        channel.nack(msg, false, false);
      }
    });
  });
}

// REST API for frontend (behind Kong)
app.get('/notifications/:user_id', async (req, res) => {
  try {
    res.json(await getNotificationsForUser(req.params.user_id));
  } catch (err) {
    if (isQuotaError(err)) {
      return res.json(getCachedNotifications(req.params.user_id) || []);
    }
    console.error('[notifications/list] Error:', err.message);
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
    setCachedNotifications(
      req.params.user_id,
      notifications.map((notification) => ({
        ...notification,
        read: true,
        readAt: new Date().toISOString(),
      }))
    );

    res.json({ success: true, updated: unreadNotifications.length });
  } catch (err) {
    if (isQuotaError(err)) {
      return res.json({ success: true, updated: 0, stale: true });
    }
    console.error('[notifications/read-all] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 11 — called by Place Order (fire-and-forget)
app.post('/notifications/send', async (req, res) => {
  const {
    userId,
    type,
    orderId,
    listingId,
    insufficientItems,
    userPhone,
    phone,
    title,
    message,
    channel,
    smsBody,
  } = req.body || {};

  try {
    const normalizedType = (type || '').toUpperCase();
    const requestedChannel = channel || getChannel(normalizedType);
    const resolvedDelivery = await resolveNotificationDelivery({
      accountId: userId,
      accountKind: req.body?.accountKind || 'auto',
      preferredChannel: requestedChannel,
      userPhone,
      phone,
      explicitChannel: Boolean(channel),
    });
    const resolvedChannel = resolvedDelivery.channel;
    const resolvedPhone = resolvedDelivery.userPhone;

    console.log('[notifications/send] Incoming:', JSON.stringify({
      userId,
      type,
      orderId,
      requestedChannel,
      resolvedChannel,
      hasPhone: Boolean(resolvedPhone),
      hasInsufficientItems: Array.isArray(insufficientItems) && insufficientItems.length > 0
    }));

    if (resolvedDelivery.suppressed) {
      console.log(
        `[notifications/send] SMS suppressed for user ${String(userId || '')}: ${resolvedDelivery.preferenceReason}`
      );
      return res.json({
        success: true,
        status: 'SKIPPED',
        channel: requestedChannel,
        reason: resolvedDelivery.preferenceReason,
      });
    }

    const notificationData = {
      userId,
      type: normalizedType,
      title: title || getTitle(normalizedType),
      message: message || getMessage(normalizedType),
      smsBody: smsBody || '',
      channel: resolvedChannel,
      userPhone: resolvedPhone,
      status: 'PENDING',
      read: false,
      orderId: orderId || null,
      listingId: listingId || null,
      preferenceReason: resolvedDelivery.preferenceReason,
    };

    if (resolvedChannel === 'SMS' && !resolvedPhone) {
      console.warn(
        `[notifications/send] Missing destination phone for ${normalizedType}; storing in-app record only`
      );
    }

    const docRef = await db.collection('notifications').add({
      ...notificationData,
      createdAt: FieldValue.serverTimestamp(),
    });
    invalidateNotificationCache(userId);

    const status = await sendNotification(notificationData);
    console.log('[notifications/send] Delivery status:', status);

    await db.collection('notifications').doc(docRef.id).update({ status });
    upsertCachedNotification(userId, {
      id: docRef.id,
      ...notificationData,
      status,
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: status !== 'FAILED',
      status,
      channel: resolvedChannel,
      notificationId: docRef.id,
      reason: resolvedDelivery.preferenceReason,
    });
  } catch (err) {
    console.error('[notifications/send] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3006;

startConsumer().catch(console.error);
app.listen(PORT, () => console.log(`Notifications service on :${PORT}`));
