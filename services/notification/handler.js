// handler.js
import { db, FieldValue } from '../firebase/firebaseAdmin.js';
import { resolveNotificationDelivery } from './accountClient.js';

export async function handleEvent(message) {
  const event = JSON.parse(message.content.toString());
  const normalizedType = event.type.replace(/\./g, '_').toUpperCase();
  const resolvedDelivery = await resolveNotificationDelivery({
    accountId: event.user_id,
    accountKind: event.account_kind || 'auto',
    preferredChannel: getChannel(normalizedType),
  });
  
  const notificationData = {
    userId: event.user_id,
    type: normalizedType,
    title: getTitle(normalizedType),
    message: getMessage(normalizedType),
    channel: resolvedDelivery.channel,
    userPhone: resolvedDelivery.userPhone,
    status: 'PENDING',
    read: false,
    preferenceReason: resolvedDelivery.preferenceReason,
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
    'LISTING_DELETED_REFUND': 'Listing Removed, Refund Issued 💸',
    'REWARD_TRIGGERED': 'Reward Unlocked! 🎉',
    'ORDER_CONFIRMED':  'Order Confirmed 🎉',
    'ORDER_PARTIAL':    'Partial Order Confirmed ⚠️',
    'ORDER_REFUNDED':   'Order Refunded 💸',
    'ORDER_READY':      'Ready for Collection 🍱',
    'ORDER_COMPLETED':  'Order Completed ✅',
  };
  return titles[type] || 'New Notification';
}

export function getMessage(type) {
  const messages = {
    'ORDER_EXPIRED':    'Your FoodRescue order has expired due to payment timeout.',
    'LISTING_EXPIRED':  'Your food reservation has expired. Check for new listings!',
    'LISTING_DELETED_REFUND': 'A restaurant removed a listing from availability. Any affected payment has been refunded.',
    'REWARD_TRIGGERED': 'Congratulations! You unlocked a 50% OFF Buy Again voucher!',
    'ORDER_CONFIRMED':  'Your FoodRescue order has been confirmed!',
    'ORDER_PARTIAL':    'Some items were out of stock. Your order was partially confirmed.',
    'ORDER_REFUNDED':   'All items were out of stock. Your order has been fully refunded.',
    'ORDER_READY':      'Food is ready. Please collect within 1 hour.',
    'ORDER_COMPLETED':  'Your FoodRescue order has been marked as completed.',
  };
  return messages[type] || 'New update from FoodRescue.';
}

export function getChannel(type) {
  const channels = {
    'ORDER_EXPIRED':    'SMS',
    'LISTING_EXPIRED':  'PUSH',
    'LISTING_DELETED_REFUND': 'SMS',
    'REWARD_TRIGGERED': 'SMS',
    'ORDER_CONFIRMED':  'SMS',
    'ORDER_PARTIAL':    'SMS',
    'ORDER_REFUNDED':   'SMS',
    'ORDER_READY':      'SMS',
    'ORDER_COMPLETED':  'IN_APP',
  };
  return channels[type] || 'PUSH';
}
