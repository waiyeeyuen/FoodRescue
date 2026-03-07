// test-sms.js (run: node test-sms.js)
import { handleEvent } from './handler.js';
import { sendNotification } from './sender.js';
import { db } from './firebaseAdmin.js';

// Simulate RabbitMQ message
const mockMessage = {
  content: Buffer.from(JSON.stringify({
    type: 'order.expired',
    user_id: '123'
  }))
};

(async () => {
  console.log('🧪 Testing FULL pipeline...');
  
  // 1. Create notification in Firestore (like RabbitMQ would)
  const notificationData = await handleEvent(mockMessage);
  console.log('📝 Created in Firestore:', notificationData.docId);
  
  // 2. Send SMS
  const status = await sendNotification(notificationData);
  console.log('📱 SMS status:', status);
  
  // 3. Update Firestore status
  await db.collection('notifications')
    .doc(notificationData.docId)
    .update({ status });
    
  console.log('✅ Database updated!');
  console.log('🔍 Check Firebase Console → notifications collection');
})();
