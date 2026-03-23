import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL         = process.env.RABBITMQ_URL             || 'amqp://guest:guest@localhost:5672';
const PLACE_ORDER_URL      = process.env.PLACE_ORDER_SERVICE_URL  || 'http://localhost:4001';
const OUTSYSTEMS_BASE      = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

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

    const resolvedItemId =
      item?.itemId || item?.listingId || item?.id || listing?.Id || listing?.id;

    if (!listing || availableQty < requestedQty) {
      insufficientItems.push({
        ...item,
        itemId: resolvedItemId,
        name: itemName,
        requestedQty,
        availableQty: listing ? availableQty : 0,
        itemRefundAmount: unitAmountMinor * requestedQty,
      });
      refundAmount += unitAmountMinor * requestedQty;
      console.log(`[Consumer] ❌ Insufficient: "${itemName}"`);
    } else {
      confirmedItems.push({
        ...item,
        itemId: resolvedItemId,
      });
      console.log(`[Consumer] ✅ Stock OK: "${itemName}" (itemId=${resolvedItemId})`);
    }
  }

  // Determine status
  let status;
  if (insufficientItems.length === 0)                 status = 'ok';
  else if (insufficientItems.length === items.length) status = 'failed';
  else                                                status = 'partial';

  console.log(`[Consumer] Stock check complete — status: ${status}`);

  // Single delegating call to Place Order orchestrator
  const res = await fetch(`${PLACE_ORDER_URL}/orders/inventory-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      paymentId,
      userId,
      currency,
      status,
      confirmedItems,
      insufficientItems,
      refundAmount,
      amountTotal,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Place Order responded ${res.status}: ${errText}`);
  }

  console.log(`[Consumer] ✅ Place Order notified — order ${orderId} status: ${status}`);
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
