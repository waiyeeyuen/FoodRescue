// handler.js
import { db } from '../firebase/firebaseAdmin.js';
import admin from '../firebase/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export async function handleEvent(message) {
  const event = JSON.parse(message.content.toString());
  
  // Lookup user
  const userDoc = await db.collection('users').doc(event.user_id).get();
  const userData = userDoc.data();
  const userPhone = userData?.phone || process.env.DEFAULT_SMS_TO || '';

  const normalizedType = event.type.replace(/\./g, '_').toUpperCase();
  
  const notificationData = {
    userId: event.user_id,
    type: normalizedType,
    title: getTitle(normalizedType),
    message: getMessage(normalizedType),
    channel: getChannel(normalizedType),
    userPhone,
    status: 'PENDING',
    read: false
  };
  
  const docRef = await db.collection('notifications').add({
    ...notificationData,
    createdAt: FieldValue.serverTimestamp()
  });
  
  return { docId: docRef.id, ...notificationData };
}

export function getTitle(type) {
  const titles = {
    'ORDER_EXPIRED':    'Order Expired 😔',
    'LISTING_EXPIRED':  'Reservation Cancelled 🍽️',
    'REWARD_TRIGGERED': 'Reward Unlocked! 🎉',
    'ORDER_CONFIRMED':  'Order Confirmed 🎉',
    'ORDER_PARTIAL':    'Partial Order Confirmed ⚠️',
    'ORDER_REFUNDED':   'Order Refunded 💸',
  };
  return titles[type] || 'New Notification';
}

export function getMessage(type) {
  const messages = {
    'ORDER_EXPIRED':    'Your FoodRescue order has expired due to payment timeout.',
    'LISTING_EXPIRED':  'Your food reservation has expired. Check for new listings!',
    'REWARD_TRIGGERED': 'Congratulations! You unlocked a 50% OFF Buy Again voucher!',
    'ORDER_CONFIRMED':  'Your FoodRescue order has been confirmed!',
    'ORDER_PARTIAL':    'Some items were out of stock. Your order was partially confirmed.',
    'ORDER_REFUNDED':   'All items were out of stock. Your order has been fully refunded.',
  };
  return messages[type] || 'New update from FoodRescue.';
}

export function getChannel(type) {
  const channels = {
    'ORDER_EXPIRED':    'SMS',
    'LISTING_EXPIRED':  'PUSH',
    'REWARD_TRIGGERED': 'SMS',
    'ORDER_CONFIRMED':  'SMS',
    'ORDER_PARTIAL':    'SMS',
    'ORDER_REFUNDED':   'SMS',
  };
  return channels[type] || 'PUSH';
}
