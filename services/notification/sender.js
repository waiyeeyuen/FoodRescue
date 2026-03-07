// senders.js
import twilio from 'twilio';
import { messaging } from './firebaseAdmin.js';
import dotenv from 'dotenv';
dotenv.config();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendNotification(notificationData) {
  const { userId, title, message, channel, userPhone } = notificationData;
  
  try {
    switch (channel) {
      case 'SMS':
        const smsResult = await twilioClient.messages.create({
          body: `${title}\n\n${message}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: userPhone
        });
        console.log('✅ SMS sent:', smsResult.sid);
        return 'SENT';
      case 'PUSH':
        const pushResult = await messaging.send({
          token: `fcm_token_user_${userId}`,
          notification: { title, body: message }
        });
        console.log('✅ Push sent:', pushResult);
        return 'SENT';
    }
  } catch (error) {
    console.error('❌ Send failed:', error.message);
    return 'FAILED';
  }
}
