import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL     = process.env.RABBITMQ_URL     || 'amqp://guest:guest@localhost:5672';
const ORDER_SERVICE_URL    = process.env.ORDER_SERVICE_URL    || 'http://localhost:3004';
const PAYMENT_SERVICE_URL  = process.env.PAYMENT_SERVICE_URL  || 'http://localhost:3003';
const OUTSYSTEMS_BASE  = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

const QUEUE = 'order.stock_check';

async function getListingByName(itemName) {
  try {
    const res = await fetch(`${OUTSYSTEMS_BASE}/GetActiveListing`);
    if (!res.ok) return null;
    const listings = await res.json();
    if (!Array.isArray(listings)) return null;
    return listings.find(
      (l) => (l.itemName || l.ItemName || '').toLowerCase() === itemName.toLowerCase()
    ) || null;
  } catch {
    return null;
  }
}

async function triggerRefund(paymentId, amountMinor, reason) {
  try {
    const res = await fetch(`${PAYMENT_SERVICE_URL}/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountMinor, reason }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[Consumer] ✅ Refund triggered for payment ${paymentId}:`, data?.message || data);
  } catch (err) {
    console.error(`[Consumer] ❌ Refund call failed:`, err.message);
  }
}

async function createConfirmedOrder({ orderId, userId, items, totalPrice, currency, notes }) {
  console.log('[Consumer] Sending order to order service:', JSON.stringify({
    orderId, customerId: userId, items, totalPrice, currency, notes
  }, null, 2));

  const res = await fetch(`${ORDER_SERVICE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      customerId: userId,
      items,
      totalPrice,
      currency,
      notes: notes || '',
      status: 'confirmed',
    }),
  });
  const data = await res.json().catch(() => ({}));
  console.log('[Consumer] Order service response:', JSON.stringify(data, null, 2));
  if (!res.ok) throw new Error(data?.error || 'Order creation failed');
  return data;
}

async function processMessage(payload) {
  console.log('==============================');
  console.log('[Consumer] ✅ Message consumed from RabbitMQ queue');
  console.log('[Consumer] Raw payload:', JSON.stringify(payload, null, 2));
  console.log('==============================');

  const { orderId, paymentId, userId, items, amountTotal, currency } = payload;

  const insufficientItems = [];
  const confirmedItems = [];
  let refundAmount = 0;

  for (const item of items) {
    const itemName = item.name || item.itemName || '';
    const requestedQty = Number(item.quantity ?? 1);
    const unitAmountMinor = Number(item.unitAmount ?? 0);

    console.log(`[Consumer] Checking stock for "${itemName}" (need: ${requestedQty})`);
    const listing = await getListingByName(itemName);
    const availableQty = Number(listing?.quantity ?? listing?.Quantity ?? 0);
    console.log(`[Consumer] OutSystems result for "${itemName}":`, listing ? `found, qty=${availableQty}` : 'NOT FOUND');

    if (!listing || availableQty < requestedQty) {
      insufficientItems.push({
        name: itemName,
        requestedQty,
        availableQty: listing ? availableQty : 0,
        itemRefundAmount: unitAmountMinor * requestedQty,
      });
      refundAmount += unitAmountMinor * requestedQty;
      console.log(`[Consumer] ❌ Insufficient: "${itemName}"`);
    } else {
      confirmedItems.push(item);
      console.log(`[Consumer] ✅ Stock OK: "${itemName}"`);
    }
  }

  if (insufficientItems.length === 0) {
    const totalPriceMajor = items.reduce(
      (sum, i) => sum + (Number(i.unitAmount) / 100) * Number(i.quantity), 0
    );

    const orderPayload = {
      orderId,
      userId,
      items: items.map(i => ({
        itemId: i.itemId || i.name,
        name: i.name,
        quantity: i.quantity,
        unitAmountMinor: i.unitAmount,
      })),
      totalPrice: Number(totalPriceMajor.toFixed(2)),
      currency,
    };

    console.log('[Consumer] ✅ All stock OK — creating confirmed order');
    console.log('[Consumer] Order payload:', JSON.stringify(orderPayload, null, 2));
    await createConfirmedOrder(orderPayload);
    console.log(`[Consumer] ✅ Order ${orderId} confirmed and saved`);

  } else if (insufficientItems.length === items.length) {
    console.log(`[Consumer] ❌ All items out of stock — triggering full refund of ${amountTotal}`);
    await triggerRefund(paymentId, amountTotal, 'inventory_conflict');

  } else {
    console.log(`[Consumer] ⚠️ Partial stock failure — refunding ${refundAmount} minor units`);

    const partialTotal = confirmedItems.reduce(
      (sum, i) => sum + (Number(i.unitAmount) / 100) * Number(i.quantity), 0
    );

    const partialOrderPayload = {
      orderId,
      userId,
      items: confirmedItems.map(i => ({
        itemId: i.itemId || i.name,
        name: i.name,
        quantity: i.quantity,
        unitAmountMinor: i.unitAmount,
      })),
      totalPrice: Number(partialTotal.toFixed(2)),
      currency,
      notes: `Partial order — refunded: ${insufficientItems.map(i => i.name).join(', ')}`,
    };

    console.log('[Consumer] ⚠️ Partial order payload:', JSON.stringify(partialOrderPayload, null, 2));
    await createConfirmedOrder(partialOrderPayload);
    await triggerRefund(
      paymentId,
      refundAmount,
      `inventory_conflict: ${insufficientItems.map(i => i.name).join(', ')} out of stock`
    );
    console.log(`[Consumer] ⚠️ Partial order ${orderId} confirmed, refund issued`);
  }
}

async function startConsumer() {
  console.log('[Consumer] Connecting to RabbitMQ...');

  let connection;
  while (true) {
    try {
      connection = await amqplib.connect(RABBITMQ_URL);
      break;
    } catch {
      console.log('[Consumer] RabbitMQ not ready, retrying in 3s...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  channel.prefetch(1);

  console.log(`[Consumer] ✅ Listening on queue: ${QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      console.error('[Consumer] ❌ Invalid JSON, discarding message');
      channel.ack(msg);
      return;
    }

    try {
      await processMessage(payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[Consumer] ❌ Processing failed:', err.message);
      channel.nack(msg, false, false);
    }
  });
}

startConsumer().catch(console.error);
