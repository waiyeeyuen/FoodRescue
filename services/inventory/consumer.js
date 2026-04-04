import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL         = process.env.RABBITMQ_URL             || 'amqp://guest:guest@localhost:5672';
const OUTSYSTEMS_BASE      = String(process.env.OUTSYSTEMS_INVENTORY_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

const QUEUE = 'inventory.check';
const DLQ = 'inventory.check.dlq';
const RESULT_QUEUE = 'inventory.result';
const CORRELATION_HEADER = 'x-correlation-id';

function getOutSystemsBaseUrl() {
  if (!OUTSYSTEMS_BASE) {
    throw new Error('OUTSYSTEMS_INVENTORY_BASE_URL is not configured');
  }

  return OUTSYSTEMS_BASE;
}

async function getActiveListings() {
  try {
    const res = await fetch(`${getOutSystemsBaseUrl()}/GetActiveListing`);
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
  const url = `${getOutSystemsBaseUrl()}/DecrementListingCount?itemId=${encodeURIComponent(itemId)}&boughtQuantity=${encodeURIComponent(boughtQuantity)}`;
  const res = await fetch(url, { method: 'PUT' });
  return res.ok;
}

function getMessageCorrelationId(msg, payload) {
  return (
    String(msg?.properties?.headers?.[CORRELATION_HEADER] || '').trim() ||
    String(payload?.correlationId || '').trim() ||
    ''
  );
}

async function processMessage(channel, payload, correlationId = '') {
  console.log('==============================');
  console.log(`[Consumer] ✅ Message consumed from RabbitMQ queue cid=${correlationId || 'n/a'}`);
  console.log('[Consumer] Raw payload:', JSON.stringify(payload, null, 2));
  console.log('==============================');

  const {
    orderId,
    paymentId,
    paymentIntentId,
    userId,
    items,
    amountTotal,
    currency,
    replyTo,
  } = payload;

  const insufficientItems = [];
  const confirmedItems = [];
  let refundAmount = 0;

  const listings = await getActiveListings();

  for (const item of items) {
    const itemName = item.name || item.itemName || '';
    const requestedQty = Number(item.quantity ?? 1);
    const unitAmountMinor = Number(item.unitAmount ?? 0);
    const requestedItemId = item?.itemId || item?.listingId || item?.id || null;

    console.log(`[Consumer] Checking stock for "${itemName}" (need: ${requestedQty}) cid=${correlationId || 'n/a'}`);
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

  console.log(`[Consumer] Stock check complete — status: ${status} cid=${correlationId || 'n/a'}`);

  const resultPayload = {
    orderId,
    paymentId,
    paymentIntentId: paymentIntentId || null,
    userId,
    currency,
    status,
    confirmedItems,
    insufficientItems,
    refundAmount,
    amountTotal,
    correlationId: correlationId || null,
  };

  channel.sendToQueue(
    replyTo || RESULT_QUEUE,
    Buffer.from(JSON.stringify(resultPayload)),
    {
      persistent: true,
      contentType: 'application/json',
      headers: correlationId ? { [CORRELATION_HEADER]: correlationId } : {},
    }
  );

  console.log(`[Consumer] ✅ Published inventory result for order ${orderId} to ${replyTo || RESULT_QUEUE} cid=${correlationId || 'n/a'}`);
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
  await channel.assertQueue(RESULT_QUEUE, { durable: true });
  channel.prefetch(1);

  console.log(`[Consumer] ✅ Listening on queue: ${QUEUE}`);
  console.log(`[Consumer] DLQ enabled: ${DLQ}`);
  console.log(`[Consumer] Result queue enabled: ${RESULT_QUEUE}`);

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
      const correlationId = getMessageCorrelationId(msg, payload);
      await processMessage(channel, { ...payload, correlationId }, correlationId);
      channel.ack(msg);
    } catch (err) {
      const correlationId = getMessageCorrelationId(msg, payload);
      console.error(`[Consumer] ❌ Processing failed cid=${correlationId || 'n/a'}:`, err.message);
      try {
        channel.sendToQueue(
          DLQ,
          msg.content,
          {
            persistent: true,
            contentType: 'application/json',
            headers: {
              ...(correlationId ? { [CORRELATION_HEADER]: correlationId } : {}),
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
