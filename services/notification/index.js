// index.js
import express from 'express';
import { connectRabbitMQ, getChannel } from './rabbitmq.js';
import { handleEvent } from './handler.js';
import { sendNotification } from './sender.js';
import { db } from '../firebase/firebaseAdmin.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

// Start RabbitMQ consumer
async function startConsumer() {
  const channel = await connectRabbitMQ();
  
  ['order.expired', 'listing.expired', 'reward.triggered'].forEach(queue => {
    channel.consume(queue, async (msg) => {
      const data = await handleEvent(msg);
      
      // Send notification
      const status = await sendNotification(data);
       
      // Update Firebase
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

startConsumer().catch(console.error);
app.listen(3001, () => console.log('Notifications service on :3001'));
