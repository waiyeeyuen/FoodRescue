// senders.js
import twilio from 'twilio';
import { messaging } from '../firebase/firebaseAdmin.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, './.env') });

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

function normalizePhone(value) {
  if (!value) return '';
  // Keep leading +, strip everything else non-digit.
  const raw = String(value).trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export async function sendNotification(notificationData) {
  const { userId, title, message, channel, userPhone } = notificationData;
  
  try {
    switch (channel) {
      case 'SMS':
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
          throw new Error('Twilio env vars missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER)');
        }
        const to = normalizePhone(userPhone);
        if (!to) {
          throw new Error('Missing destination phone number');
        }
        const smsResult = await twilioClient.messages.create({
          body: `${title}\n\n${message}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to
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
      default:
        console.warn('⚠️ Unknown channel:', channel);
        return 'SKIPPED';
    }
  } catch (error) {
    console.error('❌ Send failed:', JSON.stringify({
      message: error?.message,
      code: error?.code,
      status: error?.status,
      moreInfo: error?.moreInfo,
      details: error?.details
    }));
    return 'FAILED';
  }
}
