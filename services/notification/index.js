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
  const snapshot = await db.collection('notifications')
    .where('user_id', '==', req.params.user_id)
    .orderBy('created_at', 'desc')
    .limit(50)
    .get();
    
  res.json(snapshot.docs.map(doc => doc.data()));
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
