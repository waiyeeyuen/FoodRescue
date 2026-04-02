import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL         = process.env.RABBITMQ_URL             || 'amqp://guest:guest@localhost:5672';
const PLACE_ORDER_URL      = process.env.PLACE_ORDER_SERVICE_URL  || 'http://localhost:4001';
const OUTSYSTEMS_BASE      = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

const QUEUE = 'order.stock_check';
const DLQ = 'order.stock_check.dlq';
const ERROR_QUEUE = 'order.error';

async function getActiveListings() {
  try {
    const res = await fetch(`${OUTSYSTEMS_BASE}/GetActiveListing`);
    if (!res.ok) return null;
    const listings = await res.json();
    if (!Array.isArray(listings)) return null;
    return listings;
  } catch {
    return null;
  }
}

function getListingId(listing) {
  return (
    listing?.itemId ??
    listing?.ItemId ??
    listing?.listingId ??
    listing?.ListingId ??
    listing?.id ??
    listing?.Id ??
    null
  );
}

function getListingName(listing) {
  return String(listing?.itemName ?? listing?.ItemName ?? listing?.name ?? listing?.Name ?? '').trim();
}

async function decrementOutSystemsListing(itemId, boughtQuantity) {
  const url = `${OUTSYSTEMS_BASE}/DecrementListingCount?itemId=${encodeURIComponent(itemId)}&boughtQuantity=${encodeURIComponent(boughtQuantity)}`;
  const res = await fetch(url, { method: 'PUT' });
  return res.ok;
}

async function processMessage(channel, payload) {
  console.log('==============================');
  console.log('[Consumer] ✅ Message consumed from RabbitMQ queue');
  console.log('[Consumer] Raw payload:', JSON.stringify(payload, null, 2));
  console.log('==============================');

  const { orderId, paymentId, userId, items, amountTotal, currency } = payload;

  const insufficientItems = [];
  const confirmedItems = [];
  let refundAmount = 0;

  const listings = await getActiveListings();

  for (const item of items) {
    const itemName = item.name || item.itemName || '';
    const requestedQty = Number(item.quantity ?? 1);
    const unitAmountMinor = Number(item.unitAmount ?? 0);
    const requestedItemId = item?.itemId || item?.listingId || item?.id || null;

    console.log(`[Consumer] Checking stock for "${itemName}" (need: ${requestedQty})`);
    const listing = Array.isArray(listings)
      ? (
        (requestedItemId
          ? listings.find((l) => String(getListingId(l) ?? '') === String(requestedItemId))
          : null) ||
        listings.find((l) => getListingName(l).toLowerCase() === String(itemName).toLowerCase())
      )
      : null;

    const availableQty = Number(listing?.quantity ?? listing?.Quantity ?? 0);
    const listingId = getListingId(listing);
    console.log(`[Consumer] OutSystems result for "${itemName}":`, listing ? `found, id=${listingId ?? '—'}, qty=${availableQty}` : 'NOT FOUND');

    if (!listing || availableQty < requestedQty) {
      insufficientItems.push({
        ...item,
        itemId: requestedItemId || listingId,
        name: itemName,
        requestedQty,
        availableQty: listing ? availableQty : 0,
        itemRefundAmount: unitAmountMinor * requestedQty,
      });
      refundAmount += unitAmountMinor * requestedQty;
      console.log(`[Consumer] ❌ Insufficient: "${itemName}"`);
    } else {
      // Atomic decrement to prevent "2 orders, 1 stock" race
      const decremented = listingId
        ? await decrementOutSystemsListing(listingId, requestedQty)
        : false;

      if (!decremented) {
        insufficientItems.push({
          ...item,
          itemId: requestedItemId || listingId,
          name: itemName,
          requestedQty,
          availableQty,
          itemRefundAmount: unitAmountMinor * requestedQty,
        });
        refundAmount += unitAmountMinor * requestedQty;
        console.log(`[Consumer] ❌ Decrement failed (inventory conflict): "${itemName}"`);
      } else {
        confirmedItems.push({
          ...item,
          itemId: requestedItemId || listingId,
        });
        console.log(`[Consumer] ✅ Stock OK + decremented: "${itemName}" (itemId=${requestedItemId || listingId})`);
      }
    }
  }

  // Determine status
  let status;
  if (insufficientItems.length === 0)                 status = 'ok';
  else if (insufficientItems.length === items.length) status = 'failed';
  else                                                status = 'partial';

  console.log(`[Consumer] Stock check complete — status: ${status}`);

  if (status !== 'ok') {
    try {
      const errorPayload = {
        type: 'inventory_conflict',
        orderId,
        paymentId,
        userId,
        currency,
        amountTotal,
        status,
        confirmedItems,
        insufficientItems,
        refundAmount,
        occurredAt: new Date().toISOString(),
      };

      channel.sendToQueue(ERROR_QUEUE, Buffer.from(JSON.stringify(errorPayload)), {
        persistent: true,
        contentType: 'application/json',
      });

      console.log(`[Consumer] Published to ${ERROR_QUEUE}`);
    } catch (err) {
      console.error('[Consumer] ❌ Failed to publish to order.error:', err?.message || err);
    }
  }

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
  await channel.assertQueue(DLQ, { durable: true });
  await channel.assertQueue(ERROR_QUEUE, { durable: true });
  channel.prefetch(1);

  console.log(`[Consumer] ✅ Listening on queue: ${QUEUE}`);
  console.log(`[Consumer] DLQ enabled: ${DLQ}`);
  console.log(`[Consumer] Error queue enabled: ${ERROR_QUEUE}`);

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
      await processMessage(channel, payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[Consumer] ❌ Processing failed:', err.message);
      try {
        channel.sendToQueue(
          DLQ,
          msg.content,
          {
            persistent: true,
            contentType: 'application/json',
            headers: {
              'x-error': err?.message || String(err),
              'x-source-queue': QUEUE,
            },
          }
        );
        console.error(`[Consumer] Sent message to DLQ: ${DLQ}`);
      } catch (dlqErr) {
        console.error('[Consumer] ❌ Failed to send to DLQ:', dlqErr?.message || dlqErr);
      } finally {
        // Ack so it doesn't disappear silently (previously it was dropped on nack with no DLX).
        channel.ack(msg);
      }
    }
  });
}

startConsumer().catch(console.error);
