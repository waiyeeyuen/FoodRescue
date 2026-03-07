// handlers.js
import { db } from '../firebase/firebaseAdmin.js';
import admin from '../firebase/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export async function handleEvent(message) {
  const event = JSON.parse(message.content.toString());
  
  // Lookup user
  const userDoc = await db.collection('users').doc(event.user_id).get();
  const userData = userDoc.data();
  const userPhone = userData?.phone || '+6587874272'; // Default for testing

  // ✅ Normalize RabbitMQ event.type to Firestore format
  const normalizedType = event.type.replace(/\./g, '_').toUpperCase();
  // "order.expired" → "ORDER_EXPIRED"
  
  // Generate FULL notification data
  const notificationData = {
    userId: event.user_id,
    type: normalizedType,        // "ORDER_EXPIRED" ✅
    title: getTitle(normalizedType),  // Uses normalized type
    message: getMessage(normalizedType),
    channel: getChannel(normalizedType),
    userPhone,  // For SMS sending
    status: 'PENDING',
    read: false
  };
  
  // Save to Firestore FIRST
  const docRef = await db.collection('notifications').add({
    ...notificationData,
    createdAt: FieldValue.serverTimestamp()
  });
  
  return { docId: docRef.id, ...notificationData };
}

// Helper functions
function getTitle(type) {
  const titles = {
    'ORDER_EXPIRED': 'Order Expired 😔',
    'LISTING_EXPIRED': 'Reservation Cancelled 🍽️',
    'REWARD_TRIGGERED': 'Reward Unlocked! 🎉'
  };
  return titles[type] || 'New Notification';
}

function getMessage(type) {
  const messages = {
    'ORDER_EXPIRED': 'Your FoodRescue order has expired due to payment timeout.',
    'LISTING_EXPIRED': 'Your food reservation has expired. Check for new listings!',
    'REWARD_TRIGGERED': 'Congratulations! You unlocked a 50% OFF Buy Again voucher!'
  };
  return messages[type] || 'New update from FoodRescue.';
}

function getChannel(type) {
  const channels = {
    'ORDER_EXPIRED': 'SMS',
    'LISTING_EXPIRED': 'PUSH',
    'REWARD_TRIGGERED': 'SMS'
  };
  return channels[type] || 'PUSH';
}
